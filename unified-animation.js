// unified-animation.js
// Coordinates WebGL rendering, position calculations, and animation timeline

class UnifiedAnimationController {
    constructor(map, webglLayer) {
        this.map = map;
        this.webglLayer = webglLayer;
        this.positionWorker = null;
        
        // Animation state
        this.state = {
            isPlaying: false,
            currentTime: 0,
            duration: 0,
            speed: 1.0,
            lastFrameTime: 0
        };

        // Track data
        this.trackData = {
            features: [],
            currentIndex: 0,
            timeRange: { start: 0, end: 0 }
        };

        // Camera state
        this.camera = {
            isLocked: false,
            offset: { x: 0, y: 0, zoom: 0 },
            dampingRatio: 0.6
        };

        // Performance monitoring
        this.performance = {
            frameCount: 0,
            lastFpsUpdate: 0,
            fps: 0,
            frameTimes: []
        };

        // Bind methods
        this.animate = this.animate.bind(this);
        this.updatePosition = this.updatePosition.bind(this);
        this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
    }

    async initialize() {
        // Initialize position worker
        this.positionWorker = new Worker('position-worker.js');
        this.positionWorker.onmessage = this.handleWorkerMessage;

        // Setup animation frame callback
        this.frameId = null;
        
        // Initialize performance monitoring
        this.startPerformanceMonitoring();
    }

    setTrackData(data) {
        if (!data || !data.features || !data.features.length) {
            console.error('Invalid track data');
            return false;
        }

        this.trackData.features = data.features;
        
        // Calculate time range
        const timestamps = this.trackData.features.map(f => f.properties.timestamp);
        this.trackData.timeRange = {
            start: Math.min(...timestamps),
            end: Math.max(...timestamps)
        };
        
        this.state.duration = (this.trackData.timeRange.end - 
                             this.trackData.timeRange.start) / 1000;
        
        // Reset animation state
        this.state.currentTime = 0;
        this.state.currentIndex = 0;
        
        // Update initial position
        this.updatePosition(0);
        
        return true;
    }

    play() {
        if (!this.trackData.features.length) return;

        this.state.isPlaying = true;
        this.state.lastFrameTime = performance.now();
        
        if (!this.frameId) {
            this.frameId = requestAnimationFrame(this.animate);
        }

        // Notify state change
        this.notifyStateChange();
    }

    pause() {
        this.state.isPlaying = false;
        if (this.frameId) {
            cancelAnimationFrame(this.frameId);
            this.frameId = null;
        }

        // Notify state change
        this.notifyStateChange();
    }

    setSpeed(speed) {
        this.state.speed = speed;
    }

    seekTo(time) {
        this.state.currentTime = Math.max(0, Math.min(time, this.state.duration));
        this.updatePosition(this.state.currentTime);
        
        // Notify state change
        this.notifyStateChange();
    }

    toggleCameraLock() {
        this.camera.isLocked = !this.camera.isLocked;
        if (this.camera.isLocked) {
            this.updateCameraOffset();
        }
    }

    animate(timestamp) {
        if (!this.state.isPlaying) return;

        // Calculate delta time
        const deltaTime = (timestamp - this.state.lastFrameTime) / 1000;
        this.state.lastFrameTime = timestamp;

        // Update current time
        this.state.currentTime += deltaTime * this.state.speed;

        // Check if animation complete
        if (this.state.currentTime >= this.state.duration) {
            this.state.currentTime = this.state.duration;
            this.pause();
        }

        // Update position
        this.updatePosition(this.state.currentTime);

        // Monitor performance
        this.updatePerformance(timestamp);

        // Request next frame
        this.frameId = requestAnimationFrame(this.animate);
    }

    updatePosition(time) {
        // Check if we have valid track data
        if (!this.trackData || !this.trackData.features || this.trackData.features.length === 0) {
            console.warn('No valid track data available for position update');
            return;
        }
        
        // Find appropriate track points
        const targetTime = this.trackData.timeRange.start + (time * 1000);
        let nextIndex = this.trackData.features.findIndex(
            f => f.properties.timestamp > targetTime
        );

        if (nextIndex === -1) {
            nextIndex = this.trackData.features.length;
        }
        const prevIndex = Math.max(0, nextIndex - 1);

        // Add null checks before accessing properties
        const prev = this.trackData.features[prevIndex];
        if (!prev || !prev.properties) {
            console.warn('Previous track point is invalid');
            return;
        }
        
        const next = this.trackData.features[nextIndex] || prev;
        if (!next || !next.properties) {
            console.warn('Next track point is invalid');
            return;
        }

        // Calculate interpolation factor
        const prevTime = prev.properties.timestamp;
        const nextTime = next.properties.timestamp;
        const t = prevTime === nextTime ? 0 : 
                 (targetTime - prevTime) / (nextTime - prevTime);

        // Send position data to worker
        this.positionWorker.postMessage({
            position: {
                lng: prev.geometry.coordinates[0],
                lat: prev.geometry.coordinates[1],
                bearing: prev.properties.bearing,
                t: t,
                targetLng: next.geometry.coordinates[0],
                targetLat: next.geometry.coordinates[1],
                targetBearing: next.properties.bearing
            },
            timestamp: performance.now()
        });
    }

    handleWorkerMessage(e) {
        const { position, bearing, speed, error } = e.data;
        
        if (error) {
            console.error('Position worker error:', error);
            return;
        }

        // Update WebGL layer
        this.webglLayer.updatePosition(
            [position.lng, position.lat],
            bearing,
            speed
        );

        // Update camera if locked
        if (this.camera.isLocked) {
            this.updateCamera(position, bearing);
        }
    }

    updateCamera(position, bearing) {
        const camera = this.map.getFreeCameraOptions();
        
        // Calculate camera position with offset
        const offset = this.calculateCameraOffset(bearing);
        const targetPosition = [
            position.lng + offset.x,
            position.lat + offset.y
        ];

        // Apply smooth transition
        this.map.easeTo({
            center: targetPosition,
            bearing: bearing,
            pitch: 60,
            duration: 0,  // Immediate update for smoothness
            easing: t => t  // Linear easing
        });
    }

    calculateCameraOffset(bearing) {
        // Convert bearing to radians
        const rad = (bearing - 90) * Math.PI / 180;
        
        // Calculate offset based on zoom level and speed
        const distance = Math.pow(2, 20 - this.map.getZoom()) * this.camera.offset.zoom;
        
        return {
            x: Math.cos(rad) * distance,
            y: Math.sin(rad) * distance
        };
    }

    updateCameraOffset() {
        if (!this.camera.isLocked) return;
        
        const center = this.map.getCenter();
        const vehiclePosition = this.webglLayer.getCurrentPosition();
        
        if (!vehiclePosition) return;
        
        this.camera.offset = {
            x: center.lng - vehiclePosition[0],
            y: center.lat - vehiclePosition[1],
            zoom: this.map.getZoom()
        };
    }

    startPerformanceMonitoring() {
        let lastTime = performance.now();
        
        const monitor = () => {
            const now = performance.now();
            const deltaTime = now - lastTime;
            lastTime = now;

            // Track frame times
            this.performance.frameTimes.push(deltaTime);
            if (this.performance.frameTimes.length > 60) {
                this.performance.frameTimes.shift();
            }

            // Update FPS counter every second
            if (now - this.performance.lastFpsUpdate > 1000) {
                const avgFrameTime = this.performance.frameTimes.reduce((a, b) => a + b, 0) / 
                                   this.performance.frameTimes.length;
                this.performance.fps = Math.round(1000 / avgFrameTime);
                this.performance.lastFpsUpdate = now;
                
                // Adjust quality if needed
                this.adjustQuality();
            }

            requestAnimationFrame(monitor);
        };

        requestAnimationFrame(monitor);
    }

    adjustQuality() {
        if (this.performance.fps < 30) {
            this.webglLayer.adjustQuality('low');
        } else if (this.performance.fps > 55) {
            this.webglLayer.adjustQuality('high');
        }
    }

    notifyStateChange() {
        // Update AppState
        if (window.AppState) {
            window.AppState.animation = {
                isPlaying: this.state.isPlaying,
                currentTime: this.state.currentTime,
                duration: this.state.duration,
                speed: this.state.speed
            };
            
            if (typeof window.AppState.notifyListeners === 'function') {
                window.AppState.notifyListeners();
            }
        }
    }

    cleanup() {
        // Stop animation
        this.pause();
        
        // Terminate worker
        if (this.positionWorker) {
            this.positionWorker.terminate();
            this.positionWorker = null;
        }
        
        // Clear camera lock
        this.camera.isLocked = false;
        
        // Clear track data
        this.trackData = {
            features: [],
            currentIndex: 0,
            timeRange: { start: 0, end: 0 }
        };
    }
}

export default UnifiedAnimationController;