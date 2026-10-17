// Game settings in one place. Shared by the browser and the Cloudflare Worker, so a change here
// applies to both on the next build / deploy (`pnpm deploy`).

export const CONFIG = {
  // ---- online games ----

  /** A player who stays disconnected this long, while the opponent is still there, loses the game. */
  abandonAfterMinutes: 5,

  /** An online room is deleted after this many hours without any activity. */
  roomIdleHours: 24,

  /** Clock choices offered for online games: minutes per side, 0 = no clock. */
  clockMinutes: [0, 3, 5, 10] as number[],

  /** Length of room codes ("ABCDE"). The Worker accepts codes of 4 to 8 characters. */
  roomCodeLength: 5,

  /** Random-opponent search: wait this long, then offer a game against the robot instead. */
  robotOfferAfterSeconds: 20,

  // ---- robot (Stockfish) ----

  defaultRobotLevel: "medium" as "easy" | "medium" | "hard",

  /**
   * Strength per level. `Skill Level` (0..20) weakens play with deliberate mistakes; `UCI_Elo` (1320..3190)
   * limits strength more smoothly. `movetime` is the thinking time in milliseconds.
   */
  robotLevels: {
    easy: { options: [["UCI_LimitStrength", "false"], ["Skill Level", "0"]] as [string, string][], movetime: 120 },
    medium: { options: [["Skill Level", "20"], ["UCI_LimitStrength", "true"], ["UCI_Elo", "1500"]] as [string, string][], movetime: 400 },
    hard: { options: [["Skill Level", "20"], ["UCI_LimitStrength", "true"], ["UCI_Elo", "2100"]] as [string, string][], movetime: 900 },
  },

  /** How the robot's turn is shown, in milliseconds: it "thinks", picks a piece, previews the target, then moves. */
  robotPacing: { thinkDelayMs: 350, previewDelayMs: 700, moveDelayMs: 1400 },

  // ---- war fog ----

  /** How many squares around a piece you can see: queen, king and rook see further than the rest. */
  fogRange: { queenKingRook: 3, others: 1 },
}

export type RobotLevel = keyof typeof CONFIG.robotLevels

// Unambiguous characters only (no 0/O, 1/I).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export const randomCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(CONFIG.roomCodeLength)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("")
