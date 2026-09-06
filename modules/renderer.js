// BetterTTS - 聊天消息前端渲染（正则替换实现）
//
// 做法：对消息文本 HTML 用正则整体匹配：
//   - [[BTTS: {…}]]（兼容旧名 BetterTTS）→ 渲染为内联气泡 HTML
//   - [[BTTS-AddRole: {…}]] → 提取“角色声音描述”回调给 index（界面隐藏该行）
// 允许跨行、允许中间的 <br> 等标签：捕获后先剥标签、解码实体再 JSON.parse。

import { nowClock } from './util.js';

/** 是否存在语音/角色调用标记（冒号=语音，连字符=AddRole） */
const HAS_MARKER_RE = /\[\[\s*(?:BetterTTS|BTTS)\s*(:|-)/i;
/** 语音调用完整匹配 */
const CALL_RE = /\[\[\s*(?:BetterTTS|BTTS)\s*:\s*(\{[\s\S]*?\})\s*\]\]/gi;
/** 角色注册调用完整匹配（含可能被 <br>/换行切分的内容） */
const ROLE_RE = /\[\[\s*(?:BetterTTS|BTTS)\s*-\s*AddRole\s*:\s*(\{[\s\S]*?\})\s*\]\]/gi;
/** 全文段落调用完整匹配 */
const TEXT_CALL_RE = /\[\[\s*(?:BetterTTS|BTTS)\s*-\s*TEXT\s*:\s*(\{[\s\S]*?\})\s*\]\]/gi;

let roleListener = null; // (obj) => void 由 index 注入，用于接收角色注册

export function setRoleListener(fn) { roleListener = fn; }

let _mesIdResolver = null; // (el) => string 由 index 注入（可选）

export function setMesIdResolver(fn) { _mesIdResolver = fn; }

/** 取消息 id（优先注入解析器，其次 .mes 的 data-message-id） */
export function mesIdOf(el) {
    if (_mesIdResolver) {
        try { const id = _mesIdResolver(el); if (id !== undefined && id !== null) return String(id); } catch { /* ignore */ }
    }
    const mes = el?.closest?.('.mes');
    if (mes) {
        const byData = mes.getAttribute('data-message-id');
        if (byData) return byData;
    }
    return 'x';
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 构造内联气泡 HTML（span，融入文字流）
 *  结构：说话者 | “台词” | 右上时间；不显示播放图标（整块可点击/右键）
 *  属性只存不含 [[ 前缀的 JSON，避免被自身正则二次匹配 */
function chipHtml({ key, character, emotion, payload, text, time }) {
    const speaker = character ? `<span class="btts-seg-speaker">${esc(character)}</span>` : '';
    return `<span class="btts-seg" data-key="${esc(key)}" data-payload="${esc(payload)}" data-char="${esc(character || '')}" data-emotion="${esc(emotion || '')}" role="button" tabindex="0" title="点击播放/暂停 · 右键更多操作">`
        + `<span class="btts-seg-ind" aria-hidden="true"></span>`
        + speaker
        + `<span class="btts-quote btts-quote-open" aria-hidden="true">“</span>`
        + `<span class="btts-seg-text">${esc(text)}</span>`
        + `<span class="btts-quote btts-quote-close" aria-hidden="true">”</span>`
        + `<time class="btts-seg-time">${esc(time || nowClock())}</time>`
        + `</span>`;
}

/** 更新气泡状态类（无播放图标：通过气泡高亮/呼吸表达播放、暂停等） */
export function setChipState(chip, status) {
    if (!chip || chip.dataset.playing === status) return;
    chip.dataset.playing = status || '';
    chip.classList.remove('btts-playing', 'btts-paused', 'btts-loading', 'btts-error');
    if (status === 'playing') chip.classList.add('btts-playing');
    else if (status === 'paused') chip.classList.add('btts-paused');
    else if (status === 'loading') chip.classList.add('btts-loading');
    else if (status === 'error') chip.classList.add('btts-error');
}

// ---------------------------------------------------------------------
// 正则替换核心
// ---------------------------------------------------------------------

/** 把带标签的片段解码为纯文本：<br>→\n、剥离其余标签、解码实体 */
function fragmentToText(html) {
    try {
        const d = document.createElement('div');
        d.innerHTML = String(html).replace(/<br\s*\/?>/gi, '\n');
        return d.textContent ?? '';
    } catch { return String(html).replace(/<[^>]+>/g, ''); }
}

/** 判断位置是否位于某个开始标签/属性内部（防止误匹配属性值） */
function insideTag(html, index) {
    const lt = html.lastIndexOf('<', index);
    const gt = html.lastIndexOf('>', index);
    return lt > gt;
}

function tryParseObj(payloadHtml) {
    const clean = fragmentToText(payloadHtml).trim();
    if (!clean) return null;
    try { return JSON.parse(clean); } catch { return null; }
}

/** 每条消息在本次会话内的唯一序号（不依赖 ST 的 data-message-id） */
let mesSeqCounter = 0;
const mesSeqMap = new WeakMap();
function seqFor(mesEl) {
    if (!mesSeqMap.has(mesEl)) mesSeqMap.set(mesEl, ++mesSeqCounter);
    return mesSeqMap.get(mesEl);
}

/** 由角色调用片段解析角色注册对象（JSON → 整段解码 → 简写“名字 描述”） */
function roleObjFromPayload(payloadHtml, rawHtml) {
    let obj = tryParseObj(payloadHtml);
    if (obj && (obj.character || obj.name || obj.role)) return obj;
    const whole = fragmentToText(rawHtml)
        .replace(/^\[\[\s*(?:BetterTTS|BTTS)\s*-\s*AddRole\s*:\s*/, '')
        .replace(/\s*\]\]$/, '');
    obj = tryParseObj(whole);
    if (obj && (obj.character || obj.name || obj.role)) return obj;
    // 简写： BTTS-AddRole 小林：描述…
    const clean = whole.trim();
    const idx = clean.search(/\s|：|:/);
    if (idx > 0) {
        return { character: clean.slice(0, idx).trim(), voice: clean.slice(idx + 1).trim() };
    }
    return null;
}

/** 由对象生成段落调用（BTTS-TEXT）的规范 JSON（含 roles） */
export function textPayload(obj) {
    const roles = Array.isArray(obj.roles) ? obj.roles : [];
    const clean = roles
        .map(r => {
            const o = {};
            if (r && r.character) o.character = String(r.character).trim();
            if (r && r.emotion) o.emotion = String(r.emotion).trim();
            return o;
        })
        .filter(o => o.character);
    return JSON.stringify({ text: String(obj.text ?? ''), ...(clean.length ? { roles: clean } : {}) });
}

/** 构造段落（全文）极简气泡：几乎透明背景，仅以边框颜色区分 */
function textChipHtml({ key, payload, text, time }) {
    return `<span class="btts-seg btts-text-seg" data-kind="text" data-key="${esc(key)}" data-payload="${esc(payload)}" role="button" tabindex="0" title="点击播放/暂停整段 · 右键更多操作">`
        + `<span class="btts-seg-ind" aria-hidden="true"></span>`
        + `<span class="btts-seg-text">${esc(text)}</span>`
        + `<time class="btts-seg-time">${esc(time || nowClock())}</time>`
        + `</span>`;
}

/**
 * 在“叶子文本容器”上做正则整段替换：
 * 1) 剥离 BTTS-AddRole 并上报；2) BTTS-TEXT→段落极简气泡；3) BTTS→内联语音气泡。
 */
function processTextContainer(el, nextKey) {
    const html0 = el.innerHTML || '';
    if (!HAS_MARKER_RE.test(html0)) return 0;

    // ---- 1) 剥离 BTTS-AddRole 并上报（不在界面显示） ----
    let cleaned = '';
    let cur = 0;
    {
        const roleRe = new RegExp(ROLE_RE.source, 'gi');
        let rm;
        while ((rm = roleRe.exec(html0)) !== null) {
            if (insideTag(html0, rm.index)) {
                cleaned += html0.slice(cur, rm.index + rm[0].length);
                cur = rm.index + rm[0].length;
                continue;
            }
            cleaned += html0.slice(cur, rm.index);
            const obj = roleObjFromPayload(rm[1], rm[0]);
            if (obj && typeof roleListener === 'function') {
                try { roleListener(obj); } catch { /* ignore */ }
            }
            cur = rm.index + rm[0].length;
        }
        cleaned += html0.slice(cur);
    }

    // ---- 2) 通用替换：source -> 处理后字符串，返回替换数量 ----
    const runPass = (source, re, kind) => {
        const parseWhole = (raw) => raw.replace(/^\[\[\s*(?:BetterTTS|BTTS)(?:-TEXT)?\s*:\s*/, '').replace(/\s*\]\]$/, '');
        let out = '';
        let last = 0;
        let count = 0;
        let m;
        const reg = new RegExp(re.source, 'gi');
        while ((m = reg.exec(source)) !== null) {
            if (insideTag(source, m.index)) {
                out += source.slice(last, m.index + m[0].length);
                last = m.index + m[0].length;
                continue;
            }
            const matchAll = m[0];
            const payloadHtml = m[1];
            let obj = tryParseObj(payloadHtml);
            if (!obj) {
                const whole = fragmentToText(matchAll);
                obj = tryParseObj(parseWhole(whole));
            }
            if (!obj) { out += source.slice(last, m.index + m[0].length); last = m.index + m[0].length; continue; }
            const text = String(obj.text ?? '').trim();
            if (!text) { out += source.slice(last, m.index + m[0].length); last = m.index + m[0].length; continue; }

            out += source.slice(last, m.index);
            if (kind === 'text') {
                out += textChipHtml({ key: nextKey(), payload: textPayload(obj), text, time: nowClock() });
            } else {
                const character = String(obj.character || obj.name || '').trim();
                const emotion = String(obj.emotion || '').trim();
                out += chipHtml({ key: nextKey(), character, emotion, payload: payloadText(obj), text, time: nowClock() });
            }
            last = m.index + matchAll.length;
            count++;
        }
        out += source.slice(last);
        return { out, count };
    };

    let pass = runPass(cleaned, TEXT_CALL_RE, 'text');
    let final = runPass(pass.out, CALL_RE, 'speech');
    if (final.count || pass.count || cleaned !== html0) {
        el.innerHTML = final.out;
    }
    return final.count + pass.count;
}

/** 由对象生成“去掉前缀”的规范 JSON（语音调用存进属性，避免正则二次匹配） */
export function payloadText(obj) {
    const fields = {};
    if (obj.character || obj.name) fields.character = obj.character || obj.name;
    if (obj.voice) fields.voice = obj.voice;
    if (obj.rate !== undefined && obj.rate !== null && obj.rate !== '') fields.rate = obj.rate;
    if (obj.emotion) fields.emotion = obj.emotion;
    if (obj.language) fields.language = obj.language;
    return JSON.stringify({ text: String(obj.text ?? ''), ...fields });
}

/** 生成完整的语音调用文本（右键“复制完整函数调用”用） */
export function wholeCallText(obj) {
    return '[[BTTS: ' + payloadText(obj) + ']]';
}

/** 生成完整的段落调用文本 */
export function wholeTextCallText(obj) {
    return '[[BTTS-TEXT: ' + textPayload(obj) + ']]';
}

/** 在可见气泡中按规范 payload 找同一声音段的气泡 key（供自动朗读高亮） */
export function findChipKeyByPayload(payload) {
    if (!payload) return null;
    for (const chip of document.querySelectorAll('.mes .btts-seg')) {
        if (chip.dataset.payload === payload) return chip.dataset.key || null;
    }
    return null;
}

/**
 * 渲染一个消息根（.mes 或任意包含调用的元素）。
 * 逐层下钻到“叶子文本容器”，避免整条消息重建。
 * 每个气泡 key = m<消息唯一序号>:<段号>，仅与所属消息绑定。
 * @returns {number} 本次替换数量
 */
export function renderElement(root) {
    if (!root || root.nodeType !== 1) return 0;
    const markerIn = (el) => el && typeof el.innerHTML === 'string' && HAS_MARKER_RE.test(el.innerHTML);
    if (!markerIn(root)) return 0;
    const mesEl = root.classList?.contains('mes') ? root : (root.closest ? root.closest('.mes') || root : root);
    const seq = seqFor(mesEl);
    let pos = 0;
    let total = 0;

    const walk = (el) => {
        if (!markerIn(el)) return;
        const kids = Array.from(el.children || []).filter(k => markerIn(k));
        if (kids.length) {
            for (const k of kids) walk(k);
            return;
        }
        try { total += processTextContainer(el, () => `m${seq}:${pos++}`); } catch { /* ignore */ }
    };
    walk(root);
    return total;
}

// ---------------------------------------------------------------------
// MutationObserver 封装（不依赖具体容器类名）
// ---------------------------------------------------------------------

function mesRootOf(node) {
    if (!node || node.nodeType !== 1) return null;
    if (typeof node.classList === 'object' && node.classList.contains('mes')) return node;
    return node.closest ? (node.closest('.mes') || null) : null;
}

function pushMesRoots(node, pending) {
    const root = mesRootOf(node);
    if (root) { pending.add(root); return; }
    const inner = node.querySelectorAll ? node.querySelectorAll('.mes') : [];
    for (const m of inner) pending.add(m);
}

export function createChatObserver(onChangedElements) {
    let timer = null;
    const pending = new Set();

    const flush = () => {
        timer = null;
        if (!pending.size) return;
        const list = [...pending];
        pending.clear();
        onChangedElements(list);
    };
    const schedule = () => {
        if (!timer) timer = setTimeout(flush, 220);
    };

    const observer = new MutationObserver((mutations) => {
        for (const mu of mutations) {
            if (mu.type === 'characterData') {
                const el = mesRootOf(mu.target.parentElement);
                if (el) pending.add(el);
                continue;
            }
            if (mu.target?.nodeType === 1) pushMesRoots(mu.target, pending);
            for (const node of mu.addedNodes || []) {
                if (node.nodeType === 1) pushMesRoots(node, pending);
                else if (node.nodeType === 3) {
                    const el = mesRootOf(node.parentElement);
                    if (el) pending.add(el);
                }
            }
        }
        if (pending.size) schedule();
    });

    let observing = false;
    const start = () => {
        if (observing) return true;
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        observing = true;
        return true;
    };
    const stop = () => { if (timer) { clearTimeout(timer); timer = null; } observer.disconnect(); observing = false; pending.clear(); };
    const rescanAll = () => { onChangedElements(Array.from(document.querySelectorAll('.mes'))); };

    return { start, stop, flush, rescanAll, isConnected: () => observing };
}

/** 轻量清理 Markdown 记号，供朗读用（只读一次文本，不修改存储） */
export function scrubMarkdown(text) {
    return String(text ?? '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\*\*\*?([^*]+)\*\*\*?/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/~~([^~]+)~~/g, '$1')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/^\s*>\s?/gm, '')
        .replace(/[*_~]/g, '')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

/**
 * 把当前可见聊天里的语音卡片还原成原始函数调用文本
 * （禁用扩展 / 需要看到原始内容时调用）
 */
export function revertVisibleChips() {
    document.querySelectorAll('.mes .btts-seg').forEach(chip => {
        const payload = chip.dataset.payload || chip.dataset.raw || '';
        if (payload.trim().startsWith('[[')) {
            chip.replaceWith(document.createTextNode(payload));
            return;
        }
        const isText = chip.dataset.kind === 'text';
        const call = (isText ? '[[BTTS-TEXT: ' : '[[BTTS: ') + payload + ']]';
        chip.replaceWith(document.createTextNode(call));
    });
}

/** 全量扫描当前可见的所有消息（幂等） */
export function scanVisible() {
    let count = 0;
    for (const mes of document.querySelectorAll('.mes')) {
        try { count += renderElement(mes); } catch { /* ignore */ }
    }
    return count;
}
