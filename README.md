# 🔊 BetterTTS — SillyTavern 语音朗读扩展

让 AI 角色真正“开口说话”的 SillyTavern 扩展：

- 通过**可编辑/导入/导出的提示词**，引导模型把角色台词输出为一种“函数调用”：
  `[[BetterTTS: {"text":"这句话会被朗读","character":"角色名","voice":"","rate":1.0,"emotion":"","language":""}]]`
- 前端用**正则把函数调用替换成漂亮的语音卡片**：显示说话内容、右上角小字时间，
  **点击播放/暂停**，**右键菜单可复制完整函数调用原文**（或语音文本）。
- 在输入栏底部注入 **“BetterTTS-角色”** 按钮：弹窗为不同角色指定**说话人（音色）与语言**。
- **适配器式 TTS 接入**：内置 Edge TTS（免费/浏览器直连）、OpenAI 兼容接口、自定义 HTTP 接口，
  并提供**获取音色列表**能力；新增服务商只需实现一个小适配器。
- 全部设置位于 SillyTavern 自带扩展配置中，支持**全部配置一键导出 / 导入 / 恢复默认**。

---

## ✨ 功能对照

| 需求 | 实现 |
| --- | --- |
| 配置位于 ST 自带扩展配置，全量导入导出 | ✅ 扩展面板挂载 + ⚙ 弹窗；导出/导入/重置一个 JSON 搞定（含角色映射、提示词、服务商参数、自定义 CSS） |
| 开关 | ✅ `启用 BetterTTS` |
| 流式播放 | ✅ 生成过程中“边出边读”（逐条朗读已完成调用）；关闭则等整条消息完成后再朗读 |
| 按段朗读 | ✅ 每个语音调用/句子独立合成播放；关闭则同音色连续内容合并为整段 |
| 朗读旁白 | ✅ 朗读角色消息里没有语音调用的纯叙述文本（用“旁白/默认”音色），可配合按段朗读按句切分 |
| 语速调节 | ✅ 0.5–2.0 滑动条（调用内 `rate` 字段可覆盖） |
| 音量调节 | ✅ 0–100%（调用内 `volume` 字段可覆盖） |
| 提示词编辑/导入/导出 | ✅ 文本框 + 恢复默认模板 / 复制 / 导出 .txt / 导入 .txt|.json + 可选**自动注入** |
| 内容渲染（美观简洁、跟随主题） | ✅ 语音卡片使用 ST 主题变量（深/浅色通用），支持自定义 CSS |
| 函数调用 → 前端渲染卡片 | ✅ 卡片含说话内容、右上角时间；点击播放/暂停；右键复制完整调用 |
| 底部选项栏“BetterTTS-角色”弹窗 | ✅ 为不同角色指定说话人/语言；含试听按钮 |
| TTS API 接入、多服务商、获取音色 | ✅ Edge / OpenAI 兼容 / 自定义 HTTP；`获取音色列表` 按钮 + 音色下拉 |

---

## 📦 安装

1. 找到 SillyTavern 的扩展目录 `SillyTavern/public/scripts/extensions/`。
   - **新版（≥1.12，推荐）**：第三方扩展放在其 `third-party/` 子目录，
     即最终路径为 `public/scripts/extensions/third-party/better-tts/index.js`；
   - 旧版/直接拷贝：`public/scripts/extensions/better-tts/index.js` 亦可（扩展会自动探测两种深度）。
2. 把本仓库**整个目录**复制为 `better-tts/`（目录内应直接包含 `index.js`、`style.css`、`manifest.json`、`modules/`）。
3. **重启 SillyTavern 服务端**（不是仅刷新页面；新增扩展需要服务端重启后才会被加载/激活）。
4. 打开浏览器控制台（F12）应能看到 `[BetterTTS] 模块已加载` 日志；扩展面板出现 BetterTTS 配置、聊天底部输入栏出现 `🔊 BetterTTS-角色` 与 `⚙` 按钮即安装成功。

> 要求 **SillyTavern ≥ 1.12**。若安装后无任何入口，请按控制台 `[BetterTTS]` 日志排查（见“常见问题”）。

---

## 🚀 快速开始

1. **启用扩展**：默认已启用。
2. **选服务商**：设置 → TTS 服务商。
   - 零配置体验：保持 **Edge TTS**（免费；需浏览器能访问 jsDelivr 等 CDN）。
   - 自建/本地服务：选 **OpenAI 兼容接口**，填 `baseUrl`（例如 `http://127.0.0.1:9880/v1`）。
3. **提示词**：默认开启“启用提示词 + 自动注入”。若你的 ST 不支持自动注入（见控制台提示），
   请手动把“提示词内容”粘贴到：**扩展 → 聊天补全 → 主提示词** 或角色系统提示词中。
4. **试试**：发送一句消息让角色说话，AI 会输出 `[[BetterTTS: {...}]]`，前端自动渲染成语音卡片并朗读。

### 语音卡片交互

| 操作 | 效果 |
| --- | --- |
| 单击卡片 | 播放 / 暂停该段语音 |
| 右键卡片 | 菜单：播放/暂停、立即朗读（打断当前）、**复制完整函数调用**、复制语音文本、停止朗读 |
| 右上角小字 | 该段语音生成时的时间 |

### 函数调用格式（模型输出）

```
[[BetterTTS: {"text":"要朗读的完整台词","character":"说话角色名","voice":"","rate":1.0,"emotion":"happy","language":"zh-CN"}]]
```

字段说明：

| 字段 | 含义 |
| --- | --- |
| `text` | 必填。要朗读的台词（纯文本，不要含 `[[` / `]]`） |
| `character` | 说话角色名（用于匹配“角色→说话人”映射） |
| `voice` | 音色/说话人 ID；留空则按角色映射 → 默认设置 → 按语言自动选择 |
| `rate` | 语速倍率 0.5–2.0（默认 1.0） |
| `emotion` | 情绪标签，如 happy/sad/angry/calm/excited/gentle…（支持的服务商可传递；Edge 目录音色含 styles 时也可直接写风格名） |
| `language` | 语言代码，如 zh-CN / en-US / ja-JP；留空按角色语言/默认语言 |

**优先级**：调用内显式字段 > 角色映射（BetterTTS-角色 弹窗）> 全局默认（设置 → 角色映射）> 按语言自动选择默认音色。

> 旁白不要包进调用：直接输出普通文本。开启“朗读旁白”后，它会以“旁白/默认”音色被朗读。

---

## 🎭 BetterTTS-角色（底部按钮）

输入栏下方的 **🔊 BetterTTS-角色** 按钮弹窗里：

- 自动列出本聊天中的角色（也可保存任意角色名，切换聊天后仍生效）。
- 每行可设 **音色（可搜索/自由输入，带当前服务商音色联想）** 与 **语言**；
  **▶ 试听**；**✕** 清除该行映射。
- 首行“旁白 / 默认”配置旁白与未映射角色使用的发音。
- “⟳ 获取音色”重新拉取当前服务商音色列表。

---

## 🧩 TTS 适配器

统一接口（见 `modules/providers.js`）：

```text
synthesize(request) → { ok, blobs: [{blob, mime}] }   // 合成
loadVoices(settings) → { ok, voices: [{id,label,group}] } // 获取音色
```

request = `{ text, voice, language, rate, emotion, character }`。

### 1) Edge TTS（默认，免费，浏览器直连）
- 无需 API Key。运行时会从 CDN 加载开源库 `@edge-tts/universal`（jsDelivr → unpkg → esm.sh 依次尝试）。
- 设置里可修改 `moduleUrl` 换镜像/自托管地址；`补充音色` 可追加目录外的 voice id。
- ⚠️ 依赖浏览器访问上述 CDN 的能力。若网络受限，**推荐改用 2/3 的本地服务**，
  或给本地 Edge 语音网关配一个 OpenAI 兼容层。

### 2) OpenAI 兼容接口（推荐用于 GPT-SoVITS / fish-speech / kokoro / CosyVoice 等）
- `baseUrl` + `model` + `defaultVoice`，按 `POST {base}/audio/speech` 调用，
  请求体为 OpenAI 格式（`input/voice/speed`…），支持 Bearer `apiKey`。
- GPT-SoVITS 系服务一般监听如 `http://127.0.0.1:9880`，请在服务面板确认其 OpenAI 兼容地址后填入。
- 支持 `instructions`（模型支持时传递情绪等指令）；`voicesUrl` 可指向返回音色列表的接口。

### 3) 自定义 HTTP 接口
- `URL / Headers / Body` 均支持占位符：`{text} {voice} {language} {lang} {rate} {volume} {emotion} {character}`。
- 响应三种模式：`audio`（响应体即音频）、`jsonUrl`（JSON 字段为音频地址，可 `a.b.c` 取深路径）、`jsonBase64`。
- `voicesUrl`（GET JSON：字符串数组 / `{id:[...]}` / `{voices:[...]}` 均可）用于“获取音色”。

---

## ⚙️ 设置详解

打开方式：扩展面板中本扩展的设置区，或输入栏 ⚙ 按钮，或 `/bettertts-settings`。

- **基本设置**：启用 / 流式播放 / 按段朗读 / 朗读旁白 / 语速 / 音量。
- **TTS 服务商**：选择服务商 → 切换对应参数；`获取音色列表`。
- **角色映射**：全局默认音色/语言（也可在 BetterTTS-角色 中配置）。
- **提示词**：编辑框（空=内置模板）；恢复默认/复制/导出(.txt)/导入(.txt|.json)；
  `自动注入` 时扩展会把提示词注册进 ST 扩展提示词系统（`in_prompt` 等位置可选）。
- **高级**：自定义 CSS（作用于语音卡片/弹窗，会随配置导出）、调试日志。
- **数据**：**导出全部配置**（一个 JSON：所有开关、服务商参数、角色映射、提示词、自定义 CSS）、
  **导入全部配置**、**恢复默认**。

斜杠命令：`/bettertts`（打开角色弹窗）、`/bettertts-settings`、`/bettertts-stop`。

---

## 🛠 开发

```
├─ index.js              入口：加载、事件、自动朗读编排、底部栏、弹窗、斜杠命令
├─ style.css             全部样式（跟随 ST 主题变量，可被自定义 CSS 覆盖）
├─ manifest.json         扩展元信息
├─ modules/
│  ├─ defaults.js        默认配置 & 内置提示词模板 & 语言表
│  ├─ settings.js        配置读写/深度合并/导入导出/角色映射解析
│  ├─ settings-ui.js     设置界面（可多实例：扩展面板 + 弹窗）
│  ├─ parser.js          函数调用正则解析（引号/花括号感知收尾）
│  ├─ renderer.js        .mes_text 内正则替换为卡片 + MutationObserver
│  ├─ player.js          朗读队列（顺序/暂停/插队/逐 blob）
│  ├─ providers.js       TTS 适配器（edge/openai/custom）+ 音色获取
│  ├─ edge-voices.js     Edge 音色目录与按语言默认音色
│  ├─ charpopup.js       BetterTTS-角色 弹窗
│  ├─ prompt.js          提示词读取/自动注入
│  └─ util.js            工具函数
```

测试：`node .research/smoke.mjs`（纯逻辑自测：解析器 / 配置合并 / 角色解析 / 词表）。
所有 JS 以 ES Module 编写，`node --check` 通过；运行前请确认放置于
`public/scripts/extensions/` 目录内（其相对 `../../` 依赖 ST 结构）。

---

## ❓ 常见问题

- **完全没有任何 BetterTTS 入口（扩展面板/底部栏都没有）**：先在浏览器控制台看有没有 `[BetterTTS]` 日志。
  没有 → 扩展根本没被加载：确认目录是 `public/scripts/extensions/third-party/<名字>/index.js`（新版）或
  `public/scripts/extensions/<名字>/index.js`（旧版），并**重启了 SillyTavern 服务端**（不是仅刷新页面）；
  有红色报错 → 把报错内容发到 Issue。
- **不朗读 / 没出现卡片**：确认扩展“启用”；模型是否真的输出了 `[[BetterTTS: {...}]]`；
  若用旧消息/切换聊天，卡片只对新消息自动渲染（点卡片可手动播）。
- **提示词没生效（自动注入失败）**：控制台会有一次警告。请手动把提示词放进主提示词/系统提示词。
- **Edge 报“无法加载 @edge-tts/universal”**：浏览器访问不了 CDN（或 CORS），换 `moduleUrl`/镜像，
  或改用本地 OpenAI 兼容服务。
- **“浏览器阻止了自动播放”**：浏览器自动播放策略；先点击页面任意位置一次，
  或直接点卡片手动播放（Toast 会提示）。
- **音色不对**：按“优先级”链路检查：调用字段 → BetterTTS-角色 行 → 默认设置；
  角色名需与角色卡名称一致。
- **想恢复原始文本**：关闭“启用”会立刻把已渲染卡片还原为原始函数调用文本。

## 📄 License / 双许可

BetterTTS 采用 **双许可（Dual-License）** 策略：

### 1. 开源社区 — GPL-3.0

对开源社区与个人用户，BetterTTS 以 [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html)
（SPDX: `GPL-3.0-only`）发布，允许自由使用、修改与分发。
GPL 是“传染性”协议：若你基于/集成本软件发布衍生作品，该作品也须以 GPL 兼容许可开源。
官方完整文本：[gpl-3.0.txt](https://www.gnu.org/licenses/gpl-3.0.txt)。

### 2. 商业用户 — 单独商业许可

若你想在 **GPL 之外**更宽松的条件下使用 BetterTTS，典型场景包括：

- 集成进**闭源商业产品 / 商业插件 / 在线服务（SaaS）**并对外销售或分发；
- 以商业产品的一部分二次分发修改版；
- 需要闭源、无传染性义务、可获得商业支持与优先维护。

请**单独购买商业许可证**（授权范围与价格另行洽谈）。
商业授权可通过本仓库 GitHub Issue（`Ptr147/SillyTavern-BetterTTS`）联系作者。
在取得商业许可前，超出 GPL-3.0 允许范围的使用一律不被授权。

> 详见仓库根目录 [`LICENSE`](LICENSE) 文件。
