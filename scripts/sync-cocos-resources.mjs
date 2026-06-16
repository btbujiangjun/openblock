#!/usr/bin/env node
/**
 * Sync runtime resource bundles into the Cocos Creator resources bundle.
 *
 * Cocos Creator only packages files under cocos/assets (and especially
 * cocos/assets/resources for runtime `resources.load` access). Web/miniprogram
 * resource packs live outside that tree, so Cocos builds must explicitly copy
 * them before Creator imports/builds the project.
 *
 * Usage:
 *   node scripts/sync-cocos-resources.mjs
 *   node scripts/sync-cocos-resources.mjs --verify
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const verify = process.argv.includes('--verify');

const OUT_ROOT = path.join(ROOT, 'cocos', 'assets', 'resources');

const COPIES = [
  {
    label: 'skin-ui-assets',
    src: path.join(ROOT, 'web', 'public', 'assets', 'skins'),
    dest: path.join(OUT_ROOT, 'assets', 'skins'),
  },
];

const MERGES = [
  {
    label: 'skin-audio-assets',
    sources: [
      path.join(ROOT, 'web', 'public', 'audio', 'skins'),
      path.join(ROOT, 'miniprogram', 'assets', 'audio', 'skins'),
    ],
    dest: path.join(OUT_ROOT, 'audio', 'skins'),
  },
];

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = path.join(dir, rel);
    for (const name of fs.readdirSync(abs)) {
      const nextRel = path.join(rel, name);
      const nextAbs = path.join(dir, nextRel);
      const st = fs.statSync(nextAbs);
      if (st.isDirectory()) stack.push(nextRel);
      else if (st.isFile() && !name.endsWith('.meta')) out.push(nextRel);
    }
  }
  return out.sort();
}

function sameFile(a, b) {
  return fs.existsSync(a) && fs.readFileSync(a).equals(fs.readFileSync(b));
}

function copyFileIfChanged(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (sameFile(src, dest)) return false;
  fs.copyFileSync(src, dest);
  return true;
}

function managedRoots() {
  return [
    ...COPIES.map((item) => item.dest),
    ...MERGES.map((item) => item.dest),
  ];
}

/** 增量同步：只更新有变化的资源，删除 plan 外过期文件；保留仍有效的 .meta（Cocos UUID 稳定）。 */
function syncIncremental(plan) {
  const expectedAbs = new Set(plan.map((item) => item.dest));
  let copied = 0;
  for (const item of plan) {
    if (copyFileIfChanged(item.src, item.dest)) copied++;
  }
  let removed = 0;
  for (const root of managedRoots()) {
    if (!fs.existsSync(root)) continue;
    for (const rel of walkFiles(root)) {
      const abs = path.join(root, rel);
      if (!expectedAbs.has(abs)) {
        fs.unlinkSync(abs);
        const meta = `${abs}.meta`;
        if (fs.existsSync(meta)) fs.unlinkSync(meta);
        removed++;
      }
    }
  }
  return { copied, removed, total: plan.length };
}

function buildCopyPlan() {
  const plan = [];
  for (const item of COPIES) {
    for (const rel of walkFiles(item.src)) {
      plan.push({
        label: item.label,
        src: path.join(item.src, rel),
        dest: path.join(item.dest, rel),
      });
    }
  }
  for (const item of MERGES) {
    const byRel = new Map();
    for (const source of item.sources) {
      for (const rel of walkFiles(source)) {
        byRel.set(rel, path.join(source, rel));
      }
    }
    for (const [rel, src] of [...byRel.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      plan.push({
        label: item.label,
        src,
        dest: path.join(item.dest, rel),
      });
    }
  }
  return plan;
}

function writeManifest(plan) {
  const manifest = {
    generatedBy: 'scripts/sync-cocos-resources.mjs',
    files: plan.map((item) => path.relative(OUT_ROOT, item.dest).split(path.sep).join('/')).sort(),
  };
  fs.writeFileSync(
    path.join(OUT_ROOT, 'resource-bundle-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function verifyPlan(plan) {
  let stale = 0;
  for (const item of plan) {
    if (!sameFile(item.dest, item.src)) {
      console.error(`[sync-cocos-resources] OUT OF DATE: ${path.relative(ROOT, item.dest)}`);
      stale++;
    }
  }
  const expected = new Set(plan.map((item) => path.relative(OUT_ROOT, item.dest)));
  const managedRoots = [
    ...COPIES.map((item) => path.relative(OUT_ROOT, item.dest)),
    ...MERGES.map((item) => path.relative(OUT_ROOT, item.dest)),
  ];
  for (const managedRoot of managedRoots) {
    const absRoot = path.join(OUT_ROOT, managedRoot);
    for (const childRel of walkFiles(absRoot)) {
      const rel = path.join(managedRoot, childRel);
      if (!expected.has(rel)) {
        console.error(`[sync-cocos-resources] EXTRA: ${path.join('cocos/assets/resources', rel)}`);
        stale++;
      }
    }
  }
  if (stale) {
    console.error(`[sync-cocos-resources] ${stale} resource file(s) stale — run npm run sync:cocos-resources`);
    process.exit(1);
  }
  console.log(`[sync-cocos-resources] OK (${plan.length} files)`);
}

const plan = buildCopyPlan();

if (verify) {
  verifyPlan(plan);
} else {
  const { copied, removed, total } = syncIncremental(plan);
  writeManifest(plan);
  console.log(
    `[sync-cocos-resources] synced ${total} files (${copied} updated, ${removed} stale removed) → ${path.relative(ROOT, OUT_ROOT)}`,
  );
}
