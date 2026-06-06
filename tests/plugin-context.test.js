import { afterEach, describe, expect, test } from "bun:test"
import plugin from "../lib/plugins/plugin.js"

class TestPlugin extends plugin {
    constructor(e) {
        super({
            name: "test-plugin"
        })
        this.e = e
    }
}

function createEvent(overrides = {}) {
    return {
        self_id: "bot-1",
        user_id: "user-1",
        group_id: "group-1",
        reply: () => true,
        ...overrides
    }
}

const cleanup = []

function track(instance, type, isGroup = false) {
    cleanup.push(() => instance.finish(type, isGroup))
}

afterEach(() => {
    while (cleanup.length) {
        cleanup.pop()()
    }
})

describe("plugin context state", () => {
    test("setContext stores and getContext returns the same event", () => {
        const instance = new TestPlugin(createEvent())
        track(instance, "install", false)

        const context = instance.setContext("install")

        expect(context).toBe(instance.e)
        expect(instance.getContext("install")).toBe(instance.e)
    })

    test("finish removes stored context", () => {
        const instance = new TestPlugin(createEvent())

        instance.setContext("update")
        instance.finish("update")

        expect(instance.getContext("update")).toBeUndefined()
    })

    test("context timeout clears state and replies with timeout message", async () => {
        const replies = []
        const instance = new TestPlugin(
            createEvent({
                reply: (...args) => {
                    replies.push(args)
                    return true
                }
            })
        )

        instance.setContext("timeout", false, 0.01, "超时了")
        await Bun.sleep(30)

        expect(instance.getContext("timeout")).toBeUndefined()
        expect(replies).toEqual([
            [
                "超时了",
                true,
                {}
            ]
        ])
    })

    test("awaitContext resolves after resolveContext", async () => {
        const first = new TestPlugin(createEvent())
        const pending = first.awaitContext(false, 1)
        track(first, "resolveContext", false)

        const nextEvent = createEvent({
            user_id: "user-1",
            self_id: "bot-1",
            reply: () => true
        })
        const second = new TestPlugin(nextEvent)
        const context = first.getContext("resolveContext")

        second.resolveContext(context)
        const resolved = await pending

        expect(resolved).toBe(nextEvent)
        expect(first.getContext("resolveContext")).toBeUndefined()
    })
})
