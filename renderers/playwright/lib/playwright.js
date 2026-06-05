import Renderer from "../../../lib/renderer/Renderer.js"
import { BrowserManager } from "../../../lib/browser/manager.js"

export default class PlaywrightRenderer extends Renderer {
  constructor(config) {
    super({
      id: "playwright",
      type: "image",
      render: "screenshot",
    })
    this.manager = new BrowserManager(config)
  }

  async screenshot(name, data = {}) {
    return this.manager.screenshot(name, data, {
      dealTpl: (entryName, entryData) => this.dealTpl(entryName, entryData),
    })
  }

  restart(force = false) {
    return this.manager.restart(force)
  }

  async stop() {
    await this.manager.stop()
  }
}
