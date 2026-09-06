// BetterTTS - 提示词管理（模板选择 + 注入）

import { DEFAULT_PROMPT_TEXT } from './defaults.js';

/** 取当前生效的提示词文本 */
export function promptTextOf(s) {
    const t = s?.prompt?.text;
    return (typeof t === 'string' && t.trim()) ? t : DEFAULT_PROMPT_TEXT;
}

export function promptEnabled(s) {
    return !!(s?.prompt?.enabled && s?.enabled);
}

export function promptShouldInject(s) {
    return !!(s?.prompt?.inject && s?.enabled);
}

/** 注入位置数值映射（与 ST extension_prompt_types 兼容：0=IN_PROMPT,1=IN_CHAT,2=AFTER_CHAT） */
export function positionNumber(s) {
    const map = { in_prompt: 0, in_chat: 1, after_chat: 2 };
    return map[s?.prompt?.position] ?? 0;
}

/**
 * 把提示词注册进 ST 的扩展提示词系统。
 * @returns {Promise<{ok:boolean, method:string|null}>}
 */
export async function registerInjection(s, { getName }) {
    const ok = { ok: false, method: null };
    try {
        // 1) 新版全局（若有 setExtensionPrompt 相关 API 则尝试）
        const g = globalThis.SillyTavern;
        const candidates = [];
        if (g && typeof g.setExtensionPrompt === 'function') candidates.push(() => g.setExtensionPrompt(getName(), promptTextOf(s), positionNumber(s)));
        // 2) getContext().setExtensionPrompt（旧版兼容）
        if (g && typeof g.getContext === 'function') {
            const ctx = g.getContext();
            if (ctx && typeof ctx.setExtensionPrompt === 'function') {
                candidates.push(() => ctx.setExtensionPrompt(getName(), promptTextOf(s), positionNumber(s)));
            }
        }
        for (const fn of candidates) {
            try {
                fn();
                ok.ok = true;
                ok.method = candidates.indexOf(fn) === 0 ? 'SillyTavern' : 'getContext';
                break;
            } catch { /* try next */ }
        }
    } catch { /* ignore */ }
    return ok;
}

/** 供手动注入不生效时提示的说明文本 */
export function injectionNotice() {
    return '自动注入失败：当前 SillyTavern 未提供扩展提示词注入接口。\n' +
        '请把“提示词内容”复制进：扩展面板 → 聊天补全/主提示词，或系统提示词（角色卡描述前的提示词）。';
}
