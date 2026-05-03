/**
 * 页面可见性辅助：后台标签页跳过轻量轮询，减少 CPU 占用。
 * 详见 docs/engineering/PERFORMANCE.md。
 */

/**
 * @template {(...args: any[]) => any} F
 * @param {F} fn
 * @returns {F} 在 document.visibilityState === 'hidden' 时不调用 fn
 */
export function skipWhenDocumentHidden(fn) {
    return /** @type {F} */ ((...args) => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            return undefined;
        }
        return fn(...args);
    });
}
