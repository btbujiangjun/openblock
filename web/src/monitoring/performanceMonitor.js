/**
 * performanceMonitor.js — 前端性能监控系统
 * 
 * 功能：
 * 1. 页面加载性能
 * 2. 用户交互延迟
 * 3. FPS 监控
 * 4. 资源加载时间
 */

let _instance = null;
let _config = null;
let _metrics = {
    pageLoads: [],
    interactions: [],
    fps: [],
    resources: []
};
let _fpsSamples = [];
let _lastFrameTime = 0;
let _isMonitoring = false;

function initPerformanceMonitor(config = {}) {
    _config = {
        sampleRate: config.sampleRate || 1.0,
        maxSamples: config.maxSamples || 100,
        fpsThreshold: config.fpsThreshold || 30,
        slowClickThreshold: config.slowClickThreshold || 200,
        ...config
    };
    
    if (typeof window === 'undefined') return;
    
    setupPerformanceObservers();
    setupInteractionTracking();
    startFpsMonitoring();
    
    console.log('[PerformanceMonitor] Initialized');
}

function setupPerformanceObservers() {
    if (typeof performance === 'undefined') return;
    
    const paintObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            if (entry.entryType === 'paint') {
                recordPaintMetric(entry);
            }
        }
    });
    
    try {
        paintObserver.observe({ entryTypes: ['paint', 'navigation', 'resource'] });
    } catch {
        console.warn('[PerformanceMonitor] Observer not supported');
    }
}

function recordPaintMetric(entry) {
    const metric = {
        name: entry.name,
        startTime: entry.startTime,
        duration: entry.duration || 0,
        timestamp: Date.now()
    };
    
    if (entry.name === 'first-contentful-paint') {
        metric.type = 'FCP';
    } else if (entry.name === 'first-paint') {
        metric.type = 'FP';
    } else if (entry.name === 'largest-contentful-paint') {
        metric.type = 'LCP';
    }
    
    _metrics.pageLoads.push(metric);
    trimMetrics('pageLoads');
}

function setupInteractionTracking() {
    if (typeof document === 'undefined') return;
    
    const interactionEvents = ['click', 'touchstart', 'keydown'];
    
    interactionEvents.forEach(eventType => {
        document.addEventListener(eventType, (e) => {
            if (!_config.sampleRate || Math.random() < _config.sampleRate) {
                recordInteraction(e);
            }
        }, { passive: true });
    });
}

function recordInteraction(event) {
    const startTime = event.timeStamp;
    
    const onComplete = () => {
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        if (duration > _config.slowClickThreshold) {
            const interaction = {
                type: event.type,
                target: event.target?.tagName || 'unknown',
                selector: getSelector(event.target),
                duration,
                timestamp: Date.now(),
                slow: true
            };
            
            _metrics.interactions.push(interaction);
            trimMetrics('interactions');
        }
    };
    
    requestAnimationFrame(onComplete);
}

function getSelector(element) {
    if (!element) return '';
    
    if (element.id) return '#' + element.id;
    if (element.className && typeof element.className === 'string') {
        return '.' + element.className.split(' ')[0];
    }
    return element.tagName?.toLowerCase() || 'unknown';
}

function startFpsMonitoring() {
    if (_isMonitoring) return;
    _isMonitoring = true;
    
    const measureFps = () => {
        const now = performance.now();
        
        if (_lastFrameTime > 0) {
            const delta = now - _lastFrameTime;
            const fps = 1000 / delta;
            
            _fpsSamples.push(fps);
            
            if (_fpsSamples.length > 60) {
                _fpsSamples.shift();
            }
        }
        
        _lastFrameTime = now;
        requestAnimationFrame(measureFps);
    };
    
    requestAnimationFrame(measureFps);
}

function stopFpsMonitoring() {
    _isMonitoring = false;
}

function getFpsStats() {
    if (_fpsSamples.length === 0) {
        return { current: 0, average: 0, min: 0, max: 0 };
    }
    
    const sum = _fpsSamples.reduce((a, b) => a + b, 0);
    const average = sum / _fpsSamples.length;
    const min = Math.min(..._fpsSamples);
    const max = Math.max(..._fpsSamples);
    const current = _fpsSamples[_fpsSamples.length - 1];
    
    const lowFpsCount = _fpsSamples.filter(f => f < _config.fpsThreshold).length;
    const lowFpsPercent = (lowFpsCount / _fpsSamples.length) * 100;
    
    return {
        current: Math.round(current),
        average: Math.round(average),
        min: Math.round(min),
        max: Math.round(max),
        lowFpsPercent
    };
}

function trimMetrics(key) {
    const max = _config.maxSamples || 100;
    if (_metrics[key].length > max) {
        _metrics[key] = _metrics[key].slice(-max);
    }
}

function getMetrics() {
    return {
        pageLoads: _metrics.pageLoads,
        interactions: _metrics.interactions,
        fps: getFpsStats(),
        resources: _metrics.resources.slice(-50)
    };
}

function getPerformanceSummary() {
    const pageLoads = _metrics.pageLoads;
    const interactions = _metrics.interactions;
    const fps = getFpsStats();
    
    const fcp = pageLoads.find(m => m.type === 'FCP');
    const lcp = pageLoads.find(m => m.type === 'LCP');
    
    const slowInteractions = interactions.filter(i => i.slow);
    
    return {
        fcp: fcp?.startTime || 0,
        lcp: lcp?.startTime || 0,
        fps: fps.average,
        slowClicks: slowInteractions.length,
        slowClickPercent: interactions.length > 0 
            ? (slowInteractions.length / interactions.length) * 100 
            : 0,
        lowFpsPercent: fps.lowFpsPercent
    };
}

function recordResourceTiming(resource) {
    _metrics.resources.push({
        name: resource.name,
        duration: resource.duration,
        size: resource.transferSize || 0,
        type: resource.initiatorType,
        timestamp: Date.now()
    });
    trimMetrics('resources');
}

function clearMetrics() {
    _metrics = {
        pageLoads: [],
        interactions: [],
        fps: [],
        resources: []
    };
    _fpsSamples = [];
}

export function getPerformanceMonitor() {
    if (!_instance) {
        _instance = {
            init: initPerformanceMonitor,
            getMetrics,
            getSummary: getPerformanceSummary,
            getFpsStats,
            recordResourceTiming,
            clearMetrics,
            startFpsMonitoring,
            stopFpsMonitoring
        };
    }
    return _instance;
}

export function getPerformanceMonitorInstance() {
    return getPerformanceMonitor();
}