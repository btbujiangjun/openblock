/**
 * aimManager.js — v10.16.1 道具瞄准模式统一管理（修复 bomb / rainbow 互斥与 ESC 取消）
 *
 * 设计要点
 * --------
 * - **互斥**：同时只能有一个道具处于瞄准状态，进入新瞄准会自动退出旧的
 * - **ESC 退出**：按 ESC 自动退出当前瞄准
 * - **统一 body class**：`skill-aiming` 全局态 + 各道具自身 class（如 `skill-aim-bomb`）
 * - **退出回调**：每个道具注册自己的 `onCancel` 钩子，便于做按钮态同步
 *
 * 公共 API
 * --------
 *   enterAim(id, { onCancel })   // 进入指定 id 的瞄准模式（可选 onCancel）
 *   exitAim(id?)                  // 退出指定 id（不传则退出当前）
 *   isAiming(id?)                 // 查询当前是否处于 id 瞄准（不传则只判全局）
 *   getCurrent()                  // 返回当前 id 或 null
 */

let _current = null;
let _onCancel = null;
let _escListenerInstalled = false;

const BODY_CLASS_GLOBAL = 'skill-aiming';
const BODY_CLASS_PREFIX = 'skill-aim-';

function _installEscListener() {
    if (_escListenerInstalled || typeof document === 'undefined') return;
    _escListenerInstalled = true;
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _current) {
            exitAim();
        }
    });
}

export function enterAim(id, opts = {}) {
    if (!id) return false;
    _installEscListener();
    if (_current && _current !== id) {
        // 互斥：先退出当前
        exitAim();
    }
    _current = id;
    _onCancel = typeof opts.onCancel === 'function' ? opts.onCancel : null;
    if (typeof document !== 'undefined') {
        document.body.classList.add(BODY_CLASS_GLOBAL);
        document.body.classList.add(BODY_CLASS_PREFIX + id);
    }
    return true;
}

export function exitAim(id = null) {
    if (!_current) return false;
    if (id && id !== _current) return false;
    const prev = _current;
    const cb = _onCancel;
    _current = null;
    _onCancel = null;
    if (typeof document !== 'undefined') {
        document.body.classList.remove(BODY_CLASS_GLOBAL);
        document.body.classList.remove(BODY_CLASS_PREFIX + prev);
    }
    if (cb) {
        try { cb(); } catch { /* ignore */ }
    }
    return true;
}

export function isAiming(id = null) {
    if (id === null) return _current !== null;
    return _current === id;
}

export function getCurrent() { return _current; }

/** 测试用：强制重置 */
export function __resetForTest() {
    _current = null;
    _onCancel = null;
    if (typeof document !== 'undefined') {
        document.body.classList.remove(BODY_CLASS_GLOBAL);
        // 清理任何残留的 skill-aim-* class
        const cls = Array.from(document.body.classList);
        for (const c of cls) {
            if (c.startsWith(BODY_CLASS_PREFIX)) {
                document.body.classList.remove(c);
            }
        }
    }
}
