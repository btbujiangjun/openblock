/**
 * 埋点（Phase P2）—— 引擎无关。事件 id 与 web `GAME_EVENTS` / server.py SQL 谓词对齐，
 * 便于复用既有「爽感/留存」看板。Sink 由平台层注入（微信 reportEvent / HTTP / 控制台）。
 */

/** 与 web 对齐的事件常量（禁止随意重命名）。 */
export const ANALYTICS_EVENTS = {
    place: 'place',
    clear: 'clear',
    multiClear: 'multi_clear',
    perfectClear: 'perfect_clear',
    comboHigh: 'combo_high',
    /** 妙手：窄位 + 高填充下成功落子（对齐 web `_checkToughPlacement` 触发的 👍 toast）。 */
    toughPlacement: 'tough_placement',
    gameOver: 'game_over',
    spawnBlocks: 'spawn_blocks',
    reviveShow: 'revive_show',
    reviveUsed: 'revive_used',
    adShow: 'ad_show',
    adComplete: 'ad_complete',
    iapPurchase: 'iap_purchase',
    levelUp: 'level_up',
    checkin: 'checkin',
    sessionStart: 'session_start',
} as const;

export type AnalyticsEvent = typeof ANALYTICS_EVENTS[keyof typeof ANALYTICS_EVENTS];

export interface AnalyticsSink {
    send(event: string, params: Record<string, unknown>): void;
}

class ConsoleSink implements AnalyticsSink {
    send(event: string, params: Record<string, unknown>): void {
        // eslint-disable-next-line no-console
        console.log('[analytics]', event, params);
    }
}

class AnalyticsImpl {
    enabled = true;
    private sink: AnalyticsSink = new ConsoleSink();
    private buffer: Array<{ event: string; params: Record<string, unknown>; ts: number }> = [];
    private sessionId = Math.random().toString(36).slice(2);

    useSink(sink: AnalyticsSink): void {
        this.sink = sink;
        this.flush();
    }

    setEnabled(on: boolean): void {
        this.enabled = on;
    }

    track(event: string, params: Record<string, unknown> = {}): void {
        if (!this.enabled) return;
        const enriched = { ...params, sid: this.sessionId, ts: Date.now() };
        try {
            this.sink.send(event, enriched);
        } catch {
            this.buffer.push({ event, params: enriched, ts: Date.now() });
        }
    }

    private flush(): void {
        const pending = this.buffer.splice(0);
        for (const e of pending) {
            try { this.sink.send(e.event, e.params); } catch { this.buffer.push(e); }
        }
    }
}

export const Analytics = new AnalyticsImpl();
