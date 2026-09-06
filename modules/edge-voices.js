// BetterTTS - Edge TTS 内置音色目录（信息性目录，便于下拉选择与语言默认音色推断）
// 标注的 voice id 为 Microsoft Edge 神经语音。列表可能随微软更新而变化，
// 用户可在“自定义音色（每行一个）”中补充新 id，或在输入框自由填写。

export const EDGE_VOICES = [
    // ---------- 简体中文 zh-CN ----------
    { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 温暖女声', gender: '女', lang: 'zh-CN', styles: ['affectionate', 'angry', 'calm', 'cheerful', 'disgruntled', 'fearful', 'gentle', 'sad', 'serious'] },
    { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 活泼女声', gender: '女', lang: 'zh-CN' },
    { id: 'zh-CN-XiaohanNeural', label: '晓涵 · 温柔女声', gender: '女', lang: 'zh-CN' },
    { id: 'zh-CN-XiaomengNeural', label: '晓梦 · 可爱女声', gender: '女', lang: 'zh-CN' },
    { id: 'zh-CN-XiaomoNeural', label: '晓墨 · 女声', gender: '女', lang: 'zh-CN' },
    { id: 'zh-CN-XiaoqiuNeural', label: '晓秋 · 广播女声', gender: '女', lang: 'zh-CN' },
    { id: 'zh-CN-XiaoruiNeural', label: '晓睿 · 女声', gender: '女', lang: 'zh-CN' },
    { id: 'zh-CN-XiaoshuangNeural', label: '晓双 · 儿童女声', gender: '女', lang: 'zh-CN' },
    { id: 'zh-CN-XiaoxuanNeural', label: '晓萱 · 女声', gender: '女', lang: 'zh-CN' },
    { id: 'zh-CN-XiaoyanNeural', label: '晓颜 · 女声', gender: '女', lang: 'zh-CN' },
    { id: 'zh-CN-XiaoyouNeural', label: '晓悠 · 儿童女声', gender: '女', lang: 'zh-CN' },
    { id: 'zh-CN-YunjianNeural', label: '云健 · 男声', gender: '男', lang: 'zh-CN', styles: ['angry', 'cheerful', 'depressed', 'disgruntled', 'fearful', 'sad', 'serious'] },
    { id: 'zh-CN-YunxiNeural', label: '云希 · 阳光男声', gender: '男', lang: 'zh-CN', styles: ['angry', 'assistant', 'chat', 'cheerful', 'sad', 'serious'] },
    { id: 'zh-CN-YunxiaNeural', label: '云夏 · 少年男声', gender: '男', lang: 'zh-CN' },
    { id: 'zh-CN-YunyangNeural', label: '云扬 · 新闻男声', gender: '男', lang: 'zh-CN', styles: ['angry', 'calm', 'cheerful', 'fearful', 'sad', 'serious'] },
    { id: 'zh-CN-YunfengNeural', label: '云枫 · 男声', gender: '男', lang: 'zh-CN' },
    { id: 'zh-CN-YunhaoNeural', label: '云皓 · 男声', gender: '男', lang: 'zh-CN' },
    { id: 'zh-CN-YunjieNeural', label: '云杰 · 男声', gender: '男', lang: 'zh-CN' },
    { id: 'zh-CN-YunzeNeural', label: '云泽 · 男声', gender: '男', lang: 'zh-CN' },
    { id: 'zh-CN-XiaobeiNeural', label: '晓北 · 东北女声', gender: '女', lang: 'zh-CN' },
    { id: 'zh-CN-XiaoniNeural', label: '晓妮 · 陕西女声', gender: '女', lang: 'zh-CN' },

    // ---------- 繁体中文 ----------
    { id: 'zh-HK-HiuGaaiNeural', label: '曉佳 · 粵語女聲', gender: '女', lang: 'zh-HK' },
    { id: 'zh-HK-HiuMaanNeural', label: '曉曼 · 粵語女聲', gender: '女', lang: 'zh-HK' },
    { id: 'zh-HK-WanLungNeural', label: '雲龍 · 粵語男聲', gender: '男', lang: 'zh-HK' },
    { id: 'zh-TW-HsiaoChenNeural', label: '曉臻 · 台灣女聲', gender: '女', lang: 'zh-TW' },
    { id: 'zh-TW-HsiaoYuNeural', label: '曉雨 · 台灣女聲', gender: '女', lang: 'zh-TW' },
    { id: 'zh-TW-YunJheNeural', label: '雲哲 · 台灣男聲', gender: '男', lang: 'zh-TW' },

    // ---------- English ----------
    { id: 'en-US-AriaNeural', label: 'Aria (US female)', gender: '女', lang: 'en-US', styles: ['angry', 'cheerful', 'empathetic', 'excited', 'friendly', 'hopeful', 'sad', 'shouting', 'terrified', 'unfriendly', 'whispering'] },
    { id: 'en-US-JennyNeural', label: 'Jenny (US female)', gender: '女', lang: 'en-US', styles: ['angry', 'assistant', 'chat', 'cheerful', 'excited', 'friendly', 'hopeful', 'newscast', 'sad', 'shouting', 'terrified', 'unfriendly', 'whispering'] },
    { id: 'en-US-MichelleNeural', label: 'Michelle (US female)', gender: '女', lang: 'en-US' },
    { id: 'en-US-AnaNeural', label: 'Ana (US child)', gender: '女', lang: 'en-US' },
    { id: 'en-US-GuyNeural', label: 'Guy (US male)', gender: '男', lang: 'en-US', styles: ['angry', 'cheerful', 'excited', 'friendly', 'hopeful', 'newscast', 'sad', 'shouting', 'terrified', 'unfriendly', 'whispering'] },
    { id: 'en-US-ChristopherNeural', label: 'Christopher (US male)', gender: '男', lang: 'en-US', styles: ['angry', 'cheerful', 'excited', 'friendly', 'hopeful', 'sad', 'shouting', 'terrified', 'unfriendly', 'whispering'] },
    { id: 'en-US-EricNeural', label: 'Eric (US male)', gender: '男', lang: 'en-US' },
    { id: 'en-US-RogerNeural', label: 'Roger (US male)', gender: '男', lang: 'en-US' },
    { id: 'en-US-SteffanNeural', label: 'Steffan (US male)', gender: '男', lang: 'en-US' },
    { id: 'en-US-AndrewNeural', label: 'Andrew (US male)', gender: '男', lang: 'en-US' },
    { id: 'en-US-EmmaNeural', label: 'Emma (US female)', gender: '女', lang: 'en-US' },
    { id: 'en-US-BrianNeural', label: 'Brian (US male)', gender: '男', lang: 'en-US' },
    { id: 'en-US-AvaNeural', label: 'Ava (US female)', gender: '女', lang: 'en-US' },
    { id: 'en-US-JennyMultilingualNeural', label: 'Jenny Multilingual', gender: '女', lang: 'en-US' },
    { id: 'en-US-AriaMultilingualNeural', label: 'Aria Multilingual', gender: '女', lang: 'en-US' },
    { id: 'en-GB-SoniaNeural', label: 'Sonia (UK female)', gender: '女', lang: 'en-GB' },
    { id: 'en-GB-LibbyNeural', label: 'Libby (UK female)', gender: '女', lang: 'en-GB' },
    { id: 'en-GB-RyanNeural', label: 'Ryan (UK male)', gender: '男', lang: 'en-GB' },
    { id: 'en-GB-ThomasNeural', label: 'Thomas (UK male)', gender: '男', lang: 'en-GB' },
    { id: 'en-GB-MaisieNeural', label: 'Maisie (UK child)', gender: '女', lang: 'en-GB' },
    { id: 'en-AU-NatashaNeural', label: 'Natasha (AU female)', gender: '女', lang: 'en-AU' },
    { id: 'en-AU-WilliamNeural', label: 'William (AU male)', gender: '男', lang: 'en-AU' },

    // ---------- 日韩 ----------
    { id: 'ja-JP-NanamiNeural', label: 'Nanami（ななみ · 女声）', gender: '女', lang: 'ja-JP' },
    { id: 'ja-JP-KeitaNeural', label: 'Keita（けいた · 男声）', gender: '男', lang: 'ja-JP' },
    { id: 'ko-KR-SunHiNeural', label: 'SunHi（선히 · 女声）', gender: '女', lang: 'ko-KR' },
    { id: 'ko-KR-InJoonNeural', label: 'InJoon（인준 · 男声）', gender: '男', lang: 'ko-KR' },
    { id: 'ko-KR-HyunsuNeural', label: 'Hyunsu（현수 · 男声）', gender: '男', lang: 'ko-KR' },

    // ---------- 欧洲 ----------
    { id: 'fr-FR-DeniseNeural', label: 'Denise (FR female)', gender: '女', lang: 'fr-FR' },
    { id: 'fr-FR-HenriNeural', label: 'Henri (FR male)', gender: '男', lang: 'fr-FR' },
    { id: 'de-DE-KatjaNeural', label: 'Katja (DE female)', gender: '女', lang: 'de-DE' },
    { id: 'de-DE-ConradNeural', label: 'Conrad (DE male)', gender: '男', lang: 'de-DE' },
    { id: 'es-ES-ElviraNeural', label: 'Elvira (ES female)', gender: '女', lang: 'es-ES' },
    { id: 'es-ES-AlvaroNeural', label: 'Álvaro (ES male)', gender: '男', lang: 'es-ES' },
    { id: 'es-MX-DaliaNeural', label: 'Dalia (MX female)', gender: '女', lang: 'es-MX' },
    { id: 'es-MX-JorgeNeural', label: 'Jorge (MX male)', gender: '男', lang: 'es-MX' },
    { id: 'it-IT-ElsaNeural', label: 'Elsa (IT female)', gender: '女', lang: 'it-IT' },
    { id: 'it-IT-DiegoNeural', label: 'Diego (IT male)', gender: '男', lang: 'it-IT' },
    { id: 'pt-BR-FranciscaNeural', label: 'Francisca (BR female)', gender: '女', lang: 'pt-BR' },
    { id: 'pt-BR-AntonioNeural', label: 'Antônio (BR male)', gender: '男', lang: 'pt-BR' },
    { id: 'ru-RU-SvetlanaNeural', label: 'Svetlana (RU female)', gender: '女', lang: 'ru-RU' },
    { id: 'ru-RU-DmitryNeural', label: 'Dmitry (RU male)', gender: '男', lang: 'ru-RU' },
    { id: 'ar-EG-SalmaNeural', label: 'Salma (EG female)', gender: '女', lang: 'ar-EG' },
    { id: 'ar-EG-ShakirNeural', label: 'Shakir (EG male)', gender: '男', lang: 'ar-EG' },
];

/** 常用语言 → 默认 Edge 音色（按语言代码回退链） */
const DEFAULT_VOICE_BY_LANG = {
    'zh-CN': 'zh-CN-XiaoxiaoNeural',
    'zh-TW': 'zh-TW-HsiaoChenNeural',
    'zh-HK': 'zh-HK-HiuGaaiNeural',
    'en-US': 'en-US-AriaNeural',
    'en-GB': 'en-GB-SoniaNeural',
    'en-AU': 'en-AU-NatashaNeural',
    'ja-JP': 'ja-JP-NanamiNeural',
    'ko-KR': 'ko-KR-SunHiNeural',
    'fr-FR': 'fr-FR-DeniseNeural',
    'de-DE': 'de-DE-KatjaNeural',
    'es-ES': 'es-ES-ElviraNeural',
    'it-IT': 'it-IT-ElsaNeural',
    'pt-BR': 'pt-BR-FranciscaNeural',
    'ru-RU': 'ru-RU-SvetlanaNeural',
    'ar-EG': 'ar-EG-SalmaNeural',
};

const FALLBACK = 'zh-CN-XiaoxiaoNeural';

export function edgeVoiceById(id) {
    if (!id) return null;
    return EDGE_VOICES.find(v => v.id === id) || null;
}

/** 按语言取默认音色；语言前缀不匹配时逐级回退到 zh-CN */
export function defaultVoiceForLanguage(lang) {
    if (!lang) return FALLBACK;
    if (DEFAULT_VOICE_BY_LANG[lang]) return DEFAULT_VOICE_BY_LANG[lang];
    const base = lang.split('-')[0];
    const hit = Object.keys(DEFAULT_VOICE_BY_LANG).find(k => k.startsWith(base + '-'));
    return hit ? DEFAULT_VOICE_BY_LANG[hit] : FALLBACK;
}

/** 组装语言下可用的音色；lang 为空返回全部 */
export function listEdgeVoices(lang) {
    if (!lang) return EDGE_VOICES.slice();
    const list = EDGE_VOICES.filter(v => v.lang === lang);
    return list.length ? list : EDGE_VOICES.slice();
}
