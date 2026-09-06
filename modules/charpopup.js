// BetterTTS - “BetterTTS-角色”弹窗
// 底部选项栏按钮弹出，为不同角色指定说话人（音色）与语言。
// 数据存于 settings.characters[角色名] = { voice, language }（全局）。
// 保留键 __narrator__ 表示旁白/默认行。

import { LANGUAGES, NARRATOR_KEY } from './defaults.js';
import * as settings from './settings.js';
import { debounce } from './util.js';
import { findCalls } from './parser.js';

let voiceOptions = [];       // [{id,label,group}]
let cachedVoiceKey = '';     // 服务商变化时重新获取
let voicePromise = null;

/** 取得（缓存）当前服务商的音色表 */
export function getVoiceOptions(s, force = false) {
    const provider = s.provider || 'edge';
    if (!force && voiceOptions.length && cachedVoiceKey === provider) {
        return Promise.resolve({ ok: true, voices: voiceOptions, message: '' });
    }
    if (!voicePromise || cachedVoiceKey !== provider) {
        cachedVoiceKey = provider;
        voicePromise = import('./providers.js').then(m => m.loadVoices(s))
            .then(res => {
                if (res.ok) voiceOptions = res.voices;
                return res;
            });
    }
    return voicePromise;
}

export function refreshVoices(s) { voiceOptions = []; cachedVoiceKey = ''; voicePromise = null; return getVoiceOptions(s, true); }

function buildDatalist() {
    if (document.getElementById('btts-voice-datalist')) return;
    const dl = document.createElement('datalist');
    dl.id = 'btts-voice-datalist';
    for (const v of voiceOptions) {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.label = [v.label, v.group].filter(Boolean).join(' · ');
        dl.appendChild(opt);
    }
    document.body.appendChild(dl);
}

function langOptionsHtml(selected) {
    return LANGUAGES.map(l =>
        `<option value="${l.code}" ${l.code === selected ? 'selected' : ''}>${l.label} (${l.code})</option>`
    ).join('');
}

let popupEl = null;
let refreshDebounced = null;
let callbacks = {};

function rowHtml(name, map, isNarrator) {
    const voice = (map && map.voice) || '';
    const lang = (map && map.language) || '';
    const desc = (map && map.voiceDescription) || '';
    return `
    <div class="btts-crow" data-name="${escapeAttr(name)}">
      <div class="btts-crow-name" title="${escapeAttr(name)}">${escapeHtml(isNarrator ? '旁白 / 默认' : name)}</div>
      <div class="btts-crow-fields">
        <input class="btts-crow-voice text_pole" type="text" list="btts-voice-datalist"
               placeholder="音色 / 说话人" value="${escapeAttr(voice)}" data-field="voice">
        <select class="btts-crow-lang" data-field="language">
          <option value="">（默认语言）</option>
          ${langOptionsHtml(lang)}
        </select>
        <button type="button" class="btts-crow-play menu_button" title="试听">▶</button>
        <button type="button" class="btts-crow-clear menu_button" title="清除该行映射（含声音描述）">✕</button>
      </div>
      <input class="btts-crow-desc text_pole" type="text" data-field="desc"
             placeholder="声音描述（来自 BTTS-AddRole 注册，可修改；用于拼成语音系统指令）"
             value="${escapeAttr(desc)}">
    </div>`;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

/**
 * 角色列表依据「生成结果」动态收集：
 * 扫描当前聊天消息里出现的 [[BetterTTS: …]] 语音调用的 character 字段
 * （无 character 时用说话人名兜底，与朗读时解析一致），并保留历史已配置的角色名。
 */
function collectSpeakers() {
    const names = [];
    const add = (n) => {
        n = String(n || '').trim();
        if (n && n !== NARRATOR_KEY && !names.includes(n)) names.push(n);
    };
    try {
        const c = callbacks.getContext ? callbacks.getContext() : null;
        const ctx = c || (globalThis.SillyTavern && typeof globalThis.SillyTavern.getContext === 'function' ? globalThis.SillyTavern.getContext() : null);
        if (ctx && Array.isArray(ctx.chat)) {
            for (const m of ctx.chat) {
                if (!m || typeof m.mes !== 'string') continue;
                let found = false;
                for (const call of findCalls(m.mes)) {
                    if (call.obj) {
                        const name = String(call.obj.character || '').trim();
                        if (name) { add(name); found = true; }
                    }
                }
                // 与运行时一致：调用未带 character 时回退到消息说话人
                if (!found && !m.is_user && !m.is_system && m.name) add(m.name);
            }
        }
    } catch { /* ignore */ }
    // 已保存映射中的名字保留（即使当前聊天/生成结果里还没出现，便于修改）
    try {
        const map = settings.characterMap();
        for (const k of Object.keys(map)) if (k !== NARRATOR_KEY) add(k);
    } catch { /* ignore */ }
    return names;
}

export function openCharacterPopup(opts = {}) {
    callbacks = opts;
    if (popupEl && popupEl.isConnected) { render(snapshotRows()); popupEl.style.display = ''; return; }

    popupEl = document.createElement('div');
    popupEl.className = 'btts-popup-root';
    popupEl.innerHTML = `
      <div class="btts-popup" role="dialog" aria-label="BetterTTS 角色设置">
        <div class="btts-popup-head">
          <span class="btts-popup-title">🔊 BetterTTS-角色</span>
          <span class="btts-popup-sub">为不同角色指定 说话人/音色 与 语言（全局生效，按角色名匹配）</span>
          <button type="button" class="btts-popup-close" aria-label="关闭">✕</button>
        </div>
        <div class="btts-popup-body">
          <div class="btts-popup-tip">
            角色列表依据<b>模型生成结果</b>自动出现（来自语音调用 character 字段），生成新台词后会自动补充；
            也可手动添加名字。voice/language 留空时使用该角色配置；无配置则用“旁白 / 默认”。
          </div>
          <div id="btts-crows"></div>
          <div class="btts-addrow">
            <input id="btts-new-name" class="text_pole btts-crow-voice" type="text" placeholder="手动添加角色名…">
            <button type="button" class="menu_button btts-add-name">＋ 添加</button>
          </div>
        </div>
        <div class="btts-popup-foot">
          <button type="button" class="menu_button btts-refresh-voices">⟳ 获取音色</button>
          <span class="btts-popup-hint" id="btts-popup-hint"></span>
        </div>
      </div>`;
    document.body.appendChild(popupEl);
    buildDatalist();

    popupEl.querySelector('.btts-popup-close').addEventListener('click', () => { popupEl.style.display = 'none'; });
    popupEl.addEventListener('click', (e) => {
        if (e.target === popupEl) popupEl.style.display = 'none';
        const playBtn = e.target.closest('.btts-crow-play');
        if (playBtn) { sampleRow(playBtn.closest('.btts-crow')); return; }
        const clearBtn = e.target.closest('.btts-crow-clear');
        if (clearBtn) {
            const row = clearBtn.closest('.btts-crow');
            const name = row.dataset.name;
            settings.removeCharacterMapping(name);
            render(snapshotRows());
            return;
        }
        const addBtn = e.target.closest('.btts-add-name');
        if (addBtn) {
            const input = popupEl.querySelector('#btts-new-name');
            const name = (input?.value || '').trim();
            if (name) {
                settings.setCharacterMapping(name, { added: true });
                if (input) input.value = '';
                render(snapshotRows());
            }
            return;
        }
    });
    const handleFieldInput = (e) => {
        const field = e.target.closest('[data-field]');
        if (!field) return;
        const row = field.closest('.btts-crow');
        if (!row) return;
        if (!refreshDebounced) refreshDebounced = debounce(() => {
            document.querySelectorAll('#btts-crows .btts-crow').forEach(r => {
                const name = r.dataset.name;
                const voice = r.querySelector('[data-field="voice"]')?.value || '';
                const lang = r.querySelector('[data-field="language"]')?.value || '';
                const desc = r.querySelector('[data-field="desc"]')?.value || '';
                settings.setCharacterMapping(name, { voice, language: lang, voiceDescription: desc });
            });
            if (callbacks.onMappingChanged) callbacks.onMappingChanged();
        }, 250);
        refreshDebounced();
    };
    popupEl.addEventListener('input', handleFieldInput);
    popupEl.addEventListener('change', handleFieldInput);
    popupEl.querySelector('.btts-refresh-voices').addEventListener('click', async () => {
        const hint = popupEl.querySelector('#btts-popup-hint');
        hint.textContent = '获取中…';
        const res = await refreshVoices(settings.get());
        hint.textContent = res.message || (res.ok ? '完成' : '失败');
        if (res.ok) renderDatalist();
        // 回填已有行的音色下拉数据（datalist 已重建）
    });

    const closeOnEsc = (e) => { if (e.key === 'Escape') popupEl.style.display = 'none'; };
    document.addEventListener('keydown', closeOnEsc);
    popupEl._closeOnEsc = closeOnEsc;

    render(snapshotRows());
    popupEl.style.display = '';
    // 拉取当前服务商音色（异步，不影响展示）
    getVoiceOptions(settings.get()).then(() => {
        if (popupEl && popupEl.isConnected) renderDatalist();
    }).catch(() => { });
    return popupEl;
}

function renderDatalist() {
    const dl = document.getElementById('btts-voice-datalist');
    if (dl) dl.remove();
    buildDatalist();
}

/** 快照当前各行已填（可能未保存）的值，重渲染时恢复，避免打断输入 */
function snapshotRows() {
    const snap = {};
    document.querySelectorAll('#btts-crows .btts-crow').forEach(r => {
        snap[r.dataset.name] = {
            voice: r.querySelector('[data-field="voice"]')?.value || '',
            language: r.querySelector('[data-field="language"]')?.value || '',
            voiceDescription: r.querySelector('[data-field="desc"]')?.value || '',
        };
    });
    return snap;
}

/**
 * 渲染行列表
 * @param {object} [overlay] { name: {voice, language} } 覆盖到显示值上（保留未保存输入）
 */
function render(overlay) {
    const box = popupEl?.querySelector('#btts-crows');
    if (!box) return;
    const speakers = collectSpeakers();
    const names = [NARRATOR_KEY, ...speakers];
    const map = settings.characterMap();
    const merged = {};
    for (const [k, v] of Object.entries(map)) merged[k] = { ...v };
    for (const [k, v] of Object.entries(overlay || {})) merged[k] = { ...(merged[k] || {}), ...v };
    box.innerHTML = names.map(name => rowHtml(name, merged[name], name === NARRATOR_KEY)).join('');
}

/** 弹窗打开时：根据最新生成结果补行（保留正在编辑的值） */
export function refreshOpenPopup() {
    if (!popupEl || !popupEl.isConnected || popupEl.style.display === 'none') return;
    render(snapshotRows());
}

function sampleRow(row) {
    if (!row) return;
    const name = row.dataset.name;
    const voice = row.querySelector('[data-field="voice"]')?.value || '';
    const language = row.querySelector('[data-field="language"]')?.value || '';
    const text = name === NARRATOR_KEY ? '你好，这是旁白试听。' : `你好，我是${name}，这是声音试听。`;
    if (callbacks.onSample) callbacks.onSample({ name, voice, language, text });
}

export function closeCharacterPopup() {
    if (popupEl) popupEl.style.display = 'none';
}
