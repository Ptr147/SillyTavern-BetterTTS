// ============================================================================
// BetterTTS - SillyTavern 语音朗读扩展（入口）
// ============================================================================
// 功能：
//  1. 配置（ST 自带扩展配置面板 + 独立弹窗，支持全部配置导出/导入/重置）
//  2. 开关 / 流式播放 / 按段朗读 / 朗读旁白 / 语速 / 音量
//  3. 提示词：编辑、导入、导出、自动注入
//  4. 内容渲染：模型按提示词输出 [[BetterTTS: {...}]] 函数调用，
//     前端“正则替换”为语音卡片（说话内容 + 右上角时间 + 点击播放/暂停 + 右键复制调用原文）
//  5. 底部选项栏按钮 “BetterTTS-角色”：弹窗为不同角色指定说话人/语言
//  6. TTS 适配器架构：Edge TTS / OpenAI 兼容 / 自定义 HTTP，支持获取音色列表
//
// 兼容：SillyTavern >= 1.12（对旧扩展 API 做了降级适配）。
// 授权：双许可 —— 开源社区 GPL-3.0（SPDX: GPL-3.0-only）；商业使用需单独购买商业许可（见 LICENSE）。
// ============================================================================

import * as settings from './modules/settings.js';
import * as parser from './modules/parser.js';
import * as renderer from './modules/renderer.js';
import * as charpopup from './modules/charpopup.js';
import * as settingsUI from './modules/settings-ui.js';
import * as promptApi from './modules/prompt.js';
import { player, PlayerStatus } from './modules/player.js';
import { synthesize } from './modules/providers.js';
import { debounce, clamp, copyText, nowClock, logDebug } from './modules/util.js';
import { NARRATOR_KEY, NARRATOR_ALIASES, EXT_VERSION } from './modules/defaults.js';

const EXT_DISPLAY = 'BetterTTS';
const EXT_NAME = 'BetterTTS';           // 注入提示词使用的注册名
const STYLE_ID = 'bettertts-style';
const USER_CSS_ID = 'bettertts-user-css';

// 模块一旦被 SillyTavern 加载即打标记（无论后续是否报错，都能据此判断“扩展是否被加载”）
try { globalThis.__BETTER_TTS_LOADED__ = true; } catch { /* ignore */ }

/** 诊断日志：控制台统一前缀，便于定位问题 */
function dlog(...args) {
    try { console.info('%c[BetterTTS]', 'color:#7b5cff;font-weight:bold', ...args); } catch { /* ignore */ }
}
function derr(...args) {
    try { console.error('%c[BetterTTS]', 'color:#ff5c5c;font-weight:bold', ...args); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// ST 模块动态加载（避免静态依赖缺失导致整个扩展无法启动）
// 注意：不同 SillyTavern 版本把第三方扩展放在不同深度：
//   旧版：public/scripts/extensions/<名称>/index.js      → ../../extensions.js
//   新版：public/scripts/extensions/third-party/<名称>/   → ../../../extensions.js
// 因此这里按候选路径逐一探测，兼容两种布局。
// ---------------------------------------------------------------------------
let extension_settings = null;   // ST: extension_settings
let extGetContext = null;        // ST: getContext()
let eventSource = null;          // ST 旧事件源（可能为 null）

const ST_REL_PATHS = {
    extensions: ['../../../extensions.js', '../../extensions.js'],
    script: ['../../../script.js', '../../script.js'],
    slash: ['../../../slash-commands.js', '../../slash-commands.js'],
};

async function importFirst(group) {
    let lastErr = null;
    for (const path of ST_REL_PATHS[group] || []) {
        try {
            const mod = await import(/* webpackIgnore: true */ path);
            dlog(`import ${path} OK`);
            return { ok: true, mod };
        } catch (e) {
            lastErr = e;
            dlog(`import ${path} 失败：`, e?.message || e);
        }
    }
    return { ok: false, error: lastErr };
}

async function loadStModules() {
    const ext = await importFirst('extensions');
    if (ext.ok) {
        extension_settings = ext.mod.extension_settings;
        extGetContext = ext.mod.getContext || null;
        dlog('extension_settings 可用 =', !!extension_settings, ' getContext 可用 =', !!extGetContext);
    } else {
        derr('无法导入 extensions.js（候选路径均失败），请确认本目录位于 public/scripts/extensions/<名称>/ 或 extensions/third-party/<名称>/', ext.error);
    }
    const scr = await importFirst('script');
    if (scr.ok) eventSource = scr.mod.eventSource || null;
}

function ctx() {
    // 不缓存：每次现取，保证 chat/characters 等引用始终是最新的
    try {
        if (globalThis.SillyTavern && typeof globalThis.SillyTavern.getContext === 'function') {
            return globalThis.SillyTavern.getContext();
        }
        if (extGetContext) return extGetContext();
    } catch (e) { derr('getContext 失败', e); }
    return null;
}

function chatMessages() {
    const c = ctx();
    return (c && Array.isArray(c.chat)) ? c.chat : [];
}

function notify(msg, type = 'warning') {
    try {
        if (globalThis.toastr && typeof globalThis.toastr[type] === 'function') {
            globalThis.toastr[type](msg, EXT_DISPLAY);
            return;
        }
    } catch { /* ignore */ }
    if (type === 'error') console.error('[BetterTTS]', msg);
    else console.log('[BetterTTS]', msg);
}

// ---------------------------------------------------------------------------
// 事件订阅（新版 bus → 旧版 eventSource 降级）
// ---------------------------------------------------------------------------
function subscribe(name, handler) {
    try {
        if (globalThis.SillyTavern && typeof globalThis.SillyTavern.on === 'function') {
            const off = globalThis.SillyTavern.on(name, handler);
            return typeof off === 'function' ? off : () => { };
        }
    } catch { /* ignore */ }
    try {
        if (eventSource && typeof eventSource.on === 'function') {
            eventSource.on(name, handler);
        }
    } catch { /* ignore */ }
    return () => { };
}

// ---------------------------------------------------------------------------
// 样式 / 用户 CSS
// ---------------------------------------------------------------------------
function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = new URL('style.css', import.meta.url).href;
    link.onerror = () => console.warn('[BetterTTS] style.css 未能加载');
    document.head.appendChild(link);
}

function applyUserCss(cssText) {
    let style = document.getElementById(USER_CSS_ID);
    if (!style) {
        style = document.createElement('style');
        style.id = USER_CSS_ID;
        document.head.appendChild(style);
    }
    style.textContent = cssText || '';
}

// ---------------------------------------------------------------------------
// 朗读任务构造（语音调用 / 旁白文本）
// ---------------------------------------------------------------------------

/** 当前角色卡的头像解析（供“按角色卡独立”存储使用） */
function avatarForName(name) {
    try {
        const c = ctx();
        const arr = (c && Array.isArray(c.characters)) ? c.characters : [];
        const target = String(name || '').trim();
        for (const ch of arr) {
            if (ch && String(ch.name || '') === target) {
                const av = ch.avatar || ch.image || ch.avatarUrl || '';
                if (av) return String(av);
            }
        }
    } catch { /* ignore */ }
    return null;
}

/** 查找角色已注册的声音描述（按当前角色卡；含旁白别称） */
function voiceDescriptionOf(name) {
    if (!name) return '';
    const candidates = [name, ...(NARRATOR_ALIASES.includes(name) ? [] : NARRATOR_ALIASES)];
    for (const cand of candidates) {
        const m = settings.getCharacterMapping(cand);
        if (m && String(m.voiceDescription || '').trim()) return String(m.voiceDescription).trim();
    }
    return '';
}

/** 拼接“角色声音描述 + 情绪”为给 TTS 的系统指令 */
function buildInstruction(name, emotion) {
    const parts = [];
    const desc = voiceDescriptionOf(name);
    if (desc) parts.push('角色声音：' + desc);
    const emo = String(emotion || '').trim();
    if (emo) parts.push('情绪/语气：' + emo);
    return parts.join('；');
}

/** 接收前端渲染剥离出的 BTTS-AddRole 注册 */
function onRoleSeen(obj) {
    try {
        const name = String(obj?.character || obj?.name || obj?.role || '').trim();
        const desc = String(obj?.voice || obj?.description || obj?.sound || obj?.desc || '').trim();
        if (!name) return;
        if (desc) {
            const existing = settings.getCharacterMapping(name);
            settings.setCharacterMapping(name, { ...(existing || {}), voiceDescription: desc });
            dlog('BTTS-AddRole 注册/更新 音色描述:', name);
        }
    } catch (e) { logDebug('AddRole 处理失败', e); }
}

/** 从原始消息文本里吸收角色注册（DOM 渲染之外的兜底） */
function ingestRolesFromText(mesText) {
    try {
        for (const c of parser.findRoleCalls(String(mesText || ''))) {
            if (c.obj) onRoleSeen(c.obj);
        }
    } catch { /* ignore */ }
}

/** 从当前聊天历史中吸收所有角色注册（换聊/载入时） */
function ingestRolesFromChat() {
    try {
        for (const m of chatMessages()) {
            if (m && typeof m.mes === 'string') ingestRolesFromText(m.mes);
        }
    } catch { /* ignore */ }
}

/** 依据调用对象构建朗读 entry（播放时实时读取设置） */
function entryForCall(callObj, key, speakerName = '') {
    const character = String(callObj.character || speakerName || '').trim();
    const res = settings.resolveParams({
        character,
        voice: callObj.voice,
        language: callObj.language,
        rate: callObj.rate,
        emotion: callObj.emotion,
    });
    const instruction = buildInstruction(character, callObj.emotion);
    const volumeFactor = (Number.isFinite(Number(callObj.volume)) && Number(callObj.volume) > 0)
        ? clamp(Number(callObj.volume), 0, 2) : 1;
    const text = callObj.text || '';
    return {
        key,
        text,
        volumeFactor,
        synth: async () => {
            const s = settings.get();
            const r = await synthesize({
                text,
                voice: res.voice,
                language: res.language,
                rate: res.rate,
                emotion: res.emotion,
                instruction,
                character,
            }, s);
            if (!r.ok) throw new Error(r.message);
            logDebug('合成成功(角色)', text.slice(0, 16),
                r.blobs.map(b => ({ mime: b.mime, size: b.blob?.size })));
            return r.blobs;
        },
    };
}

/** 依据普通文本构建朗读 entry（旁白/段落/全文等）
 *  @param {string|null} [instruction] 指定系统指令（段落：拼入本段角色声音+情绪）；缺省=按旁白描述
 */
function entryForText(text, key, character = NARRATOR_KEY, instruction) {
    const res = settings.resolveParams({ character, voice: '', language: '', rate: null, emotion: '' });
    const finalInstruction = instruction !== undefined ? (instruction || '') : buildInstruction(character, '');
    return {
        key,
        text,
        volumeFactor: 1,
        synth: async () => {
            const s = settings.get();
            const r = await synthesize({
                text,
                voice: res.voice,
                language: res.language,
                rate: res.rate,
                emotion: res.emotion,
                instruction: finalInstruction,
                character,
            }, s);
            if (!r.ok) throw new Error(r.message);
            logDebug('合成成功(文本)', text.slice(0, 16),
                r.blobs.map(b => ({ mime: b.mime, size: b.blob?.size })));
            return r.blobs;
        },
    };
}

/** 把段落 roles（角色+情绪）拼成系统指令（含各角色已注册声音描述） */
function instructionForRoles(roles) {
    const parts = [];
    const list = Array.isArray(roles) ? roles : [];
    for (const r of list) {
        if (!r || typeof r !== 'object') continue;
        const n = String(r.character || '').trim();
        if (!n) continue;
        const d = voiceDescriptionOf(n);
        if (d) parts.push('角色「' + n + '」声音：' + d);
        const em = String(r.emotion || r.mood || '').trim();
        if (em) parts.push('「' + n + '」情绪/语气：' + em);
    }
    return parts.join('；');
}

/** 把一个消息里的“全文段落调用”（BTTS-TEXT）转成朗读任务（每段一个） */
function textCallEntries(mes) {
    const calls = parser.findTextCalls(mes.mes || '');
    const out = [];
    const mesId = mes.id !== undefined ? mes.id : chatMessages().indexOf(mes);
    for (const c of calls) {
        if (!c.obj) continue;
        const text = String(c.obj.text ?? '').trim();
        if (!text) continue;
        const instr = instructionForRoles(c.obj.roles) || undefined;
        const entry = entryForText(text, `txt:${mesId}:${c.pos}`, NARRATOR_KEY, instr);
        entry.payloadText = renderer.textPayload(c.obj);
        out.push(entry);
    }
    return out;
}

/** 将文本按旁白规则切成若干 entry（读旁白/按段时用） */
function narrationEntries(mes, baseKey) {
    const s = settings.get();
    const text = renderer.scrubMarkdown(mes.mes || '');
    if (!text) return [];
    const blocks = parser.parseBlocks(text);
    const plainParts = blocks.filter(b => b.kind === 'text').map(b => b.text).filter(t => t.trim());
    const entries = [];
    let i = 0;
    for (const part of plainParts) {
        if (s.perSegment) {
            for (const sent of parser.splitSentences(part)) {
                if (sent.trim()) entries.push(entryForText(sent.trim(), `${baseKey}|narr|${i++}`));
            }
        } else if (part.trim()) {
            entries.push(entryForText(part.trim(), `${baseKey}|narr|${i++}`));
        }
    }
    return entries;
}

/**
 * 把一个消息里的语音调用转成朗读任务。
 * 按段朗读=true：每个调用独立任务；false：同音色连续调用合并为一段。
 */
function callEntries(mes) {
    const s = settings.get();
    const calls = parser.findCalls(mes.mes || '');
    const out = [];
    const mesId = mes.id !== undefined ? mes.id : chatMessages().indexOf(mes);
    const speaker = mes.name || '';

    if (s.perSegment) {
        for (const c of calls) {
            if (!c.obj) continue;
            const obj = parser.normalizeCall(c.obj, {});
            if (!obj.text) continue;
            const entry = entryForCall(obj, `seg:${mesId}:${c.pos}`, speaker);
            entry.payloadText = renderer.payloadText(c.obj);
            out.push(entry);
        }
        return out;
    }

    // 合并模式：连续且 音色/语言/角色/语速/情感 相同的调用合成一段
    const groups = [];
    let cur = null;
    for (const c of calls) {
        if (!c.obj) continue;
        const obj = parser.normalizeCall(c.obj, {});
        if (!obj.text) continue;
        const character = obj.character || speaker;
        const sig = [character, obj.voice, obj.language, obj.rate, obj.emotion].join('|');
        if (cur && cur.sig === sig) {
            cur.texts.push(obj.text);
        } else {
            cur = { sig, startPos: c.pos, obj, character, texts: [obj.text] };
            groups.push(cur);
        }
    }
    for (const g of groups) {
        const merged = { ...g.obj, text: g.texts.join('。') };
        const entry = entryForCall(merged, `seg:${mesId}:${g.startPos}`, g.character);
        entry.payloadText = renderer.payloadText(merged);
        out.push(entry);
    }
    return out;
}

// ---------------------------------------------------------------------------
// 自动朗读（生成期间 / 生成结束后）
// ---------------------------------------------------------------------------
let generating = false;
let handledCalls = new Set();   // 已自动排队的语音调用 key
let handledNarr = new Set();
let handledText = new Set();    // 已自动排队的全文段落 key
let pollTimer = null;
let autoOff = false;            // 用户手动停止开关（在一次生成内）

function lastNonUserMes() {
    const chat = chatMessages();
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (m && !m.is_user) return m;
    }
    return null;
}

function isSpokenMessage(mes) {
    return !!(mes && !mes.is_user && !mes.is_system && mes.role !== 'system'
        && typeof mes.mes === 'string' && mes.mes.trim());
}

function mesBaseKey(mes) {
    return mes.id !== undefined ? String(mes.id) : String(chatMessages().indexOf(mes));
}

async function autoHandleMessage(mes, { allowCalls, allowNarr, streamingNow }) {
    if (!mes || !settings.isEnabled() || autoOff) return;
    const s = settings.get();
    const base = mesBaseKey(mes);

    // 角色注册始终吸收（说话/全文模式都需要声音描述）
    ingestRolesFromText(mes.mes);

    // 全文模式：按“段落调用 BTTS-TEXT”逐段朗读（流式时每完成一段即播一段）
    if (s.prompt?.mode === 'full') {
        if (!(allowCalls || allowNarr)) return;
        const entries = textCallEntries(mes);
        for (const e of entries) {
            if (e.payloadText) {
                const chipKey = renderer.findChipKeyByPayload(e.payloadText);
                if (chipKey) e.aliasKeys = [chipKey];
                delete e.payloadText;
            }
            const hkey = 'txt:' + base + '|' + e.key;
            if (handledText.has(hkey)) continue;
            handledText.add(hkey);
            player.enqueue(e);
        }
        return;
    }

    if (allowCalls) {
        const entries = callEntries(mes);
        for (const e of entries) {
            // 若能找到对应已渲染气泡（按内容匹配），把它作为别名 key → 播放时只高亮该气泡
            if (e.payloadText) {
                const chipKey = renderer.findChipKeyByPayload(e.payloadText);
                if (chipKey) e.aliasKeys = [chipKey];
                delete e.payloadText;
            }
            const hkey = base + '|' + e.key;
            if (handledCalls.has(hkey)) continue;
            handledCalls.add(hkey);
            player.enqueue(e); // 依序排队
        }
    }
    if (allowNarr && s.readNarration) {
        const nar = narrationEntries(mes, base);
        for (const e of nar) {
            const hkey = base + '|' + e.key;
            if (handledNarr.has(hkey)) continue;
            handledNarr.add(hkey);
            player.enqueue(e);
        }
    }
}

/** 全文模式朗读队列（段落级 BTTS-TEXT：见 textCallEntries 逻辑，此函数不再使用） */

function schedulePoll() {
    if (pollTimer) return;
    pollTimer = setTimeout(async () => {
        pollTimer = null;
        if (!generating || autoOff || !settings.isEnabled()) return;
        const mes = lastNonUserMes();
        if (mes && isSpokenMessage(mes)) {
            const s = settings.get();
            if (s.streaming) {
                // 流式：说话模式读已完成语音调用；全文模式读已完成段落
                await autoHandleMessage(mes, { allowCalls: true, allowNarr: false, streamingNow: true });
            }
        }
        if (generating) schedulePoll();
    }, 550);
}

function onGenerationStart() {
    generating = true;
    autoOff = false;
    handledCalls.clear();
    handledNarr.clear();
    handledText.clear();
    rearmInjectionBeforeGeneration();
    if (settings.get().streaming) schedulePoll();
}

async function onGenerationEnd() {
    if (!generating) return;
    generating = false;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (autoOff || !settings.isEnabled()) return;
    const mes = lastNonUserMes();
    if (mes && isSpokenMessage(mes)) {
        await autoHandleMessage(mes, { allowCalls: true, allowNarr: true, streamingNow: false });
    }
    charpopup.refreshOpenPopup(); // 有新台词 → 角色弹窗即时补行
}

function stopAuto() {
    autoOff = true;
    generating = false;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    player.stopAll();
}

// ---------------------------------------------------------------------------
// 渲染 & 播放器状态同步
// ---------------------------------------------------------------------------
const observer = renderer.createChatObserver((elements) => {
    if (!settings.isEnabled()) return;
    for (const el of elements) {
        try {
            const n = renderer.renderElement(el);
            if (n > 0) logDebug('渲染语音卡片 x' + n, el.className);
        } catch (e) { logDebug('renderElement err', e); }
    }
});

function refreshChipStates(key, status) {
    if (!key) return;
    document.querySelectorAll(`.btts-seg[data-key="${CSS.escape(key)}"]`).forEach(chip => renderer.setChipState(chip, status));
}

function scanAllVisible() {
    if (!settings.isEnabled()) return;
    renderer.scanVisible();
}
const scanDebounced = debounce(scanAllVisible, 500);

function onPlayerState(key, status, extra) {
    refreshChipStates(key, status);
    if (status === PlayerStatus.ERROR) {
        notify(extra.message || '播放出错', 'error');
    }
}

// ---------------------------------------------------------------------------
// 事件绑定（点击 / 右键菜单）
// ---------------------------------------------------------------------------
function chipByEventTarget(target) {
    return target && target.nodeType === 1 ? target.closest('.btts-seg') : null;
}

document.addEventListener('click', (e) => {
    const chip = chipByEventTarget(e.target);
    if (!chip) return;
    if (e.target.closest('.btts-menu')) return; // 菜单内部交给菜单
    const key = chip.dataset.key;
    player.toggle(key, () => entryFromChip(chip)).catch(err => notify(String(err?.message || err), 'error'));
});

document.addEventListener('contextmenu', (e) => {
    const chip = chipByEventTarget(e.target);
    if (!chip) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    showChipMenu(chip, e.clientX, e.clientY);
}, true); // capture：抢在 ST 消息右键菜单前

function entryFromChip(chip) {
    const payload = chip.dataset.payload || chip.dataset.raw || '';
    let obj = null;
    if (payload.trim().startsWith('[[')) {
        const src = payload;
        obj = parser.findCalls(src)[0]?.obj || parser.findTextCalls(src)[0]?.obj || parser.findRoleCalls(src)[0]?.obj || null;
    } else {
        try {
            const parsed = JSON.parse(payload);
            if (parsed && typeof parsed === 'object') obj = parsed;
        } catch { /* ignore */ }
    }
    if (obj) {
        if (chip.dataset.kind === 'text' || obj.roles) {
            const text = String(obj.text ?? '').trim();
            const instr = instructionForRoles(obj.roles) || undefined;
            return entryForText(text, chip.dataset.key, NARRATOR_KEY, instr);
        }
        const norm = parser.normalizeCall(obj, {});
        return entryForCall(norm, chip.dataset.key, chip.dataset.char);
    }
    // 兜底：直接读气泡文本
    const text = (chip.querySelector('.btts-seg-text')?.textContent || '').trim();
    return entryForText(text, chip.dataset.key, chip.dataset.char || NARRATOR_KEY);
}

let menuEl = null;
function showChipMenu(chip, x, y) {
    hideChipMenu();
    const payload = chip.dataset.payload || chip.dataset.raw || '';
    const isText = chip.dataset.kind === 'text';
    const rawCall = payload.trim().startsWith('[[') ? payload : (isText ? '[[BTTS-TEXT: ' : '[[BTTS: ') + payload + ']]';
    const text = chip.querySelector('.btts-seg-text')?.textContent || '';
    menuEl = document.createElement('div');
    menuEl.className = 'btts-menu';
    const items = [
        { label: '▶ 播放 / ⏸ 暂停', act: () => player.toggle(chip.dataset.key, () => entryFromChip(chip)) },
        { label: '🔁 立即朗读（打断当前）', act: () => player.enqueue(entryFromChip(chip), { startNow: true }) },
        { label: '📋 复制完整函数调用', act: () => copyText(rawCall).then(ok => notify(ok ? '已复制完整函数调用' : '复制失败', ok ? 'success' : 'error')) },
        { label: '📄 复制语音文本', act: () => copyText(text).then(ok => notify(ok ? '已复制语音文本' : '复制失败', ok ? 'success' : 'error')) },
        { label: '⏹ 停止朗读', act: () => player.stopAll() },
    ];
    const list = document.createElement('ul');
    for (const it of items) {
        const li = document.createElement('li');
        li.textContent = it.label;
        li.addEventListener('click', () => { hideChipMenu(); it.act(); });
        list.appendChild(li);
    }
    menuEl.appendChild(list);
    menuEl.style.position = 'fixed';
    menuEl.style.left = '0px';
    menuEl.style.top = '0px';
    menuEl.style.transform = `translate(${Math.min(x, window.innerWidth - 240)}px, ${Math.min(y, window.innerHeight - 190)}px)`;
    document.body.appendChild(menuEl);
    setTimeout(() => {
        document.addEventListener('click', hideChipMenu, { once: true });
        document.addEventListener('keydown', (e2) => { if (e2.key === 'Escape') hideChipMenu(); }, { once: true });
    }, 0);
}
function hideChipMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
}

// ---------------------------------------------------------------------------
// 底部选项栏按钮
// ---------------------------------------------------------------------------
/** 打开 BetterTTS-角色 弹窗（供选项菜单 / 底部按钮共用） */
function openRolesPopup() {
    charpopup.openCharacterPopup({
        getContext: ctx,
        onSample: (p) => {
            const call = { text: p.text || '试听', character: p.name, voice: p.voice || '', language: p.language || '', rate: null, emotion: '', volume: null };
            const e = entryForCall(call, 'sample:' + nowClock(), p.name);
            player.enqueue(e, { startNow: true });
        },
        onMappingChanged: () => { /* settings 已持久化 */ },
    });
}

function buildBottomBar() {
    const group = document.createElement('div');
    group.className = 'btts-bar';

    const btnChar = document.createElement('button');
    btnChar.type = 'button';
    btnChar.className = 'menu_button btts-bar-btn';
    btnChar.innerHTML = '🔊 <span>BetterTTS-角色</span>';
    btnChar.title = '为不同角色指定说话人（音色）与语言';
    btnChar.addEventListener('click', openRolesPopup);

    const btnSet = document.createElement('button');
    btnSet.type = 'button';
    btnSet.className = 'menu_button btts-bar-btn btts-bar-btn-icon';
    btnSet.innerHTML = '⚙';
    btnSet.title = 'BetterTTS 设置';
    btnSet.addEventListener('click', openSettingsModal);

    group.appendChild(btnChar);
    group.appendChild(btnSet);
    group.dataset.mounted = '';
    return group;
}

let bttsBarEl = null;            // 旧式底部独立按钮组（仅在无法接入选项菜单时兜底）
let barMounted = false;
let optionMenuMounted = false;   // 是否已把入口加入 发送栏“…”弹出菜单

/** 生成与 ST 原生选项项一致的 <a> 入口（参考 #option_close_chat） */
function makeOptionLink(id, iconClass, text, title, onClick) {
    const a = document.createElement('a');
    a.id = id;
    a.className = 'interactable';
    a.tabIndex = 0;
    a.setAttribute('role', 'button');
    a.title = title || text;
    a.style.cssText = 'cursor:pointer;display:flex;align-items:center;gap:6px;';
    const i = document.createElement('i');
    i.className = iconClass;
    i.style.width = '18px';
    i.style.textAlign = 'center';
    const span = document.createElement('span');
    span.textContent = text;
    a.appendChild(i);
    a.appendChild(span);
    const fire = (ev) => {
        if (ev) { ev.preventDefault(); ev.stopPropagation(); }
        onClick();
    };
    a.addEventListener('click', fire);
    a.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); onClick(); }
    });
    return a;
}

/**
 * 把“BetterTTS-角色 / 设置”入口并入 发送栏“…”弹出菜单，
 * 插入到 #option_close_chat 同列表内（同样式、同容器）。
 * @returns {boolean} 是否成功（容器尚未渲染时返回 false 以便重试）
 */
function mountOptionMenuEntries() {
    // 已插入且仍在 DOM 中 → 完成；若被 ST 重新渲染清掉则再次插入
    if (document.getElementById('btts-menu-characters')) { optionMenuMounted = true; return true; }
    const closeChat = document.querySelector('#option_close_chat');
    if (!closeChat || !closeChat.parentNode) return false;
    const parent = closeChat.parentNode;

    const setLink = makeOptionLink(
        'btts-menu-settings', 'fa-solid fa-cog', 'BetterTTS 设置',
        '打开 BetterTTS 设置（开关/服务商/提示词/角色映射）', openSettingsModal);
    const charLink = makeOptionLink(
        'btts-menu-characters', 'fa-solid fa-microphone-lines', 'BetterTTS-角色',
        '为不同角色指定说话人（音色）与语言', openRolesPopup);

    parent.insertBefore(setLink, closeChat);
    parent.insertBefore(charLink, setLink);
    optionMenuMounted = true;
    dlog('BetterTTS 入口已并入 发送栏“…”菜单（#option_close_chat 列表）');
    return true;
}

/**
 * 兜底方案：聊天底部输入栏独立按钮（仅当选项菜单容器不可用时启用，
 * 保证入口不丢失）。样式尽量内敛，避免挤压输入栏。
 */
function mountLegacyBar() {
    if (barMounted && bttsBarEl && bttsBarEl.isConnected) return true;
    if (!bttsBarEl) bttsBarEl = buildBottomBar();

    const g = bttsBarEl;
    const sendBtn = document.querySelector('#send_but_send');
    if (sendBtn) {
        sendBtn.parentNode?.insertBefore(g, sendBtn);
        dlog('兜底：底部按钮已挂载到 #send_but_send 前');
    } else {
        const sendForm = document.querySelector('#send_form');
        if (sendForm) {
            sendForm.appendChild(g);
            dlog('兜底：底部按钮已挂载到 #send_form 内');
        } else if (!g.isConnected) {
            document.body.appendChild(g);
            g.classList.add('btts-bar-fallback');
            dlog('兜底：底部按钮以悬浮形式显示');
        }
    }
    barMounted = true;
    return true;
}

// ---------------------------------------------------------------------------
// 设置：ST 扩展面板 + 独立弹窗
// ---------------------------------------------------------------------------
const settingsMounts = [];
let settingsPanelMounted = false;

function mountIntoSettingsPanel() {
    if (settingsPanelMounted) return true;
    const host = document.querySelector('#extensions_settings');
    if (!host) return false; // ST 尚未渲染该容器，稍后重试
    if (host.querySelector('.btts-settings')) { settingsPanelMounted = true; return true; }
    try {
        const wrap = document.createElement('div');
        wrap.innerHTML = settingsUI.buildSettingsHtml({ panel: true });
        const node = wrap.firstElementChild;
        const api = settingsUI.bindSettings(node, makeUiHooks());
        host.appendChild(node);
        if (api) settingsMounts.push(api);
        settingsPanelMounted = true;
        dlog('设置面板已挂载到 #extensions_settings');
        return true;
    } catch (e) {
        derr('设置面板挂载失败', e);
        return false;
    }
}

/** 统一尝试挂载（设置面板 + 选项菜单入口），供定时重试用 */
function ensureMounts() {
    const panel = mountIntoSettingsPanel();
    const menu = mountOptionMenuEntries();
    return panel && menu;
}

let modalEl = null;
function openSettingsModal() {
    if (modalEl && modalEl.isConnected) { modalEl.style.display = ''; return; }
    modalEl = document.createElement('div');
    modalEl.className = 'btts-modal-root';
    const box = document.createElement('div');
    box.className = 'btts-modal';
    box.innerHTML = `
      <div class="btts-modal-head">
        <span>🔊 BetterTTS 设置</span>
        <button type="button" class="btts-modal-close" aria-label="关闭">✕</button>
      </div>
      <div class="btts-modal-body"></div>`;
    modalEl.appendChild(box);
    document.body.appendChild(modalEl);

    const body = box.querySelector('.btts-modal-body');
    body.innerHTML = settingsUI.buildSettingsHtml();
    const settingsNode = body.querySelector('.btts-settings');
    const api = settingsUI.bindSettings(settingsNode, makeUiHooks());
    if (api) settingsMounts.push(api);

    box.querySelector('.btts-modal-close').addEventListener('click', () => { modalEl.style.display = 'none'; });
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) modalEl.style.display = 'none'; });
    modalEl.style.display = '';
}

function makeUiHooks() {
    return {
        notice: (msg, cls) => notify(msg, cls === 'err' ? 'error' : 'success'),
        onChange: (path, value) => {
            if (path === 'customCss') applyUserCss(settings.get().customCss || '');
            if (path === 'provider') {
                charpopup.refreshVoices(settings.get()).catch(() => { });
            }
            if (path === 'enabled') {
                globalThis.__BETTER_TTS_DEBUG__ = !!settings.get().debug;
                if (!value) {
                    renderer.revertVisibleChips();
                    player.stopAll();
                } else {
                    scanAllVisible();
                }
            }
            if (typeof path === 'string' && (path.startsWith('prompt.') || path === 'enabled')) {
                refreshPromptInjection();
            }
        },
        onCustomCss: (v) => applyUserCss(v || ''),
        onConfigImported: () => {
            for (const m of settingsMounts) { try { m.refresh(); } catch { /* ignore */ } }
            applyUserCss(settings.get().customCss || '');
            refreshPromptInjection();
            scanAllVisible();
        },
        onVoicesLoaded: () => { /* datalist 由角色弹窗负责刷新 */ },
        onVoicesTextChanged: () => charpopup.refreshVoices(settings.get()).catch(() => { }),
    };
}

function refreshAllSettingsUi() {
    for (const m of settingsMounts) { try { m.refresh(); } catch { /* ignore */ } }
}

// ---------------------------------------------------------------------------
// 提示词注入
// ---------------------------------------------------------------------------
let injectionState = { ok: false, method: null, attempted: false, warned: false };

function modeLabel() {
    return settings.get().prompt?.mode === 'full' ? '全文模式' : '说话模式';
}

function pushInjectStatus(msg, ok) {
    for (const m of settingsMounts) {
        try { if (typeof m.setInjectStatus === 'function') m.setInjectStatus(msg, ok); } catch { /* ignore */ }
    }
}

function injectStatusText(res) {
    if (!res || !res.ok) return null;
    let t = '已注入：' + (res.label || modeLabel());
    if (res.roleOk === true) t += ' + 角色规则';
    else if (res.roleOk === false) t += '（角色规则未注入）';
    return t;
}

const ROLE_PROMPT_NAME = EXT_NAME + '-角色注册'; // 独立的 BTTS-AddRole 系统提示词条目

/** 单次注册（失败不打断，返回结果）
 *  注入两条：① 当前合成模式提示词（说话/全文）② 角色注册规则（默认都注入） */
async function tryInjectPrompt() {
    const s = settings.get();
    const primaryEnabled = promptApi.promptEnabled(s) && promptApi.promptShouldInject(s);
    const roleEnabled = primaryEnabled && promptApi.rolePromptInject(s);

    const primary = await promptApi.registerNamedInjection(s, {
        name: EXT_NAME,
        text: promptApi.promptTextOf(s),
        enabled: primaryEnabled,
        getContext: ctx,
    });
    const role = await promptApi.registerNamedInjection(s, {
        name: ROLE_PROMPT_NAME,
        text: promptApi.rolePromptTextOf(s),
        enabled: roleEnabled,
        getContext: ctx,
    });
    return {
        ok: primary.ok,
        method: primary.method || role.method,
        error: primary.error,
        entry: primary.entry,
        roleOk: role.ok,
        roleError: role.error,
        label: modeLabel(),
    };
}

async function refreshPromptInjection() {
    const res = await tryInjectPrompt();
    injectionState = { ok: res.ok, method: res.method, error: res.error, attempted: true, warned: injectionState.warned };
    if (res.ok) {
        dlog('提示词注入成功', res.entry, '角色规则:', res.roleOk === true ? '已注入' : (res.roleError || '未启用'));
        pushInjectStatus(injectStatusText(res), true);
        return true;
    }
    // 失败 → 自动重试（ST 上下文可能尚未就绪）
    dlog('提示词注入未就绪，准备重试…', res.error || '');
    pushInjectStatus('未注入，重试中…', false);
    let tries = 0;
    const timer = setInterval(async () => {
        tries++;
        const r2 = await tryInjectPrompt();
        if (r2.ok) {
            clearInterval(timer);
            injectionState.ok = true;
            injectionState.error = null;
            dlog('提示词注入成功（重试）', r2.entry, '角色规则:', r2.roleOk === true ? '已注入' : (r2.roleError || '未启用'));
            pushInjectStatus(injectStatusText(r2), true);
            return;
        }
        if (tries >= 6) {
            clearInterval(timer);
            injectionState.error = r2.error || '';
            pushInjectStatus('注入失败：' + (r2.error || '未知原因'), false);
            if (!injectionState.warned) {
                injectionState.warned = true;
                derr('提示词自动注入失败：', r2.error || '', promptApi.injectionNotice());
                notify('提示词自动注入失败：' + (r2.error || '未知原因') + '（详见控制台，可先手动把提示词复制进主提示词）', 'error');
            }
        }
    }, 1500);
    return false;
}

/** 每次生成前复注册（防止个别 ST 版本在生成时清空扩展提示词） */
function rearmInjectionBeforeGeneration() {
    tryInjectPrompt().then(r => {
        if (r.ok) logDebug('生成前提示词复注册成功');
    }).catch(() => { });
}

// ---------------------------------------------------------------------------
// 斜杠命令
// ---------------------------------------------------------------------------
async function registerSlashCommands() {
    const cmds = [
        {
            name: 'bettertts',
            helpString: '打开 BetterTTS-角色 弹窗（为角色指定说话人/语言）',
            callback: () => charpopup.openCharacterPopup({
                getContext: ctx,
                onSample: (p) => { const e = entryForCall({ text: p.text || '试听', character: p.name, voice: p.voice || '', language: p.language || '', rate: null, emotion: '', volume: null }, 'sample:' + nowClock(), p.name); player.enqueue(e, { startNow: true }); },
                onMappingChanged: () => { },
            }),
        },
        {
            name: 'bettertts-settings',
            helpString: '打开 BetterTTS 设置',
            callback: openSettingsModal,
        },
        {
            name: 'bettertts-stop',
            helpString: '停止 BetterTTS 朗读',
            callback: stopAuto,
        },
    ];
    try {
        if (globalThis.SillyTavern && typeof globalThis.SillyTavern.registerSlashCommand === 'function') {
            for (const c of cmds) {
                try { globalThis.SillyTavern.registerSlashCommand(c.name, c.callback, [], c.helpString, true); } catch { /* ignore */ }
            }
            return;
        }
    } catch { /* ignore */ }
    // 降级：老式 registerSlashCommand（按候选路径探测）
    const sl = await importFirst('slash');
    if (sl.ok && sl.mod && typeof sl.mod.registerSlashCommand === 'function') {
        for (const c of cmds) sl.mod.registerSlashCommand(c.name, c.callback, [], c.helpString, true);
        return;
    }
    console.warn('[BetterTTS] slash 命令注册失败（不影响核心功能）');
}

// ---------------------------------------------------------------------------
// 聊天切换等清理
// ---------------------------------------------------------------------------
function onChatContextChanged() {
    handledCalls.clear();
    handledNarr.clear();
    ingestRolesFromChat();
    charpopup.refreshOpenPopup();
}

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------
async function init() {
    await loadStModules();
    if (!extension_settings) {
        console.error('[BetterTTS] 未能获取 extension_settings，扩展可能未在 SillyTavern 中运行。');
        return;
    }

    settings.init(extension_settings);
    settings.setCharacterAvatarResolver(avatarForName); // 角色配置按“角色卡”独立
    const debouncedPersist = debounce(() => {
        try {
            const c = ctx();
            if (c && typeof c.saveSettingsDebounced === 'function') c.saveSettingsDebounced();
        } catch { /* ignore */ }
    }, 600);
    settings.setPersist(() => debouncedPersist());

    globalThis.__BETTER_TTS_DEBUG__ = !!settings.get().debug;

    ensureStyle();
    applyUserCss(settings.get().customCss || '');

    // 播放器
    player.setVolumeGetter(() => settings.get().volume);
    player.setErrorHandler((entry, msg) => notify(msg, 'error'));
    player.onState(onPlayerState);

    // 渲染
    renderer.setRoleListener(onRoleSeen);   // BTTS-AddRole → 角色声音描述
    if (!observer.start()) {
        // #chat 可能尚未出现，稍后重试
        const retry = setInterval(() => {
            if (observer.start()) { clearInterval(retry); scanAllVisible(); }
        }, 800);
        setTimeout(() => clearInterval(retry), 20000);
    }
    // 打开已有聊天时全量渲染一次（幂等）
    setTimeout(scanAllVisible, 600);
    setTimeout(ingestRolesFromChat, 1600); // 载入历史消息后吸收 BTTS-AddRole

    // 设置挂载（立即尝试一次；ST 部分 UI 渲染较晚，配合下方定时重试）
    ensureMounts();

    // 事件
    subscribe('generation_started', onGenerationStart);
    subscribe('generation_ended', onGenerationEnd);
    subscribe('chat_changed', onChatContextChanged);
    subscribe('character_selected', onChatContextChanged);
    subscribe('message_swiped', onChatContextChanged);
    subscribe('message_rendered', () => { scanDebounced(); charpopup.refreshOpenPopup(); });

    // 提示词注入 & 命令
    refreshPromptInjection();
    registerSlashCommands();

    dlog('初始化完成：',
        'enabled=' + settings.isEnabled(),
        'provider=' + settings.get().provider,
        '设置面板已挂载=' + settingsPanelMounted,
        '选项菜单入口=' + optionMenuMounted,
        '兜底按钮=' + barMounted);
}

// ST 的扩展由动态 import 加载；防止意外重复执行（如热更新/重复挂载）
function boot() {
    if (globalThis.__BETTER_TTS_BOOTED__) return;
    globalThis.__BETTER_TTS_BOOTED__ = true;
    const run = () => init().then(() => {
        // 兜底重试挂载：面板/选项菜单可能晚于扩展脚本出现（最长约 20s）
        let tries = 0;
        const timer = setInterval(() => {
            tries++;
            const done = ensureMounts();
            if (done || tries >= 20) {
                clearInterval(timer);
                // 一直找不到选项菜单容器时才退回旧式独立按钮，保证入口不丢
                if (!optionMenuMounted && !barMounted) {
                    try { mountLegacyBar(); } catch { /* ignore */ }
                }
                dlog('挂载重试结束：设置面板=' + settingsPanelMounted + ' 选项菜单入口=' + optionMenuMounted + ' 兜底按钮=' + barMounted);
            }
        }, 1000);
    }).catch(e => {
        derr('初始化失败（详见下方堆栈；请把这段信息反馈给作者）', e);
    });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }
}
boot();
dlog('模块已加载（BetterTTS v' + EXT_VERSION + '），入口位于：发送栏“…”弹出菜单（BetterTTS-角色 / BetterTTS 设置）+ 扩展面板“🔊 BetterTTS 设置”。若看不到，请检查：1) 目录是否为 public/scripts/extensions/third-party/<名字>/；2) 是否重启了 SillyTavern 服务端；3) 浏览器控制台是否有红色错误。');
