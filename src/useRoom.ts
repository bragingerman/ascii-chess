import { useCallback, useEffect, useRef, useState } from "react"
import { randomCode } from "./config"
import type { ClientMsg, MatchMsg, ServerMsg, Settings, View } from "./protocol"

export const newCode = randomCode

// The app lives under a base path in production (/ascii-chess/) and at the root in `vite dev`.
export const BASE = import.meta.env.BASE_URL
export const roomPath = (code: string) => `${BASE}r/${code}`
export const roomUrl = (code: string) => `${location.origin}${roomPath(code)}`
export const codeFromPath = () => {
  const path = location.pathname
  return path.startsWith(`${BASE}r/`) ? (path.slice(BASE.length + 2).match(/^([A-Za-z0-9]{4,8})\/?$/)?.[1].toUpperCase() ?? null) : null
}

function tokenFor(code: string) {
  const key = `ascii-chess:${code}`
  try {
    const saved = localStorage.getItem(key)
    if (saved) return saved
    const t = crypto.randomUUID()
    localStorage.setItem(key, t)
    return t
  } catch {
    return crypto.randomUUID()
  }
}

/** Joins the global queue; calls `onMatched` with the room code once an opponent is found. Returns a cancel function. */
export function findOpponent(settings: Settings, onMatched: (code: string) => void, onFail: () => void) {
  const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${BASE}match`)
  let done = false
  sock.onopen = () => sock.send(JSON.stringify({ t: "find", settings }))
  sock.onmessage = (e) => {
    const msg: MatchMsg = JSON.parse(e.data)
    if (msg.t === "matched") {
      done = true
      onMatched(msg.code)
    } else if (msg.t === "error") {
      done = true
      onFail()
    }
  }
  sock.onclose = () => {
    if (!done) onFail()
  }
  return () => {
    done = true
    sock.close()
  }
}

export type RoomError = "not_found" | "full" | "exists" | "bad"
export type Room = {
  view: View | null
  /** Moment `view` arrived; clocks count down from here. */
  at: number
  connected: boolean
  error: RoomError | null
  send: (msg: ClientMsg) => void
}

/** Keeps one WebSocket to the room alive (reconnecting with the same token) while `code` is set. */
export function useRoom(code: string | null, create: Settings | null): Room {
  const [view, setView] = useState<View | null>(null)
  const [at, setAt] = useState(0)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<RoomError | null>(null)
  const ws = useRef<WebSocket | null>(null)
  // `create` only matters for the very first hello.
  const createRef = useRef(create)
  createRef.current = create

  useEffect(() => {
    setView(null)
    setError(null)
    setConnected(false)
    if (!code) return
    const token = tokenFor(code)
    let stopped = false
    let retry = 0
    let timer = 0
    let first = true

    const open = () => {
      const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${BASE}ws/${code}`)
      ws.current = sock
      sock.onopen = () => {
        retry = 0
        setConnected(true)
        const hello: ClientMsg = { t: "hello", token, ...(first && createRef.current ? { create: createRef.current } : {}) }
        first = false
        sock.send(JSON.stringify(hello))
      }
      sock.onmessage = (e) => {
        const msg: ServerMsg = JSON.parse(e.data)
        if (msg.t === "error") {
          stopped = true
          setError(msg.reason)
          sock.close()
        } else {
          setView(msg)
          setAt(Date.now())
        }
      }
      sock.onclose = () => {
        setConnected(false)
        if (stopped) return
        timer = window.setTimeout(open, Math.min(5000, 400 * 2 ** retry++))
      }
    }
    open()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      ws.current?.close()
      ws.current = null
    }
  }, [code])

  const send = useCallback((msg: ClientMsg) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg))
  }, [])

  return { view, at, connected, error, send }
}
