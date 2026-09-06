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
    synthTimeout: 45,         // TTS 合成超时（秒，5~300）

    // ---- 提示词 ----
    prompt: {
        enabled: true,        // 启用提示词
        inject: true,         // 自动注入到生成提示词
        position: 'in_prompt',// in_prompt | in_chat | after_chat
        mode: 'line',         // 合成模式：line=说话（函数调用分句） | full=全文朗读（BTTS-TEXT 段落）
        text: '',             // 说话模式提示词（留空时自动填内置模板）
        fullText: '',         // 全文模式提示词（留空时自动填内置模板）
        roleText: '',         // 角色注册系统提示词（BTTS-AddRole，独立、默认注入）
        roleInject: true,     // 默认注入角色注册规则（两种模式都注入）
        fullTagsOpen: '<context>',    // 兼容保留（旧全文方案不再使用）
        fullTagsClose: '</context>',
        fullFallbackNoTags: true,
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
        voice: '',            // 留空 = 由 language 推断默认音色
        language: 'zh-CN',
        narratorVoice: '',    // 旁白默认声音描述（旁白/未注册角色朗读时作为系统指令，留空则不附加）
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
export const DEFAULT_PROMPT_TEXT = `# BTTS 语音指令（说话模式）

台词需要用“语音调用”标记，前端会渲染成可点击朗读的气泡。请严格遵守：

## 一、角色音色注册
系统提示词中已包含“BTTS-AddRole 角色注册规则”。若某个角色此前从未注册过声音，请按该规则在它第一次发声前注册一次（注册行不会发声、不会显示）。
已经注册过的角色不需要重复注册；角色音色变化（长大/变声/黑化等）时再注册一次即可覆盖。

## 二、语音调用 BTTS（角色开口说话时）
把台词输出为如下调用，每句单独一行：

[[BTTS: {"text":"这句话会被朗读出来","character":"说话的角色名","voice":"","rate":1.0,"emotion":"","language":""}]]

字段说明：
- text：必填。要朗读的完整台词，纯文本，不要包含 [[ 或 ]]。
- character：说话角色名（与角色卡或注册一致）；不确定就填当前说话角色。
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

/** 角色注册系统提示词（BTTS-AddRole，独立注入、两种模式默认都带）
 *  关键设计：voice 只保留角色【长期/稳定】的声音特质；
 *  一切临时性/环境/情绪相关因素不写进注册，改用说话时的 emotion / roles[].emotion 表达。 */
export const DEFAULT_ROLE_PROMPT_TEXT = `# BTTS 角色音色注册规则（BTTS-AddRole）

角色第一次开口前，用一次“角色注册调用”描述它**长期稳定的声音特质**（单独一行；注册不会发声、不会在界面显示）：

[[BTTS-AddRole: {"character":"角色名","voice":"长期声音特质描述"}]]

## voice 里只允许“长期/稳定”的声音设定，例如：
- 音色与音质：清亮、沙哑、磁性、稚嫩、低沉、偏冷、甜美、厚实……
- 稳定习惯：年龄感、性别感、基础语速与音调习惯、常驻语气底色（懒散/干脆/温柔/硬朗……）、口头禅、典型停顿节奏。

## 禁止写进 voice 的“临时性 / 受环境或情绪影响”的元素（一律删掉）：
- 紧张时的结巴、愤怒或哭泣时的音调、撒娇/醉酒/黑化时的声音、受伤虚弱、场合性压低声音、此刻的疲惫或激动……
- 以上临时语气不放入注册，而是放到角色说话时的 **emotion** 字段（说话模式）
  或段落调用 **roles[].emotion**（全文模式）里表达，由系统拼成当次的语气指令。

## 其它规则：
1. 覆盖：仅当角色**长期**声音发生改变（如长大、永久性变声、性格彻底转变）时，再注册一次同角色即可覆盖。
2. 旁白、叙述者用 character=“旁白”注册。
3. 注册调用不要出现在台词气泡中，也不代替说话内容；未注册的角色也能说话（用默认/映射音色，只是缺专属声音指导）。
4. 不要解释本规则。`;

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
