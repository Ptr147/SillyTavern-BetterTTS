// BetterTTS - 聊天消息前端渲染（正则替换实现）
//
// 做法：对消息文本 HTML 用正则整体匹配 [[BetterTTS: {…}]]（允许跨行、允许中间的 <br> 等标签），
// 把“函数调用”字符串级替换为渲染好的气泡 HTML：
//   - 说话内容 + 右上角小字时间
//   - 点击 播放/暂停（document 级委托，见 index.js）
//   - 右键 弹出菜单（复制完整函数调用 / 复制文本等，见 index.js）
//
// 兼容多行/被标签切分的调用：捕获后先剥离标签、解码实体再 JSON.parse，
// 因此不依赖调用是否“恰好完整落在一个文本节点”内。

import { nowClock } from './util.js';

const PREFIX_RE = /\[\[\s*BetterTTS\s*:/i;
// 匹配一个完整的调用（含可能出现在中间的空格/换行/<br> 等）
const CALL_RE = /\[\[\s*BetterTTS\s*:\s*(\{[\s\S]*?\})\s*\]\]/gi;

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

/**
 * 在“叶子文本容器”上做正则整段替换。
 * @param {HTMLElement} el 不含仍带调用的子元素的最深层容器
 * @returns {number} 替换的调用数
 */
function processTextContainer(el) {
    const html0 = el.innerHTML || '';
    if (!PREFIX_RE.test(html0)) return 0;
    const mesId = mesIdOf(el);

    const re = new RegExp(CALL_RE.source, 'gi');
    let out = '';
    let last = 0;
    let inserted = 0;
    let segPos = 0;
    let m;

    while ((m = re.exec(html0)) !== null) {
        if (insideTag(html0, m.index)) {
            // 命中在标签/属性内部：保留原文，继续向后找
            out += html0.slice(last, m.index + m[0].length);
            last = m.index + m[0].length;
            continue;
        }
        const matchAll = m[0];
        const payloadHtml = m[1];
        // 先尝试标准 JSON；失败再尝试整段解码（兼容被标签切碎的情况）
        let obj = tryParseObj(payloadHtml);
        if (!obj) {
            const whole = fragmentToText(matchAll);
            const inner = whole.replace(/^\[\[\s*BetterTTS\s*:\s*/, '').replace(/\s*\]\]$/, '');
            obj = tryParseObj(inner);
        }
        if (!obj) {
            // 解析失败：保留原文，不消耗序号
            out += html0.slice(last, m.index + matchAll.length);
            last = m.index + matchAll.length;
            continue;
        }
        const text = String(obj.text ?? '').trim();
        if (!text) {
            out += html0.slice(last, m.index + matchAll.length);
            last = m.index + matchAll.length;
            continue;
        }
        const character = String(obj.character || obj.name || '').trim();
        const emotion = String(obj.emotion || '').trim();

        out += html0.slice(last, m.index);
        out += chipHtml({
            key: `seg:${mesId}:${segPos++}`,
            character,
            emotion,
            payload: payloadText(obj),
            text,
            time: nowClock(),
        });
        last = m.index + matchAll.length;
        inserted++;
    }
    if (inserted) {
        el.innerHTML = out + html0.slice(last);
    }
    return inserted;
}

/** 由对象生成“去掉前缀”的规范 JSON（存进属性，避免正则二次匹配） */
function payloadText(obj) {
    const fields = {};
    if (obj.character || obj.name) fields.character = obj.character || obj.name;
    if (obj.voice) fields.voice = obj.voice;
    if (obj.rate !== undefined && obj.rate !== null && obj.rate !== '') fields.rate = obj.rate;
    if (obj.emotion) fields.emotion = obj.emotion;
    if (obj.language) fields.language = obj.language;
    return JSON.stringify({ text: String(obj.text ?? ''), ...fields });
}

/** 生成完整的调用文本（右键“复制完整函数调用”用） */
export function wholeCallText(obj) {
    return '[[BetterTTS: ' + payloadText(obj) + ']]';
}

/**
 * 渲染一个消息根（.mes 或任意包含调用的元素）。
 * 逐层下钻到“叶子文本容器”，避免整条消息重建。
 * @returns {number} 本次替换数量
 */
export function renderElement(root) {
    if (!root || root.nodeType !== 1) return 0;
    const markerIn = (el) => el && typeof el.innerHTML === 'string' && PREFIX_RE.test(el.innerHTML);
    let total = 0;

    const walk = (el) => {
        if (!markerIn(el)) return;
        const kids = Array.from(el.children || []).filter(k => markerIn(k));
        if (kids.length) {
            for (const k of kids) walk(k);
            return;
        }
        try { total += processTextContainer(el); } catch { /* ignore */ }
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
        const call = payload.trim().startsWith('[[BetterTTS') ? payload : '[[BetterTTS: ' + payload + ']]';
        const textNode = document.createTextNode(call);
        chip.replaceWith(textNode);
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
