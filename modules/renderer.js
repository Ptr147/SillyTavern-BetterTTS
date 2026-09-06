// BetterTTS - 聊天消息前端渲染
// 把消息 DOM 中形如 [[BetterTTS: {...}]] 的“语音调用”正则替换为可交互卡片：
//   - 显示 说话内容 + 右上角小字时间
//   - 点击 播放/暂停
//   - 右键 弹出菜单（复制完整调用原文 / 复制文本等）
// 同时提供 MutationObserver，自动处理：新消息、流式生成中的增量刷新、
// 消息编辑、切换聊天后的重新渲染。

import { nowClock } from './util.js';
import { findCalls } from './parser.js';

const PREFIX_RE = /\[\[\s*BetterTTS\s*:/i;

let _mesIdResolver = null; // (el) => string 由 index 注入，用于得到消息 id

export function setMesIdResolver(fn) { _mesIdResolver = fn; }

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

/** 判读一个文本片段是否为调用标记 */
export function hasMarkerInText(text) {
    return typeof text === 'string' && PREFIX_RE.test(text);
}

// ---------------------------------------------------------------------
// 卡片构建
// ---------------------------------------------------------------------

const PLAY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
const LOAD_ICON = '<svg class="btts-spin" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10h-2.4A7.6 7.6 0 1 1 12 4.4z"/></svg>';

function buildChip({ key, character, emotion, text, raw, time }) {
    const seg = document.createElement('div');
    seg.className = 'btts-seg';
    seg.dataset.key = key;
    seg.dataset.raw = raw;
    seg.dataset.char = character || '';
    seg.dataset.emotion = emotion || '';
    seg.setAttribute('tabindex', '0');
    seg.setAttribute('role', 'button');
    seg.setAttribute('aria-label', (character ? character + '：' : '') + '语音，点击播放或暂停');
    seg.title = '点击播放/暂停 · 右键更多操作';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btts-seg-play';
    btn.setAttribute('aria-hidden', 'true');
    btn.innerHTML = PLAY_ICON;

    const body = document.createElement('div');
    body.className = 'btts-seg-body';

    const head = document.createElement('div');
    head.className = 'btts-seg-head';
    const charEl = document.createElement('span');
    charEl.className = 'btts-seg-char';
    charEl.textContent = character || '语音';
    if (emotion) {
        const emoEl = document.createElement('span');
        emoEl.className = 'btts-seg-emotion';
        emoEl.textContent = emotion;
        head.appendChild(charEl);
        head.appendChild(emoEl);
    } else {
        head.appendChild(charEl);
    }
    const timeEl = document.createElement('time');
    timeEl.className = 'btts-seg-time';
    timeEl.textContent = time || nowClock();
    head.appendChild(timeEl);

    const textEl = document.createElement('div');
    textEl.className = 'btts-seg-text';
    textEl.textContent = text;

    body.appendChild(head);
    body.appendChild(textEl);
    seg.appendChild(btn);
    seg.appendChild(body);
    return seg;
}

/** 更新卡片图标状态（由播放器状态驱动） */
export function setChipState(chip, status) {
    if (!chip || chip.dataset.playing === status) return;
    chip.dataset.playing = status || '';
    chip.classList.remove('btts-playing', 'btts-paused', 'btts-loading', 'btts-error');
    const btn = chip.querySelector('.btts-seg-play');
    if (!btn) return;
    if (status === 'playing') {
        btn.innerHTML = PAUSE_ICON;
        chip.classList.add('btts-playing');
    } else if (status === 'paused') {
        btn.innerHTML = PLAY_ICON;
        chip.classList.add('btts-paused');
    } else if (status === 'loading') {
        btn.innerHTML = LOAD_ICON;
        chip.classList.add('btts-loading');
    } else if (status === 'error') {
        btn.innerHTML = PLAY_ICON;
        chip.classList.add('btts-error');
    } else {
        btn.innerHTML = PLAY_ICON;
    }
}

// ---------------------------------------------------------------------
// 单条消息元素处理：把文本节点中的调用替换成卡片
// ---------------------------------------------------------------------

function collectTextNodes(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
        if (n.nodeValue && PREFIX_RE.test(n.nodeValue)) out.push(n);
    }
    return out;
}

/** 由原始文本片段推导卡片主文案（JSON 无效时按简写处理） */
function chipFromRaw(raw, payloadText) {
    let obj = null;
    try { obj = JSON.parse(payloadText); } catch { obj = null; }
    if (!obj || typeof obj !== 'object') {
        const text = payloadText.replace(/^[\s"']+|[\s"']+$/g, '');
        if (!text) return null;
        obj = { text, character: '', voice: '', rate: 0, emotion: '', language: '' };
    }
    const text = String(obj.text ?? '').trim();
    if (!text) return null;
    return {
        obj,
        text,
        character: String(obj.character || obj.name || '').trim(),
        emotion: String(obj.emotion || '').trim(),
    };
}

/**
 * 在一条消息的 .mes_text 元素内做“正则替换”：
 * 将 [[BetterTTS: {...}]] 替换成渲染好的卡片。
 * 卡片 key 与“自动朗读”使用的 key 一致（seg:<消息id>:<第N个调用>），
 * 使自动播放时卡片能同步高亮。
 * @returns {number} 本次插入的卡片数量
 */
export function renderElement(el) {
    if (!el || el.nodeType !== 1) return 0;
    const mesId = mesIdOf(el);
    const nodes = collectTextNodes(el);
    if (!nodes.length) return 0;

    let inserted = 0;
    let segPos = 0; // 跨文本节点累计的调用序号（与 parser.findCalls 的 pos 对齐）

    for (const node of nodes) {
        const full = node.nodeValue;
        const calls = findCalls(full); // 该文本节点内完整闭合的调用（含位置与解析结果）
        if (!calls.length) continue;
        const frag = document.createDocumentFragment();
        let last = 0;
        let replacedInNode = false;

        for (const c of calls) {
            if (c.start > last) {
                frag.appendChild(document.createTextNode(full.slice(last, c.start)));
            }
            const chipInfo = chipFromRaw(c.raw, c.payload);
            if (!chipInfo) {
                // 无效调用保留原文（排查用），不占用序号
                frag.appendChild(document.createTextNode(c.raw));
                last = c.end;
                continue;
            }
            const key = `seg:${mesId}:${segPos++}`;
            frag.appendChild(buildChip({
                key,
                character: chipInfo.character,
                emotion: chipInfo.emotion,
                text: chipInfo.text,
                raw: c.raw,
                time: nowClock(),
            }));
            last = c.end;
            replacedInNode = true;
            inserted++;
        }
        if (replacedInNode) {
            if (last < full.length) frag.appendChild(document.createTextNode(full.slice(last)));
            node.parentNode?.replaceChild(frag, node);
        }
    }
    return inserted;
}

// ---------------------------------------------------------------------
// MutationObserver 封装（不依赖 .mes_text/#chat 等具体类名/id）
// ---------------------------------------------------------------------

/** 把一个节点解析为“消息根”（.mes 或离它最近的 .mes） */
function mesRootOf(node) {
    if (!node || node.nodeType !== 1) return null;
    if (typeof node.classList === 'object' && node.classList.contains('mes')) return node;
    return node.closest ? (node.closest('.mes') || null) : null;
}

/** 把可能包含消息的节点加入待处理集合（含其内部的全部 .mes） */
function pushMesRoots(node, pending) {
    const root = mesRootOf(node);
    if (root) { pending.add(root); return; }
    // 整个容器被重建/首屏加载时：addedNodes 可能是大的包装节点
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
            // childList / subtree
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
 * 把当前页面可见聊天里的语音卡片还原成原始函数调用文本
 * （禁用扩展 / 需要看到原始内容时调用）
 */
export function revertVisibleChips() {
    document.querySelectorAll('.mes .btts-seg').forEach(chip => {
        const raw = chip.dataset.raw;
        if (raw === undefined) return;
        const textNode = document.createTextNode(raw);
        chip.replaceWith(textNode);
    });
}

/** 全量扫描当前可见的所有消息（幂等），把函数调用替换成气泡卡片 */
export function scanVisible() {
    let count = 0;
    for (const mes of document.querySelectorAll('.mes')) {
        try { count += renderElement(mes); } catch { /* ignore */ }
    }
    return count;
}
