// BetterTTS - 配置数据管理（读写 extension_settings.betterTTS）

import { DEFAULTS, SETTINGS_KEY, DEFAULT_PROMPT_TEXT, DEFAULT_FULL_PROMPT_TEXT } from './defaults.js';
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
    merged.schemaVersion = DEFAULTS.schemaVersion;
    // 提示词为空 → 填充内置（系统）提示词，面板中可直接查看/编辑
    if (!merged.prompt || typeof merged.prompt !== 'object') merged.prompt = structuredClone(DEFAULTS.prompt);
    if (!String(merged.prompt.text || '').trim()) merged.prompt.text = DEFAULT_PROMPT_TEXT;
    if (!String(merged.prompt.fullText || '').trim()) merged.prompt.fullText = DEFAULT_FULL_PROMPT_TEXT;
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

/** 设置某角色（名称）的映射；合并保留 voiceDescription 等附加字段，全空则删除该角色 */
export function setCharacterMapping(name, mapping) {
    const map = characterMap();
    const merged = { ...(map[name] || {}), ...(mapping || {}) };
    const cleaned = {};
    for (const [k, v] of Object.entries(merged)) {
        if (v !== undefined && v !== null && String(v).trim() !== '') cleaned[k] = v;
    }
    if (Object.keys(cleaned).length) map[name] = cleaned;
    else delete map[name];
    persist();
}

/** 删除某角色的完整映射（含声音描述） */
export function removeCharacterMapping(name) {
    const map = characterMap();
    if (name && map[name]) { delete map[name]; persist(); }
}

/** 读取某角色已注册的“声音描述”（BTTS-AddRole） */
export function voiceDescriptionOf(name) {
    const map = characterMap();
    if (name && map[name]) return String(map[name].voiceDescription || '').trim();
    return '';
}

export function getCharacterMapping(name) {
    const map = characterMap();
    if (name && map[name]) return map[name];
    return {};
}

/** 依据角色名 + 全局默认，解析最终使用的音色/语言/语速 */
export function resolveParams({ character, voice, language, rate, emotion }) {
    const d = data || DEFAULTS;
    const map = getCharacterMapping(character);
    const finalVoice = String(voice || map.voice || d.defaults.voice || '').trim();
    const finalLanguage = String(language || map.language || d.defaults.language || 'zh-CN').trim() || 'zh-CN';
    const finalRate = rate !== null && rate !== undefined && Number.isFinite(Number(rate))
        ? Math.min(2, Math.max(0.5, Number(rate)))
        : d.rate;
    return {
        voice: finalVoice,
        language: finalLanguage,
        rate: finalRate,
        volume: d.volume,
        emotion: String(emotion || '').trim(),
    };
}
