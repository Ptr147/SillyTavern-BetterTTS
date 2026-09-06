// BetterTTS - 默认配置与常量
// 本文件不依赖 SillyTavern API，可被任何模块安全引用。

export const EXT_NAME = 'BetterTTS';
export const EXT_ID = 'better-tts';
export const SETTINGS_KEY = 'betterTTS';
export const EXT_VERSION = '1.0.0';

/** 主配置默认值（会被深度合并进 extension_settings.betterTTS） */
export const DEFAULTS = {
    schemaVersion: 1,

    // ---- 基本 ----
    enabled: true,            // 总开关
    streaming: false,         // 流式播放：生成过程中边出边读（关闭则整条消息生成完再读）
    perSegment: true,         // 按段朗读：每个语音调用/句子独立合成播放
    readNarration: false,     // 朗读旁白：没有语音调用的纯叙述文本也要朗读
    rate: 1.0,                // 语速（0.5 ~ 2.0）
    volume: 1.0,              // 音量（0 ~ 1）

    // ---- 提示词 ----
    prompt: {
        enabled: true,        // 启用提示词
        inject: true,         // 自动注入到生成提示词
        position: 'in_prompt',// in_prompt | in_chat | after_chat
        text: '',             // 留空时使用内置默认模板
    },

    // ---- 服务商 ----
    provider: 'edge',         // edge | openai | custom
    providers: {
        edge: {
            // 浏览器端动态加载的 Edge TTS 库（@edge-tts/universal）
            moduleUrl: 'https://cdn.jsdelivr.net/npm/@edge-tts/universal@1.4.0/+esm',
            language: 'zh-CN',
        },
        openai: {
            baseUrl: 'http://127.0.0.1:8000/v1', // 例如 GPT-SoVITS / fish-speech / kokoro 等
            apiKey: '',
            model: 'tts-1',
            responseFormat: 'mp3', // mp3 | opus | aac | flac | wav | pcm
            defaultVoice: 'alloy',
            sendInstructions: false, // 发送 instructions（gpt-4o-mini-tts 等支持情感）
            instructionsTemplate: '{{emotion}} 的语气朗读以下内容。',
            voicesUrl: '',       // 可选：GET 返回音色列表的地址
            voicesText: '',      // 手动音色表，每行一个
        },
        custom: {
            name: '我的 TTS 服务',
            method: 'POST',
            url: 'http://127.0.0.1:5000/tts?text={text}&voice={voice}&rate={rate}&lang={language}',
            headers: '{}',
            body: '',
            responseMode: 'audio', // audio | jsonUrl | jsonBase64
            jsonField: 'url',     // responseMode=jsonUrl/jsonBase64 时使用的字段
            voicesUrl: '',        // 可选：返回音色列表的地址
            voicesText: '',
        },
    },

    // ---- 默认发音人/语言（旁白与未配置的角色使用）----
    defaults: {
        voice: '',        // 留空 = 由 language 推断默认音色
        language: 'zh-CN',
    },

    // ---- 角色 → 说话人/语言 映射（跨聊天全局；以角色名称为键）----
    // "__narrator__" 保留键表示旁白/默认行
    characters: {},

    // ---- 高级 ----
    customCss: '',
    debug: false,
};

export const MARKER_START = '[[BetterTTS:';

/** 获取语言列表（用于下拉选择） */
export const LANGUAGES = [
    { code: 'zh-CN', label: '简体中文（普通话）' },
    { code: 'zh-TW', label: '繁體中文（臺灣）' },
    { code: 'zh-HK', label: '繁體中文（香港）' },
    { code: 'en-US', label: 'English (US)' },
    { code: 'en-GB', label: 'English (UK)' },
    { code: 'en-AU', label: 'English (Australia)' },
    { code: 'ja-JP', label: '日本語' },
    { code: 'ko-KR', label: '한국어' },
    { code: 'fr-FR', label: 'Français' },
    { code: 'de-DE', label: 'Deutsch' },
    { code: 'es-ES', label: 'Español' },
    { code: 'it-IT', label: 'Italiano' },
    { code: 'pt-BR', label: 'Português (BR)' },
    { code: 'ru-RU', label: 'Русский' },
    { code: 'ar-EG', label: 'العربية' },
];

export function languageLabel(code) {
    const hit = LANGUAGES.find(x => x.code === code);
    return hit ? hit.label : code || '';
}

/** 默认系统提示词模板（%NARRATOR_NAME%、%CHAR_NAME% 等可被替换） */
export const DEFAULT_PROMPT_TEXT = `# BetterTTS 语音指令

为了让我的台词可以被语音朗读，请遵守以下规则：

## 规则
1. 当角色需要【开口说话/对话】时，请把说话内容输出成下面这种“语音调用”（每句对话一个调用，单独占一行，不要额外解释调用本身）：

[[BetterTTS: {"text":"这句话会被朗读出来","character":"说话的角色名","voice":"","rate":1.0,"emotion":"","language":""}]]

2. 语音调用各字段说明：
   - text：要朗读的完整说话内容，用双引号包裹；内容里不要出现 [[ 或 ]]。
   - character：说话的角色名（与角色卡一致）；不确定就填当前说话角色。
   - voice：希望使用的音色/说话人。留空表示由系统按角色或默认配置决定。想指定时写中文音色名或服务商音色 ID。
   - rate：语速倍率，0.5~2.0 之间的数字，默认 1.0。
   - emotion：情绪（可选）：happy、sad、angry、calm、excited、surprised、fearful、gentle 等，或留空。
   - language：语言代码（可选，如 zh-CN、en-US、ja-JP），留空则按角色语言/默认语言。

3. 【动作、旁白、心理描写、叙述性内容】不要包进语音调用，直接输出普通文本即可，我不会朗读它们。
4. 一次回复里多个角色轮流说话时，请为每个人分别输出语音调用，并正确填写 character。
5. 绝不输出规则本身，也不要解释你在遵守规则。`;

/** 旁白保留键 */
export const NARRATOR_KEY = '__narrator__';
