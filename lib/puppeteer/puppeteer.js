import Renderer from "../renderer/loader.js"
import { wrapBrowser } from "puppeteer"

/**
 * 暂时保留对手工引用puppeteer.js的兼容
 * 后期会逐步废弃
 * 提供截图、分片截图，以及旧插件常用的 puppeteer 浏览器接口
 */
const renderer = Renderer.getRenderer()
let compatBrowser = null

function getCompatBrowser() {
    const browser = renderer.manager?.browser
    if (!browser) {
        return null
    }
    if (!compatBrowser || compatBrowser.browser !== browser) {
        compatBrowser = wrapBrowser(browser, target => renderer.manager?.stop?.(target))
    }
    return compatBrowser
}

renderer.screenshot = async (name, data) => {
    const img = await renderer.render(name, data)
    return img ? segment.image(img) : img
}
renderer.screenshots = async (name, data) => {
    data.multiPage = true
    const imgs = (await renderer.render(name, data)) || []
    const ret = []
    for (const img of imgs) {
        ret.push(img ? segment.image(img) : img)
    }
    return ret.length > 0 ? ret : false
}

renderer.browserInit = async () => {
    const browser = await renderer.manager?.browserInit?.()
    if (!browser) {
        return false
    }
    return getCompatBrowser()
}

renderer.ensureBrowser = renderer.browserInit

Object.defineProperty(renderer, "browser", {
    get() {
        return getCompatBrowser()
    }
})

export default renderer
