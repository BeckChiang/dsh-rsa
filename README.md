# Real Startup Animation (RSA) · `dsh-rsa`

给 DeepSeek Harness 桌面版加一个**真正属于启动阶段**的启动画面：点图标立刻出画面，主窗口在画面后面继续加载。

A configurable startup splash screen for the DeepSeek Harness desktop app. The splash is rendered by the **Electron main process before the main window appears** — a real startup animation, not a launcher wrapper, and not a web page that flashes after the window is already up.

> 当前版本 **1.0.0**。仅 Windows 桌面版支持深度部署。
> Current release **1.0.0**. Deep deployment is Windows-desktop only.

---

## 效果

| 浅色 | 深色 |
| --- | --- |
| ![light splash](docs/media/splash-light.gif) | ![dark splash](docs/media/splash-dark.gif) |

> 28 帧循环，直接从真实启动画面录制；署名默认在右下角。设置页里可以浅色/深色并排对照。

它解决的是一个很具体的问题：**冷启动那几秒是纯黑或纯白空屏**。DSH 主窗口要等渲染进程、配置、工作区都准备好才出现，在此之前用户只能盯着空桌面，不知道是卡住了还是在启动。启动画面占住这段时间，同时把品牌和进度感做出来。

---

## 平台与依赖

| 项 | 说明 |
| --- | --- |
| 宿主 | DeepSeek Harness 桌面版（Electron 44 实测，0.2.2-rc.3） |
| 系统 | **仅 Windows**。启动画面窗口用 `transparent + frame:false + setShape` 裁剪圆角，`render.mjs` 只在 `win32` 创建它 |
| 非 Windows | 深度部署在动手之前直接返回错误，**不会**改写 `app.asar`；设置页的实时预览照常可用 |
| 运行时依赖 | 无。只依赖 DSH 自带的 `original-fs` 与 Node 内置模块 |

---

## 安装

### 从 npm

```powershell
# 在 DSH 里按包名安装（也可在插件市场面板搜索 dsh-rsa）
plugin_manager install_bundle dsh-rsa
```

### 从源码

```powershell
plugin_manager install_bundle https://github.com/BeckChiang/dsh-rsa
```

### 开发时挂软链

```jsonc
// <DSH_HOME>/profiles/<profile>/package.json
{
  "dependencies": {
    "dsh-rsa": "link:C:/path/to/dsh-rsa"
  }
}
```

软链方式下改源码**重启即生效**，不必重新 `install_bundle`。

安装后打开 **设置 → RSA 启动画面**。配置与部署状态写在插件目录下的 `data/`（`config.json` / `state.json`，不入库）；从 npm 安装时位于 profile 的 `node_modules/dsh-rsa/data/`，卸载重装会回到默认配置。

---

## 快速开始

1. **设置 → RSA 启动画面**：调参数，顶部预览实时更新（默认浅色、深色左右并排，便于同时看两套主题）。
2. 点 **深度部署**：先自动跑 7 项兼容性检查 → 通过后弹出二次确认面板（面板里写明回滚脚本路径）→ 确认后才写入。
3. **正常退出 DSH**，再启动 —— 新画面直接可见。**只需要重启一次。**

---

## 设置页导览

- **顶部预览**：浅色 / 深色**左右并排**，各占一半宽度，纵向只花掉原来一半的高度，把空间让给下面的表单。标题栏的按钮在「并排 / 仅浅色 / 仅深色」三态间循环，单看某一种时会恢复全宽大图，方便检查字重与边角。
- **顶部红字提醒**：需要重新做兼容性检查时才出现（见下节），旁边是「立即检查 / 重新检查」。
- **六个配置分组**：Logo、中心文字、署名、窗口、背景光球、进度光环。
- **兼容性与回滚**：手动跑检查、逐项看结果、显示回滚脚本的真实路径。
- **底部**：部署 / 仅保存，以及上次换入的结果（`applied (copy)` / `discarded: ...`）。

当前方案即默认方案，随时可以「恢复默认」。

---

## 部署机制

核心矛盾：**Windows 下运行中的 Electron 始终占用 `app.asar`**，启动阶段（splash 已加载之后）和运行期间都不能可靠替换它。所以策略是「现在准备、退出时换、下次启动生效」。

### 第 1 步：点「深度部署」

1. 客户端先跑一遍全量兼容性检查，不通过就直接拒绝。
2. 通过后弹二次确认面板，写明会改写 `app.asar`、**退出时才换入**、以及回滚脚本的完整路径。
3. 确认后 `POST /rsa/deploy` 带 `confirmed: true`；服务端**在写盘前再跑一次全量检查**（防止打开页面后宿主恰好被升级），任一项 `FAIL` 返回 409 且不碰 `app.asar`。
4. 读取当前配置 → 生成 `lib/splash.cjs`（参数化的启动画面 + 等 `app.whenReady()`、显示/关闭窗口的逻辑）。
5. 若入口（`package.json` 的 `main`，通常是 `lib/main.js`）还没有插桩，**自动在首行注入一行** `import("./splash.cjs").catch(() => {})`。
   - 不存在「先跑 hook 安装器」这一步：首次部署即自动插桩；DSH 升级把 `app.asar` 换回官方版本后，再点一次部署就会重新注入。
   - 插桩只有一行，与宿主 `main.js` 是 ESM 还是 CJS 无关。
6. 重打包出 `resources/app.asar.rsa-new`，并把 `lastDeployAt` / `pendingAsar` / `pendingSize` 记进 `state.json`。

> 重打包会**追加归档里还没有的文件**：干净的官方 `app.asar` 没有 `lib/splash.cjs`，部署时连缺失的中间目录一起补进去，再按新布局修正头部偏移——所以全新安装也能一次部署成功。任一步失败都会立刻删除 `app.asar.rsa-new`，不会把半成品留到下次启动。

### 第 2 步：正常退出 DSH

插件在进程退出前（`process.on("exit")`）校验 pending：

1. 入口确实带插桩、`lib/splash.cjs` 存在与当前配置一致；
2. 宿主版本没在部署之后升级过（读 `package.json.version` 对比）；
3. **按头部自带的对齐信息逐个文件重算 SHA256**，确认整包 2 万个文件字节都没错位。

通过就换入成 `app.asar`：

- 先试 `rename` —— 原子、不复制。但运行中的宿主仍持有文件句柄，Windows 下必然 `EPERM`；
- 于是走**复制兜底**：`copyFileSync` 覆盖正在被占用的 `app.asar`（Windows 允许对已打开的文件做覆盖写）→ `fsync` → 复读大小 + `verifyAsar(limit:5)` + 插桩 + splash 存在；
- 校验不过就用 `app.asar.rsa-backup` 还原，并把 pending 留给下次。

成功后删除 pending，`state.json` 记 `lastApplyResult: "applied (copy)"`、`lastApplyMode`、`lastApplyAt`。

### 第 3 步：下次启动

直接加载换好的 asar，显示新画面。

### 兜底路径

- **被强杀**（没有 exit 事件）：pending 留到下次启动。**启动阶段只校验、不换入** —— 此刻宿主仍在读归档，替换会让后续读取拿到错位字节；状态栏显示 pending 待应用，再正常退出一次即可换入。
- **手动换入**：状态栏能看到 `lastApplyResult`，失败原因写在里面。

首次部署会创建 `resources/app.asar.rsa-backup` 作为回滚点（只建一次，之后不覆盖）。

---

## 兼容性检查

DSH 升级会整包换掉 `app.asar`。本插件要往这个归档里写文件，**写入器必须与宿主的读取器完全对齐**，否则换上去就是一个起不来的包（0.2.4 就是这么炸的）。7 项检查全部为的是这一件事：

| 检查 | 抓什么 | 失败意味着 |
| --- | --- | --- |
| `file` | `resources/app.asar` 存在 | 没装对，或路径解析错 |
| `header` | `head[4]` / `head[8]` / `head[12]` 三者自洽、头部按 4 字节对齐、数据区不越界 | 头部布局变了（0.2.4 bug 的形状） |
| `layout` | 每个 entry 的 `offset + size` 落在数据区内；对齐空隙只记录不判失败 | 归档内部偏移不自洽 |
| `integrity` | 全量重算 SHA256（约 2 万个文件） | 归档已被改坏，或读取偏移错位 |
| `entry` | `package.json` 的 `main` 能读出来、内容像 JS、注入插桩后确实带 hook | 入口不可解析，注入了也起不来 |
| `roundtrip` | 把当前归档**原样重打包一次**，要求字节完全一致 | 本插件的写入器与这版宿主不对齐 —— **只有这项能证明写进去是安全的** |
| `version` | 宿主版本在 `lib/compat.mjs` 的 `TESTED_HOST_VERSIONS` 里 | 只是 `WARN`，不阻塞，但提示升级插件后重测 |

### 什么时候该跑

设置页顶部有一条**红字提醒**，出现条件只有三种：

1. **首次安装** —— `state.json` 里没有检查记录；
2. **宿主升级过** —— 上次记录里的 `lastCompatHostVersion` 与当前 `app.asar` 的 `package.json.version` 不一致（升级会换掉归档，旧结论对新包无效）；
3. **上次检查失败** —— `last-failed`，一直提醒到通过为止。

命中时插件加载 5 秒后**自动跑一次全量检查**并记录（启动日志 `[rsa] automatic compatibility check (<reason>, host <version>): passed`），设置页打开时若仍缺结论也补跑一次。结论按宿主版本写入 `state.json`：`lastCompatAt` / `lastCompatHostVersion` / `lastCompatOk` / `lastCompatFull` / `lastCompatError`。

**DSH 更新后**：先打开设置页看红字 → 等它自动跑完或点「立即检查」→ 若 `roundtrip` 或 `header` 变 `FAIL`，说明归档布局变了，**此时别部署**，升级插件或等适配。

---

## 回滚

**回滚脚本随插件安装**：`<插件目录>/bin/rsa-rollback.cmd`，绝对路径由 `rollbackPath()` 给出（设置页会显示当前实际路径，二次确认面板里也会写一遍）。插件每次加载、每次部署都会重写它，把解析到的 `resources` 路径烤进去。

DSH 起不来时，双击它即可把 `app.asar.rsa-backup` 复制回 `app.asar`：

- 先 `tasklist` 确认 `DeepSeek Harness.exe` 没在跑，没退出就提示先退出（**运行中复制会失败**）；
- 找不到备份 / 找不到 `app.asar` / 复制失败都有明确的退出码与提示；
- 纯 ASCII 批处理，不依赖 Node、DSH 或插件运行时；备份文件保留，可重复执行。

> 脚本**不入库**（`.gitignore` 里忽略）：里面烤的是每台机器的绝对路径，属于生成物。仓库里只有生成它的 `lib/rollback.mjs`。

手工回滚（等效）：退出 DSH，把 `resources\app.asar.rsa-backup` 复制成 `resources\app.asar`。

---

## 配置项

| 分组 | 可调 |
| --- | --- |
| 窗口 | 宽、高、圆角半径 |
| 主题 | 跟随系统 / 强制浅色 / 强制深色，浅色与深色卡片不透明度 |
| Logo | 倍率（0.1×–5×，1× = 320 px 基准宽，等比且不超过窗口宽）、距顶距离、自定义浅色/深色图 |
| 中心文字 | 内容、字号、字体、字重、斜体、距顶、动效（rise / fade / none）、周期、逐字延迟、字距 |
| 署名 | 内容、字号、是否显示、四角位置、偏移 |
| 背景光球 | 开关、动效（float / drift / pulse）、速度、两个光球透明度 |
| 进度光环 | 开关、样式（band / dots / breathe）、光带长度、周期、拖尾、线宽 |

---

## 踩过的坑

这一节是给未来的自己（和下一个要改这个插件的人）看的。每一条都真实发生过，按版本记录。

### 1. 部署后 DSH 静默起不来（0.2.4 的根因）

- **症状**：点「深度部署」→ 退出 → 再启动，进程出现又立刻消失，没有窗口，没有错误弹窗。桌面日志里只有 `Error: dsh desktop host stopped`，phase: startup。
- **根因**：`asar.mjs` 用 `head[12]`（头部 JSON 的**原始长度**）当头部大小，`dataOffset = 16 + jsonLen`。但 electron-builder 产物会把头部 JSON **补到 4 字节对齐**：真机 `jsonLen = 5,669,961`（`%4 == 1`），补了 3 个空格，真实数据区从 `16 + (head[4] - 8) = 5,669,980` 开始。按错的位置拷贝，重打包出的归档里**每个文件整体前移 3 字节**，宿主读到的 `package.json` / `lib/main.js` 全是垃圾 —— 于是应用一声不响地起不来。
- **修法**：按 Electron 自己的算法读头部 —— `headerSize = head.readUInt32LE(4) - 8`，`head[12]` 只用于取 JSON 长度并做兜底校验；`repackAsar()` 写头部时也按**字节**长度补空格对齐（`head[12]` 写未对齐长度，`head[4]/head[8]` 写对齐后的长度）。
- **教训**：归档格式的「看起来对」和「字节对」是两件事。现在 `verifyAsar()` 会逐个文件重算 SHA256，部署自检与换入后复检都跑它。

### 2. 部署自检一直「通过」（0.2.4）

- **症状**：上面那个坏包被 arm 了、还真换上了，因为部署自检说没问题。
- **根因**：自检用**同一个错 reader** 读回自己刚写的包 —— reader 错、writer 错、校验也错，三者自洽，谁都发现不了。
- **修法**：自检不看「读出来的东西像不像」，而是拿头部里**自带**的 `integrity.hash` 逐个比对内容字节（`verifyAsar()`）。独立于写入逻辑，才叫校验。
- **教训**：用错误的工具验证自己，等于没验证。

### 3. 大文件的 integrity 只有 1 个 block（0.2.4）

- **症状**：`verifyAsar()` 对 `main.js`（848 KB）开始报 block 数不符。
- **根因**：`integrityFor()` 只写了 `blocks: [sha256(整个文件)]`，而 asar 规范是**每 4 MiB 一块**，大文件应当有多块。
- **修法**：按 `ASAR_BLOCK_SIZE = 4 * 1024 * 1024` 分块，同时保留整包 `hash`。
- **教训**：规范里写「block」的地方，别想当然只有一块。

### 4. 测试 fixture 与 buggy reader 自洽，测不出 bug（0.2.4）

- **症状**：23 项测试全绿，线上照样炸。
- **根因**：`test/helpers.mjs` 的 `buildAsar()` 按 reader 的错误假定造归档（`head[12]` 写对齐后的长度、不补空格），fixture 与错误实现完美自洽。
- **修法**：fixture 改成 electron-builder 的真实布局（`head[12]` 写未对齐长度、补 1–3 个空格、`head[4]` 写对齐后长度 + 8），并新增 `archiveWithPaddedHeader()`（循环造 `jsonLen % 4 !== 0` 的归档）专门覆盖这条路径。
- **教训**：fixture 要按**真实产物**造，不能按自己的实现造。

### 5. 点部署 → 关闭 → 下次启动没变化（0.2.5 的回归）

- **症状**：部署提示成功，退出时也没报错，下次启动还是旧画面。`state.json` 里 `pendingAsar` 一直躺着。
- **根因**：0.2.4 把换入改成「只 `rename`」，删掉了复制兜底。Windows 下运行中的宿主**始终持有** `app.asar`，`rename` 必然 `EPERM` —— 唯一能生效的路径被亲手拆了。
- **修法**：`rename` 失败即回退 `copyFileSync` + `fsync` + 复读校验；失败则用备份还原并保留 pending。`state.json` 记录 `lastApplyResult` / `lastApplyMode`，设置页可见。
- **教训**：Windows 允许**覆盖**已被打开的文件，但不允许**替换**它（rename/unlink）。这条差异决定了整个部署策略。

### 6. 换入时机太晚，要重启两次（1.0.0 之前的设计）

- **症状**：部署后第一次重启没变化，第二次才看到新画面。
- **根因**：早期只在启动 2.5 秒后跑换入 —— 那时 splash 模块**已经加载完**，换进去的 asar 要等下一次启动才被读取。
- **修法**：启动阶段改为**只校验、不换入**（还能避免在宿主读归档时替换它的风险），真正换入放到 exit 事件。
- **教训**：要换的文件正在被读取时，唯一的正确时机是「没人再读它」之后。

### 7. 旧代码会把新 pending 删掉（0.2.5 排查中的发现）

- **症状**：用修复后的代码暂存了 pending，退出后文件消失，什么都没换上。
- **根因**：**正在运行的那个进程**加载的还是修复前的内存代码，它的 `applyPending()` 用错误的 reader 校验新包（头部有 3 字节填充）→ 判定「没有 hook」→ `unlinkSync` 删掉 pending。
- **修法/处置**：不硬改文件去骗旧 reader（依赖 Electron 内部到底按 `head[4]` 还是 `align4(head[12])` 定位 payload，猜错就又起不来）；正确做法是重启一次让新代码上位，再部署。
- **教训**：改宿主端部署逻辑时，「现在运行的进程是旧代码」本身就是个变量。

### 8. `layout` 检查把 48 KB 对齐空隙判成失败（0.2.5）

- **症状**：真机 `layout` 报错，但归档明明能用（`roundtrip` 字节一致）。
- **根因**：真实 `app.asar` 里 entry 之间有 **48,464 字节**的对齐空隙（electron-builder 给 unpacked payload 留的），检查把「任意 >4 B 的空隙」当失败。
- **修法**：只有**越界**（`start < dataOffset` 或 `end > size`）才失败，空隙只累计进 detail 文本。
- **教训**：校验要盯「安全边界」，不要盯「我期待的紧凑布局」。

### 9. 测试把随插件的回滚脚本烤成了临时路径（0.2.5 → 0.2.6）

- **症状**：跑完全套测试后，真实的 `bin/rsa-rollback.cmd` 里 `set "RES=..."` 指向 `%TEMP%` 下的假安装，双击回滚等于回滚到不存在的文件。
- **根因**：测试调用 `deploy()`（内部会 `ensureRollbackScript()`），而它无条件落盘到插件目录。
- **修法**：`targetsRealInstall(paths)` 守卫 —— 只有 `resources === process.resourcesPath` 或显式给了 `pluginDir` 时才写，并补回归用例「临时安装绝不改写随插件发行的脚本」。
- **教训**：测试有副作用不可怕，副作用写进**产品目录**才可怕。

### 10. 设置页只剩 `cannot get property "rsaPaths" without inject`（0.2.7）

- **症状**：点进 RSA 设置页，整页只有这一句错误。
- **根因**：为了给路由测试注入临时安装路径，`handle()` 里写了 `const overrides = ctx.rsaPaths || {}`。cordis 的 `ctx` 是 **Proxy**，读取任何没在 `inject` 里声明过的属性都会直接抛错 —— 生产环境**必然**命中，`/rsa/state` 一进来就抛，被路由 catch 包成 500。
- **修法**：路径覆盖改走模块级 `setPathOverrides()`（仅测试使用），`handle()` 一个 `ctx` 属性都不碰。
- **教训**：cordis 的 `ctx` 不是普通对象。要读什么，先写进 `inject`；测试专用的口子别挂在 ctx 上。

### 11. 假 ctx 是普通对象，抓不到 Proxy 的行为（0.2.7）

- **根因**：测试里 `ctxFor()` 返回 `{ rsaPaths: {...} }` —— 普通对象能读，Proxy 不能，测试与真实环境前提不一致，所以第 10 条没被测试拦住。
- **修法**：`strictCtx()` —— 一个 `get` 陷阱对任何属性都抛 `cannot get property "<name>" without inject` 的 Proxy，完全复刻 cordis 的行为。同类回归以后在 `node test/routes.test.mjs` 里就会失败。
- **教训**：假对象要假成**真实环境的形状**，不是「够用就行」。

### 12. 「恢复默认」按钮直接抛 ReferenceError（0.2.6 顺手修）

- **根因**：`reset()` 里调了不存在的 `setPreviewNonce((n) => n + 1)`（重构后遗留的调用）。
- **修法**：删掉。预览靠 `config` 变化驱动重渲染，不需要这个 nonce。

### 13. 预览吃掉一半纵向空间（1.0.0）

- **症状**：顶部预览固定在顶部（`position: sticky`），720 × 426 px，把设置表单挤到只剩一条缝。
- **根因**：`previewFrame` 单张、`maxWidth: 720`、`aspectRatio: 520 / 308` —— 宽度决定高度，720 宽就是 426 高。
- **修法**：改成浅色 / 深色**左右并排**，每张最多 380 宽（≈210 高），高度直接减半，还能同时对照两套主题；标题栏按钮改为「并排 / 仅浅色 / 仅深色」三态循环，单看时恢复全宽大图。缩放仍由每张自己的 `ResizeObserver` 驱动，互不影响。
- **教训**：预览是辅助，别让它比主内容还占地方。

### 排查小贴士（环境类）

- **`node --test` 在受限沙箱里 `spawn EPERM`**：改用逐个文件直跑 `node test/asar.test.mjs` 等。
- **`node -e` 跑 ESM 顶层 await 会报奇怪的 `JSON.parse` 错**：写成 `.mjs` 文件再跑。
- **启动日志不在你想的地方**：沙箱会把 `$TEMP` 重定向，真正的 splash 日志在 `C:\Users\recko\AppData\Local\Temp\dsh-splash.log`，路径别靠环境变量猜。
- **桌面崩溃日志**：`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*-main.log` / `crash-*-web-boot.log`。

---

## 版本历史

| 版本 | 要点 |
| --- | --- |
| 1.0.0 | 预览改浅色/深色并排 + 三态切换（省一半纵向空间）；README 重写，踩坑全量归档；版本号进入 1.x |
| 0.2.7 | 修设置页 `cannot get property "rsaPaths" without inject`（cordis ctx 是 Proxy）；测试改用 `strictCtx()` |
| 0.2.6 | 顶部红字提醒（首次安装 / 宿主升级 / 上次失败）+ 自动检查；部署前二次确认并写明回滚路径；服务端要求 `confirmed: true` 且写盘前再查一次；修「恢复默认」ReferenceError |
| 0.2.5 | 恢复复制兜底换入（0.2.4 的 rename-only 是回归）+ fsync + 换入后复检 + 失败还原；7 项兼容性检查；随插件安装的回滚脚本；启动阶段只校验 |
| 0.2.4 | 修 asar 头部 4 字节对齐（部署后起不来）；新增 `verifyAsar()` 全量校验；`integrity.blocks` 按 4 MiB 分块 |
| 0.2.3 | 部署改为「退出时换入、下次启动生效」 |
| 0.2.2 | 原子换入、CSRF 防护、嵌套入口插桩、过期 splash 检测 |
| 0.2.1 | 首次部署自动追加缺失的 splash 模块、Windows-only 限制、换入前校验 pending |
| 0.2.0 | 首个可用版本：配置页、实时预览、深度部署 |

---

## 开发结构

```
plugins/rsa/
├─ index.js            # host：/rsa 路由（state / preview / config / reset / compat / deploy）
├─ client.js           # client：settings.section 设置页
├─ cordis.patch.yml    # 插件挂载声明
├─ package.json
├─ locale/             # en / zh-CN 元数据
├─ lib/
│  ├─ defaults.mjs     # 默认配置 + normalizeConfig 校验
│  ├─ render.mjs       # 参数化 splash HTML + CJS 生成
│  ├─ asar.mjs         # asar 读写/重打包（original-fs）+ verifyAsar
│  ├─ hook.mjs         # 入口一行插桩的检测与注入
│  ├─ deploy.mjs       # 部署、pending 换入（rename→copy）、备份
│  ├─ compat.mjs       # 兼容性检查（7 项）+ compatStatus 判定
│  ├─ rollback.mjs     # 生成 bin/rsa-rollback.cmd
│  ├─ store.mjs        # 配置与状态持久化（data/）
│  └─ brand-*.svg      # 官方矢量 logo（浅色/深色）
├─ bin/
│  └─ rsa-rollback.cmd # 一键回滚脚本（运行时生成，不入库）
├─ test/               # node:test 用例（asar / hook / deploy / apply / compat / routes）
└─ data/               # 运行时配置与状态（不入库）
```

---

## 测试

```powershell
node --test
```

受限环境（沙箱里 `node --test` 会 `spawn EPERM`）逐个文件跑：

```powershell
node test/asar.test.mjs
node test/deploy.test.mjs
node test/hook.test.mjs
node test/apply.test.mjs
node test/compat.test.mjs
node test/routes.test.mjs
```

当前 **48 项**全绿，覆盖：

- **asar**：在干净归档里追加新文件与缺失目录、替换后的偏移与 integrity、父节点是文件时报错、带 4 字节填充的头部能被正确解析、重打包后字节不变、payload 被移动时 `verifyAsar()` 能查出；
- **hook**：幂等、shebang 处理；
- **deploy**：首次部署、失败清理 pending、非 Windows 拒绝部署；
- **apply**：**宿主仍持有 `app.asar` 时经复制路径换入成功（`mode: "copy"`）**、启动阶段只校验不换入、损坏 pending 被丢弃且不动 live、跨版本 pending 被丢弃、重复部署不重复插桩、回滚脚本内容与位置；
- **compat**：7 项检查在正常归档上通过、截断/损坏/入口不可解析时判失败、未测试版本只 `WARN`、检查本身不改归档；`compatStatus` 的五种判定（首次 / 命中 / 升级后失效 / 上次失败 / 找不到归档）；
- **routes**：未带 `confirmed: true` 的部署一律 400 且不写盘、`/state` 带出 `compat`、全量检查后提醒消失、宿主换版后重新提醒、临时安装不改写随插件发行的回滚脚本、`strictCtx()` 防止再读 ctx 未知属性。

---

## 发布

```powershell
cd plugins/rsa
node --test          # 或逐个文件跑
npm publish          # 需要 npm 登录与 2FA OTP
```

`files` 白名单决定包里有什么：`index.js`、`client.js`、`cordis.patch.yml`、`lib/**/*`、`bin/**`、`locale/*.json`、`icon.svg`、`docs/media/*.gif`。

---

## 已知限制

- **仅限 Windows**：`render.mjs` 只在 `win32` 创建启动画面窗口；`deploy()` 在其它平台直接返回错误并说明原因，不改写 `app.asar`。
- `setShape` 圆角裁剪依赖 Electron 版本；DSH 桌面端（Electron 44）可用。
- 启动画面窗口是 `transparent + frame:false + setShape`，非 DSH 桌面端不适用。
- 插件只改 `app.asar`，不碰官方 exe，不会触发 SmartScreen。
- 设置页的实时预览通过 `POST /rsa/preview` 生成，iframe 以 `srcdoc` 渲染；并排模式下是两次请求（同一份配置、两套主题），服务端是纯字符串渲染，成本可忽略。
- DSH 升级会覆盖 `app.asar`，届时重新部署一次即可（插桩会自动补回）。

---

## 许可

MIT © BeckChiang
