import init from "./config/init.js"
import cfg from "./config/config.js"
import PluginsLoader from "./plugins/loader.js"
import ListenerLoader from "./listener/loader.js"
import { EventEmitter } from "events"
import { applyFileService } from "./bot/file.js"
import { applyMessageService } from "./bot/message.js"
import { applyServerService, createExpressApp, createHttpServer, createWebSocketServer } from "./bot/server.js"
import { applyStoreService } from "./bot/store.js"
import { applyUtilService } from "./bot/util.js"

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
    online = false

    express = createExpressApp(this)
    server = createHttpServer(this)
    wss = createWebSocketServer()
    wsf = Object.create(null)
    ws_pending = new Set()
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
        this.online = true
        this.flushPendingWs()
        this.emit("online", this)
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
}

applyUtilService(Orangezai.prototype)
applyFileService(Orangezai.prototype)
applyMessageService(Orangezai.prototype)
applyServerService(Orangezai.prototype)
applyStoreService(Orangezai.prototype)
