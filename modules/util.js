// BetterTTS - 通用小工具（不依赖 ST API，仅依赖页面全局 jQuery/$）

/** 取当前时间字符串 HH:MM:SS */
export function nowClock() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}

export function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

/** 简单防抖 */
export function debounce(fn, wait = 200) {
    let timer = null;
    const wrapped = function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn.apply(this, args); }, wait);
    };
    wrapped.cancel = () => { clearTimeout(timer); timer = null; };
    return wrapped;
}

/** 把对象转成可读 JSON 字符串（缩进 2） */
export function prettyJson(obj) {
    try { return JSON.stringify(obj, null, 2); }
    catch { return String(obj); }
}

/** 安全 JSON.parse */
export function safeParse(text, fallback = null) {
    try { return JSON.parse(text); }
    catch { return fallback; }
}

/** 复制文本到剪贴板 */
export async function copyText(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* fall through */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;left:-9999px;top:0;';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
    } catch { return false; }
}

/** 从任意结构中尽力提取字符串（用于语音列表容错解析） */
export function voiceListFromAny(raw) {
    const out = [];
    const push = v => {
        if (v === null || v === undefined) return;
        if (typeof v === 'string') { const s = v.trim(); if (s && !out.includes(s)) out.push(s); return; }
        if (typeof v === 'object') {
            const cand = v.id ?? v.voice ?? v.name ?? v.voiceId ?? v.value ?? v.label ?? v.zhName;
            if (typeof cand === 'string' && cand.trim()) { const s = cand.trim(); if (!out.includes(s)) out.push(s); }
            else if (Array.isArray(v.voices)) { v.voices.forEach(push); }
        }
        if (Array.isArray(v)) v.forEach(push);
    };
    push(raw);
    return out;
}

/** 生成一个 DOM 元素（$ 可用时用 jQuery，否则纯 DOM） */
export function makeEl(html) {
    if (typeof $ !== 'undefined') return $(html);
    const tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    return tpl.content.firstChild;
}

/** 在控制台输出调试信息 */
export function logDebug(...args) {
    try {
        // 通过全局桥读取调试开关（由 index.js 注入）
        if (globalThis.__BETTER_TTS_DEBUG__) console.debug('[BetterTTS]', ...args);
    } catch { /* ignore */ }
}

/** 简单哈希，用于生成稳定 key */
export function hashString(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
}

/** 对 <audio> 友好的文件扩展名 */
export function extFromMime(mime) {
    if (!mime) return 'bin';
    if (mime.includes('wav')) return 'wav';
    if (mime.includes('mp3')) return 'mp3';
    if (mime.includes('ogg') || mime.includes('opus')) return 'ogg';
    if (mime.includes('aac')) return 'aac';
    if (mime.includes('mpeg')) return 'mp3';
    if (mime.includes('flac')) return 'flac';
    return mime.split('/')[1] || 'bin';
}

/** 触发浏览器下载文本文件 */
export function downloadTextFile(filename, text, mime = 'application/json') {
    const blob = new Blob([text], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/** 读取用户选择的第一个文本文件 */
export function pickTextFile(accept = '.json,.txt,application/json,text/plain') {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.style.display = 'none';
        input.addEventListener('change', async () => {
            const f = input.files && input.files[0];
            if (!f) { resolve(null); return; }
            try {
                const text = await f.text();
                resolve({ name: f.name, text });
            } catch (e) {
                resolve(null);
            } finally {
                input.remove();
            }
        });
        document.body.appendChild(input);
        input.click();
    });
}

/** HTML 转义 */
export function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
