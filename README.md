# dsh-voice-studio-plugin

给 DeepSeek Harness（DSH）加一个会说话、会唱歌的桌面角色。

把 AI 的回复念出来、每条消息旁边放一个朗读小喇叭、右键立绘打开语音面板、从模型市场一键下载新音色——**声音模型、参考音色、立绘素材全部通过 profile 目录配置，换角色不用改代码。**

> 大多数语音插件把「某个特定角色」写死在代码里。这个插件把角色抽象成配置：往 `profiles/` 放一个目录，就多一个角色。

---

## 功能一览

### 说话（GPT-SoVITS / SAPI）

- **说句试试**：面板里输入文字立即朗读
- **听上一句**：重读当前会话最近一条 AI 回复
- **自动朗读**：AI 回复完成后自动开口（可关）
- **听上一句**：重读模型最近一次实际朗读的内容（含小喇叭点读、自动朗读的内容）
- **文本清洗**：自动剔除代码块、表格、链接、Markdown 符号；长文本按段合成、可限制单轮朗读字数
- **语音缓存**：同一句（同参数）秒回，缓存上限 100 MB、自动淘汰
- **时长抽风防御**：合成结果明显超过按字数估算的时长（慢动抽语音）自动重试一次；结尾长静音自动裁剪；缓存里的坏文件重读时自动重新合成
- **可调参数**：音量、语速、温度、topK、topP、重复抑制、句间停顿、闲置冷却共 8 个滑块
- **预热与显存管理**：预热开关真实控制显存——GPT-SoVITS 没有 `/unload`，关闭预热时会终止服务进程并释放显存；闲置一段时间自动冷却
- **SAPI 兜底**：内置「系统语音」角色走 Windows SAPI，零依赖开箱即用

### 唱歌（Seed-VC）

- 源歌曲下拉（读取服务端歌曲库）→ 一键转换 → 自动播放
- 转换队列：一次一首，唱完自动下一首，可取消
- 伴奏处理（保留/去除）、人声增益、伴奏增益、扩散步数可调
- 模型预载开关（关闭时调用 `/unload` 释放显存）

### 桌面挂件（立绘）

- 16 张动图（14 待机 + 2 说话），待机随机轮换
- 说话/唱歌时自动切「voice」动图，说完切回
- 自由拖拽；松手不吸边，窗口尺寸变化时才吸最近边
- 左键连点 5 次随机换图；右键打开面板；可隐藏、可左右翻转
- 椭圆冒泡：预热/报错时挂在立绘旁做轻量引导，详情进面板看

### 消息小喇叭

- 每条 AI 消息下注入一个朗读按钮（DSH 槽位 `conversation.chat.assistant-actions`）
- 点击即朗读该条消息；朗读中呼吸闪烁
- 不影响消息排版，失败不影响聊天主链路

### 模型市场

- 50 个音色模型，按来源分类（游戏 26 / 动漫 16 / 虚拟主播·歌手 7 / 系统 1）
- 下载（支持断点续传）/ 取消 / 卸载 / 进度显示；下载后回写真实体积
- 无参考音频的模型标「需自备参考音频」徽章
- 清单只记录来源，不托管权重；下载由本机直连来源站

### 设置页

DSH 设置（左下角头像）→ 「语音」分页：说话 / 唱歌 / 模型市场 / 外观四个 tab，所有开关和滑块都在这里，立绘隐藏后仍可全功能使用。

---

## 环境要求

| 依赖 | 说明 |
| --- | --- |
| Windows | SAPI 兜底、`pythonw` 无窗口启动都依赖 Windows |
| DSH | `>=0.1.7-rc.1 <0.3.0-0`（`engines.dsh`） |
| GPT-SoVITS（可选） | `api_v2.py` 服务端，建议 NVIDIA GPU |
| Seed-VC（可选） | 歌声转换服务端，接口见下文 |
| 麦克风/网络 | 不需要；所有服务只走本机回环地址 |

不部署任何 Python 服务也能用：内置的「系统语音」角色（Windows SAPI）零依赖。

---

## 安装

本地开发（`link:` 指向源码目录，改完需重启 DSH）：

```bash
dsh plugin --profile <你的profile> add link:C:/path/to/dsh-voice-studio-plugin
```

发布到 npm 后：

```bash
dsh plugin --profile <你的profile> add dsh-voice-studio-plugin
```

安装后在 DSH 设置 → 语音里启用。

---

## 配置一个角色

复制 `profiles/_template/` 为 `profiles/<角色id>/`，编辑 `profile.json`：

```json
{
  "id": "my-voice",
  "name": "我的角色",
  "description": "面板和设置页里显示的一句介绍",
  "builtin": false,
  "assets": {
    "icon": "",
    "background": ""
  },
  "tts": {
    "engine": "gpt-sovits",
    "baseUrl": "http://127.0.0.1:9880",
    "refAudio": "D:/path/to/ref.wav",
    "promptText": "参考音频里说的那句话，逐字写下来",
    "promptLang": "zh",
    "textLang": "zh",
    "sapiVoice": ""
  },
  "svc": {
    "baseUrl": "http://127.0.0.1:9890",
    "refAudio": "",
    "backing": "keep",
    "steps": 30
  },
  "modelFiles": { "gpt": "", "sovits": "" }
}
```

### 字段说明

| 字段 | 说明 |
| --- | --- |
| `id` | 角色唯一标识，仅字母数字下划线连字符；`_` 开头的目录会被跳过（模板用） |
| `name` / `description` | 面板与设置页显示 |
| `assets.icon` | 头像图；留空自动在角色 `assets/` 目录找 `icon.<png/jpg/jpeg/webp/gif>`，再退回内置 `assets/whale.png` |
| `assets.background` | 挂件背景；留空自动找 `background.<webp/png/jpg>`，再退回内置 `assets/background.webp` |
| `tts.engine` | `gpt-sovits`（默认）或 `sapi`（系统语音，此时只需 `sapiVoice`） |
| `tts.baseUrl` | TTS 服务地址；留空用全局 `ttsUrl` |
| `tts.refAudio` | **GPT-SoVITS 必填**，参考音频的绝对路径（服务端可读） |
| `tts.promptText` | 参考音频逐字稿，直接影响合成质量 |
| `tts.sapiVoice` | SAPI 引擎时指定系统语音名，留空用默认 |
| `svc.baseUrl` | 唱歌服务地址；留空表示该角色不支持唱歌（或全局关闭唱歌） |
| `svc.backing` | 伴奏处理：`off` / `keep` / `discard` |
| `modelFiles.gpt` / `modelFiles.sovits` | 微调权重绝对路径；配置后预热/合成前自动推给服务端加载（`/set_gpt_weights`、`/set_sovits_weights`），市场下载的模型会自动填好 |

资源图也可以不放文件、直接在面板里上传（「修改立绘 / 背景」），支持 png/jpg/jpeg/webp/gif。

---

## 全局配置

在 DSH 设置 → 语音里改（落盘到插件目录 `user-config.json`），或直接改文件。默认值：

| 项 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `autoSpeak` | `false` | 每轮 AI 回复自动朗读 |
| `volume` | `1` | 音量 0~1 |
| `speed` | `1` | 语速 0.5~2 |
| `profile` | `""` | 当前角色 id，留空用第一个 |
| `ttsUrl` | `http://127.0.0.1:9880` | 全局 TTS 地址（角色未配置时生效） |
| `svcUrl` | `""` | 全局 SVC 地址 |
| `wakePort` | `9881` | 唤醒端口，0 = 关闭 |
| `wakeEnabled` | `true` | 唤醒端口开关 |
| `idleUnloadMs` | `300000` | 空闲冷却（5 分钟），0 = 从不 |
| `ttsUnloadOnExit` / `svcUnloadOnExit` | `true` | 退出 DSH 时卸载模型/终止进程 |
| `svcEnabled` | `true` | 唱歌功能总开关 |
| `maxCharsPerTurn` | `1200` | 单轮朗读字数上限（100~8000） |
| `segmentChars` | `120` | 分段合成字数（40~500） |
| `temperature` | `0.7` | 采样温度（0.05~2） |
| `topK` / `topP` | `10` / `0.9` | 采样范围 |
| `repetitionPenalty` | `1.35` | 重复抑制 |
| `fragmentInterval` | `0.4` | 句间停顿（秒） |
| `widgetSize` | `104` | 立绘尺寸（64~240 px） |
| `widgetFlip` / `widgetVisible` | `false` / `true` | 立绘左右翻转 / 隐藏 |
| `glassBlur` | `14` | 毛玻璃强度（0~40） |
| `theme` / `accent` | `whale` / `""` | 外观主题 / 强调色 |
| `svcSteps` | `30` | 唱歌扩散步数（10~60） |
| `vocalGain` / `backingGain` | `1` / `0.9` | 人声/伴奏增益（0~1.5） |
| `pythonPath` | `""` | Python 解释器（自动拉起用，建议 venv 的 `Scripts` 目录或 `pythonw.exe` 全路径） |
| `ttsScript` / `ttsCwd` | `""` / `""` | GPT-SoVITS 启动脚本 / 工作目录（cwd 留空取脚本目录） |
| `svcScript` / `svcCwd` | `""` / `""` | Seed-VC 启动脚本 / 工作目录（同上） |

---

## 服务对接

插件不内嵌任何模型，只调本机 HTTP 服务。**服务可以先于插件启动**：插件启动和每次使用前都会探测端口，发现服务在线就直接复用，不会重复拉起。

### TTS（GPT-SoVITS `api_v2.py`）

请求 `GET /tts`，查询参数：

| 参数 | 值 |
| --- | --- |
| `text` / `text_lang` | 要念的文字 / 语言（来自角色） |
| `ref_audio_path` / `prompt_text` / `prompt_lang` | 角色的参考音频与逐字稿 |
| `media_type` / `streaming_mode` | `wav` / `false` |
| `temperature` / `top_k` / `top_p` / `repetition_penalty` / `fragment_interval` / `speed_factor` | 全局配置里的采样参数 |

可选 `GET /vram`：返回 `{ vramMb }`，服务自报显存占用，状态页直接展示（无此端点则退回差值估算）。

**预热语义**（`api_v2` 没有 `/warm`、`/unload`）：

- 预热 = 发一次极短试合成，触发模型延迟加载
- 关闭预热 = 按端口找到并终止服务进程，真正释放显存
- 空闲冷却到期：SVC 调 `/unload`；TTS 只清预热标记（进程保留，下次秒回）

### SVC（Seed-VC `svc_server.py`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | `{ ready, busy, loading, vramMb, ... }` |
| GET | `/library` | 歌曲库 `{ dir, items: [{name, bytes}] }` |
| POST | `/sing` | 转换，body 见下 |
| GET | `/audio/<file>` | 取回产物 wav |
| GET | `/warm` / `/unload` | 预载 / 卸载模型 |

`POST /sing` 请求体：

```json
{
  "source": "歌曲库里的文件名",
  "steps": 30,
  "backing": "keep",
  "vocalGain": 1,
  "backingGain": 0.9,
  "ref": "可选的参考音色绝对路径"
}
```

`backing` 三种模式：`off` 整段直接转换（带伴奏的源会糊）／`keep` 分离人声只转人声再混回伴奏／`discard` 只输出人声（适合发语音条）。转换是重活：30 秒的歌在消费级显卡上约 15~60 秒，同一时刻只跑一个任务。

### 自动拉起服务（可配置）

TTS / SVC 离线时，插件会尝试自动拉起进程（`pythonw` 无窗口、detached、日志轮转 512 KB、90 秒就绪等待、启动加锁防并发）。拉起需要 5 个部署路径配置（写在 `user-config.json`，或通过 `/config` 接口写入）：

```json
{
  "pythonPath": "D:/gpt-sovits/venv/Scripts",
  "ttsScript": "D:/gpt-sovits/api_v2.py",
  "ttsCwd": "D:/gpt-sovits",
  "svcScript": "D:/seed-vc/svc_server.py",
  "svcCwd": "D:/seed-vc"
}
```

- `pythonPath` 支持填 venv 的 `Scripts` 目录（自动优先 `pythonw.exe`）、`python.exe`（自动换同目录 `pythonw.exe`）或 `pythonw.exe` 全路径
- `ttsCwd` / `svcCwd` 留空时默认取对应脚本所在目录
- 五项默认全空 = 不自动拉起，只探测已在跑的服务并直接复用；给别人部署时要么预先启动服务，要么填好各自的路径

---

## 唤醒端口（外部程序接口）

TCP `127.0.0.1:9881`，一行命令一个回复（走 TCP 而非 HTTP，因为 DSH web 服务有鉴权，外部进程拿不到 token）：

```
ping            → ok / err
wake 或 tts     → 确保 TTS 在线并预热（已在跑则直接 ok）
sing 或 svc     → 确保 SVC 在线并预载
```

qq-bridge 之类的机器人可以用它在说话前把语音服务拉起来。

---

## 调试 HTTP 接口（开发者）

路由挂在 DSH 的 web 服务上（前缀 `/voice-studio`，端口跟随 DSH，浏览器直接能访问）。常用：

| 路径 | 方法 | 说明 |
| --- | --- | --- |
| `/status` | GET | 总状态：服务在线、显存、队列、当前角色 |
| `/config` | GET / POST | 读 / 写全局配置（POST 传增量 patch） |
| `/speak` | POST | `{text}` 入队合成；空 text = 重读最近一次朗读的内容 |
| `/poll` | GET | 取合成音频（base64，取走即消费） |
| `/clear` | POST | 清空朗读队列（停止按钮） |
| `/tts-warm` | POST | 切换 TTS 预热（开 = 拉起+预热，关 = 杀进程） |
| `/svc-toggle` | POST | 切换 SVC 模型预载（开 = warm，关 = unload） |
| `/sing` | POST | `{source, steps, backing, ...}` 入队转换 |
| `/songs` | GET | 歌曲库 |
| `/market` 及 `/market/download|progress|cancel|clear|uninstall` | GET/POST | 模型市场与下载管理 |
| `/probe` | GET | 检测 SAPI / TTS / SVC 可用性 |
| `/moods` / `/mood?name=` | GET | 立绘动图清单 / 单图（支持 Range） |
| `/asset?name=` / `/icon?name=` | GET | 角色资源 / 内置图标 |
| `/upload` | POST | 上传立绘/背景（base64 data URL，≤8 MB） |
| `/clientlog` | POST | 前端日志上报 |
| `/open-folder?which=` | POST | 打开歌曲库/角色目录 |

---

## 项目结构

```
dsh-voice-studio-plugin/
├── index.js               插件入口（后端）：23 个 HTTP 路由、会话监听、
│                          唤醒端口、空闲冷却、退出清理
├── client.js              设置页 + 小喇叭（DSH 槽位，独立 script）
├── client/
│   ├── main.js            立绘挂件（Shadow DOM）：动图、冒泡、面板、拖拽
│   ├── panel.css          面板样式
│   └── src/               api / dom / store / controls / player / dropdown
│       └── pages/         speak / sing / market / look 四个页面
├── src/
│   ├── config.js          配置规范化 + 角色扫描（跳过 _ 开头目录）
│   ├── text.js            文本清洗 / 分段 / 截断
│   ├── audio.js           WAV 时长解析 + 尾静音裁剪（时长抽风防御）
│   ├── market/index.js    市场清单 / 下载（Range 续传）/ 卸载
│   ├── services/proc.js   进程启动（pythonw、detached、日志轮转、防并发）
│   ├── services/vram.js   显存读取（服务自报优先，基线差值兜底）
│   ├── tts/client.js      GPT-SoVITS 客户端（/tts、/vram、/set_*_weights，预热=短试合成）
│   ├── tts/sapi.js        Windows SAPI
│   └── svc/client.js      Seed-VC 客户端
├── profiles/
│   ├── builtin/           内置系统语音（SAPI，零依赖）
│   ├── _template/         角色模板（复制它做新角色）
│   └── <你的角色>/        profile.json + assets/ + models/
├── market/index.json      50 个模型清单
├── assets/                whale.png、background.webp、moods/（16 动图）、bubbles/
├── locale/                插件管理器的标题/描述（en / zh）
├── icon.webp              插件图标（说话动图「扩音器」）
└── cordis.patch.yml       DSH 配置注入
```

运行期产物：`user-config.json`（用户配置）、`cache/`（语音缓存，100 MB 上限）、`debug.log` / `tts-server.log` / `svc-server.log`（日志，512 KB 轮转）、`.vram-baseline.json`（显存基线）。

---

## 开发与调试

- `link:` 安装**不会热更新**：改完代码必须重启 DSH 验证
- 改动 JS 后全量 `node --check`；改 `panel.css` 后检查括号平衡
- 前端两个 script（`client.js` 与 `client/main.js`）不共享模块，唯一通信通道是 `window.__DSH_VOICE_STUDIO__`
- 历史踩坑与强制约束见 `.rewrite/PITFALLS.md`（Shadow DOM、下拉菜单、进程启动等，每条对应真实 bug）

---

## 已知限制

- 微调权重的加载依赖 api_v2 的 `/set_gpt_weights`、`/set_sovits_weights`；插件重启后第一次预热/合成会重推一遍权重（多花十几秒），换来的是不管服务端默认加载了什么都保证是当前角色的权重
- 没配 `modelFiles` 的角色走零样本：音色跟随 `refAudio` + `promptText`，质量不如微调权重
- 所有服务只允许本机回环地址（防止聊天内容外发）
- 显存估算依赖服务自报；WDDM 下按整卡差值的兜底算法无法精确到进程
- 参考音频必须是服务端可读的本地绝对路径
- 唱歌转换产物不自动清理，需要自己管理服务端输出目录
- 市场下载的模型落在插件目录的 `profiles/` 下；npm 重装/升级插件会清掉这些目录，请注意备份
- 市场模型来自第三方（HuggingFace / ModelScope 等），许可已尽量标注，音色可能涉及角色版权，使用范围请自行评估

---

## License

代码 MIT。各音色模型权重有独立许可（见市场条目标注），本仓库不托管任何权重文件。
