import PlaywrightRenderer from "../playwright/lib/playwright.js"

export default function (config) {
    const renderer = new PlaywrightRenderer(config)
    renderer.id = "puppeteer"
    return renderer
}
