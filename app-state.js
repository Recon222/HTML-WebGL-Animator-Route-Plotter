// app-state.js
// Central state management with WebGL and unified animation integration

// Import new systems
import WebGLVehicleLayer from './webgl-vehicle-layer.js';
import UnifiedAnimationController from './unified-animation.js';
import PerformanceMonitor from './performance-monitor.js';
// Import functions from route-planning.js
import { 
    initializePlanningSystem,
    togglePlanningMode 
} from './route-planning.js';
// Import functions from route-completion.js
import {
    initializeLayerControls,
    showRouteCompletionModal,
    setupRouteCompletionEvents
} from './route-completion.js';
// Import functions from data-processing.js
import {
    handleFileImport,
    processData
} from './data-processing.js';
// Import utility functions
import {
    showNotification,
    createNotificationsContainer,
    formatTime,
    formatDateForInput,
    formatTimeForInput,
    formatDateTime,
    generateUniqueId
} from './utils.js';

// Application State
const AppState = {
    // Core components
    map: null,
    webglLayer: null,
    animationController: null,
    performanceMonitor: null,

    // Data state
    data: {
        type: "FeatureCollection",
        features: []
    },

    // Animation state
    animation: {
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        speed: 1,
        lastFrame: 0,
        currentPoint: 0
    },

    // Filter state
    filters: {
        timeRange: { start: null, end: null },
        useUTC: false
    },

    // Map state
    bounds: null,
    lastValidBearing: null,

    // Planning mode state
    planningMode: {
        active: false,
        waypoints: [],
        routeSegments: [],
        currentRoute: null
    },

    // Camera state
    camera: {
        isLocked: false,
        lockedConfig: null,
        lastUpdateTime: 0,
        transitionInProgress: false
    },

    // Performance state
    performance: {
        quality: 'high',
        adaptiveQuality: true,
        monitoring: true
    },

    // State management
    setState(updates) {
        Object.assign(this, updates);
        this.notifyListeners();
    },

    listeners: new Set(),

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    },

    notifyListeners() {
        this.listeners.forEach(listener => listener(this));
    }
};

// Make AppState globally available to avoid circular dependencies
window.AppState = AppState;

// Initialize Application
async function initializeApp() {
    const savedMapboxToken = localStorage.getItem('mapboxToken');
    
    if (savedMapboxToken) {
        document.getElementById('landingOverlay').style.display = 'none';
        await initializeMap(savedMapboxToken);
    }

    setupEventListeners();
    createNotificationsContainer();
}

// Map Initialization
async function initializeMap(token) {
    mapboxgl.accessToken = token;
    
    // Initialize map with WebGL optimizations
    AppState.map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/standard-satellite',
        center: [-79.4512, 43.6568],
        zoom: 13,
        pitch: 45,
        antialias: true,
        maxZoom: 20,
        minZoom: 0,
        renderWorldCopies: true,
        optimizeForTerrain: true,
        preserveDrawingBuffer: false
    });

    // Wait for map to load
    await new Promise(resolve => AppState.map.on('load', resolve));

    // Initialize components
    await initializeComponents();
    
    // Add navigation control
    AppState.map.addControl(new mapboxgl.NavigationControl(), 'top-right');
}

// Initialize Core Components
async function initializeComponents() {
    try {
        // Initialize WebGL vehicle layer
        AppState.webglLayer = new WebGLVehicleLayer(AppState.map);
        await AppState.webglLayer.initialize();

        // Initialize unified animation controller
        AppState.animationController = new UnifiedAnimationController(
            AppState.map,
            AppState.webglLayer
        );
        await AppState.animationController.initialize();

        // Initialize performance monitor
        AppState.performanceMonitor = new PerformanceMonitor();
        AppState.performanceMonitor.start();

        // Setup performance monitoring
        AppState.performanceMonitor.addListener(handlePerformanceEvent);

        // Initialize planning system
        initializePlanningSystem();
        
        // Initialize layer controls
        initializeLayerControls();

        console.log('All components initialized successfully');
    } catch (error) {
        console.error('Error initializing components:', error);
        showNotification('Error initializing application components', 'error');
    }
}

// Performance Event Handler
function handlePerformanceEvent(event) {
    switch (event.type) {
        case 'quality-change':
            AppState.performance.quality = event.quality;
            AppState.webglLayer.adjustQuality(event.quality);
            break;

        case 'performance-summary':
            console.log('Performance Summary:', event.summary);
            // Handle performance summary if needed
            break;

        case 'detailed-analysis':
            if (event.analysis.metrics.fps.current < 30) {
                showNotification('Performance optimization in progress', 'warning');
            }
            break;
    }
}

// Event Listeners Setup
function setupEventListeners() {
    // File handling
    document.getElementById('fileButton').onclick = () => 
        document.getElementById('fileInput').click();
    document.getElementById('fileInput').onchange = (e) => {
        if (e.target.files.length > 0) handleFileImport(e.target.files[0]);
    };

    // Playback controls - now using unified animation controller
    document.getElementById('playButton').onclick = () => {
        if (AppState.animation.isPlaying) {
            AppState.animationController.pause();
        } else {
            AppState.animationController.play();
        }
        updatePlaybackButtonState();
    };

    document.getElementById('rewindButton').onclick = () => {
        const newTime = Math.max(0, AppState.animation.currentTime - 10);
        AppState.animationController.seekTo(newTime);
    };

    document.getElementById('forwardButton').onclick = () => {
        const newTime = Math.min(
            AppState.animation.duration,
            AppState.animation.currentTime + 10
        );
        AppState.animationController.seekTo(newTime);
    };
    
    // Speed controls
    document.querySelectorAll('.speed-button').forEach(button => {
        button.onclick = () => {
            document.querySelectorAll('.speed-button').forEach(b => 
                b.classList.remove('active')
            );
            button.classList.add('active');
            const speed = parseFloat(button.dataset.speed);
            AppState.animationController.setSpeed(speed);
            AppState.animation.speed = speed;
        };
    });

    // Progress bar
    const progressBar = document.getElementById('progressBar');
    progressBar.onclick = (e) => {
        const rect = progressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const targetTime = percent * AppState.animation.duration;
        AppState.animationController.seekTo(targetTime);
    };

    // Timeline toggle
    document.getElementById('timelineToggle').onclick = () => {
        document.querySelector('.timeline-panel').classList.toggle('collapsed');
    };

    // Setup button
    document.getElementById('setupButton').onclick = () => {
        const token = document.getElementById('mapboxToken').value.trim();
        if (token) {
            localStorage.setItem('mapboxToken', token);
            document.getElementById('landingOverlay').style.display = 'none';
            initializeMap(token);
        } else {
            showNotification('Please enter a valid Mapbox token', 'error');
        }
    };

    // Settings button
    document.getElementById('settingsButton').onclick = () => {
        const modal = document.getElementById('settingsModal');
        modal.style.display = 'flex';
        updateStylePreviewImages();
        initializeSettingsTabs();
        initializeLayerControls();
    };

    // Map style handling
    document.querySelectorAll('.style-option').forEach(option => {
        option.onclick = async () => {
            const style = option.dataset.style;
            document.querySelectorAll('.style-option').forEach(opt => 
                opt.classList.remove('active')
            );
            option.classList.add('active');
            
            // Save current state
            const wasPlaying = AppState.animation.isPlaying;
            if (wasPlaying) {
                AppState.animationController.pause();
            }

            // Update style
            AppState.map.setStyle(style);

            // Wait for style to load
            await new Promise(resolve => AppState.map.once('style.load', resolve));

            // Reinitialize components
            await initializeComponents();

            // Restore state if needed
            if (wasPlaying) {
                AppState.animationController.play();
            }
        };
    });

    // Route planning button
    document.getElementById('routePlanningButton').addEventListener('click', 
        togglePlanningMode
    );
    
    // Complete route button
    document.getElementById('completeRouteButton').addEventListener('click', () => {
        // Use the globally available function if it exists, otherwise show an error
        if (typeof showRouteCompletionModal === 'function') {
            showRouteCompletionModal();
        } else {
            showNotification('Route completion functionality not loaded', 'error');
        }
    });
}

// UI Update Functions
function updatePlaybackButtonState() {
    const button = document.getElementById('playButton');
    const icon = button.querySelector('.material-icons');
    icon.textContent = AppState.animation.isPlaying ? 'pause' : 'play_arrow';
}

// Map Style Preview Updates
function updateStylePreviewImages() {
    const token = mapboxgl.accessToken;
    document.querySelectorAll('.style-option img').forEach(img => {
        const url = img.src.replace('YOUR_TOKEN', token);
        img.src = url;
    });
}

// Settings Tab Management
function initializeSettingsTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(panel => 
                panel.classList.remove('active')
            );
            
            button.classList.add('active');
            document.getElementById(`${button.dataset.tab}-panel`).classList.add('active');
        });
    });
}

// Time utilities moved to utils.js

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', initializeApp);