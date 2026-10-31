// Assemble the plugin's page (page/*.js + style.css + icons/) into one
// self-contained index.html: no magpie host, no network.
//
//   git clone --depth 1 https://github.com/magpie-community/plugins /tmp/ao
//   AO_COMMIT=$(git -C /tmp/ao rev-parse HEAD) \
//     node build.mjs /tmp/ao/packages/agent-office index.html
//
// Three edits to the originals: the magpie API is shimmed (localStorage, the
// system's language and theme), the icon files are embedded as data URIs, and
// the page's script moves to the end of <body> (defer is ignored inline).
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const pkg = process.argv[2]
const out = process.argv[3]
const page = join(pkg, "page")
const read = (f) => readFileSync(join(page, f), "utf8")
const commit = process.env.AO_COMMIT || ""

const icons = {}
for (const f of readdirSync(join(page, "icons")).sort()) {
  const type = f.endsWith(".svg") ? "image/svg+xml" : f.endsWith(".png") ? "image/png" : null
  if (!type) continue
  icons[f] = `data:${type};base64,${readFileSync(join(page, "icons", f)).toString("base64")}`
}

// icons.js: the plugin loads icons/<file> beside itself; here they're embedded
const iconsJs = read("icons.js")
  .replace("img.src = \"icons/\" + brand.icon", "img.src = ICON_DATA[brand.icon]")
  .replace("if (brand.icon) {", "if (brand.icon && ICON_DATA[brand.icon]) {")
  .replace("(() => {", `(() => {\n  const ICON_DATA = ${JSON.stringify(icons)}`)

// model.js: no host here, so "starting…" would be a lie; say what to do
const modelJs = read("model.js")
  .replace('noFile: "Starting… the plugin reads your agents\' sessions in magpie\'s plugin host.",',
    'noFile: "No sample agents. Settings › Sample agents shows them again; a live.js written by the plugin\'s host beside this file shows real ones.",')
  .replace('noFile: "正在启动……插件在 magpie 的插件宿主里读取各个 Agent 的会话。",',
    'noFile: "没有示例 Agent：在“设置 › 示例 Agent”里重新打开；把插件宿主写出的 live.js 放在本文件旁边，就能显示真实会话。",')

// app.js: sample agents are the only data here, so they keep up with the clock
const appJs = read("app.js").replace("state.demoSnap ??= M.demo(now)", "state.demoSnap = M.demo(now)")

const shim = `// magpie's own API, as much as the page uses: the theme's language, the
// plugin's saved options (here: this browser's localStorage), theme changes.
(() => {
  const KEY = "agent-office"
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") } catch { return {} } }
  const mq = matchMedia("(prefers-color-scheme: dark)")
  const paint = () => { document.documentElement.dataset.theme = mq.matches ? "dark" : "light" }
  paint()
  mq.addEventListener("change", paint)
  globalThis.magpie = {
    ready: Promise.resolve({ lang: new URLSearchParams(location.search).get("lang") || navigator.language }),
    options: {
      // opened from disk there are no sessions to show: sample agents. served
      // by server.mjs there are: only what it reads.
      get: async () => ({ demo: location.protocol === "file:", ...read() }),
      set: async (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)) } catch {} return o },
    },
    onTheme() {},
  }
})()`

const css = read("style.css") + `
/* standalone: magpie paints the page's background and its own theme; here
   the page does, following the system's */
body { background: var(--bg); }
@media (prefers-color-scheme: dark) {
  :root { --bg: #151517; --card: #1c1c1f; --fg: #ececf1; --muted: #9b9ba3; --line: #2c2c31; }
}
`

const body = read("index.html")
  // function replacements: the sources hold "$&"-style sequences
  .replace(/<link rel="stylesheet" href="style.css">/, () => `<style>\n${css}</style>`)
  .replace(/<script src="_magpie\/bridge\.js"><\/script>\n/, "")
  .replace(/<script src="agents\.js"><\/script>\n/, () => `<script>${read("agents.js")}</script>\n`)
  .replace(/<script src="model\.js"><\/script>\n/, () => `<script>${modelJs}</script>\n`)
  .replace(/<script src="icons\.js"><\/script>\n/, () => `<script>${iconsJs}</script>\n`)
  .replace(/<script src="scene\.js"><\/script>\n/, () => `<script>${read("scene.js")}</script>\n`)
  .replace(/<script src="app\.js" defer><\/script>\n?/, "")
  .replace(/<meta charset="utf-8">/, `<meta charset="utf-8">\n<!--
  Agent Office, standalone: the magpie plugin's page (@magpie-community/page-agent-office)
  with the plugin's host part replaced (server.mjs serves live.js) — assembled from${commit ? ` magpie-community/plugins@${commit.slice(0, 7)}` : " magpie-community/plugins"}
  under the MIT license, same as the original. Open this file in a browser: no
  host, no network. Opened from disk it shows sample agents (Settings turns them
  off); served by server.mjs it shows the agents this machine is running.

  Real data, if wanted: write the host's live.js beside this file
  (globalThis.AgentOfficeLive = {v,sessions:[…]}), or paste it in a <script>
  before the last one. lib/readers.mjs + lib/scan.mjs in the package produce it.
-->`)
  .replace("</body>", () => `<script>${appJs}</script>\n</body>`)
  .replace("<title>Agent Office</title>", () => `<title>Agent Office</title>\n<script>${shim}</script>`)

writeFileSync(out, body)
console.log(`${out}: ${(Buffer.byteLength(body) / 1024).toFixed(0)} KiB, ${Object.keys(icons).length} icons`)
