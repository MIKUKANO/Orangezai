const { DatabaseSync, constants } = require("node:sqlite")

class Statement {
    constructor(result = {}) {
        this.lastID = result.lastInsertRowid === undefined ? undefined : Number(result.lastInsertRowid)
        this.changes = result.changes ?? 0
    }
}

class Database {
    constructor(filename, _mode, callback = () => {}) {
        this.filename = filename

        try {
            this.db = new DatabaseSync(filename)
            queueMicrotask(() => callback(null))
        } catch (err) {
            queueMicrotask(() => callback(err))
        }
    }

    serialize(callback) {
        callback()
    }

    all(sql, parameters, callback) {
        if (typeof parameters === "function") {
            callback = parameters
            parameters = []
        }

        try {
            callback(null, this.db.prepare(sql).all(parameters))
        } catch (err) {
            callback(err)
        }
    }

    run(sql, parameters, callback) {
        if (typeof parameters === "function") {
            callback = parameters
            parameters = []
        }

        try {
            const result = this.db.prepare(sql).run(parameters)
            callback?.call(new Statement(result), null)
        } catch (err) {
            callback?.(err)
        }
    }

    close(callback) {
        try {
            this.db.close()
            callback?.(null)
        } catch (err) {
            callback?.(err)
        }
    }
}

module.exports = {
    Database,
    Statement,
    OPEN_READWRITE: constants.SQLITE_OPEN_READWRITE,
    OPEN_CREATE: constants.SQLITE_OPEN_CREATE
}
