import { DurableObject } from "cloudflare:workers"
import type { ClientMsg, FindMsg, LastMove, MatchMsg, Result, ServerMsg, Settings, View } from "../src/protocol"
import { allMoves, apply, initialBoard, inCheck, legalFrom, sq, visibleSquares, type Board, type Color, type Position } from "../src/rules"

interface Env {
  ROOM: DurableObjectNamespace<Room>
  LOBBY: DurableObjectNamespace<Lobby>
  ASSETS: Fetcher
}

const CODE = /^[A-Z0-9]{4,8}$/
const IDLE_MS = 24 * 60 * 60 * 1000

// The game is served from https://germanbragin.com/ascii-chess/ (a route on that zone) and,
// for convenience, from the workers.dev address. Everything under PREFIX is ours; on the
// main domain every other path goes straight to the existing website untouched.
const PREFIX = "/ascii-chess"
const SITE_HOSTS = new Set(["germanbragin.com", "www.germanbragin.com"])

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const inside = path === PREFIX || path.startsWith(`${PREFIX}/`)

    if (!inside) {
      // Only reachable through the route's trailing wildcard (e.g. /ascii-chess-foo): leave it to the site.
      if (SITE_HOSTS.has(url.hostname)) return fetch(req)
      // workers.dev: old root-level links (/, /r/CODE) now live under the prefix.
      return Response.redirect(`${url.origin}${PREFIX}${path === "/" ? "/" : path}${url.search}`, 301)
    }
    if (path === PREFIX) return Response.redirect(`${url.origin}${PREFIX}/${url.search}`, 301)

    const rest = path.slice(PREFIX.length) // always starts with "/"
    if (rest === "/match") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 })
      return env.LOBBY.get(env.LOBBY.idFromName("global")).fetch(req)
    }
    const m = rest.match(/^\/ws\/([A-Za-z0-9]+)$/)
    if (m) {
      const code = m[1].toUpperCase()
      if (!CODE.test(code)) return new Response("bad code", { status: 400 })
      if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 })
      const stub = env.ROOM.get(env.ROOM.idFromName(code))
      return stub.fetch(req)
    }

    // Static files are stored without the prefix; unknown paths fall back to index.html (room links).
    url.pathname = rest
    return env.ASSETS.fetch(new Request(url, req))
  },
}

type Stored = {
  code: string
  settings: Settings
  seats: { white: string | null; black: string | null }
  phase: "waiting" | "playing" | "over"
  board: Board
  turn: Color
  /** Per move: the text each side sees (fog hides squares the viewer cannot see). */
  history: { white: string; black: string }[]
  moves: LastMove[]
  clocks: { white: number; black: number }
  turnStartedAt: number
  drawOffer: Color | null
  rematch: { white: boolean; black: boolean }
  result: Result | null
  touched: number
}

const other = (c: Color): Color => (c === "white" ? "black" : "white")

export class Room extends DurableObject<Env> {
  s: Stored | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get<Stored>("s")) ?? null
    })
  }

  async fetch(req: Request): Promise<Response> {
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    // The code travels in the URL; the id name is not readable from inside the object.
    this.code = new URL(req.url).pathname.split("/").pop()!.toUpperCase()
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  /** Called by the Lobby (RPC): open a room nobody sits in yet. False if the code is taken. */
  async prepare(code: string, settings: Settings): Promise<boolean> {
    if (this.s) return false
    this.code = code
    this.s = this.fresh(code, settings, null)
    await this.save()
    return true
  }

  private fresh(code: string, settings: Settings, white: string | null): Stored {
    const minutes = [0, 3, 5, 10].includes(settings.minutes) ? settings.minutes : 0
    return {
      code,
      settings: { fog: !!settings.fog, minutes },
      seats: { white, black: null },
      phase: "waiting",
      board: initialBoard(),
      turn: "white",
      history: [],
      moves: [],
      clocks: { white: minutes * 60000, black: minutes * 60000 },
      turnStartedAt: 0,
      drawOffer: null,
      rematch: { white: false, black: false },
      result: null,
      touched: Date.now(),
    }
  }

  code = ""

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg))
    } catch {}
  }

  private colorOf(ws: WebSocket): Color | null {
    const token = (ws.deserializeAttachment() as { token?: string } | null)?.token
    const s = this.s
    if (!s || !token) return null
    return s.seats.white === token ? "white" : s.seats.black === token ? "black" : null
  }

  private online(color: Color, except?: WebSocket) {
    return this.ctx.getWebSockets().some((w) => w !== except && w.readyState === WebSocket.OPEN && this.colorOf(w) === color)
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: ClientMsg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    if (msg.t === "hello") return this.hello(ws, msg)
    const s = this.s
    const me = this.colorOf(ws)
    if (!s || !me) return
    const now = Date.now()

    if (msg.t === "move") {
      const { from, to } = msg
      if (s.phase !== "playing" || s.turn !== me) return
      const piece = s.board[from?.row]?.[from?.col]
      if (!piece || piece.color !== me || !legalFrom(s.board, from).some((p) => p.row === to?.row && p.col === to?.col)) return
      if (this.clockOut(s, now)) return this.finish({ winner: other(me), reason: "timeout" })
      const before = s.board
      const after = apply(before, { from, to })
      const text = (viewer: Color) => {
        if (!s.settings.fog || viewer === me) return `${sq(from)}${sq(to)}`
        const seen = new Set([...visibleSquares(before, viewer), ...visibleSquares(after, viewer)])
        const mask = (p: Position) => (seen.has(`${p.row}-${p.col}`) ? sq(p) : "??")
        return `${mask(from)}${mask(to)}`
      }
      s.history.push({ white: text("white"), black: text("black") })
      s.moves.push({ from: { ...from }, to: { ...to }, captured: before[to.row][to.col], by: me })
      s.board = after
      s.turn = other(me)
      s.turnStartedAt = now
      s.drawOffer = null
      if (!allMoves(after, s.turn).length) {
        return this.finish(inCheck(after, s.turn) ? { winner: me, reason: "mate" } : { winner: null, reason: "stalemate" })
      }
    } else if (msg.t === "resign") {
      if (s.phase !== "playing") return
      return this.finish({ winner: other(me), reason: "resign" })
    } else if (msg.t === "draw") {
      if (s.phase !== "playing") return
      if (s.drawOffer && s.drawOffer !== me) return this.finish({ winner: null, reason: "agreed" })
      s.drawOffer = me
    } else if (msg.t === "decline") {
      if (s.drawOffer !== other(me)) return
      s.drawOffer = null
    } else if (msg.t === "rematch") {
      if (s.phase !== "over") return
      s.rematch[me] = true
      if (s.rematch.white && s.rematch.black) this.start(s, true)
    } else return
    await this.save()
  }

  private async hello(ws: WebSocket, msg: Extract<ClientMsg, { t: "hello" }>) {
    if (typeof msg.token !== "string" || msg.token.length < 8 || msg.token.length > 64) return this.send(ws, { t: "error", reason: "bad" })
    let s = this.s
    if (msg.create) {
      if (s) return this.send(ws, { t: "error", reason: "exists" })
      s = this.s = this.fresh(this.code, msg.create, msg.token)
    }
    if (!s) return this.send(ws, { t: "error", reason: "not_found" })
    let color: Color | null = s.seats.white === msg.token ? "white" : s.seats.black === msg.token ? "black" : null
    if (!color) {
      if (s.seats.white && s.seats.black) return this.send(ws, { t: "error", reason: "full" })
      if (!s.seats.white) s.seats.white = msg.token
      else {
        // The second player arrives: colours are drawn by lot.
        s.seats.black = msg.token
        if (Math.random() < 0.5) s.seats = { white: s.seats.black, black: s.seats.white }
        this.start(s, false)
      }
      color = s.seats.white === msg.token ? "white" : "black"
    }
    // A reconnect replaces a stale socket of the same player.
    for (const w of this.ctx.getWebSockets()) if (w !== ws && this.colorOf(w) === color) w.close(1000, "replaced")
    ws.serializeAttachment({ token: msg.token })
    await this.save()
  }

  /** (Re)start a game; on a rematch the sides swap. */
  private start(s: Stored, swap: boolean) {
    if (swap) s.seats = { white: s.seats.black, black: s.seats.white }
    s.phase = "playing"
    s.board = initialBoard()
    s.turn = "white"
    s.history = []
    s.moves = []
    s.clocks = { white: s.settings.minutes * 60000, black: s.settings.minutes * 60000 }
    s.turnStartedAt = Date.now()
    s.drawOffer = null
    s.rematch = { white: false, black: false }
    s.result = null
  }

  /** Charge the mover's clock; true when it ran out. */
  private clockOut(s: Stored, now: number) {
    if (!s.settings.minutes) return false
    s.clocks[s.turn] = Math.max(0, s.clocks[s.turn] - (now - s.turnStartedAt))
    s.turnStartedAt = now
    return s.clocks[s.turn] <= 0
  }

  private async finish(result: Result) {
    const s = this.s!
    s.phase = "over"
    s.result = result
    s.drawOffer = null
    await this.save()
  }

  async alarm() {
    const s = this.s
    if (!s) return
    const now = Date.now()
    if (now - s.touched > IDLE_MS) {
      this.s = null
      this.ctx.getWebSockets().forEach((w) => w.close(1000, "idle"))
      return this.ctx.storage.deleteAll()
    }
    if (s.phase === "playing" && this.clockOut(s, now)) return this.finish({ winner: other(s.turn), reason: "timeout" })
    await this.save()
  }

  async webSocketClose(ws: WebSocket) {
    ws.close()
    this.broadcast(ws)
  }

  async webSocketError(ws: WebSocket) {
    this.broadcast(ws)
  }

  private async save() {
    const s = this.s!
    s.touched = Date.now()
    await this.ctx.storage.put("s", s)
    // One alarm serves both the flag-fall deadline and the idle clean-up.
    const flag = s.phase === "playing" && s.settings.minutes ? s.turnStartedAt + s.clocks[s.turn] : Infinity
    await this.ctx.storage.setAlarm(Math.min(flag, s.touched + IDLE_MS) + 50)
    this.broadcast()
  }

  private broadcast(closing?: WebSocket) {
    if (!this.s) return
    for (const ws of this.ctx.getWebSockets()) {
      const color = this.colorOf(ws)
      if (ws !== closing && ws.readyState === WebSocket.OPEN && color) this.send(ws, this.view(color, closing))
    }
  }

  private view(you: Color, closing?: WebSocket): View {
    const s = this.s!
    const seen = s.settings.fog ? visibleSquares(s.board, you) : null
    const board = seen ? s.board.map((row, r) => row.map((p, c) => (p && p.color !== you && !seen.has(`${r}-${c}`) ? null : p))) : s.board
    const legal: View["legal"] = {}
    if (s.phase === "playing" && s.turn === you) {
      s.board.forEach((row, r) =>
        row.forEach((p, c) => {
          if (p?.color !== you) return
          const to = legalFrom(s.board, { row: r, col: c })
          if (to.length) legal[`${r}-${c}`] = to
        }),
      )
    }
    const lm = s.moves[s.moves.length - 1] ?? null
    const hidden = lm && seen && lm.by !== you && !seen.has(`${lm.to.row}-${lm.to.col}`) && !seen.has(`${lm.from.row}-${lm.from.col}`)
    const now = Date.now()
    const running = s.phase === "playing" ? s.turn : null
    return {
      t: "state",
      code: s.code,
      you,
      settings: s.settings,
      phase: s.phase,
      board,
      turn: s.turn,
      check: inCheck(s.board, s.turn),
      legal,
      history: s.history.map((h) => h[you]),
      moveNo: s.moves.length,
      last: hidden ? null : lm,
      clock: s.settings.minutes
        ? {
            white: s.clocks.white - (running === "white" ? now - s.turnStartedAt : 0),
            black: s.clocks.black - (running === "black" ? now - s.turnStartedAt : 0),
            running,
          }
        : null,
      drawOffer: s.drawOffer,
      rematch: s.rematch,
      opponentOnline: this.online(other(you), closing),
      result: s.result,
    }
  }
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => ALPHABET[b % ALPHABET.length]).join("")

/**
 * Global matchmaking queue. A searching browser holds a socket here; when two sockets with the same
 * settings are waiting, the Lobby opens a Room for them and sends both its code.
 */
export class Lobby extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  private send(ws: WebSocket, msg: MatchMsg) {
    try {
      ws.send(JSON.stringify(msg))
    } catch {}
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: FindMsg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    if (msg.t !== "find") return
    const minutes = [0, 3, 5, 10].includes(msg.settings?.minutes) ? msg.settings.minutes : 0
    const settings: Settings = { fog: !!msg.settings?.fog, minutes }
    const key = `${settings.fog ? 1 : 0}-${minutes}`

    const other = this.ctx.getWebSockets().find(
      (w) => w !== ws && w.readyState === WebSocket.OPEN && (w.deserializeAttachment() as { key?: string } | null)?.key === key,
    )
    if (!other) {
      ws.serializeAttachment({ key })
      return this.send(ws, { t: "waiting" })
    }

    for (let i = 0; i < 5; i++) {
      const code = newCode()
      if (await this.env.ROOM.get(this.env.ROOM.idFromName(code)).prepare(code, settings)) {
        other.serializeAttachment({ key: null })
        this.send(other, { t: "matched", code })
        this.send(ws, { t: "matched", code })
        other.close(1000, "matched")
        ws.close(1000, "matched")
        return
      }
    }
    this.send(ws, { t: "error" })
  }

  async webSocketClose(ws: WebSocket) {
    ws.close()
  }
}
