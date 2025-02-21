async function handleFileImport(file) {
    try {
        const fileType = file.name.split('.').pop().toLowerCase();
        const content = await readFileContent(file);
        
        let data;
        if (fileType === 'csv') {
            data = await parseCSV(content);
        } else if (fileType === 'kml') {
            data = await parseKML(content);
        } else {
            throw new Error('Unsupported file type');
        }

        processData(data);
        showNotification(`Successfully loaded ${file.name}`, 'info');
    } catch (error) {
        console.error('Error importing file:', error);
        showNotification('Error importing file: ' + error.message, 'error');
    }
}

function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Error reading file'));
        reader.readAsText(file);
    });
}

async function parseCSV(content) {
    return new Promise((resolve, reject) => {
        Papa.parse(content, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: (results) => {
                if (results.errors && results.errors.length > 0) {
                    console.warn('CSV parsing warnings:', results.errors);
                }
                
                const features = results.data
                    .filter(row => row.latitude && row.longitude && row.timestamp)
                    .map(row => ({
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: [row.longitude, row.latitude]
                        },
                        properties: {
                            timestamp: new Date(row.timestamp).getTime(),
                            bearing: row.bearing || 0,
                            speed: row.speed,
                            altitude: row.altitude,
                            accuracy: row.accuracy
                        }
                    }));

                resolve({
                    type: 'FeatureCollection',
                    features: features,
                    properties: {
                        source: 'csv-import',
                        filename: 'import.csv',
                        importedAt: new Date().toISOString()
                    }
                });
            },
            error: reject
        });
    });
}

async function parseKML(content) {
    try {
        const parser = new DOMParser();
        const kml = parser.parseFromString(content, 'text/xml');
        const geoJSON = toGeoJSON.kml(kml);

        const features = geoJSON.features
            .filter(feature => feature.geometry.type === 'Point')
            .map(feature => {
                // Try to extract timestamp from different possible KML structures
                let timestamp = feature.properties.timeStamp || 
                               feature.properties.timestamp || 
                               feature.properties.when;
                               
                // Some KML files use <when> tag inside <TimeStamp>
                if (!timestamp && feature.properties.TimeStamp) {
                    timestamp = feature.properties.TimeStamp.when;
                }
                
                return {
                    type: 'Feature',
                    geometry: feature.geometry,
                    properties: {
                        timestamp: new Date(timestamp).getTime(),
                        bearing: feature.properties.bearing || feature.properties.heading || 0,
                        name: feature.properties.name,
                        description: feature.properties.description
                    }
                };
            })
            .filter(feature => !isNaN(feature.properties.timestamp))
            .sort((a, b) => a.properties.timestamp - b.properties.timestamp);

        return {
            type: 'FeatureCollection',
            features: features,
            properties: {
                source: 'kml-import',
                filename: 'import.kml',
                importedAt: new Date().toISOString()
            }
        };
    } catch (error) {
        console.error('Error parsing KML:', error);
        throw new Error('Invalid KML file structure');
    }
}

function processData(data) {
    // Validate data
    if (!data || !data.features || data.features.length === 0) {
        showNotification('No valid tracking points found in file', 'error');
        return;
    }
    
    // Sort features by timestamp
    data.features.sort((a, b) => a.properties.timestamp - b.properties.timestamp);

    // Calculate duration and prepare animation
    const firstTime = data.features[0].properties.timestamp;
    data.features.forEach(feature => {
        feature.properties.elapsedTime = (feature.properties.timestamp - firstTime) / 1000;
    });

    // Update AppState
    AppState.data = data;
    AppState.animation.currentTime = 0;
    AppState.animation.duration = data.features[data.features.length - 1].properties.elapsedTime;
    AppState.animation.currentPoint = 0;
    AppState.animation.isPlaying = false;

    // Calculate bounds
    const bounds = new mapboxgl.LngLatBounds();
    data.features.forEach(feature => {
        bounds.extend(feature.geometry.coordinates);
    });
    AppState.bounds = bounds;

    // Fit map to bounds
    AppState.map.fitBounds(bounds, {
        padding: 50,
        duration: 2000
    });

    // Initialize timeline
    updateTimeline();
    updatePlaybackDisplay();
    updateVehiclePosition();
}

// Calculate bearing between points with smoothing
function calculateBearing(point1, point2) {
    // Convert to turf points
    const start = turf.point(point1);
    const end = turf.point(point2);
    
    // Calculate raw bearing
    let bearing = turf.bearing(start, end);
    
    // Normalize to 0-360 range
    return (bearing + 360) % 360;
}

// Create Route GeoJSON
function createRouteGeoJSON(routeName) {
    if (!AppState.planningMode.waypoints.length || !AppState.planningMode.routeSegments.length) {
        showNotification('Cannot create route: No waypoints defined', 'error');
        return null;
    }
    
    const startTime = AppState.planningMode.waypoints[0].timestamp.getTime();
    const routePoints = [];
    
    AppState.planningMode.routeSegments.forEach(segment => {
        const startWaypoint = AppState.planningMode.waypoints.find(w => w.id === segment.startWaypointId);
        const endWaypoint = AppState.planningMode.waypoints.find(w => w.id === segment.endWaypointId);
        
        if (!startWaypoint || !endWaypoint || !startWaypoint.timestamp || !endWaypoint.timestamp) return;
        
        // Get route geometry
        const coordinates = segment.geometry.coordinates;
        
        // Calculate segment time
        const segmentStartTime = startWaypoint.timestamp.getTime();
        const segmentEndTime = endWaypoint.timestamp.getTime();
        const timeDiff = segmentEndTime - segmentStartTime;
        
        // Calculate total segment distance
        let totalDistance = 0;
        for (let i = 1; i < coordinates.length; i++) {
            totalDistance += turf.distance(
                turf.point(coordinates[i-1]),
                turf.point(coordinates[i]),
                { units: 'kilometers' }
            );
        }
        
        // Generate points every ~1 second based on estimated speed
        const averageSpeed = totalDistance / (timeDiff / 1000); // km/s
        const pointsNeeded = Math.max(
            Math.ceil(timeDiff / 1000), // At least one point per second
            Math.ceil(totalDistance * 1000) // Or one point every meter
        );
        
        // Generate interpolated points
        let lastBearing = null;
        for (let i = 0; i <= pointsNeeded; i++) {
            const progress = i / pointsNeeded;
            
            // Find the appropriate line segment for this progress
            let cumulativeDistance = 0;
            let segmentStart = 0;
            
            for (let j = 1; j < coordinates.length; j++) {
                const segmentDistance = turf.distance(
                    turf.point(coordinates[j-1]),
                    turf.point(coordinates[j]),
                    { units: 'kilometers' }
                );
                
                if (cumulativeDistance + segmentDistance >= totalDistance * progress) {
                    segmentStart = j - 1;
                    break;
                }
                cumulativeDistance += segmentDistance;
            }
            
            // Interpolate within the line segment
            const segmentProgress = (totalDistance * progress - cumulativeDistance) / 
                turf.distance(
                    turf.point(coordinates[segmentStart]),
                    turf.point(coordinates[segmentStart + 1]),
                    { units: 'kilometers' }
                );
            
            const interpolatedPoint = [
                coordinates[segmentStart][0] + (coordinates[segmentStart + 1][0] - coordinates[segmentStart][0]) * segmentProgress,
                coordinates[segmentStart][1] + (coordinates[segmentStart + 1][1] - coordinates[segmentStart][1]) * segmentProgress
            ];
            
            // Calculate timestamp
            const timestamp = segmentStartTime + (timeDiff * progress);
            
            // Calculate bearing directly without smoothing
            let bearing;
            if (i === 0 && routePoints.length > 0) {
                bearing = routePoints[routePoints.length - 1].properties.bearing;
            } else {
                // Calculate bearing directly without smoothing
                bearing = calculateBearing(interpolatedPoint, lookAheadPoint);
            }
            
            routePoints.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: interpolatedPoint
                },
                properties: {
                    timestamp: timestamp,
                    elapsedTime: (timestamp - startTime) / 1000,
                    bearing: bearing
                }
            });
        }
    });
    
    return {
        type: 'FeatureCollection',
        features: routePoints,
        properties: {
            name: routeName,
            createdAt: new Date().toISOString(),
            source: 'user-created',
            waypointCount: AppState.planningMode.waypoints.length,
            confirmedTimestamps: AppState.planningMode.waypoints.filter(wp => 
                wp.timestampType === 'confirmed').length
        }
    };
}

// Get Route from Timeline
function getRouteFromTimeline(index) {
    // Extract route data from timeline
    // This is dependent on how routes are stored in the timeline
    const timelineContent = document.getElementById('timelineContent');
    const tripGroups = timelineContent.querySelectorAll('.trip-group');
    
    if (index < 0 || index >= tripGroups.length) {
        return null;
    }
    
    // Get the timeline data (assumes current data is the selected route)
    // In a more complex implementation, we'd store multiple routes
    if (!AppState.data || !AppState.data.features || !AppState.data.features.length) {
        return null;
    }
    
    // Clone to avoid modifying original
    return JSON.parse(JSON.stringify(AppState.data));
}

// Find Significant Points
function findSignificantPoints(features) {
    const significantIndices = [0]; // Always include the first point
    
    // Determine route length
    const routeLength = features.length;
    
    // If very short route, use all points
    if (routeLength <= 10) {
        return Array.from({length: routeLength}, (_, i) => i);
    }
    
    // For longer routes, use an adaptive approach
    let lastDirection = null;
    let lastSignificantIndex = 0;
    
    for (let i = 1; i < routeLength - 1; i++) {
        // Include points where direction changes significantly
        const prevPoint = features[i-1].geometry.coordinates;
        const currentPoint = features[i].geometry.coordinates;
        const nextPoint = features[i+1].geometry.coordinates;
        
        const currentDirection = calculateBearing(prevPoint, currentPoint);
        const nextDirection = calculateBearing(currentPoint, nextPoint);
        
        const directionChange = Math.abs(nextDirection - currentDirection);
        const normalizedChange = directionChange > 180 ? 360 - directionChange : directionChange;
        
        // Add points where:
        // 1. Direction changes significantly (e.g., turns)
        // 2. Reasonable distance from last significant point
        const distanceFromLast = i - lastSignificantIndex;
        
        if ((normalizedChange > 30 && distanceFromLast > 5) || distanceFromLast > 100) {
            significantIndices.push(i);
            lastSignificantIndex = i;
        }
        
        lastDirection = nextDirection;
    }
    
    // Always include the last point
    if (significantIndices[significantIndices.length - 1] !== routeLength - 1) {
        significantIndices.push(routeLength - 1);
    }
    
    return significantIndices;
}

// Fetch directions from Mapbox API
async function fetchDirectionsRoute(startCoords, endCoords) {
    const accessToken = mapboxgl.accessToken;
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${startCoords[0]},${startCoords[1]};${endCoords[0]},${endCoords[1]}?alternatives=false&geometries=geojson&steps=false&overview=full&access_token=${accessToken}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Directions API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        if (!data.routes || data.routes.length === 0) {
            throw new Error('No route found between the points');
        }
        
        return data;
    } catch (error) {
        console.error('Error fetching directions:', error);
        showNotification('Failed to get route: ' + error.message, 'error');
        throw error;
    }
}