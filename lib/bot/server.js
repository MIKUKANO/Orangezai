import express from "express"
import http from "node:http"
import { WebSocketServer } from "ws"
import cfg from "../config/config.js"

export function createExpressApp(target) {
    return Object.assign(express(), {
        quiet: []
    })
        .use(
            express.urlencoded({
                extended: false
            })
        )
        .use(express.json())
        .use(express.raw())
        .use(express.text())
        .use("/status", req => req.res.send(process.memoryUsage()))
        .use(req => {
            let quiet = false
            for (const i of req.app.quiet) {
                if (req.originalUrl.startsWith(i)) {
                    quiet = true
                    break
                }
            }
            req.rid = `${req.ip}:${req.socket.remotePort}`
            req.sid = `${req.protocol}://${req.hostname}:${req.socket.localPort}${req.originalUrl}`
            target.makeLog(
                quiet ? "debug" : "mark",
                [
                    "HTTP",
                    req.method,
                    "请求",
                    req.headers,
                    req.query,
                    req.body
                ],
                `${req.sid} <= ${req.rid}`
            )
            req.next()
        })
        .use("/exit", req => {
            if (
                [
                    "::1",
                    "::ffff:127.0.0.1"
                ].includes(req.ip) ||
                req.hostname === "localhost"
            ) {
                process.exit(1)
            }
        })
        .use("/File", (...args) => target.fileSend(...args))
}

export function createHttpServer(target) {
    return http
        .createServer(target.express)
        .on("error", err => {
            if (typeof target[`server${err.code}`] === "function") {
                return target[`server${err.code}`](err)
            }
            target.makeLog("error", err, "Server")
        })
        .on("upgrade", (...args) => target.wsConnect(...args))
}

export function createWebSocketServer() {
    return new WebSocketServer({
        noServer: true
    })
}

const serverService = {
    wsConnect(req, socket, head) {
        this.wss.handleUpgrade(req, socket, head, conn => {
            conn.rid = `${req.socket.remoteAddress}:${req.socket.remotePort}-${req.headers["sec-websocket-key"]}`
            conn.sid = `ws://${req.headers["x-forwarded-host"] || req.headers.host || `${req.socket.localAddress}:${req.socket.localPort}`}${req.url}`
            this.makeLog(
                "mark",
                [
                    "建立连接",
                    req.headers
                ],
                `${conn.sid} <=> ${conn.rid}`
            )
            conn.on("error", (...args) => this.makeLog("error", args, `${conn.sid} <=> ${conn.rid}`))
            conn.on("close", () => this.makeLog("mark", "断开连接", `${conn.sid} <≠> ${conn.rid}`))
            conn.on("message", msg =>
                this.makeLog(
                    "debug",
                    [
                        "消息",
                        this.String(msg)
                    ],
                    `${conn.sid} <= ${conn.rid}`
                )
            )
            conn.sendMsg = msg => {
                if (!Buffer.isBuffer(msg)) {
                    msg = this.String(msg)
                }
                this.makeLog(
                    "debug",
                    [
                        "消息",
                        msg
                    ],
                    `${conn.sid} => ${conn.rid}`
                )
                return conn.send(msg)
            }
            for (const i of this.wsf[req.url.split("/")[1]] || [
                () => conn.terminate()
            ]) {
                i(conn, req, socket, head)
            }
        })
    },

    async serverEADDRINUSE(err) {
        this.makeLog(
            "error",
            [
                "监听端口",
                cfg.bot.port,
                "错误",
                err
            ],
            "Server"
        )
        try {
            await fetch(`http://localhost:${cfg.bot.port}/exit`)
        } catch {}
        this.server_listen_time = (this.server_listen_time || 0) + 1
        await this.sleep(this.server_listen_time * 1000)
        this.server.listen(cfg.bot.port)
    },

    async serverLoad() {
        this.server.listen(cfg.bot.port)
        await new Promise(resolve => this.server.once("listening", resolve))
        this.makeLog(
            "mark",
            [
                "启动 HTTP 服务器",
                logger.green(`http://[${this.server.address().address}]:${this.server.address().port}`)
            ],
            "Server"
        )
    }
}

export function applyServerService(target) {
    Object.assign(target, serverService)
}
