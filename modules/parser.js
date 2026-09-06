// BetterTTS - 语音/角色调用解析器
// 识别的函数调用格式（正则驱动 + 引号感知的收尾匹配）：
//
//   语音（说话模式）：  [[BTTS: { "text": "...", "character": "...", ... }]]  （兼容旧名 BetterTTS）
//   角色注册（声音描述）：[[BTTS-AddRole: { "character": "...", "voice": "声音描述" }]]
//
// 说明：
//  - 内容采用类 JSON 的对象字面量；语音调用 text 必填。
//  - 正文里不应出现 [[ 或 ]]（模板中已约束）。
//  - 若模型只输出了一半（未闭合），解析器会跳过该片段（视为“进行中”）。

/** 语音调用前缀（新名 BTTS，兼容旧名 BetterTTS；不含 -AddRole） */
const SPEECH_PREFIX = /\[\[\s*(?:BetterTTS|BTTS)\s*:\s*/i;
/** 角色注册前缀 */
const ROLE_PREFIX = /\[\[\s*(?:BetterTTS|BTTS)\s*-\s*AddRole\s*:\s*/i;

/** 通用扫描：按给定前缀找“闭合的函数调用” */
function scanCalls(text, prefixRe) {
    if (!text || typeof text !== 'string') return [];
    const out = [];
    let pos = 0;
    let i = 0;
    while (i < text.length) {
        const rest = text.slice(i);
        const m = prefixRe.exec(rest);
        if (!m) break;
        const start = i + m.index;
        const openIdx = start + m[0].length;

        // 引号感知找闭合的 "]]"
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
        if (closeIdx < 0) break; // 未闭合：可能在流式生成中
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

/**
 * 解析语音调用 [[BTTS: {...}]]（兼容旧名 [[BetterTTS: …]]）
 * @returns {Array<{raw,payload,start,end,pos,obj}>} pos 为第几个调用（0 起）
 */
export function findCalls(text) {
    return scanCalls(text, SPEECH_PREFIX);
}

/**
 * 解析角色注册调用 [[BTTS-AddRole: {…}]]
 * @returns {Array<{raw,payload,start,end,pos,obj}>}
 */
export function findRoleCalls(text) {
    return scanCalls(text, ROLE_PREFIX);
}

/** 文本是否包含语音或角色调用标记（含半截的） */
export function hasMarker(text) {
    return typeof text === 'string' && (SPEECH_PREFIX.test(text) || ROLE_PREFIX.test(text));
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
