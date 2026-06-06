import init from "./config/init.js"
import cfg from "./config/config.js"
import PluginsLoader from "./plugins/loader.js"
import ListenerLoader from "./listener/loader.js"
import { EventEmitter } from "events"
import fs from "node:fs/promises"
import path from "node:path"
import util from "node:util"
import { exec, execFile } from "node:child_process"
import { installMissingDependency } from "./tools/dependency.js"
import { applyFileService } from "./bot/file.js"
import { applyMessageService } from "./bot/message.js"
import { applyServerService, createExpressApp, createHttpServer, createWebSocketServer } from "./bot/server.js"
import { applyStoreService } from "./bot/store.js"

export default class Orangezai extends EventEmitter {
    stat = {
        start_time: Date.now() / 1000
    }
    bot = this
    bots = {}
    uin = Object.assign([], {
        toJSON() {
            if (!this.now) {
                switch (this.length) {
                    case 0:
                        return ""
                    case 1:
                    case 2:
                        return this[this.length - 1]
                }
                const array = this.slice(1)
                this.now = array[Math.floor(Math.random() * array.length)]
                setTimeout(() => delete this.now, 60000)
            }
            return this.now
        },
        toString(raw, ...args) {
            return raw === true ? this.__proto__.toString.apply(this, args) : this.toJSON().toString(raw, ...args)
        },
        includes(value) {
            return this.some(i => i == value)
        }
    })
    adapter = []

    express = createExpressApp(this)
    server = createHttpServer(this)
    wss = createWebSocketServer()
    wsf = Object.create(null)
    fs = Object.create(null)

    constructor() {
        super()

        for (const name of [
            404,
            "timeout"
        ]) {
            this.fileToUrl(`resources/http/File/${name}.jpg`, {
                name,
                time: false,
                times: false
            })
        }

        return new Proxy(this.bots, {
            get: (target, prop) => {
                const value = this[prop] ?? target[prop]
                if (value !== undefined) {
                    return value
                }
                for (const i of [
                    this.uin.toString(),
                    ...this.uin
                ]) {
                    if (target[i]?.[prop] !== undefined) {
                        this.makeLog("trace", `因不存在 Bot.${prop} 而重定向到 Bot.${i}.${prop}`)
                        if (typeof target[i][prop]?.bind === "function") {
                            return target[i][prop].bind(target[i])
                        }
                        return target[i][prop]
                    }
                }
                this.makeLog("trace", `不存在 Bot.${prop}`)
            }
        })
    }

    async run() {
        await init()
        await this.serverLoad()
        await import("./plugins/stdin.js")
        await PluginsLoader.load()
        await ListenerLoader.load()

        this.express.use(req => req.res.redirect(cfg.bot.redirect))
        this.makeLog(
            "info",
            `连接地址：${logger.blue(`${cfg.bot.url.replace(/^http/, "ws")}/`)}${logger.cyan(`[${Object.keys(this.wsf)}]`)}`,
            "WebSocket"
        )
        this.emit("online", this)
    }

    sleep(time, promise) {
        if (promise) {
            return Promise.race([
                promise,
                this.sleep(time)
            ])
        }
        return new Promise(resolve => setTimeout(resolve, time))
    }

    async fsStat(path, opts) {
        try {
            return await fs.stat(path, opts)
        } catch (err) {
            this.makeLog("trace", [
                "获取",
                path,
                "状态错误",
                err
            ])
            return false
        }
    }

    async mkdir(dir, opts) {
        try {
            await fs.mkdir(dir, {
                recursive: true,
                ...opts
            })
            return true
        } catch (err) {
            this.makeLog("error", [
                "创建",
                dir,
                "错误",
                err
            ])
            return false
        }
    }

    async rm(file, opts) {
        try {
            await fs.rm(file, {
                force: true,
                recursive: true,
                ...opts
            })
            return true
        } catch (err) {
            this.makeLog("error", [
                "删除",
                file,
                "错误",
                err
            ])
            return false
        }
    }

    async glob(path, opts = {}) {
        if (!opts.force && (await this.fsStat(path))) {
            return [
                path
            ]
        }
        if (!fs.glob) {
            return []
        }
        const array = []
        try {
            for await (const i of fs.glob(path, opts)) {
                array.push(i)
            }
        } catch (err) {
            this.makeLog("error", [
                "匹配",
                path,
                "错误",
                err
            ])
        }
        return array
    }

    StringOrNull(data) {
        if (typeof data === "object" && typeof data.toString !== "function") {
            return "[object null]"
        }
        return String(data)
    }

    StringOrBuffer(data, base64) {
        const string = String(data)
        return string.includes("\ufffd") ? (base64 ? `base64://${data.toString("base64")}` : data) : string
    }

    getCircularReplacer() {
        const _this_ = this,
            ancestors = []
        return function (key, value) {
            switch (typeof value) {
                case "function":
                    return String(value)
                case "object":
                    if (value === null) {
                        return null
                    }
                    if (value instanceof Map || value instanceof Set) {
                        return Array.from(value)
                    }
                    if (value instanceof Error) {
                        return value.stack
                    }
                    if (value.type === "Buffer" && Array.isArray(value.data)) {
                        try {
                            return _this_.StringOrBuffer(Buffer.from(value), true)
                        } catch {}
                    }
                    break
                default:
                    return value
            }
            while (ancestors.length > 0 && ancestors.at(-1) !== this) {
                ancestors.pop()
            }
            if (ancestors.includes(value)) {
                return `[Circular ${_this_.StringOrNull(value)}]`
            }
            ancestors.push(value)
            return value
        }
    }

    String(data, opts) {
        switch (typeof data) {
            case "string":
                return data
            case "function":
                return String(data)
            case "object":
                if (data instanceof Error) {
                    return data.stack
                }
                if (Buffer.isBuffer(data)) {
                    return this.StringOrBuffer(data, true)
                }
        }

        try {
            return JSON.stringify(data, this.getCircularReplacer(), opts) || this.StringOrNull(data)
        } catch (err) {
            return this.StringOrNull(data)
        }
    }

    Loging(data, opts = cfg.bot.log_object) {
        if (typeof data === "string") {
        } else if (!opts) {
            data = this.StringOrNull(data)
        } else {
            data = util.inspect(data, {
                depth: 5,
                colors: true,
                showHidden: true,
                showProxy: true,
                getters: true,
                breakLength: 100,
                maxArrayLength: 100,
                maxStringLength: 1000,
                ...opts
            })
        }

        const length = opts.length || cfg.bot.log_length
        if (data.length > length) {
            data = `${data.slice(0, length)}${logger.gray(`... ${data.length - length} more characters`)}`
        }
        return data
    }

    async exec(cmd, opts = {}) {
        return new Promise(resolve => {
            const name = logger.cyan(this.String(cmd))
            this.makeLog(opts.quiet ? "debug" : "mark", name, "执行命令")
            opts.encoding ??= "buffer"
            const callback = (error, stdout, stderr) => {
                const raw = {
                    stdout,
                    stderr
                }
                stdout = String(stdout).trim()
                stderr = String(stderr).trim()
                resolve({
                    error,
                    stdout,
                    stderr,
                    raw
                })
                this.makeLog(
                    opts.quiet ? "debug" : "mark",
                    `${name} ${logger.green(`[完成${this.getTimeDiff(start_time)}]`)} ${stdout ? `\n${stdout}` : ""}${stderr ? logger.red(`\n${stderr}`) : ""}`,
                    "执行命令"
                )
                if (error) {
                    this.makeLog(opts.quiet ? "debug" : "error", error, "执行命令")
                }
            }
            const start_time = Date.now()
            if (Array.isArray(cmd)) {
                execFile(cmd.shift(), cmd, opts, callback)
            } else {
                exec(cmd, opts, callback)
            }
        })
    }

    async cmdPath(cmd, opts = {}) {
        const ret = await this.exec(`${process.platform === "win32" ? "where" : "command -v"} "${cmd}"`, {
            quiet: true,
            ...opts
        })
        return ret.error ? false : ret.stdout
    }

    makeLog(level, msg, id) {
        if (level === "error" && id !== "Dependency") {
            void installMissingDependency(msg, id).catch(err => {
                console.error("Dependency", msg, err)
            })
        }

        const log = []
        if (id !== false) {
            log.push(logger.blue(`[${id || "OrangeYz"}]`))
        }
        for (const i of Array.isArray(msg)
            ? msg
            : [
                  msg
              ]) {
            log.push(this.Loging(i))
        }
        logger.logger[level](...log)
    }

    em(name = "", data = {}) {
        this.prepareEvent(data)
        while (true) {
            this.emit(name, data)
            const i = name.lastIndexOf(".")
            if (i === -1) {
                break
            }
            name = name.slice(0, i)
        }
    }

    getFriendArray() {
        const array = []
        for (const bot_id of this.uin) {
            for (const [id, i] of this.bots[bot_id].fl || []) {
                array.push({
                    ...i,
                    bot_id
                })
            }
        }
        return array
    }

    getFriendList() {
        const array = []
        for (const bot_id of this.uin) {
            array.push(...(this.bots[bot_id].fl?.keys() || []))
        }
        return array
    }

    getFriendMap() {
        const map = new Map()
        for (const bot_id of this.uin) {
            for (const [id, i] of this.bots[bot_id].fl || []) {
                map.set(id, {
                    ...i,
                    bot_id
                })
            }
        }
        return map
    }
    get fl() {
        return this.getFriendMap()
    }

    getGroupArray() {
        const array = []
        for (const bot_id of this.uin) {
            for (const [id, i] of this.bots[bot_id].gl || []) {
                array.push({
                    ...i,
                    bot_id
                })
            }
        }
        return array
    }

    getGroupList() {
        const array = []
        for (const bot_id of this.uin) {
            array.push(...(this.bots[bot_id].gl?.keys() || []))
        }
        return array
    }

    getGroupMap() {
        const map = new Map()
        for (const bot_id of this.uin) {
            for (const [id, i] of this.bots[bot_id].gl || []) {
                map.set(id, {
                    ...i,
                    bot_id
                })
            }
        }
        return map
    }
    get gl() {
        return this.getGroupMap()
    }
    get gml() {
        const map = new Map()
        for (const bot_id of this.uin) {
            for (const [id, i] of this.bots[bot_id].gml || []) {
                map.set(
                    id,
                    Object.assign(new Map(i), {
                        bot_id
                    })
                )
            }
        }
        return map
    }
    get pickUser() {
        return this.pickFriend
    }

    getTextMsg(fnc = () => true) {
        if (typeof fnc !== "function") {
            const { self_id, user_id } = fnc
            fnc = data => data.self_id == self_id && data.user_id == user_id
        }

        return new Promise(resolve => {
            const listener = data => {
                try {
                    if (!fnc(data)) {
                        return
                    }

                    let msg = ""
                    for (const i of data.message) {
                        if (i.type === "text" && i.text) {
                            msg += i.text.trim()
                        }
                    }
                    if (!msg) {
                        return
                    }

                    resolve(msg)
                    this.off("message", listener)
                } catch (err) {
                    this.makeLog("error", err, data.self_id)
                }
            }
            this.on("message", listener)
        })
    }

    getTimeDiff(time1 = this.stat.start_time * 1000, time2 = Date.now()) {
        const time = (time2 - time1) / 1000
        let ret = ""
        const day = Math.floor(time / 3600 / 24)
        if (day) {
            ret += `${day}天`
        }
        const hour = Math.floor((time / 3600) % 24)
        if (hour) {
            ret += `${hour}时`
        }
        const min = Math.floor((time / 60) % 60)
        if (min) {
            ret += `${min}分`
        }
        const sec = (time % 60).toFixed(3)
        if (sec) {
            ret += `${sec}秒`
        }
        return ret || "0秒"
    }
}

applyFileService(Orangezai.prototype)
applyMessageService(Orangezai.prototype)
applyServerService(Orangezai.prototype)
applyStoreService(Orangezai.prototype)
