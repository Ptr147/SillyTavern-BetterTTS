// BetterTTS - 播放队列
// 全局单一实例。队列按顺序逐条朗读；支持暂停/恢复、立即插队朗读、
// 音量实时生效；同一 key 同一时间只存在一个“播放任务”。

import { clamp, num, extFromMime } from './util.js';

export const PlayerStatus = {
    IDLE: 'idle',
    QUEUED: 'queued',
    LOADING: 'loading',
    PLAYING: 'playing',
    PAUSED: 'paused',
    ENDED: 'ended',
    ERROR: 'error',
    STOPPED: 'stopped',
};

export class BetterTTSPlayer {
    constructor() {
        this.queue = [];        // 尚未开始的 entries
        this.current = null;    // 正在加载/播放的 entry
        this._draining = false;
        this._listeners = new Set();
        this._volume = () => 1;
        this._onError = null;
        this._paused = false;
    }

    setVolumeGetter(fn) { this._volume = fn; }
    setErrorHandler(fn) { this._onError = fn; }

    /** 订阅状态变化：listener(key, status, extra) */
    onState(listener) { this._listeners.add(listener); return () => this._listeners.delete(listener); }
    _emit(key, status, extra = {}) {
        for (const l of this._listeners) { try { l(key, status, extra); } catch { /* ignore */ } }
    }

    /** 发出某条目的状态（主 key + 别名 key，供气泡高亮） */
    _emitEntry(entry, status, extra = {}) {
        if (!entry) return;
        this._emit(entry.key, status, extra);
        if (Array.isArray(entry.aliasKeys)) {
            for (const a of entry.aliasKeys) this._emit(a, status, extra);
        }
    }

    /** 某 key 当前 UI 状态 */
    getState(key) {
        if (this.current && this.current.key === key) {
            if (!this.current.ready) return PlayerStatus.LOADING;
            return this._paused ? PlayerStatus.PAUSED : PlayerStatus.PLAYING;
        }
        if (this.queue.some(e => e.key === key)) return PlayerStatus.QUEUED;
        return PlayerStatus.IDLE;
    }

    get currentKey() { return this.current ? this.current.key : null; }

    _volumeNow() {
        try { return clamp(num(this._volume(), 1), 0, 1); } catch { return 1; }
    }

    /**
     * 加入队列
     * @param {{key:string, synth:()=>Promise<Array<{blob,mime}>>, label?:string}} entry
     * @param {{startNow?:boolean}} opts
     */
    async enqueue(entry, opts = {}) {
        if (!entry?.key || !entry.text) return;
        if (this.current?.key === entry.key || this.queue.some(e => e.key === entry.key)) return;
        if (opts.startNow) {
            // 打断当前，清空队列后插到最前
            this._stopCurrent();
            for (const q of this.queue) this._emitEntry(q, PlayerStatus.STOPPED);
            this.queue = [];
        }
        this.queue.push(entry);
        this._emitEntry(entry, PlayerStatus.QUEUED);
        this._drain();
    }

    /** 内部：串行消费队列 */
    async _drain() {
        if (this._draining) return;
        this._draining = true;
        try {
            while (!this.current && this.queue.length) {
                const entry = this.queue.shift();
                this.current = entry;
                entry.ready = false;
                this._emitEntry(entry, PlayerStatus.LOADING);
                try {
                    const blobs = await entry.synth();
                    if (!Array.isArray(blobs) || !blobs.length) throw new Error('没有返回音频数据');
                    if (this.current !== entry) return; // 播放期间被停止
                    entry.blobs = blobs;
                    entry.ready = true;
                    await this._playEntryBlobs(entry);
                } catch (e) {
                    if (this.current !== entry) return;
                    this.current = null;
                    const msg = e?.message || String(e);
                    this._emitEntry(entry, PlayerStatus.ERROR, { message: msg });
                    if (this._onError) { try { this._onError(entry, msg); } catch { /* ignore */ } }
                }
            }
        } finally {
            this._draining = false;
            // 若期间又有新条目进来（竞争窗口），再触发一轮
            if (this.queue.length && !this.current) this._drain();
        }
    }

    /** 播放某 entry 的全部 blobs；结束后标记 ENDED */
    async _playEntryBlobs(entry) {
        for (let i = 0; i < entry.blobs.length; i++) {
            if (this.current !== entry) return;
            const { blob, mime } = entry.blobs[i];
            const ok = await this._playOneBlob(entry, blob, mime);
            if (!ok) return; // 被停止/出错
        }
        if (this.current === entry) {
            this.current = null;
            this._paused = false;
            this._emitEntry(entry, PlayerStatus.ENDED);
        }
    }

    /** 播放单个 blob；resolve true=正常结束，false=中断 */
    _playOneBlob(entry, blob, mime) {
        return new Promise((resolve) => {
            if (this.current !== entry) { resolve(false); return; }
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.volume = Math.min(1, this._volumeNow() * clamp(num(entry.volumeFactor, 1), 0, 2));
            audio.preload = 'auto';
            entry.audio = audio;
            entry.objectUrl = url;
            entry.mime = mime || '';
            this._paused = false;

            let settled = false;
            const done = (ok) => {
                if (settled) return;
                settled = true;
                this._cleanupAudio(entry);
                resolve(ok);
            };

            audio.onended = () => done(true);
            audio.onerror = () => {
                done(false);
                if (this.current === entry) {
                    this.current = null;
                    const msg = '音频解码/播放失败（' + (entry.mime ? extFromMime(entry.mime) : '未知格式') + '）';
                    this._emitEntry(entry, PlayerStatus.ERROR, { message: msg });
                    if (this._onError) { try { this._onError(entry, msg); } catch { /* ignore */ } }
                }
            };

            audio.play().then(() => {
                if (this.current !== entry) { try { audio.pause(); } catch { /* ignore */ } return; }
                this._emitEntry(entry, PlayerStatus.PLAYING);
                if (globalThis.__BETTER_TTS_DEBUG__) {
                    try {
                        const log = (...a) => console.info('[BetterTTS]', ...a);
                        log('播放开始 volume=' + audio.volume + ' mime=' + (entry.mime || mime) + ' size=' + blob.size);
                        audio.addEventListener('loadedmetadata', () => log('loadedmetadata duration=' + audio.duration + 's'));
                        let noted = false;
                        audio.addEventListener('timeupdate', () => {
                            if (!noted) { noted = true; log('正在推进 currentTime=' + audio.currentTime.toFixed(2) + 's'); }
                        });
                        setTimeout(() => {
                            log('0.7s检查', {
                                currentTime: audio.currentTime,
                                paused: audio.paused,
                                ended: audio.ended,
                                readyState: audio.readyState,
                                networkState: audio.networkState,
                                volume: audio.volume,
                                duration: Number.isFinite(audio.duration) ? audio.duration : null,
                            });
                        }, 700);
                    } catch (e) { console.info('[BetterTTS] 播放诊断失败', e); }
                }
            }).catch((e) => {
                if (this.current !== entry) return; // 已停止，忽略
                done(false);
                this.current = null;
                const msg = '浏览器阻止了自动播放，请点击卡片手动播放（' + (e?.message || e) + '）';
                this._emitEntry(entry, PlayerStatus.ERROR, { message: msg });
                if (this._onError) { try { this._onError(entry, msg); } catch { /* ignore */ } }
            });
        });
    }

    _cleanupAudio(entry) {
        if (entry.audio) {
            try { entry.audio.onended = null; entry.audio.onerror = null; entry.audio.pause(); } catch { /* ignore */ }
        }
        if (entry.objectUrl) { try { URL.revokeObjectURL(entry.objectUrl); } catch { /* ignore */ } }
        entry.audio = null;
        entry.objectUrl = null;
    }

    /** 停止当前（不含队列） */
    _stopCurrent() {
        const entry = this.current;
        if (!entry) { this._paused = false; return; }
        this._cleanupAudio(entry);
        this.current = null;
        this._paused = false;
        this._emitEntry(entry, PlayerStatus.STOPPED);
    }

    /** 全部停止并清空队列 */
    stopAll() {
        this._stopCurrent();
        for (const q of this.queue) this._emitEntry(q, PlayerStatus.STOPPED);
        this.queue = [];
    }

    /** 从队列中移除某 key（正在播放则停止） */
    remove(key) {
        if (this.current?.key === key) { this._stopCurrent(); this._drain(); return; }
        const idx = this.queue.findIndex(e => e.key === key);
        if (idx >= 0) {
            const [removed] = this.queue.splice(idx, 1);
            this._emitEntry(removed, PlayerStatus.STOPPED);
        }
    }

    /**
     * 卡片点击入口：
     *  正在播放 → 暂停；已暂停 → 继续；否则立即插队朗读该 key。
     * @param {string} key
     * @param {()=>object} entryFactory 仅在需要新任务时调用
     */
    async toggle(key, entryFactory) {
        if (this.current?.key === key) {
            if (this._paused) {
                if (this.current.audio) {
                    try { await this.current.audio.play(); } catch (e) {
                        if (this._onError) { try { this._onError(this.current, '播放失败：' + (e?.message || e)); } catch { /* ignore */ } }
                        return;
                    }
                }
                this._paused = false;
                this._emitEntry(this.current, PlayerStatus.PLAYING);
            } else {
                this._paused = true;
                try { this.current.audio?.pause(); } catch { /* ignore */ }
                this._emitEntry(this.current, PlayerStatus.PAUSED);
            }
            return;
        }
        // 排队中的条目直接删除（它会被新任务取代）
        this.remove(key);
        const entry = entryFactory();
        if (entry) await this.enqueue(entry, { startNow: true });
    }

    /** 设置音量（立即作用于当前音频） */
    applyVolume() {
        if (this.current?.audio) {
            this.current.audio.volume = Math.min(1, this._volumeNow() * clamp(num(this.current.volumeFactor, 1), 0, 2));
        }
    }

    get isPlaying() { return !!this.current && !this._paused; }
}

/** 全局播放器单例 */
export const player = new BetterTTSPlayer();
