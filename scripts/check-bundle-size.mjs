#!/usr/bin/env node
/**
 * check-bundle-size.mjs — fail CI if the main JS chunk exceeds the
 * v1.15 code-split budget. Run after `npm run build`.
 *
 * Budgets (uncompressed bytes):
 *   index   ≤ 360 KB   ← critical: blocks first paint
 *   meta    ≤ 360 KB   ← acceptable: loaded after game_over / panel open
 *   rl      ≤ 100 KB   ← acceptable: loaded only when bot panel opens
 *
 * Update budgets here when adding a justified core-path dependency,
 * and document the bump in CHANGELOG.md.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUDGETS = {
    index: 360 * 1024,
    meta:  360 * 1024,
    rl:    100 * 1024,
};

const distAssets = join(process.cwd(), 'dist', 'assets');

const violations = [];
let inspected = 0;

for (const entry of readdirSync(distAssets)) {
    if (!entry.endsWith('.js')) continue;

    const match = entry.match(/^([a-zA-Z0-9_]+)-[A-Za-z0-9_-]+\.js$/);
    if (!match) continue;
    const chunk = match[1];
    const budget = BUDGETS[chunk];
    if (budget == null) continue;

    const size = statSync(join(distAssets, entry)).size;
    inspected += 1;
    const sizeKB = (size / 1024).toFixed(1);
    const budgetKB = (budget / 1024).toFixed(0);

    if (size > budget) {
        violations.push(
            `  ✗ ${entry}: ${sizeKB} KB > ${budgetKB} KB budget for "${chunk}"`,
        );
    } else {
        console.log(`  ✓ ${entry}: ${sizeKB} KB ≤ ${budgetKB} KB`);
    }
}

if (inspected === 0) {
    console.error('check-bundle-size: no chunks matched any budget — was the build run?');
    process.exit(2);
}

if (violations.length) {
    console.error('\nBundle size budget exceeded:');
    for (const v of violations) console.error(v);
    console.error(
        '\nTo unblock: split with vite manualChunks, lazy-load via dynamic import(), ' +
        'or update the budget in scripts/check-bundle-size.mjs and document it in CHANGELOG.md.',
    );
    process.exit(1);
}

console.log('\nAll chunks within budget.');
