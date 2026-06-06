import { segment } from "oicq"
import cfg from "../config/config.js"

const messageService = {
    prepareEvent(data) {
        if (!this.bots[data.self_id]) {
            return
        }
        if (!data.bot) {
            Object.defineProperty(data, "bot", {
                value: this.bots[data.self_id]
            })
        }
        if (!data.friend && data.user_id) {
            Object.defineProperty(data, "friend", {
                value: data.bot.pickFriend(data.user_id)
            })
        }
        if (!data.group && data.group_id) {
            Object.defineProperty(data, "group", {
                value: data.bot.pickGroup(data.group_id)
            })
        }
        if (!data.member && data.group && data.user_id) {
            Object.defineProperty(data, "member", {
                value: data.group.pickMember(data.user_id)
            })
        }

        if (data.bot.adapter?.id) {
            data.adapter_id = data.bot.adapter.id
        }
        if (data.bot.adapter?.name) {
            data.adapter_name = data.bot.adapter.name
        }

        for (const i of [
            data.friend,
            data.group,
            data.member
        ]) {
            if (typeof i !== "object") {
                continue
            }
            i.sendFile ??= (file, name) => i.sendMsg(segment.file(file, name))
            i.makeForwardMsg ??= this.makeForwardMsg
            i.sendForwardMsg ??= msg => this.sendForwardMsg(msg => i.sendMsg(msg), msg)
            i.getInfo ??= () => i.info || i
        }
    },

    pickFriend(user_id, strict) {
        user_id = Number(user_id) || user_id
        let user = this.fl.get(user_id)
        if (!user) {
            for (const [id, ml] of this.gml) {
                user = ml.get(user_id)
                if (user) {
                    user.bot_id = ml.bot_id
                    break
                }
            }
        }
        if (user) {
            return this.bots[user.bot_id].pickFriend(user_id)
        }
        if (strict) {
            return false
        }
        this.makeLog("debug", [
            "因不存在用户",
            user_id,
            "而随机选择Bot",
            this.uin.toJSON()
        ])
        return this.bots[this.uin].pickFriend(user_id)
    },

    pickGroup(group_id, strict) {
        group_id = Number(group_id) || group_id
        const group = this.gl.get(group_id)
        if (group) {
            return this.bots[group.bot_id].pickGroup(group_id)
        }
        if (strict) {
            return false
        }
        this.makeLog("debug", [
            "因不存在群",
            group_id,
            "而随机选择Bot",
            this.uin.toJSON()
        ])
        return this.bots[this.uin].pickGroup(group_id)
    },

    pickMember(group_id, user_id) {
        return this.pickGroup(group_id).pickMember(user_id)
    },

    sendFriendMsg(bot_id, user_id, ...args) {
        try {
            if (!bot_id) {
                return this.pickFriend(user_id).sendMsg(...args)
            }

            if (this.uin.includes(bot_id) && this.bots[bot_id]) {
                return this.bots[bot_id].pickFriend(user_id).sendMsg(...args)
            }

            if (this.pickFriend(bot_id, true)) {
                return this.pickFriend(bot_id).sendMsg(user_id, ...args)
            }

            return new Promise((resolve, reject) => {
                const listener = data => {
                    resolve(data.bot.pickFriend(user_id).sendMsg(...args))
                    clearTimeout(timeout)
                }
                const timeout = setTimeout(() => {
                    reject(
                        Object.assign(Error("等待 Bot 上线超时"), {
                            bot_id,
                            user_id,
                            args
                        })
                    )
                    this.off(`connect.${bot_id}`, listener)
                }, 300000)
                this.once(`connect.${bot_id}`, listener)
            })
        } catch (err) {
            this.makeLog(
                "error",
                [
                    "发送好友消息错误",
                    args,
                    err
                ],
                `${bot_id} => ${user_id}`
            )
        }
    },

    sendGroupMsg(bot_id, group_id, ...args) {
        try {
            if (!bot_id) {
                return this.pickGroup(group_id).sendMsg(...args)
            }

            if (this.uin.includes(bot_id) && this.bots[bot_id]) {
                return this.bots[bot_id].pickGroup(group_id).sendMsg(...args)
            }

            if (this.pickGroup(bot_id, true)) {
                return this.pickGroup(bot_id).sendMsg(group_id, ...args)
            }

            return new Promise((resolve, reject) => {
                const listener = data => {
                    resolve(data.bot.pickGroup(group_id).sendMsg(...args))
                    clearTimeout(timeout)
                }
                const timeout = setTimeout(() => {
                    reject(
                        Object.assign(Error("等待 Bot 上线超时"), {
                            bot_id,
                            group_id,
                            args
                        })
                    )
                    this.off(`connect.${bot_id}`, listener)
                }, 300000)
                this.once(`connect.${bot_id}`, listener)
            })
        } catch (err) {
            this.makeLog(
                "error",
                [
                    "发送群消息错误",
                    args,
                    err
                ],
                `${bot_id} => ${group_id}`
            )
        }
    },

    makeForwardMsg(msg) {
        return {
            type: "node",
            data: msg
        }
    },

    makeForwardArray(msg = [], node = {}) {
        const forward = []
        for (const message of Array.isArray(msg)
            ? msg
            : [
                  msg
              ]) {
            forward.push({
                ...node,
                message
            })
        }
        return this.makeForwardMsg(forward)
    },

    async sendForwardMsg(send, msg) {
        const messages = []
        for (const { message } of Array.isArray(msg)
            ? msg
            : [
                  msg
              ]) {
            messages.push(await send(message))
        }
        return messages
    },

    getMasterMsg() {
        return this.getTextMsg(data => cfg.master[data.self_id]?.includes(String(data.user_id)))
    },

    async sendMasterMsg(msg, bot_array = Object.keys(cfg.master), sleep = 5000) {
        const ret = {}
        await Promise.allSettled(
            (Array.isArray(bot_array)
                ? bot_array
                : [
                      bot_array
                  ]
            ).map(async bot_id => {
                ret[bot_id] = {}
                for (const user_id of cfg.master[bot_id] || []) {
                    ret[bot_id][user_id] = this.sendFriendMsg(bot_id, user_id, msg)
                    if (sleep) {
                        await this.sleep(sleep, ret[bot_id][user_id])
                    }
                }
            })
        )
        return ret
    }
}

export function applyMessageService(target) {
    Object.assign(target, messageService)
}
