// The robot's brain: Stockfish (lite, single-threaded WASM) in a Web Worker.
import { CONFIG, type RobotLevel } from "./config.ts"
import type { Board, Color, Move } from "./rules.ts"
import { legalUci, toFen } from "./uci.ts"

export type Level = RobotLevel

const LEVELS = CONFIG.robotLevels

let worker: Worker | null = null
let ready: Promise<void> | null = null
let listener: ((line: string) => void) | null = null
// Searches run strictly one after another.
let queue: Promise<unknown> = Promise.resolve()
let searching = false

function start() {
  if (ready) return ready
  worker = new Worker(`${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`)
  worker.onmessage = (e) => listener?.(String(e.data))
  ready = new Promise<void>((resolve) => {
    listener = (line) => {
      if (line === "uciok") {
        worker!.postMessage("isready")
      } else if (line === "readyok") {
        listener = null
        resolve()
      }
    }
    worker!.postMessage("uci")
  })
  return ready
}

/** Best move for `color`, or null when it has none. Resolves with a legal move even if the engine misbehaves. */
export function engineMove(board: Board, color: Color, level: Level): Promise<Move | null> {
  const run = async (): Promise<Move | null> => {
    const legal = legalUci(board, color)
    if (!legal.length) return null
    if (legal.length === 1) return legal[0].move
    try {
      await start()
    } catch {
      return legal[Math.floor(Math.random() * legal.length)].move
    }
    const w = worker!
    const cfg = LEVELS[level]
    w.postMessage("ucinewgame")
    for (const [name, value] of cfg.options) w.postMessage(`setoption name ${name} value ${value}`)
    w.postMessage(`position fen ${toFen(board, color)}`)
    searching = true
    const best = await new Promise<string>((resolve) => {
      listener = (line) => {
        const m = line.match(/^bestmove (\S+)/)
        if (m) {
          listener = null
          resolve(m[1])
        }
      }
      // searchmoves keeps the engine inside this game's rules (no castling, queen-only promotion).
      w.postMessage(`go movetime ${cfg.movetime} searchmoves ${legal.map((l) => l.uci).join(" ")}`)
    })
    searching = false
    return (legal.find((l) => l.uci === best) ?? legal[Math.floor(Math.random() * legal.length)]).move
  }
  const p = queue.then(run)
  queue = p.catch(() => {})
  return p
}

/** Ends a running search early (new game, dialog opened); its result is then ignored by the caller. */
export function stopEngine() {
  if (searching) worker?.postMessage("stop")
}
