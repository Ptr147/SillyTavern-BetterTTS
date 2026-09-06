// BetterTTS - “BetterTTS-角色”弹窗
// 底部选项栏按钮弹出，为不同角色指定说话人（音色）与语言。
// 数据存于 settings.characters[角色名] = { voice, language }（全局）。
// 保留键 __narrator__ 表示旁白/默认行。

import { LANGUAGES, NARRATOR_KEY } from './defaults.js';
import * as settings from './settings.js';
import { debounce } from './util.js';

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
        <button type="button" class="btts-crow-clear menu_button" title="清除该行映射">✕</button>
      </div>
    </div>`;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function collectSpeakers() {
    const names = [];
    const add = (n) => {
        n = String(n || '').trim();
        if (n && !names.includes(n)) names.push(n);
    };
    try {
        const c = callbacks.getContext ? callbacks.getContext() : null;
        const ctx = c || (globalThis.SillyTavern ? (typeof globalThis.SillyTavern.getContext === 'function' ? globalThis.SillyTavern.getContext() : null) : null);
        if (ctx) {
            if (ctx.characters && Array.isArray(ctx.characters)) ctx.characters.forEach(ch => add(ch?.name));
            if (ctx.chat && Array.isArray(ctx.chat)) {
                ctx.chat.forEach(m => {
                    if (m && !m.is_user && !m.is_system && m.name) add(m.name);
                });
            }
            if (ctx.name2 && !names.includes(ctx.name2)) add(ctx.name2);
        }
    } catch { /* ignore */ }
    // 加上已保存映射中的名字（即使不在当前聊天）
    try {
        const map = settings.characterMap();
        for (const k of Object.keys(map)) if (k !== NARRATOR_KEY) add(k);
    } catch { /* ignore */ }
    return names;
}

export function openCharacterPopup(opts = {}) {
    callbacks = opts;
    if (popupEl && popupEl.isConnected) { render(); popupEl.style.display = ''; return; }

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
            提示：语音调用中的 voice/language 字段优先；留空时按此处的角色映射决定。
          </div>
          <div id="btts-crows"></div>
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
            row.querySelector('[data-field="voice"]').value = '';
            const sel = row.querySelector('[data-field="language"]');
            if (sel) sel.value = '';
            settings.setCharacterMapping(name, { voice: '', language: '' });
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
                settings.setCharacterMapping(name, { voice, language: lang });
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

    render();
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

function render() {
    const box = popupEl.querySelector('#btts-crows');
    if (!box) return;
    const speakers = collectSpeakers();
    const names = [NARRATOR_KEY, ...speakers];
    const map = settings.characterMap();
    box.innerHTML = names.map(name => rowHtml(name, map[name], name === NARRATOR_KEY)).join('');
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
