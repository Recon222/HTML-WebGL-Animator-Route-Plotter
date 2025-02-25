// position-worker.js
// Web Worker for physics-based position calculations and smoothing

// Enable this flag to print detailed debug info in console
const DEBUG = true;

// Constants and configuration
const CONFIG = {
    // Physics parameters
    maxAcceleration: 3.0,         // m/s²
    maxSpeed: 55.0,               // m/s (~200 km/h)
    minSpeedThreshold: 0.1,       // m/s
    bearingThreshold: 2.0,        // degrees
    earthRadius: 6371e3,          // meters
    
    // Smoothing factors
    positionSmoothing: 0.85,      // Higher = smoother but more latency
    bearingSmoothing: 0.75,       // Higher = smoother turning
    speedSmoothing: 0.8,          // Higher = smoother acceleration/deceleration
    
    // Projection parameters
    mercatorScale: 1 / (2 * Math.PI),  // Standard Mercator scale
    maxLatitude: 85.051129        // Maximum latitude in Web Mercator
};

// Add debug log function
function debugLog(...args) {
    if (DEBUG) {
        console.log('[PositionWorker]', ...args);
    }
}

// State management
let state = {
    position: null,        // Current position {lng, lat}
    velocity: {x: 0, y: 0},// Velocity in Mercator coordinates
    acceleration: {x: 0, y: 0},   // Acceleration in Mercator coordinates
    bearing: 0,           // Current bearing in degrees
    speed: 0,            // Current speed in m/s
    lastTimestamp: 0,    // Last update timestamp
    lastValidBearing: 0  // Last valid bearing calculation
};

// Helper functions for geodetic calculations
const GeoMath = {
    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    },

    toDegrees(radians) {
        return radians * (180 / Math.PI);
    },

    normalizeBearing(bearing) {
        while (bearing > 360) bearing -= 360;
        while (bearing < 0) bearing += 360;
        return bearing;
    },

    // Convert lat/lng to Mercator coordinates
    toMercator(lng, lat) {
        const x = lng * CONFIG.mercatorScale;
        const y = Math.log(Math.tan(Math.PI / 4 + this.toRadians(lat) / 2)) * CONFIG.mercatorScale;
        return {x, y};
    },

    // Convert Mercator to lat/lng
    fromMercator(x, y) {
        const lng = x / CONFIG.mercatorScale;
        const lat = this.toDegrees(2 * Math.atan(Math.exp(y / CONFIG.mercatorScale)) - Math.PI / 2);
        return {lng, lat};
    },

    // Calculate distance between two points
    calculateDistance(pos1, pos2) {
        const φ1 = this.toRadians(pos1.lat);
        const φ2 = this.toRadians(pos2.lat);
        const Δφ = this.toRadians(pos2.lat - pos1.lat);
        const Δλ = this.toRadians(pos2.lng - pos1.lng);

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return CONFIG.earthRadius * c;
    },

    // Calculate bearing between two points
    calculateBearing(pos1, pos2) {
        const φ1 = this.toRadians(pos1.lat);
        const φ2 = this.toRadians(pos2.lat);
        const λ1 = this.toRadians(pos1.lng);
        const λ2 = this.toRadians(pos2.lng);

        const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
        const x = Math.cos(φ1) * Math.sin(φ2) -
                Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
        
        return this.normalizeBearing(this.toDegrees(Math.atan2(y, x)));
    }
};

// Physics and smoothing calculations
const Physics = {
    // Apply smoothing to a value
    smooth(current, target, factor) {
        return current + (target - current) * factor;
    },

    // Smooth a bearing value (handling 0/360 wraparound)
    smoothBearing(current, target, factor) {
        let diff = target - current;
        
        // Handle wraparound
        if (Math.abs(diff) > 180) {
            diff = diff > 0 ? diff - 360 : diff + 360;
        }
        
        return GeoMath.normalizeBearing(current + diff * factor);
    },

    // Update velocity based on new position
    updateVelocity(oldPos, newPos, deltaTime) {
        const merc1 = GeoMath.toMercator(oldPos.lng, oldPos.lat);
        const merc2 = GeoMath.toMercator(newPos.lng, newPos.lat);
        
        return {
            x: (merc2.x - merc1.x) / deltaTime,
            y: (merc2.y - merc1.y) / deltaTime
        };
    },

    // Calculate acceleration from velocity change
    updateAcceleration(oldVel, newVel, deltaTime) {
        return {
            x: (newVel.x - oldVel.x) / deltaTime,
            y: (newVel.y - oldVel.y) / deltaTime
        };
    },

    // Clamp acceleration to maximum value
    clampAcceleration(acc) {
        const magnitude = Math.sqrt(acc.x * acc.x + acc.y * acc.y);
        if (magnitude > CONFIG.maxAcceleration) {
            const scale = CONFIG.maxAcceleration / magnitude;
            return {
                x: acc.x * scale,
                y: acc.y * scale
            };
        }
        return acc;
    },
    
    // Linear interpolation between two points
    lerpPosition(pos1, pos2, t) {
        return {
            lng: pos1.lng + (pos2.lng - pos1.lng) * t,
            lat: pos1.lat + (pos2.lat - pos1.lat) * t
        };
    },
    
    // Spherical linear interpolation (slerp) between two points
    slerpPosition(pos1, pos2, t) {
        // Convert to Cartesian coordinates
        const phi1 = GeoMath.toRadians(90 - pos1.lat);
        const theta1 = GeoMath.toRadians(pos1.lng);
        const phi2 = GeoMath.toRadians(90 - pos2.lat);
        const theta2 = GeoMath.toRadians(pos2.lng);
        
        // Convert to 3D Cartesian coordinates
        const x1 = Math.sin(phi1) * Math.cos(theta1);
        const y1 = Math.sin(phi1) * Math.sin(theta1);
        const z1 = Math.cos(phi1);
        
        const x2 = Math.sin(phi2) * Math.cos(theta2);
        const y2 = Math.sin(phi2) * Math.sin(theta2);
        const z2 = Math.cos(phi2);
        
        // Compute dot product
        const dot = x1 * x2 + y1 * y2 + z1 * z2;
        
        // If points are very close, use linear interpolation
        if (dot > 0.9999) {
            return this.lerpPosition(pos1, pos2, t);
        }
        
        // Compute angle between vectors
        const omega = Math.acos(Math.max(-1, Math.min(1, dot)));
        const sinOmega = Math.sin(omega);
        
        // Compute interpolation factors
        const factor1 = Math.sin((1 - t) * omega) / sinOmega;
        const factor2 = Math.sin(t * omega) / sinOmega;
        
        // Interpolate 3D coordinates
        const x = x1 * factor1 + x2 * factor2;
        const y = y1 * factor1 + y2 * factor2;
        const z = z1 * factor1 + z2 * factor2;
        
        // Convert back to lat/lng
        const phi = Math.acos(z);
        const theta = Math.atan2(y, x);
        
        return {
            lat: 90 - GeoMath.toDegrees(phi),
            lng: GeoMath.toDegrees(theta)
        };
    }
};

// Process new position data
function processPosition(newPosition, timestamp) {
    if (DEBUG) {
        debugLog('Processing new position data:', newPosition);
        debugLog('Timestamp:', timestamp);
        debugLog('Current state:', JSON.stringify(state));
    }
    
    // Check if this is an interpolation request with an interpolation factor
    if ('t' in newPosition && newPosition.targetLng !== undefined && newPosition.targetLat !== undefined) {
        debugLog('Interpolation requested with t:', newPosition.t);
        
        // Get source and target positions
        const sourcePos = { 
            lng: newPosition.lng, 
            lat: newPosition.lat 
        };
        
        const targetPos = { 
            lng: newPosition.targetLng, 
            lat: newPosition.targetLat 
        };
        
        // Use spherical interpolation for smoother movement
        const interpolatedPos = Physics.slerpPosition(
            sourcePos, 
            targetPos, 
            newPosition.t
        );
        
        debugLog('Source position:', sourcePos);
        debugLog('Target position:', targetPos);
        debugLog('Interpolated position:', interpolatedPos);
        
        // Get source and target bearings
        const sourceBearing = newPosition.bearing || 0;
        const targetBearing = newPosition.targetBearing || sourceBearing;
        
        // Smoothly interpolate bearing
        let interpolatedBearing;
        if (Math.abs(targetBearing - sourceBearing) > 180) {
            // Handle bearing wraparound
            const adjustedTarget = targetBearing > sourceBearing ? targetBearing - 360 : targetBearing + 360;
            interpolatedBearing = sourceBearing + (adjustedTarget - sourceBearing) * newPosition.t;
        } else {
            interpolatedBearing = sourceBearing + (targetBearing - sourceBearing) * newPosition.t;
        }
        
        // Normalize bearing to 0-360 range
        interpolatedBearing = GeoMath.normalizeBearing(interpolatedBearing);
        
        debugLog('Source bearing:', sourceBearing);
        debugLog('Target bearing:', targetBearing);
        debugLog('Interpolated bearing:', interpolatedBearing);
        
        // Estimate speed based on distance and time difference
        const distance = GeoMath.calculateDistance(sourcePos, targetPos);
        
        // Update state with interpolated values
        state.position = interpolatedPos;
        state.bearing = interpolatedBearing;
        state.lastTimestamp = timestamp;
        
        debugLog('Updated state:', JSON.stringify(state));
        return state;
    }

    // Initialize state if needed
    if (!state.position) {
        state.position = newPosition;
        state.lastTimestamp = timestamp;
        state.lastValidBearing = newPosition.bearing || 0;
        return state;
    }

    // Calculate time delta
    const deltaTime = (timestamp - state.lastTimestamp) / 1000; // Convert to seconds
    if (deltaTime <= 0) return state;

    // Calculate distance and bearing
    const distance = GeoMath.calculateDistance(state.position, newPosition);
    debugLog('Distance to new position:', distance, 'meters');
    
    let newBearing = state.lastValidBearing;

    if (distance > CONFIG.minSpeedThreshold) {
        newBearing = GeoMath.calculateBearing(state.position, newPosition);
        state.lastValidBearing = newBearing;
        debugLog('New bearing calculated:', newBearing);
    }

    // Update velocity and acceleration
    const newVelocity = Physics.updateVelocity(state.position, newPosition, deltaTime);
    const newAcceleration = Physics.updateAcceleration(state.velocity, newVelocity, deltaTime);
    
    debugLog('New velocity:', newVelocity);
    debugLog('New acceleration:', newAcceleration);
    
    // Apply smoothing and constraints
    state.velocity = {
        x: Physics.smooth(state.velocity.x, newVelocity.x, CONFIG.speedSmoothing),
        y: Physics.smooth(state.velocity.y, newVelocity.y, CONFIG.speedSmoothing)
    };
    
    state.acceleration = Physics.clampAcceleration(newAcceleration);
    state.bearing = Physics.smoothBearing(state.bearing, newBearing, CONFIG.bearingSmoothing);
    
    // Calculate speed
    state.speed = distance / deltaTime;
    if (state.speed > CONFIG.maxSpeed) {
        state.speed = CONFIG.maxSpeed;
    }

    // Update position with smoothing
    const rawPosition = newPosition;
    state.position = {
        lng: Physics.smooth(state.position.lng, rawPosition.lng, CONFIG.positionSmoothing),
        lat: Physics.smooth(state.position.lat, rawPosition.lat, CONFIG.positionSmoothing)
    };
    
    debugLog('Raw position:', rawPosition);
    debugLog('Smoothed position:', state.position);
    debugLog('Smoothing factor:', CONFIG.positionSmoothing);

    state.lastTimestamp = timestamp;
    
    return state;
}

// Handle messages from main thread
self.onmessage = function(e) {
    const { position, timestamp } = e.data;
    
    if (!position) {
        self.postMessage({ error: 'Invalid position data' });
        return;
    }

    try {
        debugLog('Received message:', e.data);
        const updatedState = processPosition(position, timestamp);
        
        const response = {
            position: updatedState.position,
            bearing: updatedState.bearing,
            speed: updatedState.speed,
            velocity: updatedState.velocity,
            timestamp: updatedState.lastTimestamp
        };
        
        debugLog('Sending response:', response);
        self.postMessage(response);
    } catch (error) {
        console.error('Error processing position:', error);
        self.postMessage({ error: error.message });
    }
};