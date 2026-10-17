// Translation between our board model and the UCI protocol spoken by Stockfish.
import { allMoves, files, type Board, type Color, type Move } from "./rules.ts"

const LETTER = { pawn: "p", knight: "n", bishop: "b", rook: "r", queen: "q", king: "k" } as const

/** FEN without castling rights or en passant: this game has neither. */
export function toFen(board: Board, turn: Color) {
  const rows = board.map((row) => {
    let out = ""
    let gap = 0
    for (const p of row) {
      if (!p) gap++
      else {
        if (gap) out += gap
        gap = 0
        const l = LETTER[p.kind]
        out += p.color === "white" ? l.toUpperCase() : l
      }
    }
    return out + (gap || "")
  })
  return `${rows.join("/")} ${turn === "white" ? "w" : "b"} - - 0 1`
}

const sqName = (row: number, col: number) => `${files[col]}${8 - row}`

/** UCI spelling of a move; a pawn reaching the last rank always promotes to a queen here. */
export function toUci(board: Board, { from, to }: Move) {
  const promo = board[from.row][from.col]?.kind === "pawn" && (to.row === 0 || to.row === 7)
  return `${sqName(from.row, from.col)}${sqName(to.row, to.col)}${promo ? "q" : ""}`
}

/** Every legal move paired with its UCI string; the engine is only ever allowed to pick from these. */
export function legalUci(board: Board, color: Color) {
  return allMoves(board, color).map((m) => ({ move: m, uci: toUci(board, m) }))
}
