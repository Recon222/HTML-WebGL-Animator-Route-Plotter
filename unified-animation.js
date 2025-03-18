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
        
        // Initialize debug overlay
        this.initDebugOverlay();
    }

    initDebugOverlay() {
        // Create debug container if it doesn't exist
        if (!document.getElementById('debugOverlay')) {
            const debugOverlay = document.createElement('div');
            debugOverlay.id = 'debugOverlay';
            debugOverlay.style.cssText = `
                position: absolute;
                top: 10px;
                left: 10px;
                background: rgba(0, 0, 0, 0.7);
                color: white;
                padding: 10px;
                border-radius: 5px;
                font-family: monospace;
                z-index: 1000;
                max-width: 400px;
                max-height: 80vh;
                overflow-y: auto;
                font-size: 12px;
            `;
            
            // Add toggle button
            const toggleButton = document.createElement('button');
            toggleButton.textContent = 'Toggle Debug';
            toggleButton.style.cssText = `
                position: absolute;
                top: 10px;
                right: 10px;
                z-index: 1001;
                padding: 5px;
            `;
            toggleButton.onclick = () => {
                const overlay = document.getElementById('debugOverlay');
                if (overlay) {
                    overlay.style.display = overlay.style.display === 'none' ? 'block' : 'none';
                }
            };
            
            // Create sections
            debugOverlay.innerHTML = `
                <h3>Animation Debug</h3>
                <div id="animationDebug"></div>
                <h3>Position Debug</h3>
                <div id="positionDebug"></div>
                <h3>Worker Debug</h3>
                <div id="workerDebug"></div>
                <h3>Render Debug</h3>
                <div id="renderDebug"></div>
            `;
            
            document.body.appendChild(debugOverlay);
            document.body.appendChild(toggleButton);
            
            // Initialize debug state
            this.debugState = {
                lastPositionUpdate: 0,
                positionUpdates: [],
                workerMessages: [],
                renderUpdates: [],
                maxEntries: 10
            };
        }
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
        
        // Debug information for camera lock
        console.log(`Camera lock ${this.camera.isLocked ? 'enabled' : 'disabled'}`);
        
        if (this.camera.isLocked) {
            this.updateCameraOffset();
            console.log('Camera offset updated:', this.camera.offset);
            
            // Add to debug overlay if it exists
            if (document.getElementById('debugOverlay')) {
                const cameraDebugSection = document.getElementById('animationDebug');
                if (cameraDebugSection) {
                    const cameraDebugInfo = document.createElement('div');
                    cameraDebugInfo.style.borderTop = '1px solid #555';
                    cameraDebugInfo.style.marginTop = '8px';
                    cameraDebugInfo.style.paddingTop = '8px';
                    cameraDebugInfo.innerHTML = `
                        <div><strong>Camera Lock Debug:</strong></div>
                        <div>Lock Status: ${this.camera.isLocked ? 'Locked' : 'Unlocked'}</div>
                        <div>Offset X: ${this.camera.offset?.x?.toFixed(6) || 'N/A'}</div>
                        <div>Offset Y: ${this.camera.offset?.y?.toFixed(6) || 'N/A'}</div>
                        <div>Zoom: ${this.camera.offset?.zoom?.toFixed(2) || 'N/A'}</div>
                        <div>Damping: ${this.camera.dampingRatio}</div>
                    `;
                    cameraDebugSection.appendChild(cameraDebugInfo);
                }
            }
        }
        
        return this.camera.isLocked; // Return current state
    }

    animate(timestamp) {
        if (!this.state.isPlaying) return;

        // Calculate delta time
        const deltaTime = (timestamp - this.state.lastFrameTime) / 1000;
        this.state.lastFrameTime = timestamp;

        // Update current time
        const previousTime = this.state.currentTime;
        this.state.currentTime += deltaTime * this.state.speed;

        // Debug animation timing
        if (document.getElementById('animationDebug')) {
            document.getElementById('animationDebug').innerHTML = `
                <div>FPS: ${this.performance.fps}</div>
                <div>Frame deltaTime: ${deltaTime.toFixed(4)}s</div>
                <div>Animation speed: ${this.state.speed.toFixed(2)}x</div>
                <div>Current time: ${this.state.currentTime.toFixed(2)}s</div>
                <div>Time change: ${(this.state.currentTime - previousTime).toFixed(4)}s</div>
                <div>Progress: ${((this.state.currentTime / this.state.duration) * 100).toFixed(1)}%</div>
            `;
        }

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

        // Calculate time since last position update
        const now = performance.now();
        const timeSinceLastUpdate = now - (this.debugState?.lastPositionUpdate || 0);
        this.debugState.lastPositionUpdate = now;
        
        // Debug position updates
        if (document.getElementById('positionDebug')) {
            // Add this update to history
            if (this.debugState.positionUpdates.length >= this.debugState.maxEntries) {
                this.debugState.positionUpdates.shift();
            }
            
            this.debugState.positionUpdates.push({
                time: time.toFixed(2),
                prevIndex,
                nextIndex,
                totalPoints: this.trackData.features.length,
                updateInterval: timeSinceLastUpdate.toFixed(0)
            });
            
            // Display current position debug info
            let positionHtml = '';
            this.debugState.positionUpdates.forEach((update, i) => {
                positionHtml += `
                    <div style="margin-bottom: 5px; ${i === this.debugState.positionUpdates.length - 1 ? 'font-weight: bold;' : ''}">
                        <div>Animation time: ${update.time}s</div>
                        <div>Points: ${update.prevIndex} → ${update.nextIndex} of ${update.totalPoints}</div>
                        <div>Update interval: ${update.updateInterval}ms</div>
                    </div>
                `;
            });
            
            document.getElementById('positionDebug').innerHTML = positionHtml;
        }

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
        
        // Add more debug info about interpolation
        if (document.getElementById('positionDebug')) {
            const lastUpdate = this.debugState.positionUpdates[this.debugState.positionUpdates.length - 1];
            if (lastUpdate) {
                const additionalInfo = document.createElement('div');
                additionalInfo.innerHTML = `
                    <div style="margin-top: 5px; border-top: 1px solid #555; padding-top: 5px;">
                        <div>Interpolation factor (t): ${t.toFixed(4)}</div>
                        <div>Point time gap: ${((nextTime - prevTime)/1000).toFixed(2)}s</div>
                        <div>Prev point: [${prev.geometry.coordinates.map(c => c.toFixed(6)).join(', ')}]</div>
                        <div>Next point: [${next.geometry.coordinates.map(c => c.toFixed(6)).join(', ')}]</div>
                        <div>Bearing change: ${(next.properties.bearing - prev.properties.bearing).toFixed(2)}°</div>
                    </div>
                `;
                document.getElementById('positionDebug').appendChild(additionalInfo);
            }
        }

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

        // Debug worker messages
        if (document.getElementById('workerDebug')) {
            // Calculate time since message was sent
            const now = performance.now();
            const workerLatency = now - e.data.timestamp;
            
            // Add this message to history
            if (this.debugState.workerMessages.length >= this.debugState.maxEntries) {
                this.debugState.workerMessages.shift();
            }
            
            this.debugState.workerMessages.push({
                position: [position.lng.toFixed(6), position.lat.toFixed(6)],
                bearing: bearing.toFixed(2),
                speed: speed?.toFixed(2) || 'N/A',
                latency: workerLatency.toFixed(1),
                timestamp: now
            });
            
            // Display worker debug info
            let workerHtml = '';
            this.debugState.workerMessages.forEach((msg, i) => {
                workerHtml += `
                    <div style="margin-bottom: 5px; ${i === this.debugState.workerMessages.length - 1 ? 'font-weight: bold;' : ''}">
                        <div>Position: [${msg.position.join(', ')}]</div>
                        <div>Bearing: ${msg.bearing}°</div>
                        <div>Speed: ${msg.speed}</div>
                        <div>Worker latency: ${msg.latency}ms</div>
                    </div>
                `;
            });
            
            document.getElementById('workerDebug').innerHTML = workerHtml;
        }

        // Update WebGL layer
        this.webglLayer.updatePosition(
            [position.lng, position.lat],
            bearing,
            speed
        );
        
        // Debug render updates
        if (document.getElementById('renderDebug')) {
            const now = performance.now();
            
            // Calculate time between render updates
            let renderInterval = 0;
            if (this.debugState.renderUpdates.length > 0) {
                const lastRender = this.debugState.renderUpdates[this.debugState.renderUpdates.length - 1];
                renderInterval = now - lastRender.timestamp;
            }
            
            // Add this update to history
            if (this.debugState.renderUpdates.length >= this.debugState.maxEntries) {
                this.debugState.renderUpdates.shift();
            }
            
            this.debugState.renderUpdates.push({
                position: [position.lng.toFixed(6), position.lat.toFixed(6)],
                bearing: bearing.toFixed(2),
                interval: renderInterval.toFixed(1),
                timestamp: now
            });
            
            // Display render debug info
            let renderHtml = '';
            this.debugState.renderUpdates.forEach((update, i) => {
                renderHtml += `
                    <div style="margin-bottom: 5px; ${i === this.debugState.renderUpdates.length - 1 ? 'font-weight: bold;' : ''}">
                        <div>Rendered position: [${update.position.join(', ')}]</div>
                        <div>Rendered bearing: ${update.bearing}°</div>
                        <div>Render interval: ${update.interval}ms</div>
                    </div>
                `;
            });
            
            document.getElementById('renderDebug').innerHTML = renderHtml;
        }

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
        
        // Add debug information for camera follow pipeline
        if (document.getElementById('debugOverlay')) {
            // Find or create camera follow debug section
            let cameraFollowDebug = document.getElementById('cameraFollowDebug');
            if (!cameraFollowDebug) {
                const debugOverlay = document.getElementById('debugOverlay');
                if (debugOverlay) {
                    const sectionHeader = document.createElement('h3');
                    sectionHeader.textContent = 'Camera Follow Debug';
                    debugOverlay.appendChild(sectionHeader);
                    
                    cameraFollowDebug = document.createElement('div');
                    cameraFollowDebug.id = 'cameraFollowDebug';
                    debugOverlay.appendChild(cameraFollowDebug);
                }
            }
            
            if (cameraFollowDebug) {
                // Track last 5 camera updates
                if (!this.cameraDebugHistory) {
                    this.cameraDebugHistory = [];
                }
                
                // Add latest update
                this.cameraDebugHistory.unshift({
                    timestamp: new Date().toISOString().split('T')[1].split('Z')[0],
                    vehiclePos: [position.lng.toFixed(6), position.lat.toFixed(6)],
                    targetPos: [targetPosition[0].toFixed(6), targetPosition[1].toFixed(6)],
                    bearing: bearing.toFixed(2),
                    offset: [offset.x.toFixed(6), offset.y.toFixed(6)]
                });
                
                // Keep only last 5 updates
                if (this.cameraDebugHistory.length > 5) {
                    this.cameraDebugHistory.pop();
                }
                
                // Render debug info
                let debugHtml = '<div style="max-height: 200px; overflow-y: auto;">';
                this.cameraDebugHistory.forEach((update, i) => {
                    debugHtml += `
                        <div style="margin-bottom: 8px; padding-bottom: 5px; ${i === 0 ? 'font-weight: bold;' : ''} ${i > 0 ? 'border-bottom: 1px dotted #555;' : ''}">
                            <div>Time: ${update.timestamp}</div>
                            <div>Vehicle: [${update.vehiclePos.join(', ')}]</div>
                            <div>Target: [${update.targetPos.join(', ')}]</div>
                            <div>Bearing: ${update.bearing}°</div>
                            <div>Offset: [${update.offset.join(', ')}]</div>
                        </div>
                    `;
                });
                debugHtml += '</div>';
                
                cameraFollowDebug.innerHTML = debugHtml;
            }
        }
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

    updatePerformance(timestamp) {
        // Increment frame count
        this.performance.frameCount++;
        
        // Only update FPS calculation occasionally to reduce overhead
        if (timestamp - this.performance.lastFpsUpdate > 1000) {
            // Calculate FPS based on frames since last update
            const secondsPassed = (timestamp - this.performance.lastFpsUpdate) / 1000;
            const framesSinceLastUpdate = this.performance.frameCount;
            
            // Update FPS
            this.performance.fps = Math.round(framesSinceLastUpdate / secondsPassed);
            
            // Reset counters
            this.performance.lastFpsUpdate = timestamp;
            this.performance.frameCount = 0;
        }
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