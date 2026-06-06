export function execPluginCommand(cmd, plugin = "", opts = {}) {
    if (plugin) {
        opts = {
            ...opts,
            cwd: `plugins/${plugin}`
        }
    }
    return Bot.exec(cmd, opts)
}

export function buildBunInstallCommand(filters = []) {
    const command = [
        "bun",
        "install"
    ]
    for (const filter of filters.filter(Boolean)) {
        command.push("--filter", filter)
    }
    return command
}

export function buildForceUpdateCommands(remoteBranch = "") {
    return [
        [
            "git",
            "fetch",
            "--prune"
        ],
        [
            "git",
            "reset",
            "--hard",
            remoteBranch
        ]
    ]
}

export function getGitErrorUrl(error = "") {
    const cleaned = String(error).replace(/(Cloning into|正克隆到)\s*'.+?'/g, "")
    return cleaned.match(/'(.+?)'/)?.[1] || ""
}

export async function handleGitError({
    reply,
    error = "",
    stdout = "",
    conflictMessage = "",
    unknownMessage = "",
    retryRebase
}) {
    if (/unable to access|无法访问/.test(error)) {
        const url = getGitErrorUrl(error)
        await reply(`远程仓库连接错误：${url || error}`)
        return false
    }

    if (/not found|未找到|does not (exist|appear)|不存在|Authentication failed|鉴权失败/.test(error)) {
        const url = getGitErrorUrl(error)
        await reply(`远程仓库地址错误：${url || error}`)
        return false
    }

    if (/be overwritten by merge|被合并操作覆盖/.test(error) || /Merge conflict|合并冲突/.test(stdout)) {
        await reply(conflictMessage || `${error}\n${stdout}`)
        return false
    }

    if (/divergent branches|偏离的分支/.test(error) && typeof retryRebase === "function") {
        const ret = await retryRebase()
        if (!ret.error && /Successfully rebased|成功变基/.test(ret.stdout + ret.stderr)) {
            return true
        }
        await reply(conflictMessage || `${error}\n${stdout}`)
        return false
    }

    await reply(unknownMessage || `${error}\n${stdout}`)
    return false
}
