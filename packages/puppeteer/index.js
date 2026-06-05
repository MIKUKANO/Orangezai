import { chromium } from "playwright"

class PuppeteerCompatElementHandle {
    constructor(locator) {
        this.locator = locator
    }

    async boundingBox() {
        return this.locator.boundingBox()
    }

    async screenshot(options = {}) {
        return this.locator.screenshot(normalizeScreenshotOptions(options))
    }

    async evaluate(fn, ...args) {
        return this.locator.evaluate(fn, ...args)
    }
}

class PuppeteerCompatPage {
    constructor(page) {
        this.page = page
    }

    async goto(url, options = {}) {
        const gotoOptions = {
            ...options
        }
        if (gotoOptions.waitUntil === "networkidle2") {
            gotoOptions.waitUntil = "networkidle"
        }
        return this.page.goto(url, gotoOptions)
    }

    async $(selector) {
        const locator = this.page.locator(selector).first()
        if ((await locator.count()) === 0) {
            return null
        }
        return new PuppeteerCompatElementHandle(locator)
    }

    async $$(selector) {
        const count = await this.page.locator(selector).count()
        const handles = []
        for (let index = 0; index < count; index++) {
            handles.push(new PuppeteerCompatElementHandle(this.page.locator(selector).nth(index)))
        }
        return handles
    }

    async $eval(selector, fn, ...args) {
        return this.page
            .locator(selector)
            .first()
            .evaluate(fn, ...args)
    }

    async $$eval(selector, fn, ...args) {
        return this.page.locator(selector).evaluateAll(fn, ...args)
    }

    async waitForSelector(selector, options = {}) {
        const locator = this.page.locator(selector).first()
        await locator.waitFor(normalizeWaitOptions(options))
        return new PuppeteerCompatElementHandle(locator)
    }

    async click(selector, options = {}) {
        return this.page.click(selector, options)
    }

    async type(selector, text, options = {}) {
        return this.page.type(selector, text, options)
    }

    async setContent(html, options = {}) {
        const setContentOptions = {
            ...options
        }
        if (setContentOptions.waitUntil === "networkidle2") {
            setContentOptions.waitUntil = "networkidle"
        }
        return this.page.setContent(html, setContentOptions)
    }

    async content() {
        return this.page.content()
    }

    async setUserAgent(userAgent) {
        return this.page.context().setExtraHTTPHeaders({
            "user-agent": userAgent
        })
    }

    async setExtraHTTPHeaders(headers) {
        return this.page.setExtraHTTPHeaders(headers)
    }

    async addStyleTag(options) {
        return this.page.addStyleTag(options)
    }

    async addScriptTag(options) {
        return this.page.addScriptTag(options)
    }

    async setViewport(viewport) {
        return this.page.setViewportSize(normalizeViewport(viewport))
    }

    async screenshot(options = {}) {
        return this.page.screenshot(normalizeScreenshotOptions(options))
    }

    async evaluate(fn, ...args) {
        return this.page.evaluate(fn, ...args)
    }

    async close() {
        return this.page.close()
    }
}

class PuppeteerCompatBrowser {
    constructor(browser, closeDelegate) {
        this.browser = browser
        this.closeDelegate = closeDelegate
    }

    async newPage() {
        const context =
            this.browser.contexts()[0] ||
            (await this.browser.newContext({
                viewport: {
                    width: 1280,
                    height: 720
                }
            }))
        const page = await context.newPage()
        return new PuppeteerCompatPage(page)
    }

    async pages() {
        return this.browser
            .contexts()
            .flatMap(context => context.pages())
            .map(page => new PuppeteerCompatPage(page))
    }

    async close() {
        return this.closeDelegate ? this.closeDelegate(this.browser) : this.browser.close()
    }

    disconnect() {
        return this.browser.close()
    }

    on(event, handler) {
        this.browser.on(event, handler)
        return this
    }

    wsEndpoint() {
        return this.browser.wsEndpoint?.() || ""
    }
}

export async function launch(options = {}) {
    const browser = await chromium.launch(normalizeLaunchOptions(options))
    return new PuppeteerCompatBrowser(browser)
}

export async function connect(options = {}) {
    const endpoint =
        typeof options === "string" ? options : options.browserWSEndpoint || options.wsEndpoint || options.endpointURL

    if (!endpoint) {
        throw new Error("Orangezai puppeteer shim requires browserWSEndpoint/wsEndpoint/endpointURL")
    }

    const browser =
        options.browserWSEndpoint || options.puppeteerWS || /^https?:/i.test(endpoint)
            ? await chromium.connectOverCDP(endpoint)
            : await chromium.connect(endpoint)

    return new PuppeteerCompatBrowser(browser)
}

export default {
    launch,
    connect
}

function normalizeLaunchOptions(options) {
    const launchOptions = {
        ...options
    }
    if (launchOptions.headless === "new") {
        launchOptions.headless = true
    }
    delete launchOptions.browserWSEndpoint
    delete launchOptions.wsEndpoint
    delete launchOptions.endpointURL
    return launchOptions
}

function normalizeViewport(viewport) {
    return {
        width: Math.max(Math.ceil(viewport.width || 0), 1),
        height: Math.max(Math.ceil(viewport.height || 0), 1)
    }
}

function normalizeScreenshotOptions(options) {
    const screenshotOptions = {
        ...options
    }
    if (screenshotOptions.type === "png") {
        delete screenshotOptions.quality
    }
    return screenshotOptions
}

function normalizeWaitOptions(options) {
    const waitOptions = {
        ...options
    }
    if (waitOptions.visible) {
        waitOptions.state = "visible"
    }
    if (waitOptions.hidden) {
        waitOptions.state = "hidden"
    }
    delete waitOptions.visible
    delete waitOptions.hidden
    return waitOptions
}
