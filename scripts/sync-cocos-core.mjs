#!/usr/bin/env node
/**
 * sync-cocos-core.mjs
 * 把 shared/ 下的数据真源生成为 cocos 工程可直接 import 的 TS 数据模块，
 * 使 Cocos 客户端与 web / 小程序共享同一份形状/规则数据（单一真源，永不漂移）。
 *
 * 用法：node scripts/sync-cocos-core.mjs [--verify]
 *   --verify  只校验生成结果是否与 shared 一致（CI 用），不写文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHARED = path.join(ROOT, 'shared');
const OUT_DIR = path.join(ROOT, 'cocos', 'assets', 'scripts', 'core');

const verify = process.argv.includes('--verify');

const GEN_HEADER =
    '/**\n' +
    ' * 自动生成文件 —— 请勿手改。数据真源：shared/shapes.json\n' +
    ' * 重新生成：node scripts/sync-cocos-core.mjs（或 npm run sync:cocos-core）\n' +
    ' */\n';

function genShapesData() {
    const shapes = JSON.parse(fs.readFileSync(path.join(SHARED, 'shapes.json'), 'utf8'));
    const categoryOrder = JSON.stringify(shapes.categoryOrder);
    const specialShapeIds = JSON.stringify(shapes.specialShapeIds);
    const byCategory = JSON.stringify(shapes.byCategory, null, 4);
    return (
        GEN_HEADER +
        "import { ShapeDef } from './types';\n\n" +
        `export const categoryOrder = ${categoryOrder} as const;\n\n` +
        `export const specialShapeIds: string[] = ${specialShapeIds};\n\n` +
        `export const byCategory: Record<string, ShapeDef[]> = ${byCategory};\n`
    );
}

function writeOrVerify(file, content) {
    const target = path.join(OUT_DIR, file);
    if (verify) {
        const cur = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
        if (cur !== content) {
            console.error(`[sync-cocos-core] OUT OF DATE: ${file} (run npm run sync:cocos-core)`);
            process.exit(1);
        }
        console.log(`[sync-cocos-core] OK ${file}`);
        return;
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(target, content);
    console.log(`[sync-cocos-core] wrote ${file}`);
}

writeOrVerify('shapesData.ts', genShapesData());
console.log('[sync-cocos-core] done');
