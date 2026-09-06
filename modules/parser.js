// BetterTTS - 语音调用解析器
// 识别的函数调用格式（正则驱动 + 引号感知的收尾匹配）：
//
//   [[BetterTTS: { "text": "...", "character": "...", "voice": "...",
//                  "rate": 1.0, "emotion": "...", "language": "..." }]]
//
// 说明：
//  - 内容采用类 JSON 的对象字面量，text 为必填。
//  - 正文里不应出现 [[ 或 ]]（模板中已约束）。
//  - 若模型只输出了一半（未闭合），解析器会跳过该片段（视为“进行中”），
//    以保证流式生成过程中不会把残缺调用当完整调用处理。

/** 匹配 [[BetterTTS: 前缀（大小写不敏感，冒号后允许空白） */
const PREFIX_RE = /\[\[\s*BetterTTS\s*:\s*/i;
/**
 * 解析一段文本中的所有语音调用。
 * @param {string} text 原始消息文本
 * @returns {Array<{raw:string,start:number,end:number,pos:number,obj:object|null}>}
 *          pos 为第几个调用（0 起），obj 为解析后的对象（解析失败为 null）
 */
export function findCalls(text) {
    if (!text || typeof text !== 'string') return [];
    const out = [];
    let pos = 0;
    let i = 0;
    while (i < text.length) {
        const rest = text.slice(i);
        const m = PREFIX_RE.exec(rest);
        if (!m) break;
        const start = i + m.index;
        const openIdx = start + m[0].length;

        // 找到闭合的 "]]"（引号感知：JSON 字符串中的 ] 不参与收尾）
        let braceDepth = 0;
        let inStr = false;
        let escape = false;
        let closeIdx = -1;
        for (let j = openIdx; j < text.length - 1; j++) {
            const ch = text[j];
            const next = text[j + 1];
            if (inStr) {
                if (escape) { escape = false; continue; }
                if (ch === '\\') { escape = true; continue; }
                if (ch === '"') inStr = false;
                continue;
            }
            if (ch === '"') { inStr = true; continue; }
            if (ch === '{') { braceDepth++; continue; }
            if (ch === '}') { braceDepth = Math.max(0, braceDepth - 1); continue; }
            if (ch === ']' && next === ']' && braceDepth <= 0) { closeIdx = j; break; }
        }
        if (closeIdx < 0) {
            // 未闭合：可能是流式生成到一半；终止（后面不会再出现有效调用）
            // 仍推进扫描，避免死循环。
            break;
        }
        const raw = text.slice(start, closeIdx + 2);
        const payload = text.slice(openIdx, closeIdx);
        let obj = null;
        try {
            const parsed = JSON.parse(payload);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed;
        } catch { obj = null; }

        out.push({ raw, payload, start, end: closeIdx + 2, pos: pos++, obj });
        i = closeIdx + 2;
    }
    return out;
}

/** 该文本是否包含至少一个（哪怕是半截的）调用标记 */
export function hasMarker(text) {
    return typeof text === 'string' && PREFIX_RE.test(text);
}

/**
 * 把消息文本切成“普通文本 / 语音调用”块（顺序保留）。
 * 解析失败的残缺调用会作为普通文本返回（并保留原始内容，便于排查）。
 */
export function parseBlocks(text) {
    const blocks = [];
    if (!text) return blocks;
    const calls = findCalls(text);
    let cursor = 0;
    for (const c of calls) {
        if (c.obj) {
            if (c.start > cursor) blocks.push({ kind: 'text', text: text.slice(cursor, c.start) });
            blocks.push({ kind: 'call', ...c });
            cursor = c.end;
        }
    }
    if (cursor < text.length) blocks.push({ kind: 'text', text: text.slice(cursor) });
    return blocks;
}

/**
 * 按句切分（用于“按段朗读”的旁白/普通文本）。
 * 切分点：。！？!?…；以及换行。单段过长时再按长度硬切。
 */
export function splitSentences(text, maxLen = 220) {
    const rawParts = text
        .replace(/\r/g, '')
        .split(/(?<=[。！？!?；;\n])/)
        .map(s => s.trim())
        .filter(Boolean);
    const out = [];
    for (let part of rawParts) {
        while (part.length > maxLen) {
            let cut = part.lastIndexOf('，', maxLen);
            if (cut < maxLen * 0.4) cut = part.lastIndexOf(',', maxLen);
            if (cut < maxLen * 0.4) cut = maxLen;
            out.push(part.slice(0, cut).trim());
            part = part.slice(cut).trim();
        }
        if (part) out.push(part);
    }
    return out;
}

/**
 * 归一化调用对象：补全缺失字段与默认值
 */
export function normalizeCall(obj, fallback = {}) {
    const o = obj && typeof obj === 'object' ? obj : {};
    return {
        text: String(o.text ?? '').trim(),
        character: String(o.character ?? o.name ?? o.role ?? '').trim(),
        voice: String(o.voice ?? o.speaker ?? o.音色 ?? '').trim(),
        rate: Number.isFinite(Number(o.rate)) ? Number(o.rate) : null,
        emotion: String(o.emotion ?? o.情绪 ?? '').trim(),
        language: String(o.language ?? o.lang ?? '').trim(),
        volume: Number.isFinite(Number(o.volume)) ? Number(o.volume) : null,
    };
}

export function applyCallFallback(call, fallback) {
    call.text = call.text || fallback.text || '';
    call.character = call.character || fallback.character || '';
    call.voice = call.voice || fallback.voice || '';
    call.rate = call.rate ?? fallback.rate;
    call.emotion = call.emotion || fallback.emotion || '';
    call.language = call.language || fallback.language || '';
    call.volume = call.volume ?? fallback.volume;
    return call;
}
