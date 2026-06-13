# 桌宠（Desktop Pet）设计文档

- 日期：2026-06-13
- 状态：已确认，待编写实现计划
- 技术栈：Electron + React + TypeScript（electron-vite 构建，electron-builder 打包）

## 1. 目标与定位

做一个跨平台（Windows / macOS）的桌面宠物应用：

- **定位**：陪伴/养成 与 AI 助手 两者并重——既要好玩的 Live2D 形象动作，也要扎实的 AI 对话与文件能力。
- **MVP 目标**：交付一个**完整最小闭环**——桌面外壳（透明、置顶、鼠标穿透、可拖动、托盘）+ 聊天（接 mock AI，动作联动）+ 喂文件（拖入、存档、列表、元数据）。
- **AI 现阶段**：用 mock provider，但接口按真实云端/agent 设计，后续接入不动上层。

## 2. 总体架构

构建：`electron-vite`（主进程 / 预加载 / 渲染层一套构建，带 HMR）。打包：`electron-builder`（win + mac）。

进程划分（安全基线：`contextIsolation: true`，无 `nodeIntegration`）：

- **主进程**：窗口生命周期、透明置顶窗口、鼠标穿透控制、托盘、全局热键、SQLite、文件入库、AI Provider（mock）。
- **预加载**：`contextBridge` 暴露类型化、最小化的 IPC API。
- **渲染层（React）**：宠物画布（Live2D）、聊天气泡、文件拖投、管理面板。

## 3. 窗口模型（双窗口）

- **宠物窗（Pet Window）**：无边框、透明、置顶、`skipTaskbar`，承载 Live2D 画布 + 紧贴宠物的聊天气泡。默认鼠标穿透。
- **管理面板窗（Panel Window）**：普通不透明窗口，放文件库、对话历史、设置。

理由：文本输入/列表滚动等重交互在"透明+穿透"窗口里难处理，拆到正常窗口可避免与穿透机制冲突。聊天气泡因需贴着宠物飘动，保留在宠物窗。

## 4. 鼠标穿透（核心技术点）

需求矛盾：穿透让点击落到桌面，但仍需点中宠物。方案为**按像素命中测试**：

- 默认 `setIgnoreMouseEvents(true, { forward: true })`：点击穿透到桌面，鼠标移动事件仍转发给渲染层。
- 渲染层依据光标位置对 Live2D/canvas 做 alpha 命中检测：光标压在**宠物非透明像素或气泡/UI**上时，通知主进程 `setIgnoreMouseEvents(false)`，使该瞬间窗口可交互；移开即恢复穿透。
- 效果：能点宠物、其余全穿透，win/mac 通用。
- 托盘提供**手动锁定/全穿透**开关与**重置交互**，防止状态卡死。

## 5. Live2D 渲染与动作系统

- `pixi.js` + `pixi-live2d-display` + Cubism Core 运行时；内置一个官方免费示例模型（如 Hiyori）。
- 透明 WebGL 画布铺满宠物窗（clearColor alpha = 0，处理预乘 alpha）。
- **ActionController**：将语义动作（idle / greet / talk / think / happy / react）映射到 Live2D 的 motion + expression。AI 回复返回 `{ text, actionTag }`，控制器播放对应动作——这是"动作交互"的桥，AI 只发动作意图。
- 附带**眼睛/头跟随光标**（Live2D 参数拖动），纳入 MVP。
- 定时**随机微动作**（idle 时偶发），纳入 MVP。

## 6. AI Provider 抽象

统一接口（主进程）：

```ts
interface LLMProvider {
  chat(messages: ChatMessage[], context?: ChatContext): AsyncIterable<{ text: string; actionTag?: string }>;
  analyzeFile?(fileId: string): Promise<unknown>; // 预留给后续 agent
}
```

- 现实现 `MockProvider`：返回随机/套路化回复 + 随机 `actionTag`，模拟流式输出与延迟。
- 将来 `ClaudeProvider` / `OpenAIProvider` 实现同接口；设置中填 key 与模型即可切换。后续 agent 的文件分析作为 `analyzeFile` 或独立 `AgentService` 接入。

## 7. 文件入库（MVP：拖入 + 存档 + 列表 + 元数据）

- 拖拽到宠物或面板均可（Electron 拖拽可取 OS 文件路径）。
- 入库服务：复制文件进 **vault 目录**（`userData/vault/<id>/<原名>`），计算 hash，向 SQLite 写元数据行（id、原名、后缀、大小、mime、hash、added_at、来源）。按 hash 去重。完成后发事件，面板列表刷新。
- **前向兼容**：`files` 表预留 `status` 与 `extracted_text` 可空字段，后续加文本抽取/检索/agent 分析无需改表。MVP 不做抽取。

## 8. 存储

- **better-sqlite3**（同步、快，主进程使用）存 `files / conversations / messages`；设置用 `electron-store`（JSON）。
- 原始文件放 vault 目录（`app.getPath('userData')/vault`）。
- 启动时跑一次轻量 migration。
- **注意**：better-sqlite3 为原生模块，需 `electron-rebuild` 且 win/mac 各自预编译——打包时作为专门一步处理。

### 数据表（初版）

- `files(id, original_name, ext, size, mime, hash UNIQUE, source, added_at, status, extracted_text)`
- `conversations(id, title, created_at, updated_at)`
- `messages(id, conversation_id, role, text, action_tag, created_at)`

## 9. IPC 设计

预加载经 `contextBridge` 暴露类型化通道：

- 窗口/穿透：`pet:setInteractive(bool)`、窗口控制、`pet:setPosition`
- 聊天：`chat:send(text)`（流式回复）、`chat:history`
- 文件：`files:ingest(paths)`、`files:list`、`files:open`、`files:remove`
- 设置：`settings:get` / `settings:set`
- 事件：`chat:reply-chunk`、`files:changed`、`action:play`

采用请求/响应 + 事件发射结合的小型模式；`/src/shared` 放共享类型保证两端契约一致。

## 10. 项目结构

```
/electron
  /main      index、windows/{pet,panel}、ipc/*、tray、mousePassthrough
             services/{db, files, ai/provider, ai/mockProvider}
  /preload   index（contextBridge）
/src         React 渲染层
  /pet       Live2D 画布、ActionController、光标跟随
  /panel     聊天、文件库、设置
  /shared    类型、IPC client
/resources/live2d/<model>
electron.vite.config.ts · electron-builder.yml
```

## 11. 跨平台要点

- 透明窗：win 用 `frame:false` + `backgroundColor:'#00000000'`；mac `hasShadow:false`、关 vibrancy。
- 置顶：`setAlwaysOnTop(true, 'screen-saver')`（mac 浮于全屏之上）。
- mac：`app.dock.hide()` 做纯悬浮 + 托盘（accessory 激活策略）。
- 多显示器 / DPI 缩放处理；监听 display 变化。
- 登录自启（可选，`app.setLoginItemSettings`）。
- 代码签名 / 公证（mac）留到分发阶段。

## 12. 错误处理

- 文件入库：锁定/不可读、超大（设上限并提示）、重复（按 hash 跳过并提示）、不支持类型（仍存，不抽取）；错误以面板 toast 呈现。
- AI：provider 错误 → 宠物"困惑"动作 + 重试；mock 仅模拟偶发延迟。
- DB：打开/migration 失败 → 降级、记录日志、通知；启动时执行 migration。
- 窗口/穿透：始终可经托盘"重置交互"恢复可交互。

## 13. 测试策略

- **单元（vitest）**：db、文件去重入库、mockProvider、动作映射等纯逻辑脱离 Electron 测。
- **IPC 契约**：`/src/shared` 类型保证渲染层/主进程一致。
- **冒烟（可选 Playwright-electron）**：验"窗口启动 + 拖文件入列表"，MVP 保持轻量。
- mock provider 使聊天可确定性测试。

## 14. MVP 范围与后续路线

### 纳入 MVP

- 桌面外壳：透明置顶窗、按像素穿透、拖动并记住位置、托盘菜单（显示/隐藏、锁定穿透、设置、退出、重置交互）。
- Live2D 形象（免费示例模型）+ ActionController + 光标跟随 + 随机微动作。
- 聊天：mock AI、流式回复、动作联动、历史持久化。
- 喂文件：拖入、存档进 vault、SQLite 元数据、面板列表展示、按 hash 去重。
- 存储：better-sqlite3 + electron-store + vault 目录。

### 后续（接口预留，暂不实现）

- 真·云端 AI（Claude/OpenAI）+ 流式 + agent 文件分析（文本抽取 / RAG / 向量检索）。
- 语音：TTS（宠物开口）、STT。
- 养成系统：心情 / 数值 / 等级。
- 提醒 / 日程；对系统事件反应（时间 / 电量 / 当前应用）。
- 多宠物与模型市场；自动更新（electron-updater）；国际化；agent 插件/技能系统。

## 15. 待解决/分发阶段事项

- better-sqlite3 原生模块的跨平台预编译与打包流程。
- mac 代码签名与公证。
- 免费 Live2D 示例模型的许可确认（用于开发与分发）。
