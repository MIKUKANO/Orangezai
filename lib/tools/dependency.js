import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import cfg from "../config/config.js"

/** 正在安装的插件 workspace，避免同一个插件重复触发 bun install */
const installing = new Set()
/** 自动安装关闭或无法安装时，同一类提示只打印一次，避免刷屏 */
const notified = new Set()
/** 等待批量安装的插件 workspace */
const pending = new Map()
let installTimer = null
let installTask = null

/** 从 Node 的模块缺失错误里提取包名，保留给旧调用方使用 */
export function getMissingPackage(error) {
    return getMissingDependency(error)?.name || false
}

/** 解析缺失依赖名和触发 import 的文件路径 */
export function getMissingDependency(error) {
    const text = collectErrorText(error)

    if (!/ERR_MODULE_NOT_FOUND|Cannot find (?:package|module)/.test(text)) {
        return false
    }

    const match = text.match(/Cannot find (?:package|module) ['"]([^'"]+)['"]/)
    const name = match?.[1]
    if (!name || !isSafePackageName(name)) {
        return false
    }

    return {
        name,
        importer: getImporterPath(text),
        text
    }
}

/** 日志里可能传入 Error、字符串或数组，这里统一展开成可匹配文本 */
function collectErrorText(value, seen = new Set()) {
    if (!value) {
        return ""
    }

    if (typeof value === "string") {
        return value
    }

    if (typeof value !== "object") {
        return String(value)
    }

    if (seen.has(value)) {
        return ""
    }
    seen.add(value)

    if (Array.isArray(value)) {
        return value
            .map(item => collectErrorText(item, seen))
            .filter(Boolean)
            .join("\n")
    }

    return [
        value.code,
        value.message,
        value.stack,
        collectErrorText(value.cause, seen)
    ]
        .filter(Boolean)
        .join("\n")
}

function getImporterPath(text) {
    const imported = text.match(/imported from\s+['"]?([^'"\n)]+)/)
    if (imported?.[1]) {
        return imported[1]
    }

    const stackFile = text.match(/\bat\s+(file:\/\/\/[^\s)]+|[A-Za-z]:[^\s)]+|\/[^\s)]+)/)
    return stackFile?.[1] || ""
}

/**
 * 缺依赖处理入口。
 * 返回 true 表示这个错误已经交给自动安装队列处理，调用方可以跳过后续报错。
 */
export async function installMissingDependency(error, source = "") {
    const missing = getMissingDependency(error)
    if (!missing) {
        return false
    }

    const workspace = resolvePluginWorkspace(missing.importer, source)
    if (!workspace) {
        notifyOnce(
            `unresolved:${missing.name}:${source}`,
            [
                `检测到缺少依赖 ${logger.red(missing.name)}`,
                source,
                "无法定位到具体插件目录，已跳过自动安装"
            ]
        )
        return false
    }

    const manifest = readPluginManifest(workspace)
    if (!manifest) {
        notifyOnce(
            `no-package:${workspace.name}:${missing.name}`,
            [
                `${logger.cyan(workspace.name)} 缺少依赖 ${logger.red(missing.name)}`,
                `插件目录没有 package.json，请插件声明依赖后执行 ${logger.green(`bun install --filter ${workspace.filter}`)}`
            ]
        )
        return false
    }

    const declared = getDeclaredRuntimeDependency(manifest, missing.name)
    if (!declared) {
        const declaredElsewhere = getDeclaredNonRuntimeDependency(manifest, missing.name)
        notifyOnce(
            `undeclared:${workspace.name}:${missing.name}`,
            [
                `${logger.cyan(workspace.name)} 缺少依赖 ${logger.red(missing.name)}`,
                declaredElsewhere
                    ? `该依赖只声明在 ${declaredElsewhere}，不会自动安装为运行时依赖`
                    : `插件 package.json 未声明该依赖，请在插件目录手动执行 ${logger.green(`bun add ${missing.name}@<version>`)} 或让插件作者声明正确版本`
            ]
        )
        return false
    }

    if (!isAutoInstallEnabled()) {
        notifyOnce(
            `disabled:${workspace.name}:${missing.name}`,
            [
                `${logger.cyan(workspace.name)} 缺少依赖 ${logger.red(missing.name)}@${declared}`,
                `请手动执行 ${logger.green(`bun install --filter ${workspace.filter}`)}，或设置 ORANGEZAI_AUTO_INSTALL_DEPS=true 后自动安装`
            ]
        )
        return false
    }

    queueInstall(workspace, missing.name, declared, source)
    return true
}

/** 延迟 1 秒安装，用来把同一轮插件加载里发现的多个插件 workspace 合并为一次 bun install */
function queueInstall(workspace, packageName, version, source = "") {
    const key = workspace.filter
    const item = pending.get(key) || {
        ...workspace,
        packages: new Map(),
        sources: new Set()
    }

    item.packages.set(packageName, version)
    if (source) {
        item.sources.add(source)
    }
    pending.set(key, item)

    Bot.makeLog(
        "mark",
        [
            `${logger.cyan(workspace.name)} 缺少依赖 ${logger.red(packageName)}@${version}`,
            source,
            "已加入插件依赖安装队列"
        ],
        "Dependency"
    )

    if (!installTimer) {
        installTimer = setTimeout(() => {
            installTimer = null
            installTask = installPending()
                .catch(err => {
                    Bot.makeLog(
                        "error",
                        [
                            "插件依赖批量安装异常",
                            err
                        ],
                        "Dependency"
                    )
                    return false
                })
                .finally(() => {
                    installTask = null
                })
        }, 1000)
    }

    return installTask
}

/** 执行当前队列里的 workspace 批量安装，成功后退出进程交给 PM2 或外部守护重启 */
async function installPending() {
    const workspaces = [
        ...pending.values()
    ].filter(item => !installing.has(item.filter))
    if (!workspaces.length) {
        return false
    }

    pending.clear()
    for (const item of workspaces) {
        installing.add(item.filter)
    }

    const command = [
        "bun",
        "install"
    ]
    for (const item of workspaces) {
        command.push("--filter", item.filter)
    }

    Bot.makeLog(
        "mark",
        [
            "正在按插件 workspace 安装依赖",
            logger.green(formatCommand(command))
        ],
        "Dependency"
    )

    try {
        const ret = await Bot.exec(command)

        if (ret.error) {
            Bot.makeLog(
                "error",
                [
                    `插件依赖安装失败 ${formatWorkspacePackages(workspaces)}`,
                    ret
                ],
                "Dependency"
            )
            return false
        }

        await cacheRestartMessage(workspaces)
        Bot.makeLog("mark", `插件依赖安装完成 ${logger.green(formatWorkspacePackages(workspaces))}，准备重启`, "Dependency")
        setTimeout(() => process.exit(), 1000)
        return true
    } finally {
        for (const item of workspaces) {
            installing.delete(item.filter)
        }
    }
}

/** 写入重启后的提示信息，复用 restart.js 的上线通知逻辑 */
async function cacheRestartMessage(workspaces) {
    try {
        await redis.set(
            "Yz:restart",
            JSON.stringify({
                reason: "dependency",
                packages: [
                    ...new Set(workspaces.flatMap(item => [
                        ...item.packages.keys()
                    ]))
                ],
                workspaces: workspaces.map(item => ({
                    name: item.name,
                    filter: item.filter,
                    packages: [
                        ...item.packages.keys()
                    ]
                })),
                time: Date.now()
            })
        )
    } catch (err) {
        Bot.makeLog(
            "error",
            [
                "依赖安装提示写入失败",
                err
            ],
            "Dependency"
        )
    }
}

function resolvePluginWorkspace(importer = "", source = "") {
    const candidates = [
        importer,
        source
    ].filter(Boolean)

    for (const item of candidates) {
        const name = getPluginName(item)
        if (!name) {
            continue
        }

        const dir = path.join(process.cwd(), "plugins", name)
        if (!fs.existsSync(dir)) {
            continue
        }

        return {
            name,
            dir,
            packageFile: path.join(dir, "package.json"),
            filter: `./plugins/${name}`
        }
    }

    return false
}

function getPluginName(value = "") {
    let normalized = normalizePath(value)
    let match = normalized.match(/(?:^|\/)plugins\/([^/]+)/)
    if (match?.[1]) {
        return match[1]
    }

    normalized = normalized.replace(/^\.?\//, "")
    const first = normalized.split("/")[0]
    if (!first || first.includes(".") || first === "plugins") {
        return ""
    }
    return first
}

function normalizePath(value = "") {
    value = String(value).trim()
    if (value.startsWith("file:")) {
        try {
            value = fileURLToPath(value)
        } catch {}
    }
    return value.replace(/\\/g, "/")
}

function readPluginManifest(workspace) {
    if (!fs.existsSync(workspace.packageFile)) {
        return false
    }

    try {
        return JSON.parse(fs.readFileSync(workspace.packageFile, "utf8"))
    } catch (err) {
        Bot.makeLog(
            "error",
            [
                `读取插件 package.json 失败 ${workspace.name}`,
                err
            ],
            "Dependency"
        )
        return false
    }
}

function getDeclaredRuntimeDependency(manifest, name) {
    return manifest.dependencies?.[name] || manifest.optionalDependencies?.[name] || false
}

function getDeclaredNonRuntimeDependency(manifest, name) {
    if (manifest.devDependencies?.[name]) {
        return "devDependencies"
    }
    if (manifest.peerDependencies?.[name]) {
        return "peerDependencies"
    }
    return false
}

function notifyOnce(key, msg) {
    if (notified.has(key)) {
        return
    }
    notified.add(key)
    Bot.makeLog("warn", msg, "Dependency")
}

function formatWorkspacePackages(workspaces) {
    return workspaces
        .map(item => `${item.name} (${[
            ...item.packages.keys()
        ].join(", ")})`)
        .join("; ")
}

function formatCommand(command) {
    return command
        .map(item => /\s/.test(item) ? `"${item}"` : item)
        .join(" ")
}

/** 只允许 npm 包名格式，避免把错误文本拼进安装命令 */
function isSafePackageName(name) {
    return /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)
}

/** 需要显式开启，且只会安装插件 package.json 已声明的运行时依赖 */
function isAutoInstallEnabled() {
    return (
        process.env.ORANGEZAI_AUTO_INSTALL_DEPS === "true" ||
        process.env.ORANGEZAI_AUTO_INSTALL_DEPS === "1" ||
        cfg?.bot?.auto_install_dependencies === true
    )
}
