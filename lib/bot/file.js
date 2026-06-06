import fs from "node:fs/promises"
import path from "node:path"
import fetch from "node-fetch"
import { fileTypeFromBuffer } from "file-type"
import md5 from "md5"
import { ulid } from "ulid"
import cfg from "../config/config.js"

const fileService = {
    async download(url, file, opts) {
        let buffer
        if (!file || (await this.fsStat(file))?.isDirectory?.()) {
            const type = await this.fileType(url, opts)
            file = file ? path.join(file, type.name) : type.name
            buffer = type.buffer
        } else {
            await this.mkdir(path.dirname(file))
            buffer = await this.Buffer(url, opts)
        }
        await fs.writeFile(file, buffer)
        return {
            url,
            file,
            buffer
        }
    },

    async Buffer(data, opts = {}) {
        if (Buffer.isBuffer(data)) {
            return data
        }
        data = this.String(data)

        if (data.startsWith("base64://")) {
            return Buffer.from(data.replace("base64://", ""), "base64")
        } else if (data.match(/^https?:\/\//)) {
            return opts.http ? data : Buffer.from(await (await fetch(data, opts)).arrayBuffer())
        } else if (await this.fsStat(data.replace(/^file:\/\//, ""))) {
            return opts.file ? data : Buffer.from(await fs.readFile(data.replace(/^file:\/\//, "")))
        }
        return data
    },

    async fileType(data, opts = {}) {
        const file = {
            name: data.name
        }
        try {
            if (Buffer.isBuffer(data.file)) {
                file.url = data.name || "Buffer"
                file.buffer = data.file
            } else {
                file.url = data.file.replace(/^base64:\/\/.*/, "base64://...")
                file.buffer = await this.Buffer(data.file, opts)
            }
            if (Buffer.isBuffer(file.buffer)) {
                file.type = await fileTypeFromBuffer(file.buffer)
                file.md5 = md5(file.buffer)
                file.name ??= `${Date.now().toString(36)}.${file.md5.slice(0, 8)}.${file.type.ext}`
            }
        } catch (err) {
            this.makeLog("error", [
                "文件类型检测错误",
                file,
                err
            ])
        }
        file.name ??= `${Date.now().toString(36)}-${path.basename(file.url)}`
        return file
    },

    async fileToUrl(file, opts = {}) {
        const { name, time = cfg.bot.file_to_url_time * 60000, times = cfg.bot.file_to_url_times } = opts

        file =
            (typeof file === "object" &&
                !Buffer.isBuffer(file) && {
                    ...file
                }) ||
            (await this.fileType(
                {
                    file,
                    name
                },
                {
                    http: true
                }
            ))
        if (!Buffer.isBuffer(file.buffer)) {
            return file.buffer
        }
        file.name = file.name ? encodeURIComponent(file.name) : ulid()

        if (typeof times === "number") {
            file.times = times
        }
        this.fs[file.name] = file
        if (time) {
            setTimeout(() => (this.fs[file.name] = this.fs.timeout), time)
        }
        return `${cfg.bot.url}/File/${file.name}`
    },

    fileSend(req) {
        const url = req.url.replace(/^\//, "")
        let file = this.fs[url] || this.fs[404]

        if (typeof file.times === "number") {
            if (file.times > 0) {
                file.times--
            } else {
                file = this.fs.timeout
            }
        }

        if (file.type?.mime) {
            req.res.setHeader("Content-Type", file.type.mime)
        }

        this.makeLog(
            "mark",
            `发送文件：${file.name}(${file.url} ${(file.buffer.length / 1024).toFixed(2)}KB)`,
            `${req.sid} => ${req.rid}`
        )
        req.res.send(file.buffer)
    }
}

export function applyFileService(target) {
    Object.assign(target, fileService)
}
