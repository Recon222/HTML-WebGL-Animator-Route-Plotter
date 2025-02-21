// position-worker.js
// Web Worker for physics-based position calculations and smoothing

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
    }
};

// Process new position data
function processPosition(newPosition, timestamp) {
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
    let newBearing = state.lastValidBearing;

    if (distance > CONFIG.minSpeedThreshold) {
        newBearing = GeoMath.calculateBearing(state.position, newPosition);
        state.lastValidBearing = newBearing;
    }

    // Update velocity and acceleration
    const newVelocity = Physics.updateVelocity(state.position, newPosition, deltaTime);
    const newAcceleration = Physics.updateAcceleration(state.velocity, newVelocity, deltaTime);
    
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
    state.position = {
        lng: Physics.smooth(state.position.lng, newPosition.lng, CONFIG.positionSmoothing),
        lat: Physics.smooth(state.position.lat, newPosition.lat, CONFIG.positionSmoothing)
    };

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
        const updatedState = processPosition(position, timestamp);
        self.postMessage({
            position: updatedState.position,
            bearing: updatedState.bearing,
            speed: updatedState.speed,
            velocity: updatedState.velocity,
            timestamp: updatedState.lastTimestamp
        });
    } catch (error) {
        self.postMessage({ error: error.message });
    }
};