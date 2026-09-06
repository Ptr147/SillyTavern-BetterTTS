// BetterTTS - 提示词管理（模板选择 + 注入）

import { DEFAULT_PROMPT_TEXT, DEFAULT_FULL_PROMPT_TEXT } from './defaults.js';

/** 当前合成模式：line（说话/函数分句）| full（全文朗读） */
export function modeOf(s) {
    return s?.prompt?.mode === 'full' ? 'full' : 'line';
}

/** 取当前生效的提示词文本（按合成模式选择对应模板） */
export function promptTextOf(s) {
    if (modeOf(s) === 'full') {
        const t = s?.prompt?.fullText;
        return (typeof t === 'string' && t.trim()) ? t : DEFAULT_FULL_PROMPT_TEXT;
    }
    const t = s?.prompt?.text;
    return (typeof t === 'string' && t.trim()) ? t : DEFAULT_PROMPT_TEXT;
}

export function promptEnabled(s) {
    return !!(s?.prompt?.enabled && s?.enabled);
}

export function promptShouldInject(s) {
    return !!(s?.prompt?.inject && s?.enabled);
}

/**
 * 注入位置数值映射（与 ST 扩展提示词 position 兼容：
 * 0≈主提示词区（同 persona/记忆），1≈聊天故事区，2≈聊天后）
 */
export function positionNumber(s) {
    const map = { in_prompt: 0, in_chat: 1, after_chat: 2 };
    return map[s?.prompt?.position] ?? 0;
}

/**
 * 把提示词注册进 ST 的扩展提示词系统。
 * 现代 ST 签名：setExtensionPrompt(key, value, position, depth, scan=false, role=SYSTEM, filter=null)
 * 注意 depth 为必填数值（漏传会得到 NaN 导致条目被丢弃）。
 * @param {object} s 当前设置
 * @param {{getName:()=>string, getContext?:()=>object}} opts
 * @returns {Promise<{ok:boolean, method?:string, error?:string, entry?:object}>}
 */
export async function registerInjection(s, { getName, getContext } = {}) {
    const out = { ok: false };
    if (!promptEnabled(s) || !promptShouldInject(s)) return out;
    const text = promptTextOf(s);
    const position = positionNumber(s);
    const key = getName ? getName() : 'BetterTTS';
    try {
        const g = globalThis.SillyTavern;
        const ctx = (typeof getContext === 'function' && getContext())
            || (g && typeof g.getContext === 'function' ? g.getContext() : null);

        if (!ctx || typeof ctx.setExtensionPrompt !== 'function') {
            out.error = '当前 ST 上下文中没有 setExtensionPrompt()';
            return out;
        }

        // key, value, position, depth, scan, role(默认 SYSTEM), filter
        ctx.setExtensionPrompt(key, text, position, 0);

        // 读回校验：确认条目真的写入且参数有效
        const entry = ctx.extensionPrompts && ctx.extensionPrompts[key];
        const depthOk = entry && Number.isFinite(Number(entry.depth));
        const valueOk = entry && String(entry.value ?? '').trim().length > 0;
        out.ok = !!entry && depthOk && valueOk;
        out.method = 'ctx.setExtensionPrompt(key,value,position,depth=0)';
        out.entry = entry ? {
            position: Number(entry.position),
            depth: Number(entry.depth),
            role: Number(entry.role),
            scan: !!entry.scan,
            valueLen: String(entry.value ?? '').length,
        } : null;
        if (!out.ok) out.error = '调用后未能读到有效条目（extensionPrompts["' + key + '"] 为空或参数无效）';
        return out;
    } catch (e) {
        out.error = String(e?.message || e);
        return out;
    }
}

/** 供手动注入不生效时提示的说明文本 */
export function injectionNotice() {
    return '自动注入失败：当前 SillyTavern 未提供可用的 setExtensionPrompt 接口，或写入后未生效。\n' +
        '请把“提示词内容”复制进：扩展面板 → Prompt Manager / 主提示词（系统提示词），再发给作者控制台日志以便修复。';
}
