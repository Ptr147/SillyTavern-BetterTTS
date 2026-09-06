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
    rateLock: false,          // 语速锁定：忽略函数调用里的 rate，统一使用上面语速
    volume: 1.0,              // 音量（0 ~ 1）

    // ---- 提示词 ----
    prompt: {
        enabled: true,        // 启用提示词
        inject: true,         // 自动注入到生成提示词
        position: 'in_prompt',// in_prompt | in_chat | after_chat
        mode: 'line',         // 合成模式：line=说话（函数调用分句） | full=全文朗读（只读标签内全文）
        text: '',             // 说话模式提示词（留空时自动填内置模板）
        fullText: '',         // 全文模式提示词（留空时自动填内置模板）
        fullTagsOpen: '<context>',    // 全文模式读取起始标签（可配置）
        fullTagsClose: '</context>',  // 全文模式读取结束标签（可配置）
        fullFallbackNoTags: true,     // 全文模式未找到标签时是否朗读整条内容
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
            defaultVoice: '',     // 默认留空：请求体不带 voice，使用服务端默认音色
            autoInstructions: true, // 自动把“角色声音描述 + 情绪”拼接为系统指令 instructions 发送
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
export const ROLE_MARK_START = '[[BetterTTS-AddRole:';

/** 旁白保留键 */
export const NARRATOR_KEY = '__narrator__';

/** 语言名称/别称（角色调用 character 可能写“旁白”“叙述者”） */
export const NARRATOR_ALIASES = [NARRATOR_KEY, '旁白', '叙述者', '旁述'];

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

/** 说话模式默认提示词模板（函数调用使用 BTTS / BTTS-AddRole） */
export const DEFAULT_PROMPT_TEXT = `# BTTS 语音指令

通过“函数调用”标记台词与角色音色，方便被前端渲染成可点击朗读的气泡。请严格遵守：

## 一、注册角色音色 BTTS-AddRole（角色首次发声前调用一次）
角色第一次开口前，先单独一行输出注册调用，用“声音描述”定义其音色：

[[BTTS-AddRole: {"character":"小林","voice":"25岁男性上班族，声音清亮但时常犹豫，语速时快时慢，紧张时会轻微结巴……"}]]

- 旁白也可以注册（character 写“旁白”）。
- 角色音色发生变化（长大、变声、黑化、剧情状态改变）时，再次调用同角色的 BTTS-AddRole 即可覆盖。
- 注册本身不会发声，只作为该角色后续语音的风格指令。

## 二、语音调用 BTTS（角色开口说话时）
把台词输出为如下调用，每句单独一行：

[[BTTS: {"text":"这句话会被朗读出来","character":"说话的角色名","voice":"","rate":1.0,"emotion":"","language":""}]]

字段说明：
- text：必填。要朗读的完整台词，纯文本，不要包含 [[ 或 ]]。
- character：说话角色名（与角色卡或 BTTS-AddRole 注册一致）；不确定就填当前说话角色。
- voice：具体音色/说话人 ID（可选）。留空则按：注册的声音描述 → 角色映射 → 默认设置推断。
- rate：语速倍率 0.5~2.0，默认 1.0。
- emotion：语气描述（可选），写成一两句自然语言即可，例如：
  “请特别小声地悄悄说、音调低沉” / “用特别愤怒的语气说” / “以极度悲伤、带着明显哭腔的语气”。
  系统会把“该角色已注册的声音描述 + 这句情绪描述”拼成指令发送给语音引擎。
- language：语言代码（可选，如 zh-CN、en-US、ja-JP）。

## 三、其它
- 动作、旁白、心理、叙述内容：不要包进语音调用，直接输出普通文本即可。
- 多人对话：每个人分别输出语音调用，character 填对。
- 不要解释本规则，也不要输出规则本身。`;

/** 全文模式默认提示词模板（段落级 BTTS-TEXT） */
export const DEFAULT_FULL_PROMPT_TEXT = `# BTTS 全文朗读指令（全文模式 · 段落级）

当前处于“全文朗读”模式，请这样输出：

1. 把回复内容按**自然段落**组织（一段叙述 + 其中的动作/对话整体为一段；视角或场景变化时另起一段）。
2. **每个段落输出一次段落调用**，整段内容放进 text；如段落里有多个角色说话/旁白，请在 roles 中列出本段涉及的角色与各自情绪，供语音合成时参考语气：

[[BTTS-TEXT: {"text":"整段文字……包括叙述、动作与所有角色的台词，语言自然、连贯、可朗读。","roles":[{"character":"旁白","emotion":"沉稳平缓"},{"character":"小林","emotion":"犹豫、结巴"},{"character":"御姐","emotion":"自信中带一丝挑逗"}]}]]

3. 规则：
   - text 必填，为该段“将被从头朗读”的完整内容；不要使用 [[BTTS: …]] 分句调用。
   - roles 可选但推荐：列出本段涉及到的角色名与语气描述；系统会把每个角色已注册的声音描述（BTTS-AddRole）+ 这里的情绪拼成指令发给语音引擎。
   - 纯叙述、无角色台词/旁白的段落可省略 roles 或写 [{"character":"旁白"}]。
   - 一次回复通常输出 1~5 个段落调用；不要在调用外输出正文。
4. 不要解释本规则。`;
