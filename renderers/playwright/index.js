import PlaywrightRenderer from "./lib/playwright.js"

export default function (config) {
  return new PlaywrightRenderer(config)
}
