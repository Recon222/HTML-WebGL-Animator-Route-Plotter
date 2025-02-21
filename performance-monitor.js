// performance-monitor.js
// Comprehensive performance monitoring and quality management system

class PerformanceMonitor {
    constructor() {
        // Performance metrics
        this.metrics = {
            fps: {
                current: 0,
                history: [],
                threshold: { min: 30, target: 60 }
            },
            frameTime: {
                current: 0,
                history: [],
                threshold: { warning: 16, critical: 32 }
            },
            memory: {
                current: 0,
                peak: 0,
                threshold: { warning: 0.8, critical: 0.9 }
            },
            gpu: {
                utilization: 0,
                threshold: { warning: 0.85, critical: 0.95 }
            }
        };

        // Quality levels and associated settings
        this.qualityLevels = {
            ultra: {
                renderScale: 1.0,
                maxParticles: 1000,
                shadowQuality: 'high',
                antialiasing: true,
                updateInterval: 16
            },
            high: {
                renderScale: 1.0,
                maxParticles: 500,
                shadowQuality: 'medium',
                antialiasing: true,
                updateInterval: 16
            },
            medium: {
                renderScale: 0.75,
                maxParticles: 250,
                shadowQuality: 'low',
                antialiasing: true,
                updateInterval: 32
            },
            low: {
                renderScale: 0.5,
                maxParticles: 100,
                shadowQuality: 'off',
                antialiasing: false,
                updateInterval: 32
            }
        };

        // Current state
        this.state = {
            currentQuality: 'high',
            lastUpdate: performance.now(),
            isMonitoring: false,
            listeners: new Set(),
            adaptiveQuality: true
        };

        // Performance event buffer
        this.eventBuffer = {
            size: 120,  // 2 minutes at 1 sample/second
            events: [],
            lastFlush: performance.now()
        };

        // Bind methods
        this.update = this.update.bind(this);
        this.monitorLoop = this.monitorLoop.bind(this);
    }

    start() {
        if (this.state.isMonitoring) return;
        
        this.state.isMonitoring = true;
        this.state.lastUpdate = performance.now();
        
        // Start monitoring loop
        requestAnimationFrame(this.monitorLoop);
        
        // Start periodic detailed analysis
        this.startDetailedAnalysis();
    }

    stop() {
        this.state.isMonitoring = false;
    }

    monitorLoop(timestamp) {
        if (!this.state.isMonitoring) return;

        // Calculate basic metrics
        this.updateBasicMetrics(timestamp);

        // Check for performance issues
        this.checkPerformance();

        // Buffer event data
        this.bufferPerformanceEvent();

        // Request next frame
        requestAnimationFrame(this.monitorLoop);
    }

    updateBasicMetrics(timestamp) {
        // Calculate frame time
        const frameTime = timestamp - this.state.lastUpdate;
        this.metrics.frameTime.current = frameTime;
        this.metrics.frameTime.history.push(frameTime);

        // Maintain history size
        if (this.metrics.frameTime.history.length > 60) {
            this.metrics.frameTime.history.shift();
        }

        // Calculate FPS
        const fps = 1000 / frameTime;
        this.metrics.fps.current = Math.round(fps);
        this.metrics.fps.history.push(fps);

        if (this.metrics.fps.history.length > 60) {
            this.metrics.fps.history.shift();
        }

        // Update memory metrics if available
        if (performance.memory) {
            this.metrics.memory.current = performance.memory.usedJSHeapSize / 
                                        performance.memory.jsHeapSizeLimit;
            this.metrics.memory.peak = Math.max(
                this.metrics.memory.peak,
                this.metrics.memory.current
            );
        }

        this.state.lastUpdate = timestamp;
    }

    checkPerformance() {
        if (!this.state.adaptiveQuality) return;

        // Calculate average FPS over last 60 frames
        const avgFps = this.metrics.fps.history.reduce((a, b) => a + b, 0) / 
                      this.metrics.fps.history.length;

        // Calculate average frame time
        const avgFrameTime = this.metrics.frameTime.history.reduce((a, b) => a + b, 0) / 
                           this.metrics.frameTime.history.length;

        // Determine appropriate quality level
        let targetQuality = this.state.currentQuality;

        if (avgFps < this.metrics.fps.threshold.min || 
            avgFrameTime > this.metrics.frameTime.threshold.critical) {
            targetQuality = this.decreaseQuality();
        } else if (avgFps > this.metrics.fps.threshold.target && 
                   avgFrameTime < this.metrics.frameTime.threshold.warning) {
            targetQuality = this.increaseQuality();
        }

        // Apply quality changes if needed
        if (targetQuality !== this.state.currentQuality) {
            this.applyQualitySettings(targetQuality);
        }
    }

    decreaseQuality() {
        const levels = Object.keys(this.qualityLevels);
        const currentIndex = levels.indexOf(this.state.currentQuality);
        return levels[Math.min(currentIndex + 1, levels.length - 1)];
    }

    increaseQuality() {
        const levels = Object.keys(this.qualityLevels);
        const currentIndex = levels.indexOf(this.state.currentQuality);
        return levels[Math.max(currentIndex - 1, 0)];
    }

    applyQualitySettings(qualityLevel) {
        const settings = this.qualityLevels[qualityLevel];
        if (!settings) return;

        this.state.currentQuality = qualityLevel;

        // Notify all listeners of quality change
        this.notifyListeners({
            type: 'quality-change',
            quality: qualityLevel,
            settings: settings
        });
    }

    bufferPerformanceEvent() {
        const event = {
            timestamp: performance.now(),
            fps: this.metrics.fps.current,
            frameTime: this.metrics.frameTime.current,
            memory: this.metrics.memory.current,
            quality: this.state.currentQuality
        };

        this.eventBuffer.events.push(event);

        // Keep buffer size in check
        if (this.eventBuffer.events.length > this.eventBuffer.size) {
            this.eventBuffer.events.shift();
        }

        // Flush buffer if needed
        if (event.timestamp - this.eventBuffer.lastFlush > 60000) { // Every minute
            this.flushPerformanceBuffer();
        }
    }

    flushPerformanceBuffer() {
        if (this.eventBuffer.events.length === 0) return;

        // Calculate performance summary
        const summary = this.calculatePerformanceSummary();

        // Clear buffer
        this.eventBuffer.events = [];
        this.eventBuffer.lastFlush = performance.now();

        // Notify listeners
        this.notifyListeners({
            type: 'performance-summary',
            summary: summary
        });
    }

    calculatePerformanceSummary() {
        const events = this.eventBuffer.events;
        if (events.length === 0) return null;

        return {
            timeRange: {
                start: events[0].timestamp,
                end: events[events.length - 1].timestamp
            },
            fps: {
                average: events.reduce((sum, e) => sum + e.fps, 0) / events.length,
                min: Math.min(...events.map(e => e.fps)),
                max: Math.max(...events.map(e => e.fps))
            },
            frameTime: {
                average: events.reduce((sum, e) => sum + e.frameTime, 0) / events.length,
                max: Math.max(...events.map(e => e.frameTime))
            },
            memory: {
                average: events.reduce((sum, e) => sum + e.memory, 0) / events.length,
                peak: Math.max(...events.map(e => e.memory))
            },
            qualityChanges: this.countQualityChanges(events)
        };
    }

    countQualityChanges(events) {
        let changes = 0;
        let lastQuality = events[0].quality;

        for (let i = 1; i < events.length; i++) {
            if (events[i].quality !== lastQuality) {
                changes++;
                lastQuality = events[i].quality;
            }
        }

        return changes;
    }

    startDetailedAnalysis() {
        // Run detailed analysis every 5 seconds
        setInterval(() => {
            if (!this.state.isMonitoring) return;

            const analysis = {
                timestamp: performance.now(),
                metrics: {
                    ...this.metrics,
                    detailed: this.gatherDetailedMetrics()
                },
                state: {
                    quality: this.state.currentQuality,
                    settings: this.qualityLevels[this.state.currentQuality]
                }
            };

            this.notifyListeners({
                type: 'detailed-analysis',
                analysis: analysis
            });
        }, 5000);
    }

    gatherDetailedMetrics() {
        return {
            timing: performance.timing,
            navigation: performance.navigation,
            memory: performance.memory,
            // Add additional metrics as needed
        };
    }

    addListener(callback) {
        this.state.listeners.add(callback);
        return () => this.state.listeners.delete(callback);
    }

    notifyListeners(event) {
        this.state.listeners.forEach(listener => {
            try {
                listener(event);
            } catch (error) {
                console.error('Error in performance listener:', error);
            }
        });
    }

    getMetrics() {
        return {
            ...this.metrics,
            quality: this.state.currentQuality,
            timestamp: performance.now()
        };
    }

    cleanup() {
        this.stop();
        this.state.listeners.clear();
        this.eventBuffer.events = [];
    }
}

export default PerformanceMonitor;