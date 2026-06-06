import { exec, execFile } from "node:child_process"
import fs from "node:fs/promises"
import util from "node:util"
import cfg from "../config/config.js"
import { installMissingDependency } from "../tools/dependency.js"

const utilService = {
    sleep(time, promise) {
        if (promise) {
            return Promise.race([
                promise,
                this.sleep(time)
            ])
        }
        return new Promise(resolve => setTimeout(resolve, time))
    },

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
    },

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
    },

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
    },

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
    },

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
    },

    async cmdPath(cmd, opts = {}) {
        const ret = await this.exec(`${process.platform === "win32" ? "where" : "command -v"} "${cmd}"`, {
            quiet: true,
            ...opts
        })
        return ret.error ? false : ret.stdout
    },

    StringOrNull(data) {
        if (typeof data === "object" && typeof data.toString !== "function") {
            return "[object null]"
        }
        return String(data)
    },

    StringOrBuffer(data, base64) {
        const string = String(data)
        return string.includes("\ufffd") ? (base64 ? `base64://${data.toString("base64")}` : data) : string
    },

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
    },

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
    },

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
    },

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
    },

    makeError(message, ...details) {
        return Object.assign(Error(message), {
            details
        })
    },

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

export function applyUtilService(target) {
    Object.assign(target, utilService)
}
