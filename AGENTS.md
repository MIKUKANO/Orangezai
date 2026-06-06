# Repository Guidelines

## 项目结构与模块组织
`app.js` 是进程入口，前台模式下会负责拉起和重启 Bot；`index.js` 作为包入口导出。核心运行时代码位于 `lib/`，是贡献者最常接触的目录：

- `lib/bot.js`：Bot 主运行时入口，负责组装服务模块、启动流程、基础工具方法和多账号聚合能力。
- `lib/bot/`：`bot.js` 的内部服务拆分目录。`file.js` 处理文件 URL 和 Buffer/下载逻辑，`message.js` 处理事件增强、消息路由与转发，`server.js` 处理 HTTP/WebSocket 服务，`store.js` 处理基于 LevelDB 的 Map 持久化。
- `lib/config/`：配置系统。`config.js` 负责合并 `default_config` 与本地配置并监听热更新，`init.js` 负责启动初始化，`log.js` 和 `redis.js` 分别处理日志与 Redis 连接。
- `lib/events/`：按事件类型拆分的事件入口，例如 `message.js`、`notice.js`、`request.js`、`connect.js`、`online.js`。
- `lib/listener/`：事件监听器加载层，负责把 `lib/events/` 下的处理器注册到运行时。
- `lib/plugins/`：插件运行时核心。`loader.js` 负责扫描 `plugins/`、热重载和任务收集，`plugin.js` 提供插件基类，`handler.js` 和 `runtime.js` 处理上下文与调用链。
- `lib/renderer/`：渲染器抽象层，`loader.js` 从 `renderers/<name>/index.js` 动态加载后端，`Renderer.js` 提供统一接口。
- `lib/browser/`、`lib/puppeteer/`：浏览器实例和渲染相关能力。
- `lib/tools/`：开发和运行辅助脚本，如依赖补装、Web 工具和部署脚本。
- `lib/modules/`：本地补丁模块与私有依赖包装，如 `md5`、`node-fetch`、`oicq` 和 `log4js.patch`。

插件从 `plugins/` 动态发现，既支持 `plugins/<name>/index.js`，也支持插件目录下直接放置多个 `.js` 文件。内置插件分组主要包括 `plugins/adapter`、`plugins/other` 和 `plugins/system`。

`plugins/other/` 目前采用“多文件插件”形式，没有统一 `index.js`。这里主要放运维和辅助能力，而不是协议接入层：

- `install.js`：处理 `#安装...` 指令，克隆插件仓库并在需要时执行 `bun install`。
- `restart.js`：处理 `#重启`、`#关机`、`#停止` 等进程控制命令，也负责定时启停逻辑。
- `update.js`：负责更新相关命令和仓库同步逻辑。
- `sendLog.js`：用于日志或错误信息回传。
- `version.js`：处理 `#版本` 等版本展示能力。
- `common.js`：`install.js` 和 `update.js` 共享的命令执行、`bun install` 拼装和 git 错误处理辅助函数。

修改 `plugins/other/` 下文件时，优先保持“单文件单职责”模式；新增命令应沿用现有 `rule`、`permission`、`reply` 和日志输出风格。

渲染后端位于 `renderers/<name>/`，每个目录通过 `index.js` 注册。共享工作区包位于 `packages/`，当前包含 `packages/puppeteer`。默认配置放在 `config/default_config/`，本地可编辑配置放在 `config/config/`。静态网页资源位于 `resources/http/`。`logs/`、`data/`、`temp/` 属于运行产物，不应作为源码修改目标。

## 构建、运行与开发命令
本仓库使用 Bun 管理依赖和脚本：

- `bun install`：安装根工作区及插件依赖。
- `bun run dev`：以开发模式启动 Bot。
- `bun run app`：直接运行主程序。
- `bun run start` / `bun run stop` / `bun run restart`：通过 `config/pm2.yaml` 管理 PM2 进程。
- `bun run log`：查看最近的 PM2 日志。
- `bun run browser:install`：安装 Playwright Chromium，供渲染器使用。
- `bun run test`：运行当前最小自动化测试。
- `bun run check` / `bun run check:fix`：运行 Biome 检查，可选自动修复。
- `bun run format`：使用 Biome 格式化代码。

## MCP 工具使用要求
如果需要了解项目、理解代码上下文、做探索性搜索，优先使用 `mcp__fast-context__fast_context_search`，不要先假设代码位置或直接做大范围关键词扫描。

### 核心原则
**任何需要理解代码上下文、探索性搜索、或自然语言定位代码的场景，优先使用 `mcp__fast-context__fast_context_search`。**

### 必须优先使用 fast-context 的场景
- 探索性搜索：不确定代码位于哪个文件或目录。
- 自然语言描述要找的逻辑：例如“XX 部署流程”“XX 事件处理”。
- 理解业务逻辑和调用链路。
- 跨模块、跨层级查询：例如从 router 追到 service 再到 model。
- 新任务开始前的代码调研和架构理解。
- 中文语义搜索：工具支持中英文双语查询。

### 根据需求选择工具
- 语义搜索或不确定位置：使用 `fast_context_search`，返回文件、行号范围和后续 grep 关键词建议。
- 精确关键词搜索：使用 grep。
- 已知文件路径并查看内容：直接读取文件。
- 按文件名模式查找：使用 glob 或等价文件查找方式。
- 编辑已有文件：使用编辑工具，不把搜索工具当读取工具替代。

### fast_context_search 参数调优
- `tree_depth=1, max_turns=1`：快速粗查，适合小项目或初步定位。
- `tree_depth=3, max_turns=3`：默认平衡配置，适合大多数场景。
- `max_turns=5`：深度搜索，适合复杂调用链追踪。
- `project_path`：指定搜索的项目根目录，默认使用当前工作目录。

## 代码风格与命名约定
统一使用 Biome 进行格式化和静态检查。保持 4 空格缩进、双引号、无分号，单行长度尽量控制在 120 列以内。目录名和模块文件名以小写为主，加载器类文件沿用现有命名，如 `loader.js`、`handler.js`、`runtime.js`。新增代码应保持 ESM 风格，并遵循现有运行时全局约定，例如 `Bot`、`Renderer`、`plugin`、`redis`，不要随意引入新的全局模式。

## 测试说明
当前仓库已有最小测试目录 `tests/`，目前包含 `plugin-context.test.js`，用于覆盖 `lib/plugins/plugin.js` 的上下文状态机。提交前至少运行 `bun run check`，涉及底层运行时或插件交互逻辑时同步运行 `bun run test`。修改插件或渲染器时，重点确认加载是否成功、命令匹配是否正常、配置读取是否符合预期。

## 提交与 Pull Request 规范
现有提交历史以简短、直接的标题为主，常见中文描述，也有 `chore:` 这类前缀。提交信息应聚焦单一改动，例如 `fix: plugin hot reload path`、`优化渲染器加载日志`。PR 需要说明改动摘要、影响目录、是否涉及配置或依赖变更，以及明确的人工验证步骤。涉及网页渲染、界面输出或 Bot 行为变更时，附上截图或关键日志更合适。

## 安全与配置建议
不要提交密钥、机器人凭据或本地专用配置。默认安全配置放在 `config/default_config/`，机器相关配置保留在 `config/config/`。如果插件新增依赖，应同步更新 `package.json`，确保其他开发者执行 `bun install` 后可以复现运行环境。
