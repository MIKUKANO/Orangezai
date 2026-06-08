import { describe, expect, test } from "bun:test"
import { wrapBrowser } from "../packages/puppeteer/index.js"

async function createCompatPage() {
    const calls = []
    const rawPage = {
        goto(...args) {
            calls.push([
                "goto",
                args
            ])
            return args
        },
        setContent(...args) {
            calls.push([
                "setContent",
                args
            ])
            return args
        },
        waitForFunction(...args) {
            calls.push([
                "waitForFunction",
                args
            ])
            return args
        },
        waitForNavigation(...args) {
            calls.push([
                "waitForNavigation",
                args
            ])
            return args
        }
    }
    const context = {
        newPage: async () => rawPage,
        pages: () => [
            rawPage
        ]
    }
    const browser = wrapBrowser({
        contexts: () => [
            context
        ]
    })

    return {
        calls,
        page: await browser.newPage()
    }
}

describe("puppeteer compat page", () => {
    test("waitForFunction wraps variadic function predicates without page eval", async () => {
        const { page } = await createCompatPage()

        const [predicate, arg, options] = await page.waitForFunction(
            (a, b) => a + b === 3,
            {
                timeout: 1000
            },
            1,
            2
        )

        expect(
            predicate([
                1,
                2
            ])
        ).toBe(true)
        expect(arg).toEqual([
            1,
            2
        ])
        expect(options).toEqual({
            timeout: 1000
        })
    })

    test("waitForFunction keeps string predicates on the native string path", async () => {
        const { page } = await createCompatPage()

        const [predicate, arg, options] = await page.waitForFunction(
            "window.ready === true",
            {
                timeout: 1000
            },
            "unused",
            "ignored"
        )

        expect(predicate).toBe("window.ready === true")
        expect(arg).toBe("unused")
        expect(options).toEqual({
            timeout: 1000
        })
    })

    test("navigation waitUntil accepts puppeteer networkidle aliases and arrays", async () => {
        const { page } = await createCompatPage()

        const [, gotoOptions] = await page.goto("https://example.com", {
            waitUntil: [
                "domcontentloaded",
                "networkidle0"
            ]
        })
        const [content, setContentOptions] = await page.setContent("<main></main>", {
            waitUntil: [
                "load",
                "domcontentloaded"
            ]
        })
        const [navigationOptions] = await page.waitForNavigation({
            waitUntil: "networkidle2"
        })

        expect(gotoOptions.waitUntil).toBe("networkidle")
        expect(content).toBe("<main></main>")
        expect(setContentOptions.waitUntil).toBe("domcontentloaded")
        expect(navigationOptions.waitUntil).toBe("networkidle")
    })
})
