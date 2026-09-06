// BetterTTS - 配置数据管理（读写 extension_settings.betterTTS）

import { DEFAULTS, SETTINGS_KEY, NARRATOR_KEY, DEFAULT_PROMPT_TEXT, DEFAULT_FULL_PROMPT_TEXT, DEFAULT_ROLE_PROMPT_TEXT } from './defaults.js';
import { prettyJson, safeParse } from './util.js';

let extensionSettings = null; // ST 的 extension_settings 对象
let persistFn = null;         // 由 index.js 注入的持久化函数
let data = null;              // 便捷引用

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 深度合并：defaults 为骨架，target 覆盖之（保留 target 中 defaults 之外的键） */
export function mergeDeep(target, defaults) {
    if (!isPlainObject(target)) return structuredClone(defaults);
    const out = {};
    // 1) defaults 中的键：target 有则覆盖，无则用默认
    for (const [k, dv] of Object.entries(defaults)) {
        const tv = target[k];
        if (isPlainObject(dv)) {
            out[k] = isPlainObject(tv) ? mergeDeep(tv, dv) : structuredClone(dv);
        } else if (tv === undefined) {
            out[k] = structuredClone(dv);
        } else {
            out[k] = tv;
        }
    }
    // 2) target 中 defaults 之外的键：原样保留（例如角色映射、自定义字段）
    for (const [k, tv] of Object.entries(target)) {
        if (!(k in defaults)) {
            out[k] = structuredClone(isPlainObject(tv) ? tv : tv);
        }
    }
    return out;
}

/** 用默认值补全当前配置（原地修改 + 返回）
 *  规则：提示词为空时自动填入内置（系统）提示词内容，保证设置面板里能看到并可编辑。 */
export function hydrate() {
    if (!extensionSettings) return data;
    const current = extensionSettings[SETTINGS_KEY];
    const merged = mergeDeep(isPlainObject(current) ? current : {}, DEFAULTS);
    // 数值钳制（volume=0/非法 时视为 1，避免“静音”式无声让用户以为坏了）
    merged.rate = Math.min(2, Math.max(0.5, Number(merged.rate) || 1));
    let vol = Number(merged.volume);
    if (!Number.isFinite(vol) || vol <= 0) vol = 1;
    merged.volume = Math.min(1, Math.max(0.05, vol));
    let to = Number(merged.synthTimeout);
    if (!Number.isFinite(to) || to <= 0) to = 45;
    merged.synthTimeout = Math.min(300, Math.max(5, to));
    merged.schemaVersion = DEFAULTS.schemaVersion;
    // 提示词为空 → 填充内置（系统）提示词，面板中可直接查看/编辑
    if (!merged.prompt || typeof merged.prompt !== 'object') merged.prompt = structuredClone(DEFAULTS.prompt);
    if (!String(merged.prompt.text || '').trim()) merged.prompt.text = DEFAULT_PROMPT_TEXT;
    if (!String(merged.prompt.fullText || '').trim()) merged.prompt.fullText = DEFAULT_FULL_PROMPT_TEXT;
    if (!String(merged.prompt.roleText || '').trim()) merged.prompt.roleText = DEFAULT_ROLE_PROMPT_TEXT;
    if (!merged.prompt.mode) merged.prompt.mode = 'line';
    extensionSettings[SETTINGS_KEY] = merged;
    data = merged;
    return data;
}

/** 绑定 ST extension_settings 并初始化 */
export function init(extSettings) {
    extensionSettings = extSettings;
    if (extensionSettings && !extensionSettings[SETTINGS_KEY]) {
        extensionSettings[SETTINGS_KEY] = structuredClone(DEFAULTS);
    }
    hydrate();
}

export function setPersist(fn) { persistFn = fn; }

/** 持久化（防抖由注入方负责） */
export function persist() {
    try { if (typeof persistFn === 'function') persistFn(); } catch { /* ignore */ }
}

export function get() { return data; }

export function isEnabled() { return !!data?.enabled; }

/** 导出全部配置（含角色映射、提示词、各服务商参数）的 JSON 字符串 */
export function exportConfigText() {
    return prettyJson(data);
}

/** 从 JSON 文本导入全部配置 */
export function importConfigText(text) {
    const parsed = safeParse(text);
    if (!parsed || typeof parsed !== 'object') return { ok: false, message: '导入失败：不是合法的 JSON 对象' };
    extensionSettings[SETTINGS_KEY] = mergeDeep(parsed, DEFAULTS);
    hydrate();
    persist();
    return { ok: true, message: '配置已导入' };
}

/** 恢复默认配置（保留 schema 层级） */
export function resetConfig() {
    extensionSettings[SETTINGS_KEY] = structuredClone(DEFAULTS);
    hydrate();
    persist();
    return { ok: true, message: '已恢复默认配置' };
}

/** 获取角色映射对象（确保存在） */
export function characterMap() {
    if (!data.characters || typeof data.characters !== 'object') data.characters = {};
    return data.characters;
}

let avatarResolver = null; // (name) => avatar|string|null ，由 index 注入，用于“按角色卡独立”存储

/** 注入“按角色名取当前角色卡头像”的解析器 */
export function setCharacterAvatarResolver(fn) { avatarResolver = fn; }

function resolveAvatar(name) {
    try { return avatarResolver ? avatarResolver(name) : null; } catch { return null; }
}

/**
 * 角色映射键：默认按“角色卡”独立 → key = <名字>::<头像路径>；
 * 同名不同卡互不影响；无头像信息（旁白/新角色等）时回退为纯名字。
 */
export function cardKeyOf(name) {
    if (!name) return '';
    const n = String(name).trim();
    if (!n || n === NARRATOR_KEY) return n;
    const av = resolveAvatar(n);
    return av ? n + '::' + String(av) : n;
}

/** 由存储键还原展示名（去掉 ::头像） */
export function cardLabelOf(key) {
    const s = String(key || '');
    const i = s.lastIndexOf('::');
    return i > 0 ? s.slice(0, i) : s;
}

/** 读取映射：优先“当前角色卡”键，兼容旧版纯名字条目 */
export function getCharacterMapping(name) {
    const map = characterMap();
    if (!name) return {};
    const full = cardKeyOf(name);
    if (map[full]) return map[full];
    const plain = String(name).trim();
    if (plain && plain !== full && map[plain]) return map[plain];
    return {};
}

/** 写入映射：只写“当前角色卡”键（不污染同名其它卡） */
export function setCharacterMapping(name, mapping) {
    const map = characterMap();
    const key = cardKeyOf(name) || String(name || '').trim();
    if (!key) return;
    const merged = { ...(map[key] || {}), ...(mapping || {}) };
    const cleaned = {};
    for (const [k, v] of Object.entries(merged)) {
        if (v !== undefined && v !== null && String(v).trim() !== '') cleaned[k] = v;
    }
    if (Object.keys(cleaned).length) map[key] = cleaned;
    else delete map[key];
    persist();
}

/** 删除某角色卡的完整映射（含声音描述） */
export function removeCharacterMapping(name) {
    const map = characterMap();
    const key = cardKeyOf(name) || String(name || '').trim();
    if (key && map[key]) { delete map[key]; persist(); }
}

/** 读取某角色已注册的“声音描述”（BTTS-AddRole） */
export function voiceDescriptionOf(name) {
    const m = getCharacterMapping(name);
    if (m) return String(m.voiceDescription || '').trim();
    return '';
}

/** 依据角色名 + 全局默认，解析最终使用的音色/语言/语速 */
export function resolveParams({ character, voice, language, rate, emotion }) {
    const d = data || DEFAULTS;
    const map = getCharacterMapping(character);
    const finalVoice = String(voice || map.voice || d.defaults.voice || '').trim();
    const finalLanguage = String(language || map.language || d.defaults.language || 'zh-CN').trim() || 'zh-CN';
    const useCallRate = !d.rateLock && rate !== null && rate !== undefined && Number.isFinite(Number(rate));
    const finalRate = useCallRate ? Math.min(2, Math.max(0.5, Number(rate))) : Math.min(2, Math.max(0.5, Number(d.rate) || 1));
    return {
        voice: finalVoice,
        language: finalLanguage,
        rate: finalRate,
        volume: d.volume,
        emotion: String(emotion || '').trim(),
    };
}
