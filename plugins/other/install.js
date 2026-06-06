import fs from "node:fs/promises"
import { Restart } from "./restart.js"
import { buildBunInstallCommand, execPluginCommand, handleGitError } from "../../lib/tools/plugin-common.js"

let insing = false
const list = {
    "genshin": "https://gitee.com/TimeRainStarSky/Yunzai-genshin",
    "rconsole-plugin": "https://gitee.com/kyrzy0416/rconsole-plugin",
    "neko-status-plugin": "https://gh-proxy.com/https://github.com/erzaozi/neko-status-plugin",
    "Guoba-Plugin": "https://gitee.com/guoba-yunzai/guoba-plugin",
    "Lagrange-Plugin": "https://gitee.com/TimeRainStarSky/Yunzai-Lagrange-Plugin",
    "Telegram-Plugin": "https://gitee.com/TimeRainStarSky/Yunzai-Telegram-Plugin",
    "Discord-Plugin": "https://gitee.com/TimeRainStarSky/Yunzai-Discord-Plugin",
    "WeChat-Plugin": "https://gitee.com/TimeRainStarSky/Yunzai-WeChat-Plugin",
    "QQBot-Plugin": "https://gitee.com/TimeRainStarSky/Yunzai-QQBot-Plugin",
    "Route-Plugin": "https://gitee.com/TimeRainStarSky/Yunzai-Route-Plugin",
    "ICQQ-Plugin": "https://gitee.com/TimeRainStarSky/Yunzai-ICQQ-Plugin",
    "KOOK-Plugin": "https://gitee.com/TimeRainStarSky/Yunzai-KOOK-Plugin"
}
const map = {}
for (const i in list) map[i.replace(/-[Pp]lugin$/, "")] = i
const legacyPaths = {
    "neko-status-plugin": "plugins/neko-status-Plugin"
}

export class install extends plugin {
    constructor() {
        super({
            name: "安装插件",
            dsc: "#安装插件",
            event: "message",
            priority: -Infinity,
            rule: [
                {
                    reg: `^#安装(插件|${Object.keys(map).join("|")})(-[Pp]lugin)?$`,
                    fnc: "install",
                    permission: "master"
                }
            ]
        })
    }

    async install() {
        if (insing) {
            await this.reply("正在安装，请稍候再试")
            return false
        }

        let name = this.e.msg.replace(/^#安装(.+?)(-[Pp]lugin)?$/, "$1")
        if (map[name]) name = map[name]

        if (name == "插件") {
            let msg = "\n"
            for (const i in list) if (!(await Bot.fsStat(`plugins/${i}`))) msg += `${i}\n`

            if (msg == "\n") msg = "暂无可安装插件"
            else msg = `可安装插件列表：${msg}发送 #安装+插件名 进行安装`

            await this.reply(msg)
            return true
        }

        const path = `plugins/${name}`
        const legacyPath = legacyPaths[name]
        if (legacyPath && (await Bot.fsStat(legacyPath))) {
            if (await Bot.fsStat(path)) {
                await this.reply(`${name} 插件已安装，但旧目录 ${legacyPath} 仍存在，请手动删除旧目录后重启`)
                return false
            }
            await fs.rename(legacyPath, path)
        }
        if (await Bot.fsStat(path)) {
            await this.reply(`${name} 插件已安装`)
            return false
        }
        return this.runInstall(name, list[name], path)
    }

    async runInstall(name, url, path) {
        logger.mark(`${this.e.logFnc} 开始安装 ${name} 插件`)
        await this.reply(`开始安装 ${name} 插件`)

        insing = true
        try {
            const ret = await Bot.exec(`git clone --depth 1 --single-branch "${url}" "${path}"`)

            if (ret.error) {
                logger.mark(`${this.e.logFnc} ${name} 插件安装错误`)
                await this.gitErr(name, ret.error.message, ret.stdout)
                return false
            }

            if (await Bot.fsStat(`${path}/package.json`)) {
                const installRet = await execPluginCommand(buildBunInstallCommand([`./${path}`]))
                if (installRet.error) {
                    await this.reply(
                        `${name} 插件依赖安装错误\n${installRet.error}\n${installRet.stdout}\n${installRet.stderr}`
                    )
                    Bot.makeLog(
                        "error",
                        [
                            "插件依赖安装错误",
                            name,
                            installRet
                        ],
                        "Plugin"
                    )
                    return false
                }
            }

            return this.restart()
        } finally {
            insing = false
        }
    }

    async gitErr(name, error, stdout) {
        return handleGitError({
            error,
            stdout,
            reply: msg => this.reply(msg),
            unknownMessage: `${name} 插件安装错误\n${error}\n${stdout}`
        })
    }

    restart() {
        return new Restart(this.e).restart()
    }
}
