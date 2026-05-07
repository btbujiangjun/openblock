/**
 * errorTracker.js — 前端错误监控系统
 * 
 * 功能：
 * 1. 自动捕获 JS 错误
 * 2. 手动上报错误
 * 3. 用户行为回溯
 * 4. 错误聚合与分类
 */

const ERROR_LEVELS = {
    DEBUG: 'debug',
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
    CRITICAL: 'critical'
};

const ERROR_CATEGORIES = {
    JAVASCRIPT: 'javascript',
    NETWORK: 'network',
    PERFORMANCE: 'performance',
    USER_ACTION: 'user_action',
    CUSTOM: 'custom'
};

let _instance = null;
let _config = null;
let _errorBuffer = [];
let _maxBufferSize = 50;
let _initialized = false;
let _userId = null;
let _sessionId = null;

function initErrorTracker(config = {}) {
    _config = {
        dsn: config.dsn || null,
        environment: config.environment || 'development',
        release: config.release || '1.0.0',
        sampleRate: config.sampleRate || 1.0,
        maxBreadcrumbs: config.maxBreadcrumbs || 100,
        ignoreErrors: config.ignoreErrors || [],
        ...config
    };
    
    _sessionId = generateSessionId();
    _initialized = true;
    
    setupGlobalErrorHandlers();
    setupUnhandledRejectionHandler();
    
    console.log('[ErrorTracker] Initialized:', _config.environment);
}

function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function setupGlobalErrorHandlers() {
    if (typeof window === 'undefined') return;
    
    window.onerror = function(message, source, lineno, colno, error) {
        trackError({
            message,
            source,
            lineno,
            colno,
            error,
            category: ERROR_CATEGORIES.JAVASCRIPT,
            level: ERROR_LEVELS.ERROR
        });
    };
}

function setupUnhandledRejectionHandler() {
    if (typeof window === 'undefined') return;
    
    window.addEventListener('unhandledrejection', function(event) {
        trackError({
            message: event.reason?.message || 'Unhandled Promise Rejection',
            error: event.reason,
            category: ERROR_CATEGORIES.JAVASCRIPT,
            level: ERROR_LEVELS.ERROR
        });
    });
}

function trackError(errorData) {
    if (!_initialized) return;
    
    if (Math.random() > _config.sampleRate) return;
    
    const ignorePatterns = _config.ignoreErrors || [];
    for (const pattern of ignorePatterns) {
        if (errorData.message?.includes(pattern)) {
            return;
        }
    }
    
    const error = {
        id: generateErrorId(),
        message: errorData.message || 'Unknown error',
        name: errorData.error?.name || 'Error',
        stack: errorData.error?.stack || '',
        category: errorData.category || ERROR_CATEGORIES.CUSTOM,
        level: errorData.level || ERROR_LEVELS.ERROR,
        timestamp: Date.now(),
        userId: _userId,
        sessionId: _sessionId,
        environment: _config.environment,
        release: _config.release,
        breadcrumbs: getBreadcrumbs(),
        metadata: {
            url: typeof window !== 'undefined' ? window.location.href : '',
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
            ...errorData.metadata
        }
    };
    
    _errorBuffer.push(error);
    
    if (_errorBuffer.length > _maxBufferSize) {
        _errorBuffer.shift();
    }
    
    sendErrorToServer(error);
    
    return error;
}

function generateErrorId() {
    return 'err_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function addBreadcrumb(breadcrumb) {
    if (!_config || _config.maxBreadcrumbs <= 0) return;
    
    const crumb = {
        timestamp: Date.now(),
        category: breadcrumb.category || 'general',
        message: breadcrumb.message || '',
        data: breadcrumb.data || {},
        level: breadcrumb.level || 'info'
    };
    
    _breadcrumbs.push(crumb);
    
    if (_breadcrumbs.length > _config.maxBreadcrumbs) {
        _breadcrumbs.shift();
    }
}

let _breadcrumbs = [];

function getBreadcrumbs() {
    return [..._breadcrumbs];
}

function clearBreadcrumbs() {
    _breadcrumbs = [];
}

async function sendErrorToServer(error) {
    if (!_config.dsn) {
        console.log('[ErrorTracker] Error captured (no DSN):', error.message);
        return;
    }
    
    try {
        await fetch('/api/monitoring/errors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(error),
            keepalive: true
        });
    } catch (e) {
        console.warn('[ErrorTracker] Failed to send error:', e);
    }
}

function setUser(userId, extra = {}) {
    _userId = userId;
    addBreadcrumb({
        category: 'user',
        message: `User set: ${userId}`,
        data: extra
    });
}

function captureMessage(message, level = 'info') {
    return trackError({
        message,
        category: ERROR_CATEGORIES.CUSTOM,
        level
    });
}

function captureException(error, extra = {}) {
    return trackError({
        message: error.message || String(error),
        error,
        category: ERROR_CATEGORIES.JAVASCRIPT,
        level: ERROR_LEVELS.ERROR,
        metadata: extra
    });
}

function getErrors(filter = {}) {
    let errors = [..._errorBuffer];
    
    if (filter.level) {
        errors = errors.filter(e => e.level === filter.level);
    }
    
    if (filter.category) {
        errors = errors.filter(e => e.category === filter.category);
    }
    
    if (filter.since) {
        errors = errors.filter(e => e.timestamp > filter.since);
    }
    
    return errors;
}

function getErrorStats() {
    const errors = _errorBuffer;
    
    const byLevel = {};
    const byCategory = {};
    
    errors.forEach(e => {
        byLevel[e.level] = (byLevel[e.level] || 0) + 1;
        byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    });
    
    return {
        total: errors.length,
        byLevel,
        byCategory,
        latest: errors[errors.length - 1]?.timestamp
    };
}

function flush() {
    const errors = [..._errorBuffer];
    _errorBuffer = [];
    
    errors.forEach(error => {
        sendErrorToServer(error);
    });
    
    return errors.length;
}

export function getErrorTracker() {
    if (!_instance) {
        _instance = {
            init: initErrorTracker,
            captureMessage,
            captureException,
            addBreadcrumb,
            clearBreadcrumbs,
            setUser,
            getErrors,
            getStats: getErrorStats,
            flush,
            ERROR_LEVELS,
            ERROR_CATEGORIES
        };
    }
    return _instance;
}

export function getErrorTrackerInstance() {
    return getErrorTracker();
}