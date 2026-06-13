# 桌宠 Plan 3 — 文件投喂与本地存储（Vault）设计文档

- 日期：2026-06-13
- 状态：已确认设计方向，待用户复核 → 编写实现计划
- 前置：Plan 1（Foundation & Desktop Shell）、Plan 2（Live2D 渲染与动作系统）已实现（PR #1 / #2）
- 技术栈：在现有 electron-vite 5 + React 19 + TypeScript（electron ^39，CommonJS 主/预加载）之上，引入 **`node:sqlite`（Electron 内置）** + **内容寻址文件 vault**

## 1. 目标与范围

把 Plan 2 的"投喂只播 `receive` 动画"升级为**真正把文件存下来**：

- 用户**把文件拖到宠物身上** / **在面板点「投喂文件」按钮选文件** / **把文件拖到面板窗口**，文件被哈希、复制进本地 vault、并在 SQLite 元数据库登记。
- 宠物对投喂仍有视觉反馈（复用 Plan 2 的 `playAction('receive')`，**保留不动**）。
- 面板新增**文件库 UI**：列出已投喂文件（名称/大小/类型/时间），支持**在默认程序打开 / 在文件管理器中显示 / 删除 / 搜索过滤**。
- 存储为后续（Plan 4）AI 分析文件打基础：内容寻址保证完整性与去重，元数据库保留人类可读映射。

### 明确不做（YAGNI / 留到后续）

- **读取/解析文件内容**（文本抽取、嵌入、AI 分析）→ Plan 4。Plan 3 只负责"存得好、列得清"。
- **内容嗅探判类型**（magic bytes / `file-type`）：Plan 3 用扩展名映射 MIME（纯函数、可测）即可；内容嗅探留作后续增强。
- **宠物对"面板投喂"也做动作反应**：Plan 3 仅"拖到宠物身上"触发本地 `receive`；面板投喂只刷新文件库。跨窗口联动留作后续 polish。
- **标签/收藏/多 vault**：单表 `files` 起步。
- 主进程窗口/穿透/拖动/托盘/Live2D 渲染**不动**（见 §9 衔接面）。

## 2. 技术选型与关键事实（研究已核实）

### 2.1 存储引擎：`node:sqlite`（内置，优于 better-sqlite3）

- **Electron 39.2.x 捆绑 Node 22.21.x**；`node:sqlite` 自 **Node 22.5 引入、22.13 起移除 `--experimental-sqlite` 标志**。因此在本项目 `electron ^39.2.6` 下，主进程可**直接 `import { DatabaseSync } from 'node:sqlite'`，无需任何运行时标志**。
- 它是**内置模块**，编译进 Electron 自带的 Node：**没有原生 addon 编译、没有 `NODE_MODULE_VERSION`/ABI 不匹配、无需 `@electron/rebuild`、无需 `asarUnpack`**——这正是 `better-sqlite3` 的反复打包痛点（每次安装/升级都要按 Electron ABI 重建 + `npmRebuild` 协调，是经典隐性破坏源）。dev 与打包行为一致。
- 同步 API（`DatabaseSync` / `StatementSync`），与 `better-sqlite3` 同等顺手，契合本计划"低写入、小表"的场景。
- **唯一代价**：`node:sqlite` 仍标注 Stability 1.1（活跃开发中），API 可能随 Node 大版本变动。**缓解：所有 DB 访问封装在单一薄模块 `libraryStore` 内**，必要时整体切回 `better-sqlite3` 只改一个文件；每次升级 Electron 大版本时复验。
- DB 文件落 `app.getPath('userData')/library.db`（Windows `%AppData%/pet`、macOS `~/Library/Application Support/pet`、Linux `~/.config/pet`，`productName: pet`）。**位于安装目录之外，随应用更新自动保留**。开库后执行 `PRAGMA journal_mode=WAL`、`PRAGMA foreign_keys=ON`；用 `PRAGMA user_version` 跟踪迁移版本。

### 2.2 文件路径解析：`webUtils.getPathForFile`（`File.path` 已移除）

- 非标准的 `File.path` **自 Electron 32 起被移除**，39 下读不到。获取拖入文件真实绝对路径的**唯一受支持方式是 `webUtils.getPathForFile(file)`**。
- `webUtils` 是**渲染进程模块**，在 `contextIsolation: true` 下主世界拿不到 → **必须在 preload 调用**，把"接收一个 `File`、返回其路径"的函数经 `contextBridge` 暴露给渲染层。`File` 可作为结构化克隆类型从主世界传入 preload。
- 另设**主进程 `dialog.showOpenDialog`**（面板「投喂文件」按钮），返回 `{ canceled, filePaths }`，与拖入分支汇合到同一个主进程 `ingest(path)`。这也是部分 macOS 上拖拽取路径偶发失败（electron/electron#44600）的可靠兜底。

### 2.3 Vault：sha256 内容寻址

- 布局（`userData/` 下）：
  ```
  userData/
    library.db                       # node:sqlite 元数据库
    vault/
      blobs/ab/cd/<sha256>           # 内容寻址 blob（无扩展名，纯内容）
      tmp/<rand>.part                # 进行中投喂的暂存区（与 blobs 同盘以便原子 rename）
  ```
- blob 文件名 = 小写 64 位十六进制 sha256；按前 2 + 次 2 个十六进制字符做 **2 级分片**（`ab/cd/`，git 同款，256×256 桶；低成本防单目录膨胀）。分片路径**完全由 sha256 反推**（`h.slice(0,2)`/`h.slice(2,4)`），不单独存储。
- **单次读取同时哈希+复制**（流式、常量内存、大文件安全）：源 → `vault/tmp/<rand>.part` 边写边喂入 `crypto.createHash('sha256')`；完成即得 hash。
- 去重在 blob 层免费实现：算出 `dest = blobs/<h0:2>/<h2:4>/<hash>`，若已存在 → 内容必然相同 → **删除暂存、不复制**；否则 `fs.rename(tmp, dest)`（同盘原子）。**先落 blob 再写 DB 行**（避免出现指向缺失 blob 的行）。

## 3. 数据模型

```sql
CREATE TABLE IF NOT EXISTS files (
  id            INTEGER PRIMARY KEY,
  sha256        TEXT    NOT NULL,        -- 64 位十六进制；与 blob 路径对应
  original_name TEXT    NOT NULL,        -- 显示名 + 扩展名，如 "季度预算.xlsx"
  ext           TEXT    NOT NULL DEFAULT '', -- ".xlsx"（path.extname 小写，便于过滤/图标）
  mime          TEXT    NOT NULL DEFAULT '', -- 按扩展名映射的尽力而为类型
  size_bytes    INTEGER NOT NULL,
  ingested_at   TEXT    NOT NULL,        -- ISO 8601
  source_path   TEXT                     -- 原始绝对路径，仅作溯源
);
CREATE INDEX  IF NOT EXISTS idx_files_sha256    ON files(sha256);
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_sha_name ON files(sha256, original_name);
```

- **行去重规则**：blob 永远去重；**显示行**仅当"相同内容 **且** 相同文件名"重复投喂时跳过（由 `idx_files_sha_name` 唯一约束 + `INSERT … ON CONFLICT DO NOTHING` 实现，命中冲突则回查既有行返回其 id）。同内容不同名 → 仍新建行（两行共享一个 blob，符合"用户看到自己投喂的每一项、底层去重"的 UX）。
- 类型映射：`ext → mime` 用 `src/shared/library/mime.ts` 内的小型纯函数表（无新依赖、可单测）；未知扩展名落 `application/octet-stream`。

## 4. 组件结构与文件清单

主进程（mirror 现有 `settingsStore.ts` 的可测模式：注入 `userDataDir` 字符串、**不 import electron**、原子写、`getXxxPath()` 访问器）：

- `src/main/libraryStore.ts`（**新增**）：`createLibraryStore(userDataDir)`。负责开库/建表/迁移、vault 目录初始化、`ingest/list/get/remove`。API：
  - `ingest(absPath: string): Promise<FileRecord>`
  - `list(): FileRecord[]`
  - `get(id: number): FileRecord | undefined`
  - `remove(id: number): void`（删行；若该 sha256 已无其它引用 → `unlink` blob，**最后引用即时回收**）
  - `blobPathFor(id: number): string | undefined`（供打开/显示定位）
  - `dispose(): void`
- `src/main/libraryStore.test.ts`（**新增**，vitest）：ingest 去重、流式哈希正确性、原子 rename、暂存清理、`list/get`、`remove` 的最后引用回收、错误路径（缺失/目录/超限）。

主进程接线：

- `src/main/ipc.ts`（**改**）：在唯一的 `registerIpcHandlers(deps)` 内注册 `library:*` 处理器；`IpcDeps` 增加 `libraryStore`、`dialog`、`shell`、以及 `getPanelWindow`（用于广播）。
- `src/main/index.ts`（**改**）：`createLibraryStore(app.getPath('userData'))` 并注入 deps；启动时清扫 `vault/tmp` 中的陈旧 `*.part`。
- `src/main/ipc.test.ts`（**改**）：扩展覆盖新处理器（注入 `libraryStore` mock）。

共享：

- `src/shared/ipc.ts`（**改**）：在 `IPC` 常量加 `library:*` 通道；在 `RendererApi` / `PanelApi` 接口加成员。
- `src/shared/types.ts`（**改**）：`FileRecord`、`IngestResult` 等领域类型（保持 electron-free）。
- `src/shared/library/mime.ts`（**新增**）：`extToMime(ext): string` 纯函数 + 表。
- `src/shared/library/filter.ts`（**新增**）：`filterFiles(items, query): FileRecord[]` 纯函数（面板搜索用，可单测）。
- 对应 `*.test.ts`（**新增**）。

预加载（两个独立 preload，工厂可测：`buildPetApi(ipc)` / `buildPanelApi(ipc)`）：

- `src/preload/index.ts`（**改**，宠物窗 `window.petApi`）：新增
  - `resolveDroppedPaths(files: FileList | File[]): string[]`（preload 内调 `webUtils.getPathForFile`）
  - `ingestPaths(paths: string[]): Promise<IngestResult[]>`（`invoke('library:ingest', paths)`）
- `src/preload/panel.ts`（**改**，面板窗 `window.panelApi`）：新增
  - `resolveDroppedPaths(files): string[]`（面板也支持拖入）
  - `library.list() / remove(id) / open(id) / reveal(id) / ingestPaths(paths) / pick()`
  - `onLibraryChanged(cb): Unsubscribe`
- `src/preload/index.d.ts`：类型来自 `@shared`，无需重复声明（核对 Window 增强）。
- `src/preload/index.test.ts` / `panel.test.ts`（**改**）：扩展工厂测试。

渲染层：

- `src/renderer/src/pet/PetApp.tsx`（**改**，`onDrop` 现位于 132–155 行）：**保留** `playAction('receive')`；新增 `const paths = window.petApi.resolveDroppedPaths(files)` → `window.petApi.ingestPaths(paths)`。`dragover` 仍 `preventDefault()`（防 Chromium 导航到 file://）。
- `src/renderer/src/panel/PanelApp.tsx`（**改**）：挂载文件库；订阅 `onLibraryChanged` 刷新。
- `src/renderer/src/panel/FileLibrary.tsx`（**新增**）：列表（名称/大小/类型/时间）+ 行操作（打开/显示/删除）+ 顶部搜索框（用 `filterFiles`）+「投喂文件」按钮（`pick`）+ 面板窗口级拖入区（`resolveDroppedPaths` → `ingestPaths`）。
- `src/renderer/src/panel/panel.css`（**改**）：文件库样式。

## 5. IPC 契约（沿用 `namespace:verb` + `handle/invoke`，常量集中在 `shared/ipc.ts`）

请求/响应（`ipcMain.handle` + `ipcRenderer.invoke`）：

- `library:ingest` — `payload: string[]`（绝对路径数组）→ `IngestResult[]`。**宠物窗与面板窗共用**。主进程逐个 `libraryStore.ingest(p)`，成功后广播 `library:changed`。
- `library:list` — `() → FileRecord[]`
- `library:remove` — `id → void`（删行 + 最后引用回收 blob），随后广播 `library:changed`
- `library:open` — `id → void`（按需物化后 `shell.openPath(物化路径)`；见 §6）
- `library:reveal` — `id → void`（`shell.showItemInFolder`）
- `library:pick` — `() → IngestResult[]`（主进程 `dialog.showOpenDialog({ properties:['openFile','multiSelections'] })` → 逐个 ingest；取消返回 `[]`）

主→渲染广播（`webContents.send` + `ipcRenderer.on`，返回 `Unsubscribe`）：

- `library:changed` — 通知**面板窗**重新 `library:list`（payload 可空或带变更 id）。宠物窗不订阅（其 `receive` 反馈是本地触发，见 §1 范围）。实现上由注入的 `broadcastLibraryChanged()` 接缝发出（mirror 现有 `broadcastSettingsChanged`，闭包持有 `getPanelWindow`），而非给 `IpcDeps` 单加 `getPanelWindow`。

## 6. 打开/显示文件（内容寻址与"真实文件名"的协调）

- blob 在磁盘上是匿名的（hash 命名、无扩展名）。人类可读身份完全在 SQLite。
- **在文件管理器中显示**（`library:reveal`）：直接 `shell.showItemInFolder(blobPath)` 即可（定位到 blob 文件）。
- **在默认程序打开**（`library:open`）：很多程序按扩展名识别，匿名 blob 可能打不开。策略：**按需物化**——把 blob 复制到 `userData/work/<id>/<original_name>`（带正确扩展名）再 `shell.openPath`，用后由启动时的 `work/` 清扫回收。**绝不重命名规范 blob**。（物化逻辑放 `libraryStore`，可测。）

## 7. 安全与健壮性

- 维持严格姿态：`contextIsolation:true` / `nodeIntegration:false`；渲染层不 import electron，一切经 preload。`webUtils` 仅在 preload 用；**不把原始绝对路径暴露给页面主世界**（除非 UI 确需显示），优先回传净化记录（名称/大小/类型/id）。
- **路径校验（`library:ingest` 收到的路径视为不可信，即便源自 `getPathForFile`）**：拒绝空串/非字符串；`path.resolve` 规范化、拒绝含 NUL；`await fs.stat` 且要求 `isFile()`（拒目录/设备/FIFO）；哈希/复制前先校验 `size <= MAX_INGEST_BYTES`（常量，默认 1 GiB）；复制目标 `path.resolve` 后必须落在 vault 根内（目标名由 sha256 派生，杜绝路径穿越）。可校验 IPC `event.senderFrame` 仅允许本应用窗口。
- 错误处理：源缺失/被占用/无权限（ENOENT/EBUSY/EPERM/EACCES）→ 中止、删暂存 `*.part`、**不写 DB 行**、向渲染层回明确错误；blobs/ 内永不残留半成品（只有原子 rename 后的完整文件才落地）。
- 启动清扫：删 `vault/tmp` 内陈旧 `*.part` 与 `userData/work/*`（无引用、安全）。
- 同步 `DatabaseSync` 会阻塞主进程事件循环——本计划写入量小、表小，可忽略；避免主线程大扫描；哈希/复制走异步流，不冻结宠物。

## 8. 测试策略

- **单元（vitest，node 环境；include 仅覆盖 `src/shared`/`src/main`/`src/preload`，不含 `.tsx`）**：
  - `libraryStore`：建表/迁移、ingest 流式哈希（已知内容→已知 sha256）、blob 去重（同内容跳过复制）、行去重（同名同内容跳过插入、同内容异名新建行）、原子 rename、暂存清理、`remove` 最后引用回收、错误路径、按需物化。用临时目录注入，不碰 electron。
  - `ipc`：`library:*` 处理器（注入 `libraryStore`/`dialog`/`shell` mock，断言广播）。
  - `mime`/`filter`：纯函数。
  - preload 工厂：新增方法走 `ipc.invoke`/`webUtils` 的桩。
- **人工验收**：沿用 Plan 1/2 清单形式新增 Plan 3 段——三种投喂路径各存一次、面板库即时出现、打开/显示/删除/搜索、重复投喂去重表现、删除后空间回收、宠物拖入仍播 `receive`、隐藏/退出不受影响。

## 9. 与 Plan 1 / Plan 2 的衔接 / 改动面

- **复用 `playAction('receive')`**（`PetApp.tsx:147`，Plan 2 已注册 `receive` → motion `Tap` / expr `f05` / 优先级 `reaction`），仅在其旁加入路径解析 + ingest IPC，**不改动作系统**。
- **mirror `settingsStore.ts`**：`libraryStore` 注入 `userDataDir`、不 import electron、原子写、`getXxxPath()`——保证可单测，文件落 `userData`。
- **沿用 IPC/preload 约定**：常量进 `shared/ipc.ts` 单一来源；处理器集中在 `registerIpcHandlers(deps)` 注入依赖；面板 API 进 `panelApi`、宠物路径解析进 `petApi`；接口成员在 `shared/ipc.ts` 各声明一次。
- **主进程窗口/穿透/拖动/托盘/Live2D 不动**。
- **构建/约束**：CommonJS 主/预加载（无 `type:module`）；`node:sqlite`/`node:*` 由 electron-vite 默认外部化（核对不被打包）；面板 `panel.html` CSP 仅 `default-src 'self'`——文件库不引入远程资源即不受影响；保持 `electron.vite.config.ts` 两个 preload 输入（index/panel）与两个 renderer html 输入（index/panel）；面板用 `React.StrictMode`（宠物窗不用），**面板 effect 须幂等/清理安全**（双调用下不重复订阅/请求）。
- **git**：账户 `lwh2015`；按既有栈式 PR 习惯，Plan 3 分支 `feat/file-ingestion` 基于 `feat/live2d`；提交带 `Co-Authored-By` 尾注；仅在用户要求时 push/开 PR。

## 10. 待解决 / 分发阶段事项

- `node:sqlite` 的 Stability 1.1：升级 Electron 大版本时复验 `DatabaseSync` API；薄封装已为切回 `better-sqlite3` 留好后路。
- `@types/node`（项目 `^22.19.1`）应已含 `node:sqlite` 类型；若个别新 API 缺类型，补一小段 ambient 声明。
- 大文件：默认 1 GiB 上限可配；如需支持超大文件再考虑把哈希/复制移到 `utilityProcess`/worker，避免主进程抖动。
- 删除/GC 语义：本计划取"删除即最后引用回收"；如需更稳妥可加 `refcount` 列或周期性孤儿 blob 清扫（YAGNI，暂不做）。

## 11. 在总路线中的位置

- 本计划 = **Plan 3 of 4**。完成后：投喂真正落库，面板有文件库可管理，存储为 AI 分析就绪（内容寻址 + 完整性 + 去重）。
- **Plan 4**：mock→真 AI 对话 + 流式 + 动作联动（启用 `talk/think`）+ 历史持久化，并**读取 vault 中文件内容**交给 agent 分析（复用本计划的 `files` 表与 blob 定位）。
