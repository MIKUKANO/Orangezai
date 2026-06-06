import fs from "node:fs/promises"

const storeService = {
    makeMap(parent_map, parent_key, map) {
        const save = async () => {
            try {
                await parent_map.db.put(parent_key, {
                    map_array: Array.from(map)
                })
            } catch (err) {
                this.makeLog("error", [
                    "写入",
                    parent_map.db.location,
                    parent_key,
                    "错误",
                    map,
                    err
                ])
            }
        }

        const set = map.set.bind(map)
        Object.defineProperty(map, "set", {
            value: async (key, value) => {
                if (JSON.stringify(map.get(key)) !== JSON.stringify(value)) {
                    set(key, value)
                    await save()
                }
                return map
            }
        })
        const del = map.delete.bind(map)
        Object.defineProperty(map, "delete", {
            value: async key => {
                if (!del(key)) {
                    return false
                }
                await save()
                return true
            }
        })
        return map
    },

    async setMap(map, set, key, value) {
        try {
            if (value instanceof Map) {
                set(key, this.makeMap(map, key, value))
                await map.db.put(key, {
                    map_array: Array.from(value)
                })
            } else if (JSON.stringify(map.get(key)) !== JSON.stringify(value)) {
                set(key, value)
                await map.db.put(key, value)
            }
        } catch (err) {
            this.makeLog("error", [
                "写入",
                map.db.location,
                key,
                "错误",
                value,
                err
            ])
        }
        return map
    },

    async delMap(map, del, key) {
        if (!del(key)) {
            return false
        }
        try {
            await map.db.del(key)
        } catch (err) {
            this.makeLog("error", [
                "删除",
                map.db.location,
                key,
                "错误",
                err
            ])
        }
        return true
    },

    async importMap(dir, map) {
        for (const i of await fs.readdir(dir)) {
            const path = `${dir}/${i}`
            try {
                await map.set(
                    i,
                    (await this.fsStat(path)).isDirectory()
                        ? await this.importMap(path, new Map())
                        : JSON.parse(await fs.readFile(path, "utf8"))
                )
            } catch (err) {
                this.makeLog("error", [
                    "读取",
                    path,
                    "错误",
                    err
                ])
            }
            await this.rm(path)
        }
        await this.rm(dir)
        return map
    },

    async getMap(dir) {
        const map = new Map()
        const db = new (await import("level")).Level(`${dir}-leveldb`, {
            valueEncoding: "json"
        })
        try {
            await db.open()
            for await (let [key, value] of db.iterator()) {
                if (typeof value === "object" && value.map_array) {
                    value = this.makeMap(map, key, new Map(value.map_array))
                }
                map.set(key, value)
            }
        } catch (err) {
            this.makeLog("error", [
                "打开",
                dir,
                "数据库错误",
                err
            ])
            return map
        }

        Object.defineProperty(map, "db", {
            value: db
        })
        const set = map.set.bind(map)
        Object.defineProperty(map, "set", {
            value: (key, value) => this.setMap(map, set, key, value)
        })
        const del = map.delete.bind(map)
        Object.defineProperty(map, "delete", {
            value: key => this.delMap(map, del, key)
        })

        if (await this.fsStat(dir)) {
            await this.importMap(dir, map)
        }
        return map
    }
}

export function applyStoreService(target) {
    Object.assign(target, storeService)
}
