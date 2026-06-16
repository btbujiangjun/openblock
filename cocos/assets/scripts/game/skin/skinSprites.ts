import { resources, SpriteFrame, Texture2D, ImageAsset } from 'cc';
import { Skin } from '../../core';

/**
 * 图片皮肤（如「水墨雅集」inkGarden）的方块整面贴图加载/缓存。
 *
 * web 主端用 `skin.blockIconAssets[colorIdx]` 把一张 PNG 满铺到方块格面（替代 Graphics 绘面 + emoji）。
 * cocos 的 Graphics 无法绘制位图，因此改用 Sprite 节点渲染：本模块负责把 8 张 PNG 解析为
 * SpriteFrame 并按 skin.id 缓存，供 BoardView / DockView / 拖拽 ghost / SkinPanel 预览复用。
 *
 * 兼容两种导入方式（无需改 .meta）：
 *   1) 已按 sprite-frame 导入 → `<path>/spriteFrame` 直接命中；
 *   2) 仅 texture（当前 inkGarden 的 png.meta 即此）→ 退化加载 `<path>/texture` 或 ImageAsset 再包成 SpriteFrame。
 */

type FrameArr = (SpriteFrame | null)[];

const _cache = new Map<string, FrameArr>();
const _loading = new Set<string>();
const _pending = new Map<string, Array<() => void>>();

/** 该皮肤是否使用「整面贴图」渲染（命中后跳过 Graphics 绘面 + emoji）。 */
export function skinHasImageBlocks(skin: Skin): boolean {
    return !!(skin.blockIconAssets && skin.blockIconAssets.length);
}

/** 取已缓存的某色方块贴图；未加载完成返回 null（调用方此时回退绘面占位）。 */
export function getSkinBlockFrame(skin: Skin, colorIdx: number): SpriteFrame | null {
    const arr = _cache.get(skin.id);
    if (!arr || !arr.length) return null;
    const n = arr.length;
    const f = arr[((colorIdx % n) + n) % n];
    return f || null;
}

/**
 * 确保该皮肤的全部方块贴图开始/完成加载。
 * - 已缓存：立即回调 onReady；
 * - 加载中：onReady 入队，待整批完成统一回调（供各视图加载完后重绘一次）。
 */
export function ensureSkinBlockFrames(skin: Skin, onReady?: () => void): void {
    if (!skinHasImageBlocks(skin)) return;
    if (_cache.has(skin.id)) { onReady?.(); return; }
    if (onReady) {
        const list = _pending.get(skin.id) ?? [];
        list.push(onReady);
        _pending.set(skin.id, list);
    }
    if (_loading.has(skin.id)) return;
    _loading.add(skin.id);

    const paths = skin.blockIconAssets!;
    const frames: FrameArr = new Array(paths.length).fill(null);
    let remaining = paths.length;
    const finish = (): void => {
        _cache.set(skin.id, frames);
        _loading.delete(skin.id);
        const cbs = _pending.get(skin.id);
        _pending.delete(skin.id);
        cbs?.forEach((cb) => { try { cb(); } catch { /* ignore */ } });
    };
    paths.forEach((p, i) => {
        loadOneFrame(p, (sf) => {
            frames[i] = sf;
            if (--remaining === 0) finish();
        });
    });
}

/** 单张加载：sprite-frame → texture → ImageAsset 三级兜底，全失败回 null。 */
function loadOneFrame(path: string, cb: (sf: SpriteFrame | null) => void): void {
    resources.load(`${path}/spriteFrame`, SpriteFrame, (err: unknown, sf: SpriteFrame) => {
        if (!err && sf) { cb(sf); return; }
        resources.load(`${path}/texture`, Texture2D, (e2: unknown, tex: Texture2D) => {
            if (!e2 && tex) { cb(safeWrap(tex)); return; }
            resources.load(path, ImageAsset, (e3: unknown, img: ImageAsset) => {
                if (!e3 && img) { cb(safeWrap(img)); return; }
                console.warn('[OpenBlock] skin block asset load failed:', path);
                cb(null);
            });
        });
    });
}

function safeWrap(src: Texture2D | ImageAsset): SpriteFrame | null {
    try {
        return SpriteFrame.createWithImage(src as Texture2D);
    } catch (err) {
        console.warn('[OpenBlock] createWithImage failed:', err);
        return null;
    }
}
