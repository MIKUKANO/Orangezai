import cfg from "../config/config.js"

/** 正在执行 bun add 的包，避免同一个包重复安装 */
const installing = new Set()
/** 自动安装关闭时，同一个缺包只提示一次，避免刷屏 */
const notified = new Set()
/** 等待批量安装的包名和触发来源 */
const pending = new Map()
let installTimer = null
let installTask = null

/** 从 Node 的模块缺失错误里提取包名 */
export function getMissingPackage(error) {
    const text = collectErrorText(error)

    if (!/ERR_MODULE_NOT_FOUND|Cannot find (?:package|module)/.test(text)) {
        return false
    }

    const match = text.match(/Cannot find (?:package|module) ['"]([^'"]+)['"]/)
    const name = match?.[1]
    if (!name || !isSafePackageName(name)) {
        return false
    }
    return name
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
        return value.map(item => collectErrorText(item, seen)).filter(Boolean).join("\n")
    }

    return [
        value.code,
        value.message,
        value.stack,
        collectErrorText(value.cause, seen)
    ].filter(Boolean).join("\n")
}

/**
 * 缺依赖处理入口。
 * 返回 true 表示这个错误已经交给自动安装队列处理，调用方可以跳过后续报错。
 */
export async function installMissingDependency(error, source = "") {
    const name = getMissingPackage(error)
    if (!name || installing.has(name)) {
        return false
    }

    /** 自动安装会修改 package.json 和 bun.lock，默认关闭更适合第三方插件环境 */
    if (!isAutoInstallEnabled()) {
        if (!notified.has(name)) {
            notified.add(name)
            Bot.makeLog(
                "warn",
                [
                    `检测到缺少依赖 ${logger.red(name)}`,
                    source,
                    `请手动执行 ${logger.green(`bun add ${name}`)}，或设置 ORANGEZAI_AUTO_INSTALL_DEPS=true 后自动安装`
                ],
                "Dependency"
            )
        }
        return false
    }

    queueInstall(name, source)
    return true
}

/** 延迟 1 秒安装，用来把同一轮插件加载里发现的多个缺包合并为一次 bun add */
function queueInstall(name, source = "") {
    if (!pending.has(name)) {
        pending.set(name, new Set())
    }
    if (source) {
        pending.get(name).add(source)
    }

    Bot.makeLog("mark", [`检测到缺少依赖 ${logger.red(name)}`, source, "已加入安装队列"], "Dependency")

    if (!installTimer) {
        installTimer = setTimeout(() => {
            installTimer = null
            installTask = installPending()
                .catch(err => {
                    Bot.makeLog("error", ["依赖批量安装异常", err], "Dependency")
                    return false
                })
                .finally(() => {
                    installTask = null
                })
        }, 1000)
    }

    return installTask
}

/** 执行当前队列里的批量安装，成功后退出进程交给 PM2 或外部守护重启 */
async function installPending() {
    const packages = [...pending.keys()].filter(name => !installing.has(name))
    if (!packages.length) {
        return false
    }

    pending.clear()
    for (const name of packages) {
        installing.add(name)
    }

    const command = `bun add ${packages.join(" ")}`
    Bot.makeLog("mark", [`正在批量安装依赖`, logger.green(command)], "Dependency")

    try {
        const ret = await Bot.exec(command)

        if (ret.error) {
            Bot.makeLog("error", [`依赖安装失败 ${packages.join(", ")}`, ret], "Dependency")
            return false
        }

        await cacheRestartMessage(packages)
        Bot.makeLog("mark", `依赖安装完成 ${logger.green(packages.join(", "))}，准备重启`, "Dependency")
        setTimeout(() => process.exit(), 1000)
        return true
    } finally {
        for (const name of packages) {
            installing.delete(name)
        }
    }
}

/** 写入重启后的提示信息，复用 restart.js 的上线通知逻辑 */
async function cacheRestartMessage(packages) {
    try {
        await redis.set("Yz:restart", JSON.stringify({
            reason: "dependency",
            packages,
            time: Date.now()
        }))
    } catch (err) {
        Bot.makeLog("error", ["依赖安装提示写入失败", err], "Dependency")
    }
}

/** 只允许 npm 包名格式，避免把错误文本拼进 shell 命令 */
function isSafePackageName(name) {
    return /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)
}

/** 需要显式开启，防止插件导入任意包时自动拉取外部代码 */
function isAutoInstallEnabled() {
    return process.env.ORANGEZAI_AUTO_INSTALL_DEPS === "true" ||
        process.env.ORANGEZAI_AUTO_INSTALL_DEPS === "1" ||
        cfg?.bot?.auto_install_dependencies === true
}
