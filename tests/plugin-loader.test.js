import { afterEach, beforeEach, describe, expect, test } from "bun:test"

globalThis.logger ??= {
    blue: value => value,
    cyan: value => value,
    green: value => value,
    magenta: value => value,
    red: value => value,
    yellow: value => value,
    mark: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
}

globalThis.Bot ??= {
    makeLog: () => {},
    String: value => (typeof value === "string" ? value : JSON.stringify(value)),
    getTimeDiff: start => `${Date.now() - start}ms`
}

const [{ default: PluginsLoader }, { default: BasePlugin }, { default: cfg }] = await Promise.all([
    import("../lib/plugins/loader.js"),
    import("../lib/plugins/plugin.js"),
    import("../lib/config/config.js")
])

const original = {
    priority: PluginsLoader.priority,
    count: PluginsLoader.count,
    getGroup: cfg.getGroup,
    getOther: cfg.getOther,
    redis: globalThis.redis
}

function createEvent(overrides = {}) {
    return {
        post_type: "message",
        message_type: "group",
        sub_type: "normal",
        self_id: "bot-1",
        user_id: "user-1",
        group_id: "group-1",
        raw_message: "#缓存测试",
        message: [
            {
                type: "text",
                text: "#缓存测试"
            }
        ],
        sender: {
            nickname: "tester",
            card: "tester"
        },
        reply: async () => true,
        ...overrides
    }
}

function useGroupConfig(config = {}) {
    cfg.getGroup = () => ({
        groupCD: 0,
        singleCD: 0,
        onlyReplyAt: 0,
        botAlias: "",
        disable: [],
        enable: [],
        ...config
    })
    cfg.getOther = () => ({})
}

function useFakeRedis() {
    const keys = []
    globalThis.redis = {
        multi() {
            return {
                incr(key) {
                    keys.push(key)
                    return this
                },
                async exec() {
                    return keys
                }
            }
        }
    }
    return keys
}

beforeEach(() => {
    PluginsLoader.priority = []
    PluginsLoader.count = async () => {}
    useGroupConfig()
})

afterEach(() => {
    PluginsLoader.priority = original.priority
    PluginsLoader.count = original.count
    cfg.getGroup = original.getGroup
    cfg.getOther = original.getOther
    globalThis.redis = original.redis
})

describe("plugin loader count batching", () => {
    test("count writes message and type counters through one redis multi", async () => {
        const keys = useFakeRedis()
        const botConfig = cfg.getConfig("bot")
        const originalMsgTypeCount = botConfig.msg_type_count
        botConfig.msg_type_count = true

        try {
            await original.count.call(
                PluginsLoader,
                createEvent({
                    message: [
                        {
                            type: "text",
                            text: "#缓存测试"
                        },
                        {
                            type: "image",
                            url: "https://example.com/a.png"
                        }
                    ]
                }),
                "receive",
                [
                    {
                        type: "text"
                    },
                    {
                        type: "image"
                    }
                ]
            )
        } finally {
            botConfig.msg_type_count = originalMsgTypeCount
        }

        expect(keys).toHaveLength(48)
        expect(keys.some(key => key.startsWith("Yz:count:receive:msg:total:"))).toBe(true)
        expect(keys.some(key => key.startsWith("Yz:count:receive:text:user:user-1:"))).toBe(true)
        expect(keys.some(key => key.startsWith("Yz:count:receive:image:group:group-1:"))).toBe(true)
    })
})

describe("plugin loader event caches", () => {
    test("group config is cached only within the current event", () => {
        let calls = 0
        cfg.getGroup = () => {
            calls++
            return {
                onlyReplyAt: calls,
                disable: [],
                enable: []
            }
        }

        const firstEvent = createEvent()
        expect(PluginsLoader.getGroupConfig(firstEvent).onlyReplyAt).toBe(1)
        expect(PluginsLoader.getGroupConfig(firstEvent).onlyReplyAt).toBe(1)
        expect(calls).toBe(1)

        const secondEvent = createEvent()
        expect(PluginsLoader.getGroupConfig(secondEvent).onlyReplyAt).toBe(2)
        expect(calls).toBe(2)
    })

    test("a matching plugin is instantiated once per event and runtime is initialized lazily", async () => {
        const replies = []
        let constructorCount = 0
        let acceptInstance
        let ruleInstance

        class CachedPlugin extends BasePlugin {
            constructor(e) {
                super({
                    name: "缓存测试",
                    event: "message",
                    rule: [
                        {
                            reg: /^#缓存测试$/,
                            fnc: "run"
                        }
                    ]
                })
                this.e = e
                constructorCount++
            }

            async accept() {
                acceptInstance = this
                return true
            }

            async run(e) {
                ruleInstance = this
                await e.reply("ok")
                return true
            }
        }

        const plugin = new CachedPlugin()
        constructorCount = 0
        PluginsLoader.priority = [
            {
                plugin,
                class: CachedPlugin,
                key: "test/cache.js",
                name: plugin.name,
                priority: plugin.priority
            }
        ]

        const event = createEvent({
            reply: async msg => replies.push(msg)
        })
        await PluginsLoader.deal(event)

        expect(constructorCount).toBe(1)
        expect(acceptInstance).toBe(ruleInstance)
        expect(event.runtime).toBeDefined()
        expect(replies).toEqual([
            "ok"
        ])

        await PluginsLoader.deal(
            createEvent({
                user_id: "user-2",
                reply: async msg => replies.push(msg)
            })
        )
        expect(constructorCount).toBe(2)
    })

    test("an unmatched rule does not instantiate the plugin or initialize runtime", async () => {
        let constructorCount = 0

        class UnmatchedPlugin extends BasePlugin {
            constructor(e) {
                super({
                    name: "未命中测试",
                    event: "message",
                    rule: [
                        {
                            reg: /^#命中$/,
                            fnc: "run"
                        }
                    ]
                })
                this.e = e
                constructorCount++
            }

            async run() {
                return true
            }
        }

        const plugin = new UnmatchedPlugin()
        constructorCount = 0
        PluginsLoader.priority = [
            {
                plugin,
                class: UnmatchedPlugin,
                key: "test/unmatched.js",
                name: plugin.name,
                priority: plugin.priority
            }
        ]

        const event = createEvent({
            raw_message: "#未命中",
            message: [
                {
                    type: "text",
                    text: "#未命中"
                }
            ]
        })
        await PluginsLoader.deal(event)

        expect(constructorCount).toBe(0)
        expect(event.runtime).toBeUndefined()
    })
})
