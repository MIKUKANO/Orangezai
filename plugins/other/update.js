import fs from "node:fs/promises"
import { Restart } from "./restart.js"
import { buildBunInstallCommand, execPluginCommand, handleGitError } from "./common.js"

let uping = false

export class update extends plugin {
    constructor() {
        super({
            name: "更新",
            dsc: "#更新 #强制更新",
            event: "message",
            priority: 4000,
            rule: [
                {
                    reg: "^#更新日志",
                    fnc: "updateLog"
                },
                {
                    reg: "^#(安?静)?(强制)?更新",
                    fnc: "update"
                },
                {
                    reg: "^#全部(安?静)?(强制)?更新$",
                    fnc: "updateAll",
                    permission: "master"
                }
            ]
        })
        this.typeName = "Orangezai"
    }

    get quiet() {
        return this.e.msg.includes("全部") || /^#安?静/.test(this.e.msg)
    }

    async replyUpdate(msg, type = "success") {
        if (!msg) return false
        const msgs = type === "error" ? this.updateErrMsgs : this.updateMsgs
        if (!Array.isArray(msgs)) return this.reply(msg)

        if (msg.type === "node" && Array.isArray(msg.data)) msgs.push(...msg.data)
        else
            msgs.push({
                message: msg
            })
        return true
    }

    exec(cmd, plugin, opts = {}) {
        return execPluginCommand(cmd, plugin, opts)
    }

    async update() {
        if (!this.e.isMaster) return false
        if (uping) {
            await this.reply("正在更新，请稍候再试")
            return false
        }

        /** 获取插件 */
        const plugin = await this.getPlugin()
        if (plugin === false) return false

        uping = true
        this.isPkgUp = false
        this.isUp = false
        this.pkgUpPlugins = new Set()
        try {
            await this.runUpdate(plugin)

            const packageUpdated = !this.isPkgUp || (await this.updatePackage())
            if (packageUpdated && this.isUp) this.restart()
        } finally {
            delete this.pkgUpPlugins
            uping = false
        }
    }

    async getPlugin(plugin = this.e.msg.replace(/#(安?静)?(强制)?更新(日志)?/, "")) {
        if (!plugin) return ""
        for (const i of [
            plugin,
            `${plugin}-Plugin`,
            `${plugin}-plugin`
        ])
            if (await Bot.fsStat(`plugins/${i}/.git`)) {
                this.typeName = i
                return i
            }
        return false
    }

    async runUpdate(plugin = "") {
        let cm = "git pull"
        let type = "更新"
        if (!plugin) cm = `git checkout package.json && ${cm}`

        if (this.e.msg.includes("强制")) {
            type = "强制更新"
            cm = `git reset --hard ${await this.getRemoteBranch(true, plugin)} && git pull --rebase`
        }
        this.oldCommitId = await this.getCommitId(plugin)

        logger.mark(`${this.e.logFnc} 开始${type} ${this.typeName}`)
        if (!this.quiet) await this.replyUpdate(`开始${type} ${this.typeName}`)
        const ret = await this.exec(cm, plugin)

        if (ret.error && !(await this.gitErr(plugin, ret.stdout, ret.error.message))) {
            logger.mark(`${this.e.logFnc} 更新失败 ${this.typeName}`)
            return false
        }

        const time = await this.getTime(plugin)
        if (/Already up|已经是最新/.test(ret.stdout)) {
            if (!this.quiet) await this.replyUpdate(`${this.typeName} 已是最新\n最后更新时间：${time}`)
        } else {
            this.isUp = true
            if (/package\.json/.test(ret.stdout)) {
                this.isPkgUp = true
                this.pkgUpPlugins ??= new Set()
                this.pkgUpPlugins.add(plugin)
            }
            await this.replyUpdate(`${this.typeName} 更新成功\n更新时间：${time}`)
            await this.replyUpdate(await this.getLog(plugin))
        }

        logger.mark(`${this.e.logFnc} 最后更新时间：${time}`)
        return true
    }

    async getCommitId(...args) {
        return (await this.exec("git rev-parse --short HEAD", ...args)).stdout
    }

    async getTime(...args) {
        return (await this.exec('git log -1 --pretty=%cd --date=format:"%F %T"', ...args)).stdout
    }

    async getBranch(...args) {
        return (await this.exec("git branch --show-current", ...args)).stdout
    }

    async getRemote(branch, ...args) {
        return (await this.exec(`git config branch.${branch}.remote`, ...args)).stdout
    }

    async getRemoteBranch(string, ...args) {
        const branch = await this.getBranch(...args)
        if (!branch && string) return ""
        const remote = await this.getRemote(branch, ...args)
        if (!remote && string) return ""
        return string
            ? `${remote}/${branch}`
            : {
                  remote,
                  branch
              }
    }

    async getRemoteUrl(branch, hide, ...args) {
        if (branch) {
            const url = (await this.exec(`git config remote.${branch}.url`, ...args)).stdout
            return hide ? url.replace(/\/\/([^@]+)@/, "//") : url
        }

        const ret = await this.exec("git config -l", ...args)
        const urls = {}
        for (const i of ret.stdout.match(/remote\..*?\.url=.+/g) || []) {
            const branch = i.replace(/remote\.(.*?)\.url=.+/g, "$1")
            const url = i.replace(/remote\..*?\.url=/g, "")
            urls[branch] = hide ? url.replace(/\/\/([^@]+)@/, "//") : url
        }
        return urls
    }

    async gitErr(plugin, stdout, error) {
        return handleGitError({
            error,
            stdout,
            reply: msg => this.replyUpdate(msg, "error"),
            conflictMessage: `${error}\n${stdout}\n若修改过文件请手动更新，否则发送 #强制更新${plugin}`,
            unknownMessage: `${error}\n${stdout}\n未知错误，可尝试发送 #强制更新${plugin}`,
            retryRebase: () => this.exec("git pull --rebase", plugin)
        })
    }

    async updateAll() {
        if (uping) {
            await this.reply("正在更新，请稍候再试")
            return false
        }

        uping = true
        this.isPkgUp = false
        this.isUp = false
        this.pkgUpPlugins = new Set()
        this.updateMsgs = []
        this.updateErrMsgs = []
        try {
            await this.runUpdate()
            for (let plugin of await fs.readdir("plugins")) {
                plugin = await this.getPlugin(plugin)
                if (plugin === false) continue
                await this.runUpdate(plugin)
            }

            if (this.updateMsgs.length) await this.reply(Bot.makeForwardMsg(this.updateMsgs))
            if (this.updateErrMsgs.length) await this.reply(Bot.makeForwardMsg(this.updateErrMsgs))

            const packageUpdated = !this.isPkgUp || (await this.updatePackage())
            if (packageUpdated && this.isUp) this.restart()
        } finally {
            delete this.updateMsgs
            delete this.updateErrMsgs
            delete this.pkgUpPlugins
            uping = false
        }
    }

    async updatePackage() {
        await this.replyUpdate("开始更新依赖")

        const plugins = [
            ...(this.pkgUpPlugins || [])
        ]
        const hasRoot = plugins.includes("")
        const pluginFilters = plugins.filter(Boolean).map(plugin => `./plugins/${plugin}`)

        if (hasRoot) {
            const ret = await this.exec(buildBunInstallCommand())
            if (ret.error) {
                await this.replyUpdate(`依赖更新失败\n${ret.error}\n${ret.stdout}\n${ret.stderr}`, "error")
                return false
            }
        }

        if (pluginFilters.length) {
            const ret = await this.exec(buildBunInstallCommand(pluginFilters))
            if (ret.error) {
                await this.replyUpdate(`插件依赖更新失败\n${ret.error}\n${ret.stdout}\n${ret.stderr}`, "error")
                return false
            }
        }

        await this.replyUpdate("依赖更新完成")
        return true
    }

    restart() {
        new Restart(this.e).restart()
    }

    async getLog(plugin = "") {
        let cm = await this.exec('git log -100 --pretty="%h||[%cd] %s" --date=format:"%F %T"', plugin)
        if (cm.error) return this.reply(cm.error.message)

        const logAll = cm.stdout.split("\n")
        if (!logAll.length) return false

        let log = []
        for (let str of logAll) {
            str = str.split("||")
            if (str[0] === this.oldCommitId) break
            if (str[1].includes("Merge branch")) continue
            log.push(str[1])
        }
        if (log.length <= 0) return ""

        const msg = [
            `${plugin || "Orangezai"} 更新日志，共${log.length}条`,
            log.join("\n\n")
        ]
        const end = await this.getRemoteUrl((await this.getRemoteBranch(false, plugin)).remote, true, plugin)
        if (end) msg.push(end)

        return Bot.makeForwardArray(msg)
    }

    async updateLog() {
        const plugin = await this.getPlugin()
        if (plugin === false) return false
        return this.reply(await this.getLog(plugin))
    }
}
