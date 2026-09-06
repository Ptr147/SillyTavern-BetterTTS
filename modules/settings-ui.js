// BetterTTS - 设置界面（可多实例挂载：ST 扩展面板 + 弹窗）
// 所有输入即时写入 extension_settings.betterTTS 并持久化。
// 支持：导出/导入全部配置（JSON）、恢复默认、提示词编辑/导入/导出、
// 音色获取等。

import { LANGUAGES, DEFAULT_PROMPT_TEXT, DEFAULT_FULL_PROMPT_TEXT, DEFAULT_ROLE_PROMPT_TEXT, EXT_VERSION } from './defaults.js';
import * as settings from './settings.js';
import { escapeHtml, downloadTextFile, pickTextFile, num, debounce } from './util.js';
import { PROVIDER_DEFS } from './providers.js';

let uidCounter = 0;

function uid() { return 'btu' + (++uidCounter); }

const langOptionsHtml = (sel) => LANGUAGES.map(l =>
    `<option value="${l.code}" ${l.code === sel ? 'selected' : ''}>${l.label} (${l.code})</option>`).join('');

const PROVIDER_UI = {
    edge: `
      <div class="btts-field">
        <label>库地址 moduleUrl（@edge-tts/universal，浏览器端加载）</label>
        <input type="text" data-path="providers.edge.moduleUrl" class="text_pole btts-inp" spellcheck="false">
      </div>
      <div class="btts-field">
        <label>默认语言</label>
        <select data-path="providers.edge.language" class="text_pole btts-inp"><option value="">（zh-CN）</option>${langOptionsHtml('zh-CN')}</select>
      </div>
      <div class="btts-field">
        <label>补充音色（每行一个 voice id，自动并入列表）</label>
        <textarea data-path="providers.edge.voicesText" class="text_pole btts-inp btts-ta-sm" placeholder="zh-CN-XiaochenNeural&#10;en-US-JasonNeural"></textarea>
      </div>`,
    openai: `
      <div class="btts-field">
        <label>接口地址 baseUrl（如 http://127.0.0.1:9880/v1 ，需支持 POST {base}/audio/speech）</label>
        <input type="text" data-path="providers.openai.baseUrl" class="text_pole btts-inp" placeholder="http://127.0.0.1:8000/v1">
      </div>
      <div class="btts-field">
        <label>API Key（可选，按 Bearer 发送）</label>
        <input type="password" data-path="providers.openai.apiKey" class="text_pole btts-inp">
      </div>
      <div class="btts-field">
        <label>模型 model</label>
        <input type="text" data-path="providers.openai.model" class="text_pole btts-inp" placeholder="tts-1 / gpt-4o-mini-tts / gpt-sovits 等">
      </div>
      <div class="btts-field">
        <label>默认音色 defaultVoice（默认留空）</label>
        <input type="text" data-path="providers.openai.defaultVoice" class="text_pole btts-inp" placeholder="留空 = 不带 voice 字段（使用服务端默认音色）">
      </div>
      <div class="btts-field">
        <label>音频格式 response_format（mp3/wav/opus/aac/flac/pcm）</label>
        <input type="text" data-path="providers.openai.responseFormat" class="text_pole btts-inp" placeholder="mp3">
      </div>
      <div class="btts-inline btts-check">
        <label class="btts-check"><input type="checkbox" data-path="providers.openai.sendInstructions">发送 instructions（gpt-4o-mini-tts 等支持）</label>
        <label class="btts-check" title="有角色声音描述/情绪时自动拼接为系统指令 instructions 发送"><input type="checkbox" data-path="providers.openai.autoInstructions">自动把角色声音+情绪拼为 instructions</label>
      </div>
      <div class="btts-field">
        <label>instructions 模板（支持 {{text}} {{emotion}} {{character}} {{rate}}）</label>
        <textarea data-path="providers.openai.instructionsTemplate" class="text_pole btts-inp btts-ta-sm"></textarea>
      </div>
      <div class="btts-field">
        <label>获取音色接口 voicesUrl（可选，GET 返回 JSON，兼容 {id:[...]} / {voices:[...]} / 字符串数组）</label>
        <input type="text" data-path="providers.openai.voicesUrl" class="text_pole btts-inp" placeholder="例如 http://127.0.0.1:8000/v1/audio/voices">
      </div>
      <div class="btts-field">
        <label>手动音色表（每行一个，与远程结果合并）</label>
        <textarea data-path="providers.openai.voicesText" class="text_pole btts-inp btts-ta-sm"></textarea>
      </div>`,
    custom: `
      <div class="btts-field">
        <label>接口名称（仅作标识）</label>
        <input type="text" data-path="providers.custom.name" class="text_pole btts-inp">
      </div>
      <div class="btts-field">
        <label>请求方式</label>
        <select data-path="providers.custom.method" class="text_pole btts-inp"><option value="POST">POST</option><option value="GET">GET</option></select>
      </div>
      <div class="btts-field">
        <label>URL 模板（占位符 {text} {voice} {language} {rate} {volume} {emotion} {character}）</label>
        <input type="text" data-path="providers.custom.url" class="text_pole btts-inp" placeholder="http://127.0.0.1:5000/tts?text={text}&voice={voice}&rate={rate}&lang={language}">
      </div>
      <div class="btts-field">
        <label>Headers（JSON 对象，值支持占位符）</label>
        <textarea data-path="providers.custom.headers" class="text_pole btts-inp btts-ta-sm" placeholder='{"Authorization":"Bearer xxxx"}'></textarea>
      </div>
      <div class="btts-field">
        <label>Body 模板（POST 时发送，JSON 字符串，支持同上占位符）</label>
        <textarea data-path="providers.custom.body" class="text_pole btts-inp btts-ta-sm" placeholder='{"text":"{text}","voice":"{voice}","rate":{rate}}'></textarea>
      </div>
      <div class="btts-field">
        <label>响应类型</label>
        <select data-path="providers.custom.responseMode" class="text_pole btts-inp">
          <option value="audio">audio（响应体即音频）</option>
          <option value="jsonUrl">jsonUrl（JSON 中某字段为音频 URL）</option>
          <option value="jsonBase64">jsonBase64（JSON 中某字段为 base64 音频）</option>
        </select>
      </div>
      <div class="btts-field">
        <label>JSON 字段路径（jsonUrl / jsonBase64 时使用，支持 a.b.c）</label>
        <input type="text" data-path="providers.custom.jsonField" class="text_pole btts-inp" placeholder="url">
      </div>
      <div class="btts-field">
        <label>获取音色接口 voicesUrl（可选）</label>
        <input type="text" data-path="providers.custom.voicesUrl" class="text_pole btts-inp">
      </div>
      <div class="btts-field">
        <label>手动音色表（每行一个）</label>
        <textarea data-path="providers.custom.voicesText" class="text_pole btts-inp btts-ta-sm"></textarea>
      </div>`,
};

/**
 * 组装设置区块 HTML
 * @param {{panel?:boolean}} opts panel=true（ST 扩展面板内挂载）时整体套一层可折叠的 <details>
 */
export function buildSettingsHtml(opts = {}) {
    const inner = `
  <div class="btts-settings" data-uid="${uid()}">
    <div class="btts-settings-head">
      <span class="btts-settings-title">🔊 BetterTTS <em>v${EXT_VERSION}</em></span>
      <span class="btts-settings-desc">让角色台词变成可点击播放的语音卡片</span>
    </div>

    <fieldset class="btts-fs">
      <legend>基本设置</legend>
      <div class="btts-inline">
        <label class="btts-check"><input type="checkbox" data-key="enabled">启用 BetterTTS</label>
        <label class="btts-check" title="生成过程中边出边读（逐条）；关闭则等整条消息生成完成后朗读"><input type="checkbox" data-key="streaming">流式播放</label>
        <label class="btts-check" title="多个语音调用/句子逐段独立合成朗读；关闭则同音色内容合并为整段朗读"><input type="checkbox" data-key="perSegment">按段朗读</label>
        <label class="btts-check" title="朗读角色消息中没有语音调用的纯叙述/旁白文本（使用“旁白/默认”音色）"><input type="checkbox" data-key="readNarration">朗读旁白</label>
        <label class="btts-check" title="开启后忽略函数调用里的 rate，全部按下方“语速”朗读"><input type="checkbox" data-key="rateLock">语速锁定</label>
      </div>
      <div class="btts-slider-row">
        <label>语速 <b class="btts-out" data-out="rate"></b></label>
        <input type="range" data-key="rate" min="0.5" max="2" step="0.05">
      </div>
      <div class="btts-slider-row">
        <label>音量 <b class="btts-out" data-out="volume"></b></label>
        <input type="range" data-key="volume" min="0.05" max="1" step="0.05">
      </div>
    </fieldset>

    <fieldset class="btts-fs">
      <legend>TTS 服务商</legend>
      <div class="btts-field">
        <label>选择服务商</label>
        <select data-key="provider" class="text_pole btts-inp">
          ${PROVIDER_DEFS.map(p => `<option value="${p.id}">${escapeHtml(p.label)}</option>`).join('')}
        </select>
        <div class="btts-hint btts-provider-hint"></div>
      </div>
      <div class="btts-provider-panels">
        ${PROVIDER_DEFS.map(p => `<div class="btts-provider-panel" data-provider="${p.id}" style="display:none">${PROVIDER_UI[p.id] || ''}</div>`).join('')}
      </div>
      <div class="btts-inline">
        <button type="button" class="menu_button btts-btn btts-fetch-voices">⟳ 获取音色列表</button>
        <span class="btts-hint btts-voice-status"></span>
      </div>
    </fieldset>

    <fieldset class="btts-fs">
      <legend>角色映射（说话人/语言）</legend>
      <div class="btts-hint">
        点击输入栏下方的 <b>“BetterTTS-角色”</b> 按钮，可为每个角色指定音色与语言；留空则使用下列默认值。
      </div>
      <div class="btts-inline">
        <label class="btts-field btts-half">默认音色
          <input type="text" data-key="defaults.voice" class="text_pole btts-inp" placeholder="留空时按语言自动选择">
        </label>
        <label class="btts-field btts-half">默认语言
          <select data-key="defaults.language" class="text_pole btts-inp"><option value="">zh-CN</option>${langOptionsHtml('zh-CN')}</select>
        </label>
      </div>
    </fieldset>

    <fieldset class="btts-fs">
      <legend>提示词与合成模式</legend>
      <div class="btts-hint">
        两种模式使用不同提示词与朗读逻辑：<b>说话模式</b> = 台词输出为函数调用
        <code>[[BTTS: {…}]]</code> / <code>[[BTTS-AddRole: {…}]]</code>，逐句渲染成可点击气泡；
        <b>全文模式</b> = 每个自然段落输出一次 <code>[[BTTS-TEXT: {…}]]</code>
        （text=整段内容，roles=本段涉及角色/旁白+情绪），前端渲染成“极简边框样式”，
        可一段一段朗读（流式开启时每完成一段即播）。
        内容为空时自动填入内置模板并显示在下方，可直接查看与编辑。
      </div>
      <div class="btts-inline">
        <label class="btts-check"><input type="checkbox" data-key="prompt.enabled">启用提示词</label>
        <label class="btts-check" title="自动注入到发送给模型的提示词中（注入当前模式对应的提示词）"><input type="checkbox" data-key="prompt.inject">自动注入</label>
        <label>注入位置
          <select data-key="prompt.position" class="text_pole">
            <option value="in_prompt">主提示词（in_prompt）</option>
            <option value="in_chat">聊天内（in_chat）</option>
            <option value="after_chat">聊天后（after_chat）</option>
          </select>
        </label>
        <label>合成模式
          <select data-key="prompt.mode" class="text_pole">
            <option value="line">说话模式（函数调用分句）</option>
            <option value="full">全文朗读模式（段落级 BTTS-TEXT）</option>
          </select>
        </label>
      </div>

      <fieldset class="btts-fs">
        <legend>说话模式提示词（BTTS / BTTS-AddRole 函数调用）</legend>
        <textarea data-key="prompt.text" class="text_pole btts-inp btts-ta-lg" spellcheck="false"
          placeholder="（内置提示词已自动填入，可在此修改）"></textarea>
        <div class="btts-inline">
          <button type="button" class="menu_button btts-btn btts-prompt-reset">恢复说话模式模板</button>
          <button type="button" class="menu_button btts-btn btts-prompt-copy">复制当前提示词</button>
          <button type="button" class="menu_button btts-btn btts-prompt-export">导出(.txt)</button>
          <button type="button" class="menu_button btts-btn btts-prompt-import">导入(.txt/.json)</button>
        </div>
      </fieldset>

      <fieldset class="btts-fs">
        <legend>角色注册系统提示词（BTTS-AddRole · 独立，默认注入，两种模式都生效）</legend>
        <label class="btts-check" style="margin-bottom:6px"
          title="无论说话/全文模式都注入“BTTS-AddRole 注册规则”，用于指导模型给角色/旁白注册声音描述">
          <input type="checkbox" data-key="prompt.roleInject">默认注入角色注册规则</label>
        <textarea data-key="prompt.roleText" class="text_pole btts-inp btts-ta-lg" spellcheck="false"
          placeholder="（内置角色注册规则已自动填入，可在此修改）"></textarea>
        <div class="btts-inline">
          <span class="btts-hint">从说话模式提示词中独立出来，切换合成模式不会被替换</span>
          <button type="button" class="menu_button btts-btn btts-prompt-role-reset">恢复角色规则模板</button>
        </div>
      </fieldset>

      <fieldset class="btts-fs">
        <legend>全文模式提示词（BTTS-TEXT 段落调用）</legend>
        <textarea data-key="prompt.fullText" class="text_pole btts-inp btts-ta-lg" spellcheck="false"
          placeholder="（内置全文提示词已自动填入，可在此修改）"></textarea>
        <div class="btts-inline">
          <span class="btts-hint">每段一个 [[BTTS-TEXT: {“text”:段落全文,“roles”:[{“character”:角色名,“emotion”:语气}]}]]</span>
          <button type="button" class="menu_button btts-btn btts-prompt-full-reset">恢复全文模式模板</button>
        </div>
      </fieldset>

      <div class="btts-hint" style="margin-top:2px">提示词注入状态：<span class="btts-inject-status">—</span></div>
    </fieldset>

    <fieldset class="btts-fs">
      <legend>高级</legend>
      <div class="btts-field">
        <label>自定义 CSS（作用于语音卡片 / 弹窗，随配置一起导出）</label>
        <textarea data-key="customCss" class="text_pole btts-inp btts-ta-sm" spellcheck="false"></textarea>
      </div>
      <label class="btts-check"><input type="checkbox" data-key="debug">调试日志（控制台输出）</label>
    </fieldset>

    <fieldset class="btts-fs">
      <legend>数据（全部配置：含角色映射、提示词、服务商参数）</legend>
      <div class="btts-inline">
        <button type="button" class="menu_button btts-btn btts-export-all">⬇ 导出全部配置</button>
        <button type="button" class="menu_button btts-btn btts-import-all">⬆ 导入全部配置(JSON)</button>
        <button type="button" class="menu_button btts-btn btts-reset-all">恢复默认</button>
        <span class="btts-hint btts-data-status"></span>
      </div>
    </fieldset>
  </div>`;

    if (opts.panel) {
        // 扩展面板内：使用 SillyTavern 主题自带的 inline-drawer 折叠结构
        // （参考 builtin 扩展的 extension_container / inline-drawer 写法）
        return `<div class="extension_container btts-native-ext">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header interactable btts-native-toggle">
      <div class="flex-container alignitemscenter margin0">
        <b>🔊 BetterTTS 设置</b>
        <small class="marginLeft5" style="opacity:.65">v${EXT_VERSION} · 点击标题展开设置</small>
      </div>
      <div class="inline-drawer-icon fa-solid interactable fa-circle-chevron-down btts-native-arrow" tabindex="0" role="button"></div>
    </div>
    <div class="inline-drawer-content btts-native-content" style="display: none;">${inner}</div>
  </div>
</div>`;
    }
    return inner;
}

/** 绑定某个挂载实例 */
export function bindSettings(rootEl, hooks = {}) {
    if (!rootEl) return null;
    const $root = typeof rootEl === 'string' ? document.querySelector(rootEl) : rootEl;
    if (!$root) return null;

    const el = (sel) => $root.querySelector(sel);
    const els = (sel) => Array.from($root.querySelectorAll(sel));
    const s = () => settings.get();
    const notify = hooks.notice || (() => { });

    // ---- 读写通用 ----
    const setByPath = (path, value) => {
        const cur = s();
        const parts = path.split('.');
        let node = cur;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
            node = node[parts[i]];
        }
        node[parts[parts.length - 1]] = value;
        settings.persist();
    };
    const getByPath = (path) => {
        let node = s();
        for (const p of path.split('.')) {
            if (node === null || node === undefined) return undefined;
            node = node[p];
        }
        return node;
    };

    const valueFor = (input) => {
        const path = input.dataset.key || input.dataset.path;
        const raw = getByPath(path);
        if (input.type === 'checkbox') return { path, value: !!input.checked, asBool: true };
        if (input.tagName === 'SELECT' || input.type === 'text' || input.type === 'password' || input.tagName === 'TEXTAREA') {
            return { path, value: input.value, asBool: false };
        }
        if (input.type === 'range') return { path, value: num(input.value), asBool: false };
        return { path, value: input.value, asBool: false };
    };

    const refreshAll = () => {
        // checkboxes / inputs / selects / textareas
        els('input[type="checkbox"]').forEach(i => { const p = i.dataset.key || i.dataset.path; i.checked = !!getByPath(p); });
        els('input[type="range"]').forEach(i => { const p = i.dataset.key; const v = num(getByPath(p)); i.value = String(v); syncOut(i, v); });
        els('input[type="text"], input[type="password"], textarea').forEach(i => {
            const p = i.dataset.key || i.dataset.path;
            const v = getByPath(p);
            if (v !== undefined && v !== null) i.value = String(v);
        });
        els('select').forEach(i => {
            const p = i.dataset.key || i.dataset.path;
            const v = getByPath(p);
            if (v !== undefined && v !== null && [...i.options].some(o => o.value === String(v))) i.value = String(v);
        });
        updateProviderVisibility();
    };

    const syncOut = (rangeInput, v) => {
        const out = rangeInput.closest('.btts-slider-row')?.querySelector('[data-out]');
        if (out) {
            out.textContent = rangeInput.type === 'range' && (rangeInput.max === '2') ? v.toFixed(2) : Math.round(v * 100) + '%';
        }
    };

    const persistFrom = (input) => {
        const { path, value, asBool } = valueFor(input);
        setByPath(path, value);
        if (asBool && (path === 'enabled')) {
            notify((value ? '已启用' : '已停用') + ' BetterTTS');
        }
        if (hooks.onChange) hooks.onChange(path, value);
        if (path === 'customCss') hooks.onCustomCss?.(value);
    };

    const updateProviderVisibility = () => {
        const cur = s().provider || 'edge';
        els('.btts-provider-panel').forEach(p => { p.style.display = p.dataset.provider === cur ? '' : 'none'; });
        const hint = el('.btts-provider-hint');
        if (hint) {
            const def = PROVIDER_DEFS.find(p => p.id === cur);
            hint.textContent = def ? def.hint : '';
        }
    };

    // ---- 事件绑定 ----
    const saveDebounced = debounce(() => settings.persist(), 300);

    // 原生 inline-drawer 折叠：自行处理点击，避免与 ST 全局委托重复触发
    (() => {
        const content = $root.querySelector('.btts-native-content');
        const arrow = $root.querySelector('.btts-native-arrow');
        const header = $root.querySelector('.btts-native-toggle');
        if (!content) return;
        const flip = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            const shown = content.style.display !== 'none';
            content.style.display = shown ? 'none' : 'block';
            if (arrow) arrow.classList.toggle('up', !shown);
        };
        header?.addEventListener('click', flip);
        arrow?.addEventListener('click', flip);
    })();

    $root.addEventListener('input', (e) => {
        const t = e.target;
        if (t.matches('input[type="range"]')) {
            const { path, value } = valueFor(t);
            setByPath(path, value);
            syncOut(t, value);
            return;
        }
        if (t.matches('input, select, textarea')) {
            persistFrom(t);
            saveDebounced();
        }
    });
    $root.addEventListener('change', (e) => {
        const t = e.target;
        if (t.matches('select[data-key="provider"]')) {
            updateProviderVisibility();
        }
        if (t.matches('select, input[type="checkbox"]')) {
            persistFrom(t);
            saveDebounced();
        }
        if (t.matches('input[data-path*="voicesText"]')) {
            hooks.onVoicesTextChanged?.();
        }
    });

    // 获取音色
    const fetchBtn = el('.btts-fetch-voices');
    if (fetchBtn) {
        fetchBtn.addEventListener('click', async () => {
            const status = el('.btts-voice-status');
            if (status) status.textContent = '获取中…';
            try {
                const mod = await import('./providers.js');
                const res = await mod.loadVoices(s());
                if (status) status.textContent = res.message;
                if (res.ok && hooks.onVoicesLoaded) hooks.onVoicesLoaded(res.voices);
                if (!res.ok) notify(res.message || '获取失败', 'err');
            } catch (e) {
                if (status) status.textContent = '获取失败';
                notify(String(e?.message || e), 'err');
            }
        });
    }

    // 提示词按钮
    el('.btts-prompt-reset')?.addEventListener('click', () => {
        setByPath('prompt.text', DEFAULT_PROMPT_TEXT);
        refreshAll();
        notify('已填入内置说话模式提示词');
    });
    el('.btts-prompt-full-reset')?.addEventListener('click', () => {
        setByPath('prompt.fullText', DEFAULT_FULL_PROMPT_TEXT);
        refreshAll();
        notify('已填入内置全文模式提示词');
    });
    el('.btts-prompt-role-reset')?.addEventListener('click', () => {
        setByPath('prompt.roleText', DEFAULT_ROLE_PROMPT_TEXT);
        refreshAll();
        notify('已填入内置角色注册规则');
    });
    el('.btts-prompt-copy')?.addEventListener('click', async () => {
        const { copyText } = await import('./util.js');
        const ok = await copyText(currentPromptText());
        notify(ok ? '提示词已复制（当前模式）' : '复制失败', ok ? 'ok' : 'err');
    });
    el('.btts-prompt-export')?.addEventListener('click', () => {
        downloadTextFile('bettertts-prompt.txt', currentPromptText(), 'text/plain');
        notify('已导出提示词（当前模式）');
    });
    el('.btts-prompt-import')?.addEventListener('click', async () => {
        const file = await pickTextFile('.txt,.json,text/plain,application/json');
        if (!file) return;
        let content = file.text;
        try {
            const obj = JSON.parse(file.text);
            if (obj && typeof obj === 'object') {
                const text = obj.prompt?.text ?? obj.text ?? obj.prompt;
                if (typeof text === 'string') content = text;
            }
        } catch { /* 纯文本 */ }
        const mode = s().prompt?.mode === 'full' ? 'full' : 'line';
        if (!content.trim()) content = mode === 'full' ? DEFAULT_FULL_PROMPT_TEXT : DEFAULT_PROMPT_TEXT;
        setByPath(mode === 'full' ? 'prompt.fullText' : 'prompt.text', content);
        refreshAll();
        notify('提示词已导入（当前模式）');
    });

    // 数据按钮
    el('.btts-export-all')?.addEventListener('click', () => {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        downloadTextFile(`bettertts-config-${stamp}.json`, settings.exportConfigText());
        notify('已导出全部配置');
    });
    el('.btts-import-all')?.addEventListener('click', async () => {
        const file = await pickTextFile('.json,application/json');
        if (!file) return;
        const res = settings.importConfigText(file.text);
        notify(res.message, res.ok ? 'ok' : 'err');
        refreshAll();
        hooks.onConfigImported?.();
    });
    el('.btts-reset-all')?.addEventListener('click', async () => {
        const conf = window.confirm ? await Promise.resolve(window.confirm('确定恢复 BetterTTS 默认配置？此操作会覆盖当前全部设置。')) : true;
        if (!conf) return;
        const res = settings.resetConfig();
        notify(res.message);
        refreshAll();
        hooks.onConfigImported?.();
    });

    function currentPromptText() {
        const d = s();
        const mode = d.prompt?.mode === 'full' ? 'full' : 'line';
        const t = mode === 'full' ? d.prompt?.fullText : d.prompt?.text;
        if (t && String(t).trim()) return String(t).trim();
        return mode === 'full' ? DEFAULT_FULL_PROMPT_TEXT : DEFAULT_PROMPT_TEXT;
    }

    // 初始
    refreshAll();
    return {
        refresh: refreshAll,
        get currentPrompt() { return currentPromptText(); },
        setInjectStatus(msg, ok) {
            const el = $root.querySelector('.btts-inject-status');
            if (!el) return;
            if (!msg) { el.textContent = '—'; el.style.color = ''; return; }
            el.textContent = msg;
            el.style.color = ok ? '#2f9e44' : '#e03131';
        },
    };
}

export function settingsPanelHtml() { return buildSettingsHtml(); }
