// BetterTTS - TTS 适配器层
// 统一的适配器接口：
//   synthesize(request)      → { ok:true, blobs:[{blob,mime}] } | { ok:false, message }
//   loadVoices(settings)     → { ok:true, voices:[{id,label,group}] } | { ok:false, message }
//
// 内置适配器：
//   1) edge    —— Edge TTS（微软 · 免费）：浏览器端动态加载 @edge-tts/universal（CDN），无需 Key
//   2) openai  —— OpenAI 兼容 /v1/audio/speech（GPT-SoVITS / fish-speech / kokoro / CosyVoice 等自建服务）
//   3) custom  —— 任意自定义 HTTP 接口（URL/Header/Body 模板，占位符替换）
//
// 新增服务商：在 PROVIDER_DEFS 中注册并实现 synthesize/loadVoices 即可。

import { listEdgeVoices, defaultVoiceForLanguage } from './edge-voices.js';
import { clamp, num, voiceListFromAny, extFromMime, logDebug } from './util.js';

export const PROVIDER_DEFS = [
    {
        id: 'edge',
        label: 'Edge TTS（微软 · 免费，浏览器直连）',
        hint: '无需 API Key。浏览器运行时从 CDN 加载 @edge-tts/universal。',
    },
    {
        id: 'openai',
        label: 'OpenAI 兼容接口（/v1/audio/speech）',
        hint: '适用于 GPT-SoVITS、fish-speech、kokoro、CosyVoice、Edge-OpenAI-Proxy 等自建/中转服务。',
    },
    {
        id: 'custom',
        label: '自定义 HTTP 接口',
        hint: '任意支持语音合成的 HTTP 服务，通过 URL / Header / Body 模板对接。',
    },
];

// =====================================================================
// 音频小工具
// =====================================================================

/** AudioBuffer → WAV(PCM16) Blob */
export function audioBufferToWavBlob(buf) {
    const channels = Math.min(2, buf.numberOfChannels || 1);
    const frameLen = buf.length;
    const sampleRate = buf.sampleRate || 24000;
    const bytesPerSample = 2;
    const dataSize = frameLen * channels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeStr = (off, s) => {
        for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);          // PCM
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    const chData = [];
    for (let c = 0; c < channels; c++) chData.push(buf.getChannelData(c));
    let off = 44;
    for (let f = 0; f < frameLen; f++) {
        for (let c = 0; c < channels; c++) {
            let s = chData[c][f];
            if (s > 1) s = 1; else if (s < -1) s = -1;
            view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            off += 2;
        }
    }
    return new Blob([buffer], { type: 'audio/wav' });
}

// =====================================================================
// Edge TTS（浏览器直连）
// =====================================================================

let edgeModuleCache = null; // { url, promise }

const EDGE_CDN_FALLBACKS = [
    'https://cdn.jsdelivr.net/npm/@edge-tts/universal@1.4.0/+esm',
    'https://unpkg.com/@edge-tts/universal@1.4.0/+esm',
    'https://esm.sh/@edge-tts/universal@1.4.0',
];

async function loadEdgeModule(cfg) {
    const urls = [];
    if (cfg.moduleUrl) urls.push(cfg.moduleUrl.trim());
    for (const u of EDGE_CDN_FALLBACKS) if (!urls.includes(u)) urls.push(u);
    let lastErr = null;
    for (const url of urls) {
        if (!url) continue;
        if (edgeModuleCache && edgeModuleCache.url === url) return edgeModuleCache.promise;
        try {
            const mod = await import(/* webpackIgnore: true */ url);
            edgeModuleCache = { url, promise: Promise.resolve(mod) };
            return edgeModuleCache.promise;
        } catch (e) {
            lastErr = e;
            logDebug('edge lib 加载失败', url, e);
        }
    }
    throw new Error('无法加载 @edge-tts/universal（' + urls.join(' / ') + '）。' +
        '请检查网络/CORS，或在设置里更换 moduleUrl，或使用本地代理 / OpenAI 兼容服务。' + (lastErr ? ' 原始错误：' + (lastErr.message || lastErr) : ''));
}

/** 从 communicate 结果中尽力提取音频块 */
function detectPayload(ev, depth = 0) {
    if (!ev || depth > 4) return null;
    if (ev instanceof AudioBuffer) return { kind: 'pcm', buf: ev };
    if (ev instanceof Blob) return { kind: 'raw', blob: ev, mime: ev.type || 'audio/mpeg' };
    if (ev instanceof ArrayBuffer) return { kind: 'raw', blob: new Blob([ev], { type: 'audio/mpeg' }), mime: 'audio/mpeg' };
    if (ArrayBuffer.isView(ev)) {
        const copy = ev.buffer.slice(ev.byteOffset, ev.byteOffset + ev.byteLength);
        return detectPayload(copy, depth + 1);
    }
    if (ev && typeof ev === 'object') {
        if (ev.type === 'error' || ev.type === 'Error') {
            throw new Error(String(ev.message || ev.error || 'Edge TTS 返回错误'));
        }
        const keys = ['data', 'audio', 'audioBuffer', 'blob', 'buffer', 'result', 'value'];
        for (const k of keys) {
            if (ev[k] !== undefined && ev[k] !== null) {
                const found = detectPayload(ev[k], depth + 1);
                if (found) return found;
            }
        }
        if (typeof ev.type === 'string' && /audio|speech/i.test(ev.type)) {
            return detectPayload(ev.data ?? ev, depth + 1);
        }
    }
    return null;
}

/** 把 Edge 返回的各种形态统一收集为可播放 blob 列表 */
async function collectEdgeAudio(result) {
    const pcmList = [];
    const rawList = [];
    let iterable = null;
    if (result && typeof result === 'object' && typeof result[Symbol.asyncIterator] === 'function') {
        iterable = result;
    } else if (result && typeof result === 'object' && typeof result[Symbol.iterator] === 'function') {
        iterable = result;
    }
    if (iterable) {
        for await (const ev of iterable) {
            const p = detectPayload(ev);
            if (!p) continue;
            if (p.kind === 'pcm') pcmList.push(p.buf);
            else rawList.push(p);
        }
    } else {
        const resolved = result && typeof result.then === 'function' ? await result : result;
        const p = detectPayload(resolved);
        if (p) {
            if (p.kind === 'pcm') pcmList.push(p.buf);
            else rawList.push(p);
        }
    }
    const blobs = [];
    for (const raw of rawList) blobs.push({ blob: raw.blob, mime: raw.mime });
    for (const buf of pcmList) {
        blobs.push({ blob: audioBufferToWavBlob(buf), mime: 'audio/wav' });
    }
    return blobs;
}

/** Edge TTS 合成 */
async function edgeSynthesize(request, cfg) {
    const mod = await loadEdgeModule(cfg);
    const Ctor = mod.EdgeTTSBrowser || mod.default?.EdgeTTSBrowser || mod.default;
    if (typeof Ctor !== 'function' && typeof Ctor !== 'object') {
        throw new Error('Edge 模块中找不到 EdgeTTSBrowser，请更换 moduleUrl');
    }
    const voice = request.voice || defaultVoiceForLanguage(request.language || cfg.language || 'zh-CN');
    const lang = request.language || cfg.language || 'zh-CN';

    const initOpts = {};
    if (typeof Ctor === 'function') {
        // 构造器可能接受 { voice, lang } 之类的初始化参数
        try {
            initOpts.voice = voice;
            initOpts.lang = lang;
        } catch { /* ignore */ }
    }
    const tts = typeof Ctor === 'function' ? new Ctor(initOpts) : Ctor;
    if (!tts || typeof tts.communicate !== 'function') {
        throw new Error('Edge 实例缺少 communicate() 方法');
    }

    const opts = {
        voice,
        lang,
        rate: clamp(num(request.rate, 1), 0.5, 2),
        pitch: 1,
    };
    if (request.volume !== null && request.volume !== undefined) opts.volume = clamp(num(request.volume, 1), 0, 1);

    // 兼容多种库版本：communicate(text, opts) 可能返回 生成器 / Promise / 对象
    let result;
    try {
        result = tts.communicate(request.text, opts);
    } catch (e) {
        try { result = tts.communicate(request.text); }
        catch (e2) { throw new Error('Edge communicate() 调用失败：' + (e2.message || e2)); }
    }
    const blobs = await collectEdgeAudio(result);
    if (!blobs.length) {
        throw new Error('Edge TTS 未返回可播放音频（请确认 voice ID 有效、文本非空）');
    }
    return blobs;
}

/** Edge 音色列表（目录 + 用户补充） */
async function edgeVoices(cfg) {
    const voices = [];
    for (const v of listEdgeVoices(cfg.language || undefined)) {
        voices.push({ id: v.id, label: v.label || v.id, group: v.lang });
    }
    if (cfg.voicesText) {
        for (const line of String(cfg.voicesText).split(/\r?\n/)) {
            const id = line.trim();
            if (id && !voices.some(x => x.id === id)) voices.push({ id, label: id, group: '自定义' });
        }
    }
    return voices;
}

// =====================================================================
// OpenAI 兼容（/v1/audio/speech）
// =====================================================================

function fillTemplate(tpl, vars) {
    return String(tpl ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => {
        const v = vars[k];
        return v === undefined || v === null ? m : String(v);
    });
}

const OPENAI_STATIC_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'ash', 'coral', 'sage'];

async function openaiSynthesize(request, cfg) {
    const base = String(cfg.baseUrl || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('请先在设置里填写 OpenAI 兼容服务的 baseUrl');
    const model = cfg.model || 'tts-1';
    const voice = request.voice || cfg.defaultVoice || 'alloy';
    const speed = clamp(num(request.rate, 1), 0.25, 4.0);

    const body = {
        model,
        input: request.text,
        voice,
        speed,
    };
    if (cfg.responseFormat && cfg.responseFormat !== 'mp3') body.response_format = cfg.responseFormat;
    // 系统指令 = “角色声音描述 + 情绪/语气”（由 index 拼接好传入 request.instruction）
    if (request.instruction && cfg.autoInstructions !== false) {
        body.instructions = String(request.instruction).trim();
    } else if (cfg.sendInstructions) {
        const instructions = fillTemplate(cfg.instructionsTemplate || '', { ...request, voice, rate: speed });
        if (instructions.trim()) body.instructions = instructions.trim();
    }

    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey.trim();

    let res;
    try {
        res = await fetch(base + '/audio/speech', { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e) {
        throw new Error('请求失败（' + base + '）：' + (e.message || e) + '（CORS/网络问题请检查服务端）');
    }
    if (!res.ok) {
        let detail = '';
        try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
        throw new Error('HTTP ' + res.status + ' ' + detail);
    }
    let blob = await res.blob();
    let mime = blob.type || (cfg.responseFormat === 'wav' || cfg.responseFormat === 'pcm' ? 'audio/wav' : 'audio/mpeg');
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const looksLikeAudio = mime.startsWith('audio/');

    // 一些自建“OpenAI 兼容”服务把音频包在 JSON 里返回：{url} / {audio_url} / {base64|data} …
    if (!looksLikeAudio && (ct.includes('json') || ct.includes('text'))) {
        try {
            const text = await blob.text();
            const data = JSON.parse(text);
            const url = data.url || data.audio_url || data.audioUrl || data.audio || data.data?.url || data.data?.audioUrl;
            if (typeof url === 'string' && url.length > 0) {
                const r2 = await fetch(url);
                if (!r2.ok) throw new Error('拉取音频失败：HTTP ' + r2.status);
                blob = await r2.blob();
                mime = blob.type || 'audio/mpeg';
            } else {
                // base64 字段
                const b64 = data.base64 || data.audio_base64 || data.audioBase64
                    || (typeof data.data === 'string' ? data.data : null)
                    || (Array.isArray(data.data) ? data.data.join('') : null);
                if (typeof b64 === 'string' && b64.length) {
                    const clean = b64.replace(/^data:[^;]+;base64,/, '');
                    const bin = atob(clean);
                    const bytes = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                    blob = new Blob([bytes], { type: 'audio/mpeg' });
                    mime = 'audio/mpeg';
                }
            }
        } catch (e) {
            logDebug('OpenAI 兼容响应不是可解析的 JSON 包装，按原始字节处理：', e?.message || e);
        }
    }
    logDebug('OpenAI 兼容返回 content-type=' + ct + ' -> mime=' + mime + ' size=' + blob.size);
    return [{ blob, mime }];
}

/** OpenAI 音色列表：优先远程接口，其次手动列表 */
async function openaiVoices(cfg) {
    const out = [];
    if (cfg.voicesUrl) {
        try {
            const res = await fetch(cfg.voicesUrl.trim());
            if (res.ok) {
                const data = await res.json().catch(() => null);
                for (const id of voiceListFromAny(data)) {
                    if (!out.some(x => x.id === id)) out.push({ id, label: id, group: '远程' });
                }
            }
        } catch (e) { logDebug('获取远程音色失败', e); }
    }
    const manual = (cfg.voicesText || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const id of manual) if (!out.some(x => x.id === id)) out.push({ id, label: id, group: '手动' });
    if (!out.length) {
        for (const id of OPENAI_STATIC_VOICES) out.push({ id, label: id, group: '内置' });
    }
    return out;
}

// =====================================================================
// 自定义 HTTP 接口
// =====================================================================

const CUSTOM_VARS = ['text', 'voice', 'language', 'lang', 'rate', 'volume', 'emotion', 'character', 'instruction'];

function buildVars(request) {
    const v = {
        text: request.text ?? '',
        voice: request.voice ?? '',
        language: request.language ?? '',
        lang: request.language ?? '',
        rate: num(request.rate, 1),
        volume: num(request.volume, 1),
        emotion: request.emotion ?? '',
        character: request.character ?? '',
        instruction: request.instruction ?? '',
    };
    return v;
}

async function customSynthesize(request, cfg) {
    const urlTpl = String(cfg.url || '').trim();
    if (!urlTpl) throw new Error('请先在设置里填写自定义接口的 URL 模板');
    const vars = buildVars(request);
    const method = (cfg.method || 'POST').toUpperCase();
    // URL 中的占位符需要 URL 编码（中文/空格等）
    const encodedVars = {};
    for (const [k, v] of Object.entries(vars)) encodedVars[k] = encodeURIComponent(String(v));
    const url = fillTemplate(urlTpl, encodedVars);

    const headers = {};
    try {
        const parsed = JSON.parse(cfg.headers || '{}');
        for (const [k, val] of Object.entries(parsed || {})) headers[k] = fillTemplate(String(val), vars);
    } catch { /* 忽略非法 header 配置 */ }

    const init = { method, headers };
    if (method !== 'GET') {
        const bodyTpl = cfg.body ?? '';
        const bodyStr = bodyTpl.trim() ? fillTemplate(bodyTpl, vars) : '';
        if (bodyStr) {
            init.body = bodyStr;
            if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
        }
    }

    let res;
    try {
        res = await fetch(url, init);
    } catch (e) {
        throw new Error('请求失败（' + url + '）：' + (e.message || e));
    }
    if (!res.ok) {
        let detail = '';
        try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
        throw new Error('HTTP ' + res.status + ' ' + detail);
    }

    const mode = cfg.responseMode || 'audio';
    if (mode === 'audio') {
        const blob = await res.blob();
        return [{ blob, mime: blob.type || 'audio/mpeg' }];
    }
    // JSON 响应：字段为 url 或 base64
    const json = await res.json().catch(() => null);
    if (!json) throw new Error('响应不是合法 JSON（responseMode=' + mode + '）');
    const field = cfg.jsonField || 'url';
    let val = json;
    for (const part of field.split('.')) val = val?.[part];
    if (val === undefined || val === null) throw new Error('JSON 中找不到字段 "' + field + '"');
    if (mode === 'jsonUrl') {
        const audioRes = await fetch(String(val));
        if (!audioRes.ok) throw new Error('拉取音频失败：HTTP ' + audioRes.status);
        const blob = await audioRes.blob();
        return [{ blob, mime: blob.type || 'audio/mpeg' }];
    }
    // jsonBase64
    const b64 = String(val).replace(/^data:[^;]+;base64,/, '');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return [{ blob: new Blob([bytes], { type: 'audio/mpeg' }), mime: 'audio/mpeg' }];
}

async function customVoices(cfg) {
    const out = [];
    if (cfg.voicesUrl) {
        try {
            const res = await fetch(cfg.voicesUrl.trim());
            if (res.ok) {
                const data = await res.json().catch(() => null);
                for (const id of voiceListFromAny(data)) {
                    if (!out.some(x => x.id === id)) out.push({ id, label: id, group: '远程' });
                }
            }
        } catch (e) { logDebug('获取自定义音色失败', e); }
    }
    for (const line of String(cfg.voicesText || '').split(/\r?\n/)) {
        const id = line.trim();
        if (id && !out.some(x => x.id === id)) out.push({ id, label: id, group: '手动' });
    }
    return out;
}

// =====================================================================
// 统一入口
// =====================================================================

/**
 * 合成一段语音
 * @param {{text:string, voice?:string, language?:string, rate?:number, volume?:number, emotion?:string, character?:string}} request
 * @param {object} s 当前 settings 数据（含 provider / providers）
 * @returns {Promise<{ok:boolean, blobs?:Array<{blob:Blob,mime:string}>, message?:string}>}
 */
export async function synthesize(request, s) {
    const providerId = s.provider || 'edge';
    const cfg = s.providers?.[providerId] || {};
    try {
        if (!request.text) return { ok: false, message: '没有可朗读的文本' };
        let blobs;
        if (providerId === 'edge') blobs = await edgeSynthesize(request, cfg);
        else if (providerId === 'openai') blobs = await openaiSynthesize(request, cfg);
        else if (providerId === 'custom') blobs = await customSynthesize(request, cfg);
        else return { ok: false, message: '未知服务商：' + providerId };
        return { ok: true, blobs };
    } catch (e) {
        return { ok: false, message: e?.message || String(e) };
    }
}

/**
 * 获取音色列表（供设置页 / 角色弹窗使用）
 * @param {object} s
 * @returns {Promise<{ok:boolean, voices:Array<{id:string,label:string,group?:string}>, message?:string}>}
 */
export async function loadVoices(s) {
    const providerId = s.provider || 'edge';
    const cfg = s.providers?.[providerId] || {};
    try {
        let voices = [];
        if (providerId === 'edge') voices = await edgeVoices(cfg);
        else if (providerId === 'openai') voices = await openaiVoices(cfg);
        else if (providerId === 'custom') voices = await customVoices(cfg);
        return { ok: true, voices, message: `共 ${voices.length} 个音色` };
    } catch (e) {
        return { ok: false, voices: [], message: e?.message || String(e) };
    }
}

/** 当前服务商的音色是否可“自由输入” */
export function voiceIsFreeText(s) {
    return s.provider === 'edge' || s.provider === 'openai' || s.provider === 'custom';
}
