// camera-control.js
// Enhanced camera control system with WebGL integration

class CameraController {
    constructor(map) {
        this.map = map;
        this.initialized = false;
        
        // Camera state
        this.state = {
            isLocked: false,
            position: null,
            bearing: 0,
            pitch: 60,
            altitude: 500,  // meters
            transitionInProgress: false,
            lastUpdateTime: 0
        };

        // Configuration
        this.config = {
            minZoom: 12,
            maxZoom: 18,
            minPitch: 45,
            maxPitch: 75,
            minAltitude: 200,   // meters
            maxAltitude: 1000,  // meters
            
            // Dynamic adjustment factors
            speedScaling: {
                altitude: 0.5,   // How much altitude increases with speed
                distance: 0.3,   // How much following distance increases with speed
                damping: 0.6     // How much smoothing increases with speed
            },
            
            // Transition settings
            transition: {
                duration: 50,    // ms
                minDuration: 16, // Minimum transition duration
                maxDuration: 100 // Maximum transition duration
            },
            
            // Movement thresholds
            thresholds: {
                position: 0.1,   // meters
                bearing: 0.5,    // degrees
                altitude: 1.0    // meters
            }
        };

        // Bind methods
        this.update = this.update.bind(this);
        this.toggleLock = this.toggleLock.bind(this);
        this.handleSpeedChange = this.handleSpeedChange.bind(this);
    }

    async initialize() {
        if (this.initialized) return;

        try {
            // Wait for map to be ready
            if (!this.map.loaded()) {
                await new Promise(resolve => this.map.on('load', resolve));
            }

            // Initialize camera position
            this.state.position = this.map.getCenter();
            
            // Add camera controls to UI
            this.setupCameraControls();
            
            // Initialize event listeners
            this.initializeEventListeners();

            this.initialized = true;
            console.log('Camera control system initialized');
        } catch (error) {
            console.error('Failed to initialize camera control:', error);
            throw error;
        }
    }

    setupCameraControls() {
        // Create camera lock button if not exists
        if (!document.getElementById('cameraLockButton')) {
            const lockButton = document.createElement('button');
            lockButton.id = 'cameraLockButton';
            lockButton.className = 'control-button';
            lockButton.title = 'Lock Camera to Vehicle';
            lockButton.innerHTML = '<span class="material-icons">videocam</span>';
            
            const controlsDiv = document.querySelector('.controls');
            const forwardButton = document.getElementById('forwardButton');
            
            if (controlsDiv && forwardButton) {
                controlsDiv.insertBefore(lockButton, forwardButton.nextSibling);
                lockButton.addEventListener('click', this.toggleLock);
            }
        }
    }

    initializeEventListeners() {
        // Handle map style changes
        this.map.on('style.load', () => {
            if (this.state.isLocked) {
                this.updateCameraPosition(true);
            }
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            if (this.state.isLocked) {
                this.updateCameraPosition(true);
            }
        });

        // Handle speed changes
        if (window.AppState && window.AppState.animation) {
            window.AppState.subscribe(state => {
                if (state.animation.speed !== this.currentSpeed) {
                    this.handleSpeedChange(state.animation.speed);
                }
            });
        }
    }

    toggleLock() {
        this.state.isLocked = !this.state.isLocked;
        
        const lockButton = document.getElementById('cameraLockButton');
        if (lockButton) {
            if (this.state.isLocked) {
                lockButton.classList.add('active');
                lockButton.querySelector('.material-icons').textContent = 'videocam_lock';
                this.captureCameraOffset();
                showNotification('Camera locked to vehicle', 'info');
            } else {
                lockButton.classList.remove('active');
                lockButton.querySelector('.material-icons').textContent = 'videocam';
                showNotification('Camera unlocked', 'info');
            }
        }
    }

    captureCameraOffset() {
        if (!this.state.isLocked) return;

        const mapCenter = this.map.getCenter();
        const vehiclePosition = window.AppState.webglLayer.getCurrentPosition();
        
        if (!vehiclePosition) return;

        // Calculate offset in world coordinates
        const centerPoint = this.map.project(mapCenter);
        const vehiclePoint = this.map.project({
            lng: vehiclePosition[0],
            lat: vehiclePosition[1]
        });

        this.state.offset = {
            x: centerPoint.x - vehiclePoint.x,
            y: centerPoint.y - vehiclePoint.y,
            zoom: this.map.getZoom(),
            bearing: this.map.getBearing() - this.state.bearing
        };
    }

    handleSpeedChange(newSpeed) {
        this.currentSpeed = newSpeed;
        
        // Adjust camera parameters based on speed
        if (this.state.isLocked) {
            const speedFactor = Math.min(newSpeed, 4) / 4; // Normalize speed to 0-1
            
            // Adjust altitude
            const altitudeRange = this.config.maxAltitude - this.config.minAltitude;
            this.state.altitude = this.config.minAltitude + 
                                (altitudeRange * speedFactor * this.config.speedScaling.altitude);
            
            // Adjust transition duration
            this.config.transition.duration = Math.max(
                this.config.transition.minDuration,
                Math.min(
                    this.config.transition.maxDuration,
                    50 / newSpeed
                )
            );
        }
    }

    update(timestamp) {
        if (!this.state.isLocked || !this.initialized) return;

        // Get current vehicle state
        const vehiclePosition = window.AppState.webglLayer.getCurrentPosition();
        const vehicleBearing = window.AppState.webglLayer.getCurrentBearing();
        
        if (!vehiclePosition) return;

        // Update camera state
        this.updateCameraState(vehiclePosition, vehicleBearing, timestamp);
    }

    updateCameraState(position, bearing, timestamp) {
        // Calculate delta time
        const deltaTime = timestamp - this.state.lastUpdateTime;
        if (deltaTime < this.config.transition.duration && !this.state.transitionInProgress) {
            return;
        }

        this.state.lastUpdateTime = timestamp;
        this.state.transitionInProgress = true;

        // Calculate target camera position
        const targetPosition = this.calculateTargetPosition(position, bearing);
        
        // Apply camera transform
        this.applyCameraTransform(targetPosition, bearing, deltaTime);
    }

    calculateTargetPosition(position, bearing) {
        // Convert bearing to radians
        const rad = ((bearing + 270) % 360) * Math.PI / 180;
        
        // Calculate distance based on speed and zoom
        const zoomFactor = Math.pow(2, 20 - this.map.getZoom());
        const speedFactor = this.currentSpeed || 1;
        const distance = zoomFactor * this.state.altitude * 
                        this.config.speedScaling.distance * speedFactor;

        // Calculate offset
        return {
            lng: position[0] + (Math.cos(rad) * distance),
            lat: position[1] + (Math.sin(rad) * distance),
            altitude: this.state.altitude
        };
    }

    applyCameraTransform(targetPosition, bearing, deltaTime) {
        // Calculate interpolation factor
        const t = Math.min(1, deltaTime / this.config.transition.duration);
        
        // Get current camera position
        const currentCenter = this.map.getCenter();
        
        // Interpolate position
        const newPosition = {
            lng: currentCenter.lng + (targetPosition.lng - currentCenter.lng) * t,
            lat: currentCenter.lat + (targetPosition.lat - currentCenter.lat) * t
        };

        // Calculate bearing difference
        let bearingDiff = bearing - this.map.getBearing();
        if (Math.abs(bearingDiff) > 180) {
            bearingDiff -= Math.sign(bearingDiff) * 360;
        }

        // Apply camera update
        try {
            this.map.easeTo({
                center: newPosition,
                bearing: bearing,
                pitch: this.state.pitch,
                duration: 0,
                easing: t => t
            });
        } catch (error) {
            console.error('Camera update error:', error);
            this.state.transitionInProgress = false;
            return;
        }

        // Reset transition flag after update
        this.state.transitionInProgress = false;
    }

    cleanup() {
        // Reset camera state
        this.state.isLocked = false;
        this.state.transitionInProgress = false;
        
        // Reset UI
        const lockButton = document.getElementById('cameraLockButton');
        if (lockButton) {
            lockButton.classList.remove('active');
            lockButton.querySelector('.material-icons').textContent = 'videocam';
        }
    }
}

// Initialize and export camera control system
let cameraController = null;

function initializeCameraSystem() {
    if (!window.AppState || !window.AppState.map) {
        console.error('Map not initialized');
        return;
    }

    cameraController = new CameraController(window.AppState.map);
    cameraController.initialize().catch(error => {
        console.error('Failed to initialize camera system:', error);
    });
}

// Export camera control interface
window.CameraControl = {
    initialize: initializeCameraSystem,
    toggle: () => cameraController?.toggleLock(),
    update: (timestamp) => cameraController?.update(timestamp),
    cleanup: () => cameraController?.cleanup()
};