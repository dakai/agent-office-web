// Agent Office, served: the plugin's page plus the part of its host that
// reads the agents' own session files — no magpie, no plugin host.
//
// Every 1.5 s it rereads the session files the agents write (lib/scan.mjs +
// lib/readers.mjs, the plugin's own readers) and serves the result as
// live.js, which index.html polls once a second. It listens on this machine
// only — 127.0.0.1 and the tailscale address, never the LAN — so the office
// is at http://localhost:7317 and http://<tailnet-ip>:7317.
//
//   PORT=7317            port to listen on
//   HOST=0.0.0.0         listen here instead (exposes it to the LAN too)
//   AGENT_OFFICE_TEXT=0  statuses and tool names only: no prompt, reply,
//                        error or command line leaves the scanner
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { createScanner } from "./lib/scan.mjs"

const PORT = Number(process.env.PORT) || 7317
const TEXT = process.env.AGENT_OFFICE_TEXT !== "0"
const EVERY = 1500
const PAGE = readFileSync(new URL("./index.html", import.meta.url))

const scanner = createScanner({ days: 2, max: 40 })

// a session as the page wants it (the plugin's own mapping, office.hooks.mjs)
function fromFiles(s, text) {
  return {
    key: s.key, source: "files", agent: s.agent, session: s.id, cwd: s.cwd, project: s.project,
    // with text off the title falls back to the folder and the step to the
    // tool's name: a prompt and a command line can both carry secrets
    title: text ? (s.title || s.project || "") : (s.project || ""),
    query: text ? s.query : "", model: s.model,
    started: s.started, updated: Math.max(s.updated || 0, s.touched || 0), touched: s.touched,
    phase: s.phase || "done", step: text ? s.step : (s.stepName || ""), reply: text ? s.reply : "", error: text ? s.error : "",
    pendingSince: s.pending?.[0]?.at || 0, turns: s.turns,
  }
}

function snapshot(now = Date.now()) {
  const sessions = []
  const seen = new Set()
  for (const s of scanner.scan(now)) {
    if (seen.has(s.key)) continue
    seen.add(s.key)
    sessions.push(fromFiles(s, TEXT))
  }
  return { v: 2, written: now, text: TEXT, sessions }
}

let live = snapshot()
setInterval(() => { try { live = snapshot() } catch {} }, EVERY).unref?.()

function handler(req, res) {
  const path = (req.url || "/").split("?")[0]
  const send = (status, type, body) => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store", "referrer-policy": "no-referrer" })
    res.end(body)
  }
  if (path === "/" || path === "/index.html") return send(200, "text/html; charset=utf-8", PAGE)
  if (path === "/live.js") return send(200, "application/javascript; charset=utf-8", `globalThis.AgentOfficeLive = ${JSON.stringify(live)};\n`)
  if (path === "/healthz") return send(200, "text/plain; charset=utf-8", "ok\n")
  if (path === "/favicon.ico") return send(204, "image/x-icon", "")
  send(404, "text/plain; charset=utf-8", "not found\n")
}

// 127.0.0.1 always; the tailscale address when there is one (a tailnet is a
// private network, the LAN is not); HOST replaces both
const tailnet = () => {
  if (process.env.TAILSCALE_IP) return process.env.TAILSCALE_IP
  for (const bin of ["tailscale", "/usr/bin/tailscale"]) {
    try {
      const ip = execFileSync(bin, ["ip", "-4"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split("\n")[0]
      if (ip) return ip
    } catch {}
  }
  return ""
}
const hosts = process.env.HOST ? [process.env.HOST] : ["127.0.0.1", tailnet()].filter(Boolean)

// one server per address: a server listens on one address, not several
const servers = hosts.map((host) => createServer(handler).listen(PORT, host, () => {
  console.log(`agent-office on http://${host}:${PORT}${TEXT ? "" : " (text off)"}`)
}))
console.log(`${live.sessions.length} session(s) at start`)

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { for (const s of servers) s.close(); process.exit(0) })
