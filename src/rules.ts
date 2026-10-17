// Pure chess rules, shared by the browser (AI + UI) and the Cloudflare Worker (online rooms).
// No castling, en passant or under-promotion: pawns always promote to a queen.

import { CONFIG } from "./config.ts"

export type Color = "white" | "black"
export type Kind = "rook" | "knight" | "bishop" | "queen" | "king" | "pawn"
export type Piece = { color: Color; kind: Kind }
export type Square = Piece | null
export type Board = Square[][]
export type Position = { row: number; col: number }
export type Move = { from: Position; to: Position }
export const files = ["a", "b", "c", "d", "e", "f", "g", "h"]

export function initialBoard(): Board {
  const back: Kind[] = ["rook", "knight", "bishop", "queen", "king", "bishop", "knight", "rook"]
  return Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 8 }, (_, col): Square => {
      if (row === 0) return { color: "black", kind: back[col] }
      if (row === 1) return { color: "black", kind: "pawn" }
      if (row === 6) return { color: "white", kind: "pawn" }
      if (row === 7) return { color: "white", kind: back[col] }
      return null
    }),
  )
}

export const same = (a: Position | null, b: Position) => a?.row === b.row && a.col === b.col
export const inside = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8
export const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]]
export const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
export const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]

export function rawMoves(board: Board, from: Position, attacksOnly = false): Position[] {
  const piece = board[from.row][from.col]
  if (!piece) return []
  const out: Position[] = []
  const add = (row: number, col: number) => {
    if (!inside(row, col)) return false
    const t = board[row][col]
    if (!t || t.color !== piece.color) out.push({ row, col })
    return !t
  }
  const slide = (dirs: number[][]) =>
    dirs.forEach(([dr, dc]) => {
      for (let n = 1; n < 8 && add(from.row + dr * n, from.col + dc * n); n++);
    })
  const dir = piece.color === "white" ? -1 : 1
  if (piece.kind === "pawn") {
    const start = piece.color === "white" ? 6 : 1
    const r = from.row + dir
    for (const dc of [-1, 1]) {
      const c = from.col + dc
      if (!inside(r, c)) continue
      if (attacksOnly) out.push({ row: r, col: c })
      else if (board[r][c] && board[r][c]!.color !== piece.color) out.push({ row: r, col: c })
    }
    if (!attacksOnly && inside(r, from.col) && !board[r][from.col]) {
      out.push({ row: r, col: from.col })
      const r2 = from.row + dir * 2
      if (from.row === start && !board[r2][from.col]) out.push({ row: r2, col: from.col })
    }
  } else if (piece.kind === "rook") slide(ORTHO)
  else if (piece.kind === "bishop") slide(DIAG)
  else if (piece.kind === "queen") slide([...ORTHO, ...DIAG])
  else if (piece.kind === "knight") KNIGHT.forEach(([dr, dc]) => add(from.row + dr, from.col + dc))
  else [...ORTHO, ...DIAG].forEach(([dr, dc]) => add(from.row + dr, from.col + dc))
  return out
}

export function apply(board: Board, { from, to }: Move): Board {
  const next = board.map((r) => [...r])
  const p = next[from.row][from.col]
  next[to.row][to.col] = p?.kind === "pawn" && (to.row === 0 || to.row === 7) ? { ...p, kind: "queen" } : p
  next[from.row][from.col] = null
  return next
}

export function inCheck(board: Board, color: Color) {
  let king: Position | null = null
  board.forEach((row, r) => row.forEach((p, c) => p?.color === color && p.kind === "king" && (king = { row: r, col: c })))
  if (!king) return true
  return board.some((row, r) =>
    row.some((p, c) => p && p.color !== color && rawMoves(board, { row: r, col: c }, true).some((m) => same(king, m))),
  )
}

export function legalFrom(board: Board, from: Position) {
  const p = board[from.row][from.col]
  if (!p) return []
  return rawMoves(board, from).filter((to) => !inCheck(apply(board, { from, to }), p.color))
}

export function allMoves(board: Board, color: Color): Move[] {
  const out: Move[] = []
  board.forEach((row, r) =>
    row.forEach((p, c) => {
      if (p?.color === color) legalFrom(board, { row: r, col: c }).forEach((to) => out.push({ from: { row: r, col: c }, to }))
    }),
  )
  return out
}

// War fog visibility: queen, king and rook see 3 squares around; other pieces see 1.
export function visibleSquares(board: Board, color: Color) {
  const set = new Set<string>()
  board.forEach((row, r) =>
    row.forEach((p, c) => {
      if (p?.color !== color) return
      const range = p.kind === "queen" || p.kind === "king" || p.kind === "rook" ? CONFIG.fogRange.queenKingRook : CONFIG.fogRange.others
      for (let dr = -range; dr <= range; dr++)
        for (let dc = -range; dc <= range; dc++) if (inside(r + dr, c + dc)) set.add(`${r + dr}-${c + dc}`)
    }),
  )
  return set
}

export const sq = (p: Position) => `${files[p.col]}${8 - p.row}`
