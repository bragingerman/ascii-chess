// Wire format between the browser and the Room Durable Object.
import type { Board, Color, Piece, Position } from "./rules"

export type Settings = { fog: boolean; minutes: number } // minutes 0 = no clock
export type Reason = "mate" | "stalemate" | "resign" | "timeout" | "agreed" | "abandoned"
export type Result = { winner: Color | null; reason: Reason }

export type ClientMsg =
  | { t: "hello"; token: string; create?: Settings }
  | { t: "move"; from: Position; to: Position }
  | { t: "resign" }
  | { t: "draw" } // offer a draw, or accept the pending offer
  | { t: "decline" }
  | { t: "rematch" }

/** Matchmaking socket (`/match`): ask for an opponent, get told which room to join. */
export type FindMsg = { t: "find"; settings: Settings }
export type MatchMsg = { t: "waiting" } | { t: "matched"; code: string } | { t: "error" }

export type LastMove = { from: Position; to: Position; captured: Piece | null; by: Color }

export type View = {
  t: "state"
  code: string
  you: Color
  settings: Settings
  phase: "waiting" | "playing" | "over"
  /** Under war fog this is already masked: enemy pieces you can't see are null. */
  board: Board
  turn: Color
  check: boolean
  /** Legal targets for each of your pieces ("row-col" -> squares); empty when it is not your turn. */
  legal: Record<string, Position[]>
  history: string[]
  moveNo: number
  /** Latest move, or null when fog hides it from you. */
  last: LastMove | null
  /** Milliseconds left per side as of this message; `running` is the side whose clock ticks. */
  clock: { white: number; black: number; running: Color | null } | null
  drawOffer: Color | null
  rematch: { white: boolean; black: boolean }
  opponentOnline: boolean
  result: Result | null
}

export type ServerMsg = View | { t: "error"; reason: "not_found" | "full" | "exists" | "bad" }
