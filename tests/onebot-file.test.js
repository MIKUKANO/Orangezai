import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

const adapterModulePath = "../plugins/adapter/OneBotv11.js"
let adapter
let importId = 0

async function loadAdapter() {
    globalThis.Bot = {
        adapter: [],
        String: value => String(value),
        fsStat: async file => fs.stat(file).catch(() => false),
        Buffer: async (file, opts = {}) => {
            if (Buffer.isBuffer(file)) {
                return file
            }
            if (typeof file === "string" && file.startsWith("base64://")) {
                return Buffer.from(file.replace("base64://", ""), "base64")
            }
            if (typeof file === "string" && file.match(/^https?:\/\//)) {
                return opts.http ? file : Buffer.from(file)
            }
            if (opts.file) {
                return file
            }
            return await fs.readFile(file)
        },
        fileToUrl: async file =>
            `http://127.0.0.1:2536/File/${typeof file === "string" ? path.basename(file) : "buffer"}`
    }
    await import(`${adapterModulePath}?t=${++importId}`)
    adapter = globalThis.Bot.adapter.at(-1)
    return adapter
}

afterEach(async () => {
    delete globalThis.Bot
    await fs.rm("./temp/onebot-file-test", {
        recursive: true,
        force: true
    })
})

describe("OneBotv11 file conversion", () => {
    test("large local files are exposed as HTTP URLs instead of base64 payloads", async () => {
        const onebot = await loadAdapter()
        const dir = "./temp/onebot-file-test"
        const file = `${dir}/video.mp4`
        await fs.mkdir(dir, {
            recursive: true
        })
        await fs.writeFile(file, Buffer.alloc(10 * 1024 * 1024 + 1))

        const message = await onebot.makeMsg({
            type: "video",
            file
        })

        expect(message[0][0].data.file).toBe("http://127.0.0.1:2536/File/video.mp4")
    })

    test("local image files still use base64 payloads", async () => {
        const onebot = await loadAdapter()
        const dir = "./temp/onebot-file-test"
        const file = `${dir}/image.jpg`
        await fs.mkdir(dir, {
            recursive: true
        })
        await fs.writeFile(file, Buffer.from("image-data"))

        const message = await onebot.makeMsg({
            type: "image",
            file
        })

        expect(message[0][0].data.file).toBe(`base64://${Buffer.from("image-data").toString("base64")}`)
    })
})
