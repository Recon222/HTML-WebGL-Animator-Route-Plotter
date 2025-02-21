// webgl-vehicle-layer.js
// WebGL-optimized vehicle layer with unified rendering and position management

class WebGLVehicleLayer {
    constructor(map) {
        this.map = map;
        this.isInitialized = false;
        this.frameId = null;

        // Performance monitoring
        this.frameStats = {
            lastFrameTime: performance.now(),
            frameTimes: [],
            frameCount: 0
        };

        // Configurable settings
        this.settings = {
            updateInterval: 16,  // ~60fps
            smoothing: 0.85,    // Position smoothing factor
            maxSpeed: 200,      // km/h
            minZoom: 5,
            maxZoom: 18
        };

        // Position tracking
        this.currentState = {
            position: null,
            bearing: 0,
            speed: 0,
            timestamp: 0
        };

        // Animation state
        this.animationState = {
            isPlaying: false,
            startTime: 0,
            currentTime: 0,
            duration: 0
        };

        // Bind methods to maintain context
        this.animate = this.animate.bind(this);
        this.updatePosition = this.updatePosition.bind(this);
        this.cleanup = this.cleanup.bind(this);
    }

    async initialize() {
        if (this.isInitialized) return;

        try {
            // Wait for map to be ready
            if (!this.map.loaded()) {
                await new Promise(resolve => this.map.on('load', resolve));
            }

            // Initialize vehicle source
            this.map.addSource('vehicle-webgl', {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [0, 0]
                    },
                    properties: {
                        bearing: 0,
                        speed: 0
                    }
                }
            });

            // Add vehicle layer with WebGL optimizations
            this.map.addLayer({
                id: 'vehicle-webgl',
                type: 'symbol',
                source: 'vehicle-webgl',
                layout: {
                    'symbol-placement': 'point',
                    'icon-image': 'vehicle-marker',
                    'icon-size': ['interpolate', ['linear'], ['zoom'],
                        this.settings.minZoom, 0.5,
                        this.settings.maxZoom, 1.5
                    ],
                    'icon-rotate': ['get', 'bearing'],
                    'icon-rotation-alignment': 'map',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true
                },
                paint: {
                    'icon-opacity': 1
                }
            });

            // Setup performance monitoring
            this.map.on('render', () => this.monitorPerformance());

            this.isInitialized = true;
            console.log('WebGL vehicle layer initialized');
        } catch (error) {
            console.error('Failed to initialize WebGL vehicle layer:', error);
            throw error;
        }
    }

    updatePosition(coordinates, bearing, speed, timestamp) {
        if (!this.isInitialized) return;

        const source = this.map.getSource('vehicle-webgl');
        if (!source) return;

        // Update current state
        this.currentState = {
            position: coordinates,
            bearing: bearing || this.currentState.bearing,
            speed: speed || 0,
            timestamp: timestamp || performance.now()
        };

        // Update GeoJSON source
        source.setData({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: coordinates
            },
            properties: {
                bearing: bearing,
                speed: speed
            }
        });
    }

    animate(timestamp) {
        if (!this.animationState.isPlaying) return;

        const deltaTime = timestamp - this.frameStats.lastFrameTime;
        
        if (deltaTime >= this.settings.updateInterval) {
            // Calculate animation progress
            const progress = (timestamp - this.animationState.startTime) / 
                           this.animationState.duration;

            if (progress >= 1) {
                this.stop();
                return;
            }

            // Update position based on animation progress
            this.updateFromProgress(progress);
            this.frameStats.lastFrameTime = timestamp;
        }

        this.frameId = requestAnimationFrame(this.animate);
    }

    updateFromProgress(progress) {
        // This will be implemented when we integrate with the position worker
        // For now, it's a placeholder for the animation update logic
    }

    start(duration) {
        if (!this.isInitialized) return;

        this.animationState = {
            isPlaying: true,
            startTime: performance.now(),
            currentTime: 0,
            duration: duration || 0
        };

        this.frameStats.lastFrameTime = performance.now();
        this.animate(this.frameStats.lastFrameTime);
    }

    stop() {
        this.animationState.isPlaying = false;
        if (this.frameId) {
            cancelAnimationFrame(this.frameId);
            this.frameId = null;
        }
    }

    monitorPerformance() {
        const now = performance.now();
        const frameTime = now - this.frameStats.lastFrameTime;
        
        this.frameStats.frameTimes.push(frameTime);
        if (this.frameStats.frameTimes.length > 60) {
            this.frameStats.frameTimes.shift();
        }

        // Calculate average frame time
        const avgFrameTime = this.frameStats.frameTimes.reduce((a, b) => a + b, 0) / 
                           this.frameStats.frameTimes.length;

        // Adjust quality settings if needed
        if (avgFrameTime > 32) { // Below 30fps
            this.adjustQuality('low');
        } else if (avgFrameTime < 16) { // Above 60fps
            this.adjustQuality('high');
        }

        this.frameStats.lastFrameTime = now;
    }

    adjustQuality(level) {
        if (!this.map.getLayer('vehicle-webgl')) return;

        const settings = {
            high: {
                iconSize: ['interpolate', ['linear'], ['zoom'],
                    this.settings.minZoom, 0.5,
                    this.settings.maxZoom, 1.5
                ],
                updateInterval: 16
            },
            low: {
                iconSize: ['interpolate', ['linear'], ['zoom'],
                    this.settings.minZoom, 0.4,
                    this.settings.maxZoom, 1.2
                ],
                updateInterval: 32
            }
        };

        const config = settings[level];
        if (!config) return;

        this.map.setLayoutProperty('vehicle-webgl', 'icon-size', config.iconSize);
        this.settings.updateInterval = config.updateInterval;
    }

    cleanup() {
        this.stop();
        
        if (this.map.getLayer('vehicle-webgl')) {
            this.map.removeLayer('vehicle-webgl');
        }
        
        if (this.map.getSource('vehicle-webgl')) {
            this.map.removeSource('vehicle-webgl');
        }

        this.isInitialized = false;
    }
}

export default WebGLVehicleLayer;