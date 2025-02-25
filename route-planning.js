// Import the setupRouteCompletionEvents function from route-completion.js
import { setupRouteCompletionEvents } from './route-completion.js';
// Import utility functions
import { 
    showNotification,
    formatTime,
    formatDateForInput,
    formatTimeForInput,
    generateUniqueId
} from './utils.js';
// Import from data-processing.js
import { fetchDirectionsRoute } from './data-processing.js';

// Update visualizations
function updateWaypointsLayer() {
    if (!AppState.map.getSource('waypoints')) return;
    
    // Convert waypoints to GeoJSON
    const features = AppState.planningMode.waypoints.map(waypoint => ({
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: waypoint.coordinates
        },
        properties: {
            id: waypoint.id,
            hasTimestamp: waypoint.timestamp !== null,
            timestampType: waypoint.timestampType,
            order: waypoint.order
        }
    }));
    
    // Update map source
    AppState.map.getSource('waypoints').setData({
        type: 'FeatureCollection',
        features: features
    });
}

function updateRouteSegmentsLayer() {
    if (!AppState.map.getSource('route-segments')) return;
    
    // Convert route segments to GeoJSON
    const features = AppState.planningMode.routeSegments.map(segment => ({
        type: 'Feature',
        geometry: segment.geometry,
        properties: {
            id: segment.id,
            startWaypointId: segment.startWaypointId,
            endWaypointId: segment.endWaypointId
        }
    }));
    
    // Update map source
    AppState.map.getSource('route-segments').setData({
        type: 'FeatureCollection',
        features: features
    });
}

// Route Planning Mode
function togglePlanningMode() {
    if (AppState.planningMode.active) {
        // Exit planning mode
        AppState.planningMode.active = false;
        document.getElementById('routePlanningButton').classList.remove('active');
        document.getElementById('completeRouteButton').style.display = 'none';
        
        // Clear planning UI if user cancels without saving
        if (AppState.planningMode.waypoints.length > 0 && !confirm('Discard current route?')) {
            AppState.planningMode.active = true;
            document.getElementById('routePlanningButton').classList.add('active');
            document.getElementById('completeRouteButton').style.display = 'flex';
            return;
        }
        
        // Clear planning data
        clearPlanningData();
        
        // Remove planning-specific map event listeners
        AppState.map.off('click', handleMapClick);

        // Exit planning mode UI
        document.querySelector('.container').classList.remove('planning-mode');
        
    } else {
        // Enter planning mode
        AppState.planningMode.active = true;
        document.getElementById('routePlanningButton').classList.add('active');
        
        // Initialize planning data
        clearPlanningData();
        
        // Add planning-specific map event listeners
        AppState.map.on('click', handleMapClick);
        
        // Show planning mode instructions
        showNotification('Route Planning Mode: Click on the map to place waypoints');
        
        // Show complete button if there are at least 2 waypoints
        updateCompletionButtonVisibility();

        // Enter planning mode UI
        document.querySelector('.container').classList.add('planning-mode');
        
        // Trigger a resize event to ensure the map fills the new space
        setTimeout(() => {
            AppState.map.resize();
        }, 100);
    }
}

function clearPlanningData() {
    // Clear any existing planning data
    AppState.planningMode.waypoints = [];
    AppState.planningMode.routeSegments = [];
    
    // Remove planning-specific layers
    clearPlanningLayers();
}

function clearPlanningLayers() {
    // Remove waypoint markers
    if (AppState.map.getLayer('waypoints')) {
        AppState.map.removeLayer('waypoints');
    }
    if (AppState.map.getSource('waypoints')) {
        AppState.map.removeSource('waypoints');
    }
    
    // Remove route segments
    if (AppState.map.getLayer('route-segments')) {
        AppState.map.removeLayer('route-segments');
    }
    if (AppState.map.getSource('route-segments')) {
        AppState.map.removeSource('route-segments');
    }
}

function initializePlanningSystem() {
    // Add event listener for planning mode button already set in setupEventListeners()
    
    // Initialize planning-specific map layers
    AppState.map.on('load', () => {
        // Add source for waypoints
        AppState.map.addSource('waypoints', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });
        
        // Add layer for waypoints
        AppState.map.addLayer({
            id: 'waypoints',
            type: 'circle',
            source: 'waypoints',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['boolean', ['get', 'hasTimestamp'], false],
                    '#00ff00', // Green for points with timestamps
                    '#ff9900'  // Orange for points without timestamps
                ],
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff'
            }
        });
        
        // Add source for route segments
        AppState.map.addSource('route-segments', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });
        
        // Add layer for route segments
        AppState.map.addLayer({
            id: 'route-segments',
            type: 'line',
            source: 'route-segments',
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': '#4285F4',
                'line-width': 4,
                'line-opacity': 0.8
            }
        });
        
        // Add waypoint interaction
        setupWaypointInteraction();
    });
    
    // Set up timestamp modal events
    setupTimestampModalEvents();
    
    // Set up route completion modal events
    setupRouteCompletionEvents();
}

function reinitializePlanningLayers() {
    clearPlanningLayers();
    
    // Re-add sources and layers
    AppState.map.addSource('waypoints', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: []
        }
    });
    
    AppState.map.addLayer({
        id: 'waypoints',
        type: 'circle',
        source: 'waypoints',
        paint: {
            'circle-radius': 8,
            'circle-color': [
                'case',
                ['boolean', ['get', 'hasTimestamp'], false],
                '#00ff00', // Green for points with timestamps
                '#ff9900'  // Orange for points without timestamps
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
        }
    });
    
    AppState.map.addSource('route-segments', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: []
        }
    });
    
    AppState.map.addLayer({
        id: 'route-segments',
        type: 'line',
        source: 'route-segments',
        layout: {
            'line-join': 'round',
            'line-cap': 'round'
        },
        paint: {
            'line-color': '#4285F4',
            'line-width': 4,
            'line-opacity': 0.8
        }
    });
    
    // Update layers with current data
    updateWaypointsLayer();
    updateRouteSegmentsLayer();
    
    // Re-setup interaction
    setupWaypointInteraction();
}

function setupWaypointInteraction() {
    // Waypoint hover
    AppState.map.on('mouseenter', 'waypoints', () => {
        AppState.map.getCanvas().style.cursor = 'pointer';
    });

    AppState.map.on('mouseleave', 'waypoints', () => {
        AppState.map.getCanvas().style.cursor = '';
    });

    // Add waypoint click functionality for editing
    AppState.map.on('click', 'waypoints', (e) => {
        if (!AppState.planningMode.active) return;
        
        if (e.features && e.features.length > 0) {
            const waypointId = e.features[0].properties.id;
            showTimestampModal(waypointId, waypointId === AppState.planningMode.waypoints[0].id);
            e.preventDefault(); // Prevent creating a new waypoint
        }
    });
}

// Map Click Handler
async function handleMapClick(e) {
    if (!AppState.planningMode.active) return;
    
    const coordinates = [e.lngLat.lng, e.lngLat.lat];
    
    // Create new waypoint
    const waypoint = {
        id: generateUniqueId(),
        coordinates: coordinates,
        timestamp: null,
        timestampType: 'estimated',
        order: AppState.planningMode.waypoints.length
    };
    
    // Add waypoint to state
    AppState.planningMode.waypoints.push(waypoint);
    
    // Ensure sources exist
    if (!AppState.map.getSource('waypoints')) {
        AppState.map.addSource('waypoints', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });
        
        AppState.map.addLayer({
            id: 'waypoints',
            type: 'circle',
            source: 'waypoints',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['boolean', ['get', 'hasTimestamp'], false],
                    '#00ff00', // Green for points with timestamps
                    '#ff9900'  // Orange for points without timestamps
                ],
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff'
            }
        });
    }
    
    if (!AppState.map.getSource('route-segments')) {
        AppState.map.addSource('route-segments', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });
        
        AppState.map.addLayer({
            id: 'route-segments',
            type: 'line',
            source: 'route-segments',
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': '#4285F4',
                'line-width': 4,
                'line-opacity': 0.8
            }
        });
    }
    
    // Update waypoints visualization immediately
    updateWaypointsLayer();
    
    // If this is the first waypoint, prompt for timestamp
    if (AppState.planningMode.waypoints.length === 1) {
        showTimestampModal(waypoint.id, true); // Force timestamp for first point
    } else {
        // Process route segment between previous waypoint and new waypoint
        const previousWaypoint = AppState.planningMode.waypoints[AppState.planningMode.waypoints.length - 2];
        try {
            await processRouteSegment(previousWaypoint, waypoint);
            
            // Update route segments visualization immediately
            updateRouteSegmentsLayer();
            
            // Show timestamp modal (optional for non-first points)
            showTimestampModal(waypoint.id, false);
            
            // Update completion button visibility
            updateCompletionButtonVisibility();
        } catch (error) {
            // Handle route processing error
            console.error('Error processing route segment:', error);
            // Remove the problematic waypoint
            AppState.planningMode.waypoints.pop();
            updateWaypointsLayer();
            showNotification('Error creating route segment. Please try again.', 'error');
        }
    }
}

// Update visibility of completion button
function updateCompletionButtonVisibility() {
    const button = document.getElementById('completeRouteButton');
    if (AppState.planningMode.active && AppState.planningMode.waypoints.length >= 2) {
        button.style.display = 'flex';
    } else {
        button.style.display = 'none';
    }
}

// Route Segment Processing
async function processRouteSegment(startWaypoint, endWaypoint) {
    try {
        const response = await fetchDirectionsRoute(
            startWaypoint.coordinates,
            endWaypoint.coordinates
        );
        
        // Extract route data
        const route = response.routes[0];
        const geometry = route.geometry;
        const duration = route.duration; // seconds
        
        // Create route segment object
        const routeSegment = {
            id: `segment-${startWaypoint.id}-${endWaypoint.id}`,
            geometry: geometry,
            duration: duration,
            startWaypointId: startWaypoint.id,
            endWaypointId: endWaypoint.id,
            startTimestamp: startWaypoint.timestamp,
            endTimestamp: endWaypoint.timestamp
        };
        
        // Calculate estimated timestamp for end waypoint if not set manually
        if (startWaypoint.timestamp && !endWaypoint.timestamp) {
            const estimatedTimestamp = new Date(startWaypoint.timestamp.getTime() + duration * 1000);
            endWaypoint.timestamp = estimatedTimestamp;
            endWaypoint.timestampType = 'estimated';
        }
        
        // Add segment to state
        AppState.planningMode.routeSegments.push(routeSegment);
        
        // Update route visualization
        updateRouteSegmentsLayer();
        
        return routeSegment;
    } catch (error) {
        console.error('Error processing route segment:', error);
        showNotification('Error creating route segment. Please try again.', 'error');
        throw error;
    }
}

// Timestamp Modal Management
let currentEditingWaypointId = null;
let isFirstWaypoint = false;

function setupTimestampModalEvents() {
    // Type selection change
    document.querySelectorAll('input[name="timestampType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            updateTimestampInputVisibility(e.target.value);
        });
    });
    
    // Save button
    document.getElementById('saveTimestampButton').addEventListener('click', () => {
        saveWaypointTimestamp();
    });
    
    // Dismiss button
    document.getElementById('dismissTimestampButton').addEventListener('click', () => {
        document.getElementById('timestampModal').style.display = 'none';
        
        // For first waypoint, we need a timestamp - don't allow dismiss
        if (isFirstWaypoint) {
            showNotification('First waypoint must have a timestamp', 'warning');
            showTimestampModal(currentEditingWaypointId, true);
        }
    });
    
    // Close button
    document.getElementById('closeTimestampModal').addEventListener('click', () => {
        // Same logic as dismiss
        document.getElementById('timestampModal').style.display = 'none';
        
        if (isFirstWaypoint) {
            showNotification('First waypoint must have a timestamp', 'warning');
            showTimestampModal(currentEditingWaypointId, true);
        }
    });
}

function showTimestampModal(waypointId, isFirst = false) {
    const waypoint = AppState.planningMode.waypoints.find(wp => wp.id === waypointId);
    if (!waypoint) return;
    
    currentEditingWaypointId = waypointId;
    isFirstWaypoint = isFirst;
    
    // Update modal content
    document.getElementById('waypointOrder').textContent = waypoint.order + 1;
    
    // Set timestamp type radio buttons
    let timestampType = waypoint.timestampType || 'estimated';
    if (waypoint.timestamp === null) timestampType = 'none';
    document.querySelector(`input[name="timestampType"][value="${timestampType}"]`).checked = true;
    
    // Set date/time inputs
    if (waypoint.timestamp) {
        const date = new Date(waypoint.timestamp);
        document.getElementById('timestampDate').value = formatDateForInput(date);
        document.getElementById('timestampTime').value = formatTimeForInput(date);
    } else {
        // Use current date as default
        const now = new Date();
        document.getElementById('timestampDate').value = formatDateForInput(now);
        document.getElementById('timestampTime').value = formatTimeForInput(now);
    }
    
    // Show estimated timestamp if available
    if (waypoint.order > 0) {
        const estimatedTime = getEstimatedTimestamp(waypoint);
        if (estimatedTime) {
            document.getElementById('estimatedTimestamp').textContent = formatTime(
                (estimatedTime.getTime() - getRouteStartTime().getTime()) / 1000
            );
            document.getElementById('estimatedTimestampInfo').style.display = 'block';
        } else {
            document.getElementById('estimatedTimestampInfo').style.display = 'none';
        }
    } else {
        document.getElementById('estimatedTimestampInfo').style.display = 'none';
    }
    
    // Show/hide timestamp inputs based on selection
    updateTimestampInputVisibility(timestampType);
    
    // Configure buttons
    if (isFirst) {
        // First waypoint must have a timestamp
        document.getElementById('timestampTypeNone').disabled = true;
        document.getElementById('dismissTimestampButton').style.display = 'none';
    } else {
        document.getElementById('timestampTypeNone').disabled = false;
        document.getElementById('dismissTimestampButton').style.display = 'block';
    }
    
    // Show modal
    document.getElementById('timestampModal').style.display = 'flex';
}

function updateTimestampInputVisibility(type) {
    const container = document.getElementById('timestampInputContainer');
    if (type === 'none') {
        container.style.display = 'none';
    } else {
        container.style.display = 'block';
    }
}

function getEstimatedTimestamp(waypoint) {
    // If this is the first waypoint, there's no estimate
    if (waypoint.order === 0) return null;
    
    // Get the closest previous waypoint with a timestamp
    let closestPrevious = null;
    for (let i = waypoint.order - 1; i >= 0; i--) {
        if (AppState.planningMode.waypoints[i].timestamp) {
            closestPrevious = AppState.planningMode.waypoints[i];
            break;
        }
    }
    
    if (!closestPrevious) return null;
    
    // Find all segments between the closest previous and current waypoint
    let cumulativeDuration = 0;
    let currentId = closestPrevious.id;
    
    while (currentId !== waypoint.id) {
        const segment = AppState.planningMode.routeSegments.find(
            seg => seg.startWaypointId === currentId
        );
        
        if (!segment) break;
        
        cumulativeDuration += segment.duration;
        currentId = segment.endWaypointId;
    }
    
    // Calculate estimated time
    return new Date(closestPrevious.timestamp.getTime() + cumulativeDuration * 1000);
}

function getRouteStartTime() {
    // Get timestamp of the first waypoint
    const firstWaypoint = AppState.planningMode.waypoints[0];
    return firstWaypoint?.timestamp || new Date();
}

function saveWaypointTimestamp() {
    const waypoint = AppState.planningMode.waypoints.find(wp => wp.id === currentEditingWaypointId);
    if (!waypoint) return;
    
    const timestampType = document.querySelector('input[name="timestampType"]:checked').value;
    
    if (timestampType === 'none') {
        // Use estimated timestamp
        waypoint.timestamp = null;
        waypoint.timestampType = 'estimated';
    } else {
        // Get date/time values
        const dateStr = document.getElementById('timestampDate').value;
        const timeStr = document.getElementById('timestampTime').value;
        
        if (!dateStr || !timeStr) {
            showNotification('Please enter both date and time', 'error');
            return;
        }
        
        // Create timestamp
        try {
            const timestamp = new Date(`${dateStr}T${timeStr}`);
            waypoint.timestamp = timestamp;
            waypoint.timestampType = timestampType;
        } catch (error) {
            showNotification('Invalid date/time format', 'error');
            return;
        }
    }
    
    // Update segments that use this waypoint
    updateAffectedSegments(waypoint);
    
    // Update visualizations
    updateWaypointsLayer();
    updateRouteSegmentsLayer();
    
    // Close modal
    document.getElementById('timestampModal').style.display = 'none';
}

function updateAffectedSegments(waypoint) {
    // Update segments where this waypoint is the start
    AppState.planningMode.routeSegments.forEach(segment => {
        if (segment.startWaypointId === waypoint.id) {
            segment.startTimestamp = waypoint.timestamp;
            
            // Update end waypoint's estimated time if needed
            const endWaypoint = AppState.planningMode.waypoints.find(wp => wp.id === segment.endWaypointId);
            if (endWaypoint && endWaypoint.timestampType === 'estimated') {
                if (waypoint.timestamp) {
                    endWaypoint.timestamp = new Date(waypoint.timestamp.getTime() + segment.duration * 1000);
                } else {
                    endWaypoint.timestamp = null;
                }
            }
        }
        
        // Update segments where this waypoint is the end
        if (segment.endWaypointId === waypoint.id) {
            segment.endTimestamp = waypoint.timestamp;
        }
    });
    
    // Recursively update subsequent estimated timestamps
    if (waypoint.timestamp) {
        updateSubsequentTimestamps(waypoint);
    }
}

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

// Export the functions needed by app-state.js and route-completion.js
export { 
    initializePlanningSystem,
    togglePlanningMode,
    updateWaypointsLayer,
    updateRouteSegmentsLayer,
    setupWaypointInteraction,
    handleMapClick,
    showTimestampModal
};