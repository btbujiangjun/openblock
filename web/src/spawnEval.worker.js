import { runSpawnEvaluation } from './bot/spawnEvaluation.js';

self.addEventListener('message', (event) => {
    const { id, options } = event.data || {};
    try {
        const report = runSpawnEvaluation(options || {});
        self.postMessage({ id, ok: true, report });
    } catch (error) {
        self.postMessage({
            id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
});

