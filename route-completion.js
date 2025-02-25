// At the top of file, if needed
// import AppState from './app-state.js'; 
// If using the global AppState, this import is not needed

// Import utility functions
import { 
    formatTime, 
    formatDateTime, 
    generateUniqueId,
    showNotification
} from './utils.js';

// Import from data-processing.js
import { processData, createRouteGeoJSON } from './data-processing.js';

// Import from route-planning.js
import { showTimestampModal, togglePlanningMode } from './route-planning.js';

function updateSubsequentTimestamps(startWaypoint) {
    // Find next segment
    const nextSegment = AppState.planningMode.routeSegments.find(
        segment => segment.startWaypointId === startWaypoint.id
    );
    
    if (!nextSegment) return;
    
    // Get end waypoint
    const endWaypoint = AppState.planningMode.waypoints.find(
        wp => wp.id === nextSegment.endWaypointId
    );
    
    if (!endWaypoint) return;
    
    // Only update if the end waypoint uses estimated timestamps
    if (endWaypoint.timestampType === 'estimated') {
        // Update timestamp
        endWaypoint.timestamp = new Date(startWaypoint.timestamp.getTime() + nextSegment.duration * 1000);
        
        // Update next segment
        nextSegment.endTimestamp = endWaypoint.timestamp;
        
        // Recursively update subsequent waypoints
        updateSubsequentTimestamps(endWaypoint);
    }
}

// Add missing vehicle initialization function
function initializeVehicle() {
    if (!AppState.map.getSource('vehicle')) {
        AppState.map.addSource('vehicle', {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [0, 0]
                },
                properties: {
                    bearing: 0
                }
            }
        });
        
        AppState.map.addLayer({
            id: 'vehicle',
            type: 'symbol',
            source: 'vehicle',
            layout: {
                'icon-image': 'vehicle-marker',
                'icon-size': 1,
                'icon-allow-overlap': true,
                'icon-rotate': ['get', 'bearing']
            }
        });
    }
}

// Route Completion Modal
function setupRouteCompletionEvents() {
    // Close button
    document.getElementById('closeRouteCompletionModal').addEventListener('click', () => {
        document.getElementById('routeCompletionModal').style.display = 'none';
    });
    
    // Cancel button
    document.getElementById('cancelCompletionButton').addEventListener('click', () => {
        document.getElementById('routeCompletionModal').style.display = 'none';
    });
    
    // Complete route button
    document.getElementById('completeRouteButton').addEventListener('click', () => {
        finalizeRoute();
    });
}

function showRouteCompletionModal() {
    if (AppState.planningMode.waypoints.length < 2) {
        showNotification('Need at least two waypoints to complete a route', 'warning');
        return;
    }
    
    // Check if first waypoint has a timestamp
    const firstWaypoint = AppState.planningMode.waypoints[0];
    if (!firstWaypoint.timestamp) {
        showNotification('First waypoint must have a timestamp', 'warning');
        showTimestampModal(firstWaypoint.id, true);
        return;
    }
    
    // Populate waypoints list
    populateWaypointsList();
    
    // Calculate and display route summary
    updateRouteSummary();
    
    // Show modal
    document.getElementById('routeCompletionModal').style.display = 'flex';
}

function populateWaypointsList() {
    const waypointsList = document.getElementById('waypointsList');
    waypointsList.innerHTML = '';
    
    AppState.planningMode.waypoints.forEach((waypoint, index) => {
        const waypointItem = document.createElement('div');
        waypointItem.className = 'waypoint-item';
        
        // Format timestamp display
        let timestampDisplay = 'No timestamp';
        let timestampBadge = '';
        
        if (waypoint.timestamp) {
            timestampDisplay = waypoint.timestamp.toLocaleTimeString();
            const badgeClass = waypoint.timestampType === 'confirmed' ? 'confirmed' : 'estimated';
            timestampBadge = `<span class="timestamp-badge ${badgeClass}">${waypoint.timestampType}</span>`;
        }
        
        waypointItem.innerHTML = `
            <div class="waypoint-marker">${index + 1}</div>
            <div class="waypoint-details">
                <div class="waypoint-coordinates">
                    ${waypoint.coordinates[0].toFixed(5)}, ${waypoint.coordinates[1].toFixed(5)}
                </div>
                <div class="waypoint-timestamp">
                    ${timestampDisplay} ${timestampBadge}
                </div>
            </div>
            <button class="edit-timestamp-button" data-waypoint-id="${waypoint.id}">
                <span class="material-icons">edit</span>
            </button>
        `;
        
        waypointsList.appendChild(waypointItem);
    });
    
    // Add edit button functionality
    document.querySelectorAll('.edit-timestamp-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const waypointId = e.currentTarget.dataset.waypointId;
            document.getElementById('routeCompletionModal').style.display = 'none';
            showTimestampModal(waypointId, waypointId === AppState.planningMode.waypoints[0].id);
            
            // Re-open completion modal after timestamp modal closes
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.attributeName === 'style' && 
                        document.getElementById('timestampModal').style.display === 'none') {
                        showRouteCompletionModal();
                        observer.disconnect();
                    }
                });
            });
            
            observer.observe(document.getElementById('timestampModal'), {attributes: true});
        });
    });
}

function updateRouteSummary() {
    // Calculate total distance
    let totalDistance = 0;
    AppState.planningMode.routeSegments.forEach(segment => {
        const coordinates = segment.geometry.coordinates;
        for (let i = 1; i < coordinates.length; i++) {
            totalDistance += turf.distance(
                turf.point(coordinates[i-1]),
                turf.point(coordinates[i]),
                {units: 'kilometers'}
            );
        }
    });
    
    // Calculate total duration
    let totalDuration = 0;
    AppState.planningMode.routeSegments.forEach(segment => {
        totalDuration += segment.duration;
    });
    
    // Get start and end times
    const firstWaypoint = AppState.planningMode.waypoints[0];
    const lastWaypoint = AppState.planningMode.waypoints[AppState.planningMode.waypoints.length - 1];
    
    // Update display
    document.getElementById('totalDistance').textContent = `${totalDistance.toFixed(2)} km`;
    document.getElementById('totalDuration').textContent = formatTime(totalDuration);
    
    if (firstWaypoint.timestamp) {
        document.getElementById('startTime').textContent = formatDateTime(firstWaypoint.timestamp);
    } else {
        document.getElementById('startTime').textContent = 'Not set';
    }
    
    if (lastWaypoint.timestamp) {
        document.getElementById('endTime').textContent = formatDateTime(lastWaypoint.timestamp);
    } else {
        document.getElementById('endTime').textContent = 'Not set';
    }
}

function finalizeRoute() {
    // Get route name
    const routeName = document.getElementById('routeName').value.trim() || 
                     `Route ${new Date().toLocaleString()}`;
    
    // Create GeoJSON for the route
    const routeData = createRouteGeoJSON(routeName);
    
    if (!routeData) {
        showNotification('Failed to create route data', 'error');
        return;
    }
    
    // Add to timeline
    processData(routeData);
    
    // Ensure vehicle layer exists and is visible
    if (!AppState.map.getLayer('vehicle')) {
        initializeVehicle();
    }
    
    // Update vehicle position to start of route
    if (routeData.features.length > 0) {
        const startPoint = routeData.features[0];
        AppState.map.getSource('vehicle').setData({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: startPoint.geometry.coordinates
            },
            properties: {
                bearing: startPoint.properties.bearing || 0
            }
        });
        
        // Center map on start point
        AppState.map.flyTo({
            center: startPoint.geometry.coordinates,
            zoom: 15,
            duration: 1000
        });
    }
    
    // Exit planning mode
    togglePlanningMode();
    
    // Close modal
    document.getElementById('routeCompletionModal').style.display = 'none';
    
    // Show success message
    showNotification(`Route "${routeName}" created successfully`, 'info');
}

// Layer Management System

function isRelevantLayer(layer) {
    // Layer patterns we want to include
    const relevantPatterns = [
        // Street/Road Labels
        /road-label/,
        /street-label/,
        
        // Cities and Towns
        /settlement-major-label/,
        /settlement-minor-label/,
        
        // Districts and Neighborhoods
        /settlement-subdivision-label/,
        
        // Places and POIs
        /poi-label/,
        
        // Transit (including airports and airways)
        /transit-label/,
        /transit-station/,
        /-transit$/,
        /airport-label/,
        /aeroway-/,
        
        // Buildings
        /building-label/,
        /building$/
    ];

    // Check if layer ID matches any of our patterns
    return relevantPatterns.some(pattern => pattern.test(layer.id));
}

function getLayerGroup(layer) {
    // Group airport-related layers
    if (layer.id.includes('airport') || layer.id.includes('aeroway')) {
        return {
            id: 'airports',
            name: 'Airports',
            pattern: id => id.includes('airport') || id.includes('aeroway')
        };
    }
    
    // Group road labels
    if (layer.id.includes('road-label') || layer.id.includes('street-label')) {
        return {
            id: 'road-labels',
            name: 'Road Labels',
            pattern: id => id.includes('road-label') || id.includes('street-label')
        };
    }
    
    // Group city/town labels
    if (layer.id.includes('settlement-major') || layer.id.includes('settlement-minor')) {
        return {
            id: 'city-labels',
            name: 'Cities & Towns',
            pattern: id => id.includes('settlement-major') || id.includes('settlement-minor')
        };
    }
    
    // Return individual layer if no group
    return {
        id: layer.id,
        name: layer.id
            .replace(/-/g, ' ')
            .replace(/label/g, '')
            .replace('settlement major', 'Cities')
            .replace('settlement minor', 'Towns')
            .replace('settlement subdivision', 'Districts/Neighborhoods')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
            .trim(),
        pattern: id => id === layer.id
    };
}

function initializeLayerControls() {
    const layerControls = document.querySelector('.layer-controls');
    if (!layerControls || !AppState.map) return;
    
    // Clear existing controls
    layerControls.innerHTML = '';
    
    try {
        const layers = AppState.map.getStyle().layers;
        
        // Filter relevant layers and group them
        const relevantLayers = layers.filter(layer => isRelevantLayer(layer));
        const layerGroups = new Map();
        
        relevantLayers.forEach(layer => {
            const group = getLayerGroup(layer);
            if (!layerGroups.has(group.id)) {
                layerGroups.set(group.id, {
                    name: group.name,
                    pattern: group.pattern,
                    layers: []
                });
            }
            layerGroups.get(group.id).layers.push(layer);
        });
        
        // Create controls for each group
        layerGroups.forEach(group => {
            const layerItem = document.createElement('div');
            layerItem.className = 'layer-item';
            
            // Toggle switch
            const toggleContainer = document.createElement('label');
            toggleContainer.className = 'toggle-switch';
            
            const toggleInput = document.createElement('input');
            toggleInput.type = 'checkbox';
            toggleInput.checked = group.layers.some(layer => layer.layout?.visibility !== 'none');
            
            const toggleSlider = document.createElement('span');
            toggleSlider.className = 'toggle-slider';
            
            toggleContainer.appendChild(toggleInput);
            toggleContainer.appendChild(toggleSlider);
            
            // Layer details
            const layerDetails = document.createElement('div');
            layerDetails.className = 'layer-details';
            
            const layerName = document.createElement('div');
            layerName.className = 'layer-name';
            layerName.textContent = group.name;
            layerName.title = `Contains ${group.layers.length} layer(s): ${group.layers.map(l => l.id).join(', ')}`;
            
            layerDetails.appendChild(layerName);
            
            // Single opacity slider for the group
            if (group.layers.some(layer => `${layer.type}-opacity` in (layer.paint || {}))) {
                const opacitySlider = document.createElement('input');
                opacitySlider.type = 'range';
                opacitySlider.className = 'opacity-slider';
                opacitySlider.min = 0;
                opacitySlider.max = 1;
                opacitySlider.step = 0.1;
                
                // Find average opacity to set initial value
                const opacitySum = group.layers.reduce((sum, layer) => {
                    const opacityProperty = `${layer.type}-opacity`;
                    if (layer.paint && opacityProperty in layer.paint) {
                        return sum + layer.paint[opacityProperty];
                    }
                    return sum + 1; // Default opacity
                }, 0);
                opacitySlider.value = opacitySum / group.layers.length;
                
                opacitySlider.addEventListener('input', (e) => {
                    const value = parseFloat(e.target.value);
                    group.layers.forEach(layer => {
                        const opacityProperty = `${layer.type}-opacity`;
                        if (layer.paint && opacityProperty in layer.paint) {
                            AppState.map.setPaintProperty(layer.id, opacityProperty, value);
                        }
                    });
                });
                
                layerDetails.appendChild(opacitySlider);
            }
            
            // Toggle event listener
            toggleInput.addEventListener('change', (e) => {
                const visibility = e.target.checked ? 'visible' : 'none';
                group.layers.forEach(layer => {
                    try {
                        AppState.map.setLayoutProperty(layer.id, 'visibility', visibility);
                    } catch (err) {
                        console.warn(`Could not set visibility for layer ${layer.id}`, err);
                    }
                });
            });
            
            // Assemble layer item
            layerItem.appendChild(toggleContainer);
            layerItem.appendChild(layerDetails);
            
            layerControls.appendChild(layerItem);
        });
        
        // Update reset button functionality
        document.querySelector('.reset-button').addEventListener('click', () => {
            layerGroups.forEach(group => {
                group.layers.forEach(layer => {
                    // Reset visibility
                    try {
                        AppState.map.setLayoutProperty(layer.id, 'visibility', 'visible');
                    } catch (err) {
                        console.warn(`Could not reset visibility for layer ${layer.id}`, err);
                    }
                    
                    // Reset opacity
                    const opacityProperty = `${layer.type}-opacity`;
                    if (layer.paint && opacityProperty in layer.paint) {
                        try {
                            AppState.map.setPaintProperty(layer.id, opacityProperty, 1);
                        } catch (err) {
                            console.warn(`Could not reset opacity for layer ${layer.id}`, err);
                        }
                    }
                });
            });
            
            // Refresh controls
            initializeLayerControls();
        });
    } catch (error) {
        console.error('Error initializing layer controls:', error);
        layerControls.innerHTML = '<div class="error-message">Error loading map layers. Try changing map style.</div>';
    }
}

// Utility: Calculate Distance Between Coordinates
function calculateDistance(coordinates) {
    let totalDistance = 0;
    for (let i = 1; i < coordinates.length; i++) {
        totalDistance += turf.distance(
            turf.point(coordinates[i-1]),
            turf.point(coordinates[i]),
            {units: 'kilometers'}
        );
    }
    return totalDistance;
}

// Make functions globally available to avoid circular dependencies
window.showRouteCompletionModal = showRouteCompletionModal;
window.setupRouteCompletionEvents = setupRouteCompletionEvents;
window.initializeLayerControls = initializeLayerControls;

// Also export functions for modules that prefer imports
export { 
    showRouteCompletionModal, 
    setupRouteCompletionEvents, 
    initializeLayerControls, 
    initializeVehicle 
};