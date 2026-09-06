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
import { NARRATOR_KEY, EXT_VERSION } from './modules/defaults.js';

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
    const volumeFactor = Number.isFinite(Number(callObj.volume)) ? clamp(Number(callObj.volume), 0, 2) : 1;
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
                character,
            }, s);
            if (!r.ok) throw new Error(r.message);
            return r.blobs;
        },
    };
}

/** 依据普通文本构建朗读 entry（旁白等） */
function entryForText(text, key, character = NARRATOR_KEY) {
    const res = settings.resolveParams({ character, voice: '', language: '', rate: null, emotion: '' });
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
                character,
            }, s);
            if (!r.ok) throw new Error(r.message);
            return r.blobs;
        },
    };
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
            out.push(entryForCall(obj, `seg:${mesId}:${c.pos}`, speaker));
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
        out.push(entryForCall(merged, `seg:${mesId}:${g.startPos}`, g.character));
    }
    return out;
}

// ---------------------------------------------------------------------------
// 自动朗读（生成期间 / 生成结束后）
// ---------------------------------------------------------------------------
let generating = false;
let handledCalls = new Set();   // 已自动排队的语音调用 key
let handledNarr = new Set();
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

    if (allowCalls) {
        const entries = callEntries(mes);
        for (const e of entries) {
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

function schedulePoll() {
    if (pollTimer) return;
    pollTimer = setTimeout(async () => {
        pollTimer = null;
        if (!generating || autoOff || !settings.isEnabled()) return;
        const mes = lastNonUserMes();
        if (mes && isSpokenMessage(mes)) {
            const s = settings.get();
            if (s.streaming) {
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
const observer = renderer.createChatObserver('#chat', (elements) => {
    if (!settings.isEnabled()) return;
    for (const el of elements) {
        try { renderer.renderElement(el); } catch (e) { logDebug('renderElement err', e); }
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
    const raw = chip.dataset.raw || '';
    const calls = parser.findCalls(raw);
    if (calls.length && calls[0].obj) {
        const obj = parser.normalizeCall(calls[0].obj, {});
        return entryForCall(obj, chip.dataset.key, chip.dataset.char);
    }
    // 兜底：直接读卡片文本
    const text = (chip.querySelector('.btts-seg-text')?.textContent || '').trim();
    return entryForText(text, chip.dataset.key, chip.dataset.char || NARRATOR_KEY);
}

let menuEl = null;
function showChipMenu(chip, x, y) {
    hideChipMenu();
    const raw = chip.dataset.raw || '';
    const text = chip.querySelector('.btts-seg-text')?.textContent || '';
    menuEl = document.createElement('div');
    menuEl.className = 'btts-menu';
    const items = [
        { label: '▶ 播放 / ⏸ 暂停', act: () => player.toggle(chip.dataset.key, () => entryFromChip(chip)) },
        { label: '🔁 立即朗读（打断当前）', act: () => player.enqueue(entryFromChip(chip), { startNow: true }) },
        { label: '📋 复制完整函数调用', act: () => copyText(raw).then(ok => notify(ok ? '已复制完整函数调用' : '复制失败', ok ? 'success' : 'error')) },
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
function buildBottomBar() {
    const group = document.createElement('div');
    group.className = 'btts-bar';

    const btnChar = document.createElement('button');
    btnChar.type = 'button';
    btnChar.className = 'menu_button btts-bar-btn';
    btnChar.innerHTML = '🔊 <span>BetterTTS-角色</span>';
    btnChar.title = '为不同角色指定说话人（音色）与语言';
    btnChar.addEventListener('click', () => {
        charpopup.openCharacterPopup({
            getContext: ctx,
            onSample: (p) => {
                const call = { text: p.text || '试听', character: p.name, voice: p.voice || '', language: p.language || '', rate: null, emotion: '', volume: null };
                const e = entryForCall(call, 'sample:' + nowClock(), p.name);
                player.enqueue(e, { startNow: true });
            },
            onMappingChanged: () => { /* settings 已持久化 */ },
        });
    });

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

let bttsBarEl = null;       // 底部栏按钮组（幂等）
let barMounted = false;

/**
 * 把“BetterTTS-角色 / ⚙”按钮放进聊天底部选项栏。
 * 采用候选锚点 + 幂等 + 可重试策略：某些 ST 版本聊天区较晚渲染。
 * @returns {boolean} 是否成功挂载
 */
function mountBottomBar() {
    if (barMounted && bttsBarEl && bttsBarEl.isConnected) return true;
    if (!bttsBarEl) bttsBarEl = buildBottomBar();

    const g = bttsBarEl;
    const q = (sel) => document.querySelector(sel);

    // 候选锚点（按优先级）：
    // 1) send 按钮前；2) ST 的 send 工具按钮组；3) options 按钮后；4) 输入栏容器
    const sendBtn = q('#send_but_send');
    if (sendBtn) {
        sendBtn.parentNode?.insertBefore(g, sendBtn);
        dlog('底部按钮已挂载到 #send_but_send 前');
        barMounted = true;
        return true;
    }
    const optionsBtn = q('#options_button');
    if (optionsBtn && optionsBtn.parentNode) {
        optionsBtn.parentNode.insertBefore(g, optionsBtn.nextSibling);
        dlog('底部按钮已挂载到 #options_button 后');
        barMounted = true;
        return true;
    }
    const sendForm = q('#send_form');
    if (sendForm) {
        // 放进输入栏（尽量保持可见；若 flex 布局，前置为新一行）
        sendForm.appendChild(g);
        dlog('底部按钮已挂载到 #send_form 内（候选锚点未命中，使用兜底位置）');
        barMounted = true;
        return true;
    }
    // 极端兜底：右下角悬浮
    if (!g.isConnected) {
        document.body.appendChild(g);
        g.classList.add('btts-bar-fallback');
        dlog('未找到输入栏容器，底部按钮以悬浮形式显示');
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

/** 统一尝试挂载（设置面板 + 底部栏），供定时重试用 */
function ensureMounts() {
    let ok = mountIntoSettingsPanel();
    const bar = mountBottomBar();
    return ok && bar;
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
let injectionState = { ok: false, method: null, attempted: false };

async function refreshPromptInjection() {
    const s = settings.get();
    if (!promptApi.promptEnabled(s) || !promptApi.promptShouldInject(s)) return;
    const res = await promptApi.registerInjection(s, { getName: () => EXT_NAME });
    if (!res.ok && !injectionState.attempted) {
        // 只在首次失败时提醒（避免刷屏）
        injectionState.attempted = true;
        console.warn('[BetterTTS] 提示词自动注入不可用：', promptApi.injectionNotice());
    }
    injectionState = { ...injectionState, ok: res.ok, method: res.method };
    logDebug('prompt 注入结果', res);
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
    if (!observer.start()) {
        // #chat 可能尚未出现，稍后重试
        const retry = setInterval(() => {
            if (observer.start()) { clearInterval(retry); scanAllVisible(); }
        }, 800);
        setTimeout(() => clearInterval(retry), 20000);
    }
    // 打开已有聊天时全量渲染一次（幂等）
    setTimeout(scanAllVisible, 600);

    // 设置挂载（立即尝试一次；ST 部分 UI 渲染较晚，配合下方定时重试）
    ensureMounts();

    // 事件
    subscribe('generation_started', onGenerationStart);
    subscribe('generation_ended', onGenerationEnd);
    subscribe('chat_changed', onChatContextChanged);
    subscribe('character_selected', onChatContextChanged);
    subscribe('message_swiped', onChatContextChanged);
    subscribe('message_rendered', () => scanDebounced());

    // 提示词注入 & 命令
    refreshPromptInjection();
    registerSlashCommands();

    dlog('初始化完成：',
        'enabled=' + settings.isEnabled(),
        'provider=' + settings.get().provider,
        '设置面板已挂载=' + settingsPanelMounted,
        '底部按钮已挂载=' + barMounted);
}

// ST 的扩展由动态 import 加载；防止意外重复执行（如热更新/重复挂载）
function boot() {
    if (globalThis.__BETTER_TTS_BOOTED__) return;
    globalThis.__BETTER_TTS_BOOTED__ = true;
    const run = () => init().then(() => {
        // 兜底重试挂载：面板/聊天区可能晚于扩展脚本出现（最长约 20s）
        let tries = 0;
        const timer = setInterval(() => {
            tries++;
            const done = ensureMounts();
            if (done || tries >= 20) {
                clearInterval(timer);
                dlog('挂载重试结束：设置面板=' + settingsPanelMounted + ' 底部按钮=' + barMounted);
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
dlog('模块已加载（BetterTTS v' + EXT_VERSION + '），若你在界面看不到任何 BetterTTS 入口，请检查：1) 目录是否为 public/scripts/extensions/<名字>/；2) 是否重启了 SillyTavern 服务端（不是仅刷新页面）；3) 浏览器控制台是否有上面的红色错误。');
