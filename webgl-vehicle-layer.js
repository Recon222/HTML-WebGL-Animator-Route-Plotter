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

        // Debug settings
        this.debug = {
            enabled: true,
            lastPosition: null,
            lastUpdate: performance.now(),
            updateHistory: [],
            maxHistoryItems: 10
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

            // Create debug trail layer if debugging is enabled
            if (this.debug.enabled) {
                this.initializeDebugLayers();
            }

            // Setup performance monitoring
            this.map.on('render', () => this.monitorPerformance());

            this.isInitialized = true;
            console.log('WebGL vehicle layer initialized');
        } catch (error) {
            console.error('Failed to initialize WebGL vehicle layer:', error);
            throw error;
        }
    }
    
    initializeDebugLayers() {
        // Add source for position trail
        this.map.addSource('debug-trail', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });
        
        // Add trail line layer
        this.map.addLayer({
            id: 'debug-trail-line',
            type: 'line',
            source: 'debug-trail',
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': '#ff0000',
                'line-width': 2,
                'line-opacity': 0.7
            }
        });
        
        // Add points layer
        this.map.addLayer({
            id: 'debug-trail-points',
            type: 'circle',
            source: 'debug-trail',
            paint: {
                'circle-radius': 4,
                'circle-color': '#ffff00',
                'circle-opacity': 0.7
            }
        });
    }
    
    updateDebugTrail(coordinates) {
        if (!this.debug.enabled || !this.isInitialized) return;
        
        const source = this.map.getSource('debug-trail');
        if (!source) return;
        
        // Add this position to history if different from last one
        if (!this.debug.lastPosition || 
            this.debug.lastPosition[0] !== coordinates[0] || 
            this.debug.lastPosition[1] !== coordinates[1]) {
            
            // Add update to history
            this.debug.updateHistory.push({
                coordinates: coordinates,
                timestamp: performance.now(),
                timeSinceLast: this.debug.lastPosition ? 
                    performance.now() - this.debug.lastUpdate : 0
            });
            
            // Trim history if needed
            if (this.debug.updateHistory.length > 50) {
                this.debug.updateHistory.shift();
            }
            
            // Update trail
            const features = this.debug.updateHistory.map((update, index) => ({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: update.coordinates
                },
                properties: {
                    index: index,
                    timestamp: update.timestamp,
                    timeDelta: update.timeSinceLast
                }
            }));
            
            // Add line feature if we have at least 2 points
            if (features.length > 1) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: this.debug.updateHistory.map(u => u.coordinates)
                    },
                    properties: {}
                });
            }
            
            // Update the source
            source.setData({
                type: 'FeatureCollection',
                features: features
            });
            
            // Store current position and time
            this.debug.lastPosition = coordinates;
            this.debug.lastUpdate = performance.now();
            
            // Log to console
            if (this.debug.enabled) {
                console.log('[WebGLLayer] Position update:', coordinates, 
                            'Time since last update:', this.debug.updateHistory[this.debug.updateHistory.length-1].timeSinceLast.toFixed(1), 'ms');
            }
        }
    }

    updatePosition(coordinates, bearing, speed, timestamp) {
        if (!this.isInitialized) return;

        const source = this.map.getSource('vehicle-webgl');
        if (!source) return;

        // Debug timing
        const now = performance.now();
        const timeSinceLastUpdate = now - (this.currentState.timestamp || now);
        
        // Debug position updates
        if (this.debug.enabled) {
            console.log('[WebGLLayer] Rendering position update:', coordinates);
            console.log('[WebGLLayer] Time since last render:', timeSinceLastUpdate.toFixed(1), 'ms');
            console.log('[WebGLLayer] Bearing:', bearing, 'Speed:', speed);
        }

        // Update current state
        this.currentState = {
            position: coordinates,
            bearing: bearing || this.currentState.bearing,
            speed: speed || 0,
            timestamp: now
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
        
        // Update debug trail
        this.updateDebugTrail(coordinates);
    }

    // Get current position for other components
    getCurrentPosition() {
        return this.currentState.position;
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
        
        // Cleanup debug layers
        if (this.debug.enabled) {
            if (this.map.getLayer('debug-trail-line')) {
                this.map.removeLayer('debug-trail-line');
            }
            if (this.map.getLayer('debug-trail-points')) {
                this.map.removeLayer('debug-trail-points');
            }
            if (this.map.getSource('debug-trail')) {
                this.map.removeSource('debug-trail');
            }
        }

        this.isInitialized = false;
    }
}

export default WebGLVehicleLayer;