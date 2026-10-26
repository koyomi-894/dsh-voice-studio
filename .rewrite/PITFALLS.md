# 重写规范：踩过的坑与强制约束

写代码时必须逐条对照，每条都对应一个真实发生过的 bug。

## A. Shadow DOM 与样式

- A1 `:host` 是唯一样式化宿主元素的入口，`.vs-host` 这类内部选择器永远匹配不到宿主。
- A2 `:host { all: initial }` 会重置 `display`/`position`，必须显式重新声明。
- A3 样式表里不能出现 `body`/`html`/`*`/`:root` 等全局选择器（会污染宿主页面）。
- A4 挂到 `document.body` 的元素拿不到 Shadow DOM 内的 CSS，必须注入页面级样式表。
- A5 `animation` 和 `transition` 都改 `transform` 时不能写在同一个元素上，会互相覆盖；分层处理。

## B. 下拉菜单（踩坑最密集）

- B1 菜单必须挂到 `document.body` 并 `position: fixed`，因为面板是滚动容器会裁切。
- B2 挂载前必须先把 `position/left/top/width/maxHeight/margin/padding/boxSizing` 写成内联样式，否则会以块级元素撑开页面出现右侧滚动条。
- B3 外部点击监听用 `pointerdown` **捕获阶段**，并且必须排除 `root.contains` 和 `menu.contains`。
- B4 菜单项选中必须用 `onpointerdown` + `stopPropagation`，用 `click` 会因元素已被移除而永不触发。
- B5 `value` 必须用 `let` 声明（曾写成 `const` 解构，导致 `Assignment to constant variable` 运行时异常）。
- B6 下拉实例必须复用，不能每次 render 都 `createDropdown`，否则旧菜单残留在 body 上。
- B7 切页面前必须 `closeAllDropdowns()`。
- B8 滚动监听不能用捕获阶段，面板内部滚动会立刻关闭菜单。

## C. 渲染与状态

- C1 轮询每 1.5s 触发 render，若每次重建 DOM，`:hover` 会丢失导致闪烁；必须用内容签名跳过无变化渲染。
- C2 标签栏用事件委托挂在永不重建的容器上，不能给每个按钮单独绑 `onclick`。
- C3 渲染签名必须包含所有影响显示的字段，漏一个就不刷新。
- C4 页面级 render 必须能被强制触发（清空签名），否则数据到了界面不更新。
- C5 清空/取消类操作与 in-flight async 有竞态：`await` 完成后必须确认 item 仍在队列（`queue[0] === item`）再投递结果，否则「停止后又响一声」（2026-10-24 修复 pump()）。

## D. 进程启动（弹窗/失败根源）

- D1 **禁止用 `cmd /c` 启动**：Windows 上 `spawn('cmd', ['/c', ...])` 即使 `windowsHide: true` 仍会创建控制台窗口。
- D2 Python 必须用 `pythonw.exe`（无控制台版本），`python.exe` 是控制台程序，`windowsHide` 对控制台程序不可靠。
- D3 启动标志 `creationFlags: 0x08000000` 只对 GUI 程序有效，控制台程序要靠 `pythonw`。
- D4 启动前必须先 `portOpen` 检测端口，不能靠 `try/catch fetch` 猜服务是否活着。
- D5 启动必须加锁防并发（`launching` 标志），连点会拉起多个进程抢端口。
- D6 启动后必须 `waitForPort` 等就绪，且超时要足够（模型加载慢，至少 90s）。
- D7 子进程必须 `detached: true` + `unref()`，否则宿主退出会连带杀死服务。

## E. 外部服务接口

- E1 GPT-SoVITS `api_v2.py` **没有** `/warm` 和 `/unload`，只有 `/tts`、`/control`、`/set_*_weights`。
- E2 预热 TTS 必须用「一次极短试合成」触发延迟加载，不能请求 `/warm`。
- E3 Seed-VC `svc_server.py` **有** `/warm` 和 `/health`。
- E4 改外部代码前必须备份（`api_v2.py.bak-vram`）。
- E5 显存必须由服务自报（`/vram`、`/health.vramMb`），不能靠整卡差值估算。

## F. 显存估算

- F1 差值法在 WDDM 下拿不到单进程占用，只能读整卡。
- F2 多个服务共用同一条最早基线，否则会把先跑的算两遍。
- F3 基线相同时必须**均分**，绝不能让每个服务都拿整份 delta（会导致合计翻倍）。
- F4 各项之和必须恒等于整卡已用，用「最后一个吃掉取整误差」保证。
- F5 基线必须持久化（重启会清空内存），并加 TTL（超 2 小时不可信）。

## G. 配置持久化

- G1 配置文件必须落盘（`user-config.json`），只存内存的话重启全丢。
- G2 启动时用户配置优先级高于宿主传入的初始配置。
- G3 滑块类改动必须防抖保存（400ms），否则拖一次打爆后端。
- G4 测试时绝不能写用户真实配置文件，会污染用户环境。

## H. 资源与缓存

- H1 上传的资源必须按真实扩展名查找（png/jpg/jpeg/webp/gif 全支持），只认 png/jpg 会导致「上传成功但看不到」。
- H2 图片 URL 必须带版本号，否则换图后浏览器用缓存。
- H3 立绘尺寸变化时必须保持贴边侧锚定，否则元素向一侧扩张导致面板位移。

## I. 交互反馈

- I1 按压动画用 `transition` 不用 `animation`（animation 中途打断会跳回，无法「按住保持」）。
- I2 缩放/翻转/抖动三个 transform 必须分在三个不同元素上。
- I3 拖动滑块期间必须冻结面板坐标（`position: fixed` + 记录 left/top），否则断触。
- I4 重复触发同一动画必须 `void el.offsetWidth` 强制重排。

## J. 代码质量

- J1 改动后必须全量 `node --check`（语法）和实际 import 测试。
- J2 Python 改动必须 `ast.parse` 校验。
- J3 写 heredoc 时反引号和 `\n` 会破坏文件，用 Python 生成脚本代替。
- J4 每个 async 路由必须有 try/catch，且错误信息不能为空字符串。
- J5 破坏性操作（卸载模型）必须有路径穿越防护和多道校验。

## K. 唱歌链路

- K1 `POST /sing` 成功只代表服务端把 wav 写进 `out/sing/`，**必须再 GET `/audio/<file>` 把字节取回**；只等 `singSong()` 返回 `ok` 就收工，会让「唱一首」永远没有可播的音频（旧版就是这个 bug）。
- K2 唱歌结果和朗读队列是两套东西：`/poll` 必须用独立字段（`singAudio` 等）返回，绝不能塞进 `pendingAudio`，否则 `queue.shift()` / `pump()` 会误删朗读队列。
- K3 转换是异步排队（接口先回 `queued`），前端不能在 `/sing` 返回时就提示「转换完成」；播放在轮询到 `singAudio` 后才发生。
