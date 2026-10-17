import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { setMuted, sfx } from "./sfx"
import {
  allMoves, apply, files, inCheck, initialBoard, legalFrom, same, sq, visibleSquares,
  type Board, type Color, type Kind, type Move, type Piece, type Position, type Square,
} from "./rules"
import { BASE, codeFromPath, findOpponent, newCode, roomPath, roomUrl, useRoom, type Room } from "./useRoom"
import { CONFIG } from "./config"
import { engineMove, stopEngine, type Level } from "./engine"
import type { Reason, Settings } from "./protocol"


const A = `${BASE}assets`
const HUMAN: Color = "white"
const AI: Color = "black"

// Silhouette ("Union") behind each piece, per side.
const unionSrc: Record<Color, Record<Kind, string>> = {
  white: {
    knight: `${A}/63c37.svg`,
    bishop: `${A}/06dcb.svg`,
    rook: `${A}/1034b.svg`,
    king: `${A}/5aa6e.svg`,
    pawn: `${A}/a0690.svg`,
    queen: `${A}/ffa4b.svg`,
  },
  black: {
    queen: `${A}/78caf.svg`,
    knight: `${A}/6c534.svg`,
    bishop: `${A}/67954.svg`,
    rook: `${A}/18866.svg`,
    king: `${A}/82991.svg`,
    pawn: `${A}/08ed6.svg`,
  },
}

const unionBox: Record<Kind, string> = {
  knight: "h-[52px] left-[19px] top-[13px]",
  pawn: "h-[44px] left-[20px] top-[21px]",
  rook: "h-[48px] left-[20px] top-[17px]",
  bishop: "h-[48px] left-[20px] top-[17px]",
  queen: "h-[48px] left-[20px] top-[17px]",
  king: "h-[48px] left-[20px] top-[17px]",
}

function glyph(piece: Piece): { src: string; className: string } {
  switch (piece.kind) {
    case "pawn":
      return { src: `${A}/8c921.svg`, className: "-translate-x-1/2 h-[36.572px] left-1/2 top-[26.73px] w-[34.541px]" }
    case "bishop":
      return { src: `${A}/75d9a.svg`, className: "-translate-x-1/2 h-[43.424px] left-1/2 top-[19.88px] w-[34.541px]" }
    case "knight":
      return { src: `${A}/542fb.svg`, className: "-translate-x-1/2 -translate-y-1/2 h-[43.736px] left-[calc(50%-0.96px)] top-[calc(50%+1.44px)] w-[32.297px]" }
    case "rook":
      return { src: `${A}/eae53.svg`, className: "-translate-x-1/2 -translate-y-1/2 h-[43.183px] left-1/2 top-[calc(50%+0.71px)] w-[34.229px]" }
    case "queen":
      return { src: `${A}/88c41.svg`, className: "-translate-x-1/2 -translate-y-1/2 h-[43.424px] left-[calc(50%+0.5px)] top-[calc(50%+1.59px)] w-[34.229px]" }
    case "king":
      return piece.color === "white"
        ? { src: `${A}/fd60c.svg`, className: "-translate-x-1/2 -translate-y-1/2 h-[40.88px] left-[calc(50%+0.5px)] top-[calc(50%+2.86px)] w-[34.541px]" }
        : { src: `${A}/b0af3.svg`, className: "-translate-x-1/2 h-[40.88px] left-[calc(50%+0.5px)] top-[22.42px] w-[34.541px]" }
  }
}

function Cell({ piece, dark }: { piece: Square; dark: boolean }) {
  if (!piece) {
    return (
      <div className={`-translate-x-1/2 -translate-y-1/2 absolute h-[69.832px] top-[calc(50%+1.34px)] w-[72.875px] ${dark ? "left-[calc(50%+0.5px)]" : "left-1/2"}`}>
        <img alt="" className="absolute block inset-0 max-w-none size-full" src={dark ? `${A}/aac0d.svg` : `${A}/c1bb9.svg`} />
      </div>
    )
  }
  const g = glyph(piece)
  return (
    <>
      <div className={`absolute w-[40px] ${unionBox[piece.kind]}`}>
        <img alt="" className="absolute block inset-0 max-w-none size-full" src={unionSrc[piece.color][piece.kind]} />
      </div>
      <div className="-translate-x-1/2 -translate-y-1/2 absolute h-[80px] left-[calc(50%+0.5px)] top-1/2 w-[75px]">
        <div className="absolute inset-[8.03%_1.41%_4.68%_1.42%]">
          <img alt="" className="absolute block inset-0 max-w-none size-full" src={dark ? `${A}/afad0.svg` : `${A}/f46ff.svg`} />
        </div>
      </div>
      <div className={`absolute ${g.className}`}>
        <img alt="" className="absolute block inset-0 max-w-none size-full" src={g.src} />
      </div>
    </>
  )
}

// Scales its content down so it always fits on screen (dialogs, menus): the game never scrolls.
function Fit({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [s, setS] = useState(1)
  useLayoutEffect(() => {
    const el = ref.current!
    const calc = () => setS(Math.min(1, (window.innerWidth - 16) / el.offsetWidth, (window.innerHeight - 16) / el.offsetHeight))
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(el)
    window.addEventListener("resize", calc)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", calc)
    }
  }, [])
  return (
    <div ref={ref} style={{ transform: `scale(${s})` }}>
      {children}
    </div>
  )
}

const ROBOT_LOSS = ["DETECTED.", "NO*&!@)%", "IMPOSSIBLE. ", "accepted."]
const PLAYER_LOSS = ["mistake.", "wound!", "FUTILE.", "HUMAN."]
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]

// Capture effect: colourful flash + ring + flying bits (as before), the captured piece
// crumbling into pixels under gravity, and a robot phrase in place of the old "BOOM".
function Annihilation({ piece, dark, text }: { piece: Piece; dark: boolean; text: string; word?: string }) {
  return (
    <span className="pointer-events-none absolute inset-0 z-10 overflow-visible">
      <Crumble piece={piece} dark={dark} />
      <PlusBlast dark={dark} />
      <span className="absolute left-[-1px] top-1/2 flex w-[82px] -translate-y-1/2 items-center justify-center bg-white">
        <TypeText text={text} />
      </span>
    </span>
  )
}

// The square's "+" texture lights up with a colour wave (white core -> yellow -> red) blowing outward.
function PlusBlast({ dark }: { dark: boolean }) {
  const src = dark ? `${A}/aac0d.svg` : `${A}/c1bb9.svg`
  return (
    <span
      className={`plus-blast absolute -translate-x-1/2 -translate-y-1/2 h-[69.832px] top-[calc(50%+1.34px)] w-[72.875px] ${dark ? "left-[calc(50%+0.5px)]" : "left-1/2"}`}
      style={{ maskImage: `url(${src})`, WebkitMaskImage: `url(${src})`, maskSize: "100% 100%", WebkitMaskSize: "100% 100%" }}
    />
  )
}

// Types the phrase in letter by letter.
function TypeText({ text }: { text: string }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setN((v) => (v >= text.length ? v : v + 1)), 45)
    return () => window.clearInterval(id)
  }, [text])
  return (
    <p className="font-['IBM_Plex_Mono:Bold'] leading-[normal] text-[#171717] text-[12px] tracking-[0.24px] uppercase whitespace-pre">
      {text.slice(0, n)}
      <span className="invisible">{text.slice(n)}</span>
    </p>
  )
}

// The captured piece breaks into pixel tiles that drop under gravity, bounce once and fade.
function Crumble({ piece, dark }: { piece: Piece; dark: boolean }) {
  const N = 10
  const size = 80 / N
  const refs = useRef<(HTMLSpanElement | null)[]>([])
  useEffect(() => {
    const tiles = Array.from({ length: N * N }, (_, i) => {
      const x = i % N
      const y = Math.floor(i / N)
      return {
        x: 0, y: 0, r: 0,
        vx: (x - N / 2 + 0.5) * 18 + (Math.random() - 0.5) * 60,
        vy: -60 - Math.random() * 140,
        vr: (Math.random() - 0.5) * 720,
        // bottom rows let go first, so the piece crumbles from below
        delay: (N - 1 - y) * 0.035 + Math.random() * 0.08,
        floor: 80 - y * size + 8 + Math.random() * 24,
        bounced: false,
      }
    })
    let raf = 0
    let last = performance.now()
    const start = last
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const t = (now - start) / 1000
      tiles.forEach((p, i) => {
        const el = refs.current[i]
        if (!el || t < p.delay) return
        p.vy += 1400 * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.r += p.vr * dt
        if (p.y > p.floor && !p.bounced) {
          p.y = p.floor
          p.vy *= -0.35
          p.vx *= 0.6
          p.bounced = true
        }
        const fade = Math.max(0, 1 - (t - p.delay) / 0.9)
        el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${p.r}deg)`
        el.style.opacity = String(fade)
      })
      if (t < 1.4) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <>
      {Array.from({ length: N * N }, (_, i) => {
        const x = i % N
        const y = Math.floor(i / N)
        return (
          <span
            key={i}
            ref={(el) => {
              refs.current[i] = el
            }}
            className="absolute overflow-hidden will-change-transform"
            style={{ left: x * size, top: y * size, width: size, height: size }}
          >
            <span className="absolute size-[80px]" style={{ left: -x * size, top: -y * size }}>
              <Cell piece={piece} dark={dark} />
            </span>
          </span>
        )
      })}
    </>
  )
}

const TONES = {
  dark: { frame: "border-white", inside: "bg-[#171717] border-2 border-solid border-white", text: "text-white", btn: "bg-white text-[#171717]" },
  robot: { frame: "border-white", inside: "bg-[red] border-2 border-solid border-white", text: "text-white", btn: "bg-white text-[#171717]" },
  player: { frame: "border-white", inside: "bg-[#02f] border-2 border-solid border-white", text: "text-white", btn: "bg-white text-[#171717]" },
  draw: { frame: "border-[#fffb00]", inside: "bg-[#fffb00]", text: "text-[#1e1e1e]", btn: "bg-[#1e1e1e] text-[#fffb00]" },
}

// Centred dialog over a faded, pixel-patterned backdrop.
function Modal({ tone, title, action, onAction, secondary, children, mobile = false, kind = "end" }: { tone: keyof typeof TONES; title: string; action: string; onAction: () => void; secondary?: { label: string; onClick: () => void }; children?: React.ReactNode; mobile?: boolean; kind?: "start" | "settings" | "end" }) {
  const t = TONES[tone]
  const inside = !mobile
    ? "gap-[48px] p-[64px]"
    : kind === "settings"
      ? "gap-[24px] px-[32px] py-[23px]"
      : kind === "start"
        ? "gap-[24px] pb-[32px] pt-[64px] px-[32px]"
        : "gap-[48px] pb-[32px] pt-[64px] px-[32px]"
  return (
    <div className="pixel-backdrop backdrop-in fixed inset-0 z-50 flex items-center justify-center overflow-hidden p-2" role="dialog" aria-modal="true">
      <Fit>
      <div className={`tv-on border-2 border-solid ${t.frame} flex flex-col items-start p-[8px] ${mobile ? "w-[256px]" : "w-[502px]"} max-w-full`}>
        <div className={`${t.inside} flex flex-col items-start ${inside} w-full`}>
          <p className={`font-['IBM_Plex_Mono:Medium'] leading-[normal] ${mobile ? "text-[24px] tracking-[0.48px]" : "text-[32px] tracking-[0.64px]"} ${t.text} uppercase w-full`}>{title}</p>
          {children}
          <button
            autoFocus
            onClick={onAction}
            className={`${t.btn} flex cursor-pointer items-center border-0 ${mobile ? "px-[16px]" : "px-[32px]"} py-[8px] w-full font-['IBM_Plex_Mono:Bold'] leading-[normal] ${mobile && kind !== "end" ? "text-[16px]" : "text-[24px]"} whitespace-nowrap hover:opacity-90`}
          >
            {action}
          </button>
          {secondary && (
            <button
              onClick={secondary.onClick}
              className={`flex w-full cursor-pointer items-center border-2 border-solid border-white bg-transparent ${mobile ? "px-[16px]" : "px-[32px]"} py-[6px] font-['IBM_Plex_Mono:Bold'] leading-[normal] ${t.text} ${mobile ? "text-[16px]" : "text-[24px]"} whitespace-nowrap hover:opacity-90`}
            >
              {secondary.label}
            </button>
          )}
        </div>
      </div>
      </Fit>
    </div>
  )
}

function Fog({ dark }: { dark: boolean }) {
  return dark ? (
    <div className="-translate-x-1/2 -translate-y-1/2 absolute h-[64.531px] left-[calc(50%+0.77px)] top-[calc(50%-0.27px)] w-[67.23px]">
      <img alt="" className="absolute block inset-0 max-w-none size-full" src={`${A}/31fa9.svg`} />
    </div>
  ) : (
    <div className="-translate-x-1/2 -translate-y-1/2 absolute h-[72.376px] left-1/2 top-[calc(50%+0.81px)] w-[71.574px]">
      <img alt="" className="absolute block inset-0 max-w-none size-full" src={`${A}/939c0.svg`} />
    </div>
  )
}

/* ---------- rules (white starts at the bottom) ---------- */


/* ---------- UI ---------- */

const metaLeftDefault = ["-", "8", "7", "6", "5", "4", "3", "2", "1", "-"]

function Ranks({ flip = false }: { flip?: boolean }) {
  const metaLeft = flip ? ["-", "1", "2", "3", "4", "5", "6", "7", "8", "-"] : metaLeftDefault
  return (
    <div className="flex flex-col font-['IBM_Plex_Mono:Regular'] gap-[68px] items-start leading-[normal] py-[4px] self-stretch shrink-0 text-[12px] text-center text-white w-[8px]">
      {metaLeft.map((t, i) => (
        <p className="shrink-0 w-full" key={i}>{t}</p>
      ))}
    </div>
  )
}

function Files({ flip = false }: { flip?: boolean }) {
  return (
    <div className="flex font-['IBM_Plex_Mono:Regular'] gap-[80px] items-center leading-[normal] px-[44px] shrink-0 text-[12px] text-center text-white w-full whitespace-nowrap">
      {(flip ? [...files].reverse() : files).map((f) => (
        <p className="shrink-0" key={f}>{f}</p>
      ))}
    </div>
  )
}

function endText(r: { winner: Color | null; reason: Reason } | null) {
  if (!r) return "Over"
  const side = r.winner === "white" ? "White" : "Black"
  switch (r.reason) {
    case "mate": return `Mate, ${side} wins`
    case "stalemate": return "Stalemate"
    case "resign": return `Resigned, ${side} wins`
    case "timeout": return `Time out, ${side} wins`
    case "agreed": return "Draw agreed"
    case "abandoned": return `Left the game, ${side} wins`
  }
}

const fmtClock = (ms: number) => {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

const linkBtn = "cursor-pointer border-0 bg-transparent p-0 text-left font-['IBM_Plex_Mono:Bold'] leading-[normal] text-white hover:underline"

// Clocks and connection state: small enough to stay on screen all the time.
function OnlineClocks({ room, row = false }: { room: Room; row?: boolean }) {
  const v = room.view!
  const [, tick] = useState(0)
  useEffect(() => {
    if (!v.clock?.running) return
    const id = window.setInterval(() => tick((n) => n + 1), 250)
    return () => window.clearInterval(id)
  }, [v.clock?.running, room.at])
  const opp: Color = v.you === "white" ? "black" : "white"
  const left = (c: Color) => (v.clock ? Math.max(0, v.clock[c] - (v.clock.running === c ? Date.now() - room.at : 0)) : null)
  const line = (c: Color, who: string) => {
    const ms = left(c)
    if (ms === null) return null
    return (
      <p className={`font-['IBM_Plex_Mono:Regular'] whitespace-pre ${v.turn === c && v.phase === "playing" ? "underline" : ""}`}>{`${who} ${fmtClock(ms)}`}</p>
    )
  }
  const note = !room.connected ? "RECONNECTING..." : !v.opponentOnline && v.phase !== "waiting" ? "FRIEND OFFLINE" : null
  return (
    <div className={`flex ${row ? "flex-row flex-wrap gap-x-[12px]" : "flex-col gap-[4px]"} leading-[normal] text-white`}>
      {line(v.you, "YOU")}
      {line(opp, "FRIEND")}
      {note && <p className="font-['IBM_Plex_Mono:Regular'] whitespace-pre opacity-70">{note}</p>}
    </div>
  )
}

function DrawPrompt({ room }: { room: Room }) {
  const v = room.view!
  if (v.phase !== "playing" || v.drawOffer !== (v.you === "white" ? "black" : "white")) return null
  return (
    <div className="flex flex-wrap gap-x-[12px] leading-[normal] text-white">
      <button className={linkBtn} onClick={() => room.send({ t: "draw" })}>| ACCEPT DRAW</button>
      <button className={linkBtn} onClick={() => room.send({ t: "decline" })}>NO</button>
    </div>
  )
}

// The dropdown: settings, game actions and (on small screens) the move log.
function MenuSheet({ room, pairs, onClose, onSettings, onLeave }: { room: Room | null; pairs: string[]; onClose: () => void; onSettings: () => void; onLeave: () => void }) {
  const v = room?.view ?? null
  const [armed, setArmed] = useState(false)
  const playing = v?.phase === "playing"
  const offered = v?.drawOffer === v?.you
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-hidden bg-black/80 p-2" onClick={onClose}>
      <Fit>
        <div
          onClick={(e) => e.stopPropagation()}
          className="tv-on flex w-[364px] flex-col gap-[16px] border-2 border-solid border-white bg-[#171717] p-[24px] text-[16px] leading-[normal] text-white"
        >
          <div className="flex items-center justify-between">
            <p className="font-['IBM_Plex_Mono:Bold']">| MENU</p>
            <button className={linkBtn} onClick={onClose}>CLOSE</button>
          </div>
          <button className={linkBtn} onClick={onSettings}>| SETTINGS</button>
          {v && room && (
            <>
              <p className="font-['IBM_Plex_Mono:Regular']">{`| ROOM ${v.code}`}</p>
              {playing && (offered ? (
                <p className="font-['IBM_Plex_Mono:Regular']">| DRAW OFFERED</p>
              ) : (
                <button className={linkBtn} onClick={() => room.send({ t: "draw" })}>| OFFER DRAW</button>
              ))}
              {playing && (
                <button
                  className={linkBtn}
                  onClick={() => {
                    if (armed) {
                      room.send({ t: "resign" })
                      onClose()
                    } else setArmed(true)
                  }}
                >
                  {armed ? "| SURE? RESIGN" : "| RESIGN"}
                </button>
              )}
              <button className={linkBtn} onClick={() => navigator.clipboard?.writeText(roomUrl(v.code)).catch(() => {})}>| COPY LINK</button>
              <button className={linkBtn} onClick={onLeave}>| LEAVE</button>
            </>
          )}
          <div className="flex flex-col gap-[8px]">
            <p className="font-['IBM_Plex_Mono:Bold']">| LAST MOVES</p>
            <div className="grid grid-cols-2 gap-x-[8px] gap-y-[4px] font-['IBM_Plex_Mono:Regular'] whitespace-pre">
              {pairs.slice(-12).map((p, i) => (
                <p key={i}>{p.replace(" ", "   ")}</p>
              ))}
            </div>
          </div>
        </div>
      </Fit>
    </div>
  )
}

export default function App() {
  // Online: `code` names the room; the server owns board, turn, clocks and history.
  const [code, setCode] = useState<string | null>(codeFromPath)
  const [create, setCreate] = useState<Settings | null>(null)
  const [lobby, setLobby] = useState({ minutes: 0, join: "" })
  const room = useRoom(code, create)
  const v = room.view
  const online = code !== null
  const me: Color = online ? (v?.you ?? "white") : HUMAN
  const opp: Color = me === "white" ? "black" : "white"
  const flip = online && me === "black"
  const [localBoard, setBoard] = useState(initialBoard)
  const [localTurn, setTurn] = useState<Color>(HUMAN)
  const board = online ? (v?.board ?? localBoard) : localBoard
  const turn = online ? (v?.turn ?? "white") : localTurn
  const [selected, setSelected] = useState<Position | null>(null)
  const [cursor, setCursor] = useState<Position>({ row: 6, col: 4 })
  const [localHistory, setHistory] = useState<string[]>([])
  const history = online ? (v?.history ?? []) : localHistory
  const [scale, setScale] = useState(1)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [pending, setPending] = useState<Position | null>(null)
  const [fog, setFog] = useState(false)
  const [sound, setSound] = useState(true)
  const first = useRef(true)
  const [modal, setModal] = useState<"start" | "settings" | "lobby" | "end" | null>(() => (codeFromPath() ? null : "start"))
  const [level, setLevel] = useState<Level>(CONFIG.defaultRobotLevel)
  const [draft, setDraft] = useState<{ fog: boolean; sound: boolean; level: Level }>({ fog: false, sound: true, level: CONFIG.defaultRobotLevel })
  const [boom, setBoom] = useState<{ row: number; col: number; id: number; piece: Piece; text: string; word: string } | null>(null)
  const panel = useRef<HTMLDivElement>(null)

  const targets = useMemo(
    () => (!selected ? [] : online ? (v?.legal[`${selected.row}-${selected.col}`] ?? []) : legalFrom(board, selected)),
    [board, selected, online, v],
  )
  const checked = online ? !!v?.check : inCheck(board, turn)
  const canMove = useMemo(() => online || allMoves(board, turn).length > 0, [board, turn, online])
  const over = online ? v?.phase === "over" : !canMove
  // Pieces of the side to move that can actually move: outlined so it's clear whose turn it is.
  const movable = useMemo(() => {
    const set = new Set<string>()
    if (online) Object.keys(v?.legal ?? {}).forEach((k) => set.add(k))
    else allMoves(board, turn).forEach((m) => set.add(`${m.from.row}-${m.from.col}`))
    return set
  }, [board, turn, online, v])
  const visible = useMemo(() => visibleSquares(board, me), [board, me])
  const fogOn = online ? !!v?.settings.fog : fog
  const status = online
    ? over
      ? endText(v?.result ?? null)
      : v?.phase !== "playing"
        ? "Waiting"
        : turn !== me
          ? v.opponentOnline ? "Friend thinks" : "Friend away"
          : checked ? "Check!" : pending ? "Confirm?" : selected ? "Pick square" : "Choose"
    : over
    ? checked
      ? `Mate, ${turn === "white" ? "Black" : "White"} wins`
      : "Stalemate"
    : turn === AI
      ? pending
        ? fogOn && !visible.has(`${pending.row}-${pending.col}`)
          ? "AI moves"
          : `AI ${selected ? (fogOn && !visible.has(`${selected.row}-${selected.col}`) ? "??" : sq(selected)) : ""}${sq(pending)}`
        : selected
          ? "AI picks"
          : "AI thinks"
      : checked
        ? "Check!"
        : pending
          ? "Confirm?"
          : selected
            ? "Pick square"
            : "Choose"

  const play = (m: Move) => {
    if (online) {
      room.send({ t: "move", from: m.from, to: m.to })
      setSelected(null)
      setPending(null)
      return
    }
    const next = apply(board, m)
    const other: Color = turn === "white" ? "black" : "white"
    if (board[m.to.row][m.to.col]) {
      sfx.capture()
      const id = Date.now()
      const victim = board[m.to.row][m.to.col]!
      setBoom({ ...m.to, id, piece: victim, ...(victim.color === AI ? { text: pick(ROBOT_LOSS), word: "\u0441aptured" } : { text: pick(PLAYER_LOSS), word: "DEFEATED" }) })
      window.setTimeout(() => setBoom((b) => (b?.id === id ? null : b)), 1600)
      // Robot reacts: its piece was captured, or it took one of the player's.

    }
    else sfx.move()
    if (inCheck(next, other)) window.setTimeout(() => sfx.check(), 160)
    setBoard((b) => apply(b, m))
    // Under war fog, hide the AI's squares the player can't see (before or after the move).
    const seeBefore = visibleSquares(board, HUMAN)
    const seeAfter = visibleSquares(next, HUMAN)
    const mask = (p: Position) => {
      const k = `${p.row}-${p.col}`
      return fogOn && turn === AI && !seeBefore.has(k) && !seeAfter.has(k) ? "??" : sq(p)
    }
    setHistory((h) => [...h, `${mask(m.from)}${mask(m.to)}`])
    setTurn((t) => (t === "white" ? "black" : "white"))
    setSelected(null)
    setPending(null)
  }

  const reset = () => {
    setBoard(initialBoard())
    setTurn(HUMAN)
    setSelected(null)
    setPending(null)
    setCursor({ row: 6, col: 4 })
    setHistory([])
    sfx.start()
  }

  useEffect(() => setMuted(!sound), [sound])

  // Keep the newest move (and the settings below it) in view as the log grows.
  useEffect(() => {
    panel.current?.scrollTo({ top: panel.current.scrollHeight, behavior: "smooth" })
  }, [history.length])

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (!over) return
    const won = online ? v?.result?.winner === me : inCheck(board, turn) && turn === AI
    const t1 = window.setTimeout(() => (won ? sfx.win() : sfx.lose()), 250)
    const t2 = window.setTimeout(() => setModal("end"), 1200)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [over])

  // A new online game (rematch) closes the result dialog.
  useEffect(() => {
    if (online && !over && modal === "end") setModal(null)
  }, [online, over, modal])

  // Online: play the sound / capture effect for each move the server reports.
  const seenMoves = useRef<number | null>(null)
  useEffect(() => {
    seenMoves.current = null
  }, [code])
  useEffect(() => {
    if (!v) return
    const prev = seenMoves.current
    seenMoves.current = v.moveNo
    if (prev === null || v.moveNo <= prev) return
    setSelected(null)
    setPending(null)
    const l = v.last
    if (!l) return
    if (l.captured) {
      sfx.capture()
      const id = Date.now()
      const piece = l.captured
      setBoom({ ...l.to, id, piece, ...(piece.color === me ? { text: pick(PLAYER_LOSS), word: "DEFEATED" } : { text: pick(ROBOT_LOSS), word: "captured" }) })
      window.setTimeout(() => setBoom((b) => (b?.id === id ? null : b)), 1600)
    } else sfx.move()
    if (v.check) window.setTimeout(() => sfx.check(), 160)
  }, [v?.moveNo])

  // The code was taken in the meantime: roll another one.
  useEffect(() => {
    if (room.error === "exists" && create) {
      const next = newCode()
      window.history.replaceState(null, "", roomPath(next))
      setCode(next)
    }
  }, [room.error])

  const leave = () => {
    window.history.pushState(null, "", BASE)
    setCode(null)
    setCreate(null)
    setSelected(null)
    setPending(null)
    setModal("start")
  }

  const createRoom = () => {
    const c = newCode()
    window.history.pushState(null, "", roomPath(c))
    setCreate({ fog: draft.fog, minutes: lobby.minutes })
    setCode(c)
    setFog(draft.fog)
    setSound(draft.sound)
    setModal(null)
    sfx.start()
  }

  // Random opponent: wait in the global queue, then join the room the server opens for the pair.
  const [searching, setSearching] = useState<Settings | null>(null)
  const cancelSearch = useRef<(() => void) | null>(null)
  const findRandom = () => {
    const settings: Settings = { fog: draft.fog, minutes: lobby.minutes }
    setSound(draft.sound)
    setModal(null)
    setSearching(settings)
    sfx.start()
    cancelSearch.current = findOpponent(
      settings,
      (c) => {
        cancelSearch.current = null
        setSearching(null)
        window.history.pushState(null, "", roomPath(c))
        setCreate(null)
        setCode(c)
        sfx.start()
      },
      () => {
        cancelSearch.current = null
        setSearching(null)
        setModal("lobby")
        sfx.denied()
      },
    )
  }
  // Waiting alone for a while: offer the robot instead (the queue search is dropped when it is taken).
  const [searchSecs, setSearchSecs] = useState(0)
  useEffect(() => {
    if (!searching) {
      setSearchSecs(0)
      return
    }
    const id = window.setInterval(() => setSearchSecs((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [searching])
  const playRobotInstead = () => {
    cancelSearch.current?.()
    cancelSearch.current = null
    setFog(searching?.fog ?? false)
    setLevel(draft.level)
    setSearching(null)
    reset()
  }
  const stopSearch = () => {
    cancelSearch.current?.()
    cancelSearch.current = null
    setSearching(null)
    setModal("lobby")
  }

  const joinRoom = () => {
    const c = lobby.join.trim().toUpperCase().replace(/^.*\//, "")
    if (!/^[A-Z0-9]{4,8}$/.test(c)) return sfx.denied()
    window.history.pushState(null, "", roomPath(c))
    setCreate(null)
    setCode(c)
    setSound(draft.sound)
    setModal(null)
    sfx.start()
  }

  useEffect(() => {
    if (online || turn !== AI || over || modal) return
    const timers: number[] = []
    let cancelled = false
    timers.push(
      window.setTimeout(async () => {
        sfx.aiThink()
        const m = await engineMove(board, AI, level)
        if (cancelled || !m) return
        // Show the AI's choice step by step: select piece, preview target, then move.
        setSelected(m.from)
        setCursor(m.from)
        sfx.aiPick()
        timers.push(
          window.setTimeout(() => {
            setPending(m.to)
            sfx.preview()
          }, CONFIG.robotPacing.previewDelayMs),
        )
        timers.push(window.setTimeout(() => play(m), CONFIG.robotPacing.moveDelayMs))
      }, CONFIG.robotPacing.thinkDelayMs),
    )
    return () => {
      cancelled = true
      stopEngine()
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [turn, board, over, modal, online])

  useEffect(() => {
    const fit = () => {
      const mobile = window.innerWidth < 960
      setIsMobile(mobile)
      // Whole screen, no scrolling: shrink to the viewport in both directions (footer takes ~48px).
      setScale(Math.min(1, (window.innerWidth - 16) / (mobile ? 364 : 945), (window.innerHeight - 48 - 16) / (mobile ? 500 : 790)))
    }
    fit()
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [])

  const activate = (pos: Position) => {
    setCursor(pos)
    if (turn !== me || over || modal || menuOpen || onlineModal || (online && v?.phase !== "playing")) return sfx.denied()
    const piece = board[pos.row][pos.col]
    if (selected && pending && same(pending, pos)) play({ from: selected, to: pos })
    else if (selected && targets.some((t) => same(t, pos))) {
      setPending(pos)
      sfx.preview()
    } else if (piece?.color === me) {
      const deselect = same(selected, pos)
      setSelected(deselect ? null : pos)
      setPending(null)
      if (deselect) sfx.cancel()
      else if (movable.has(`${pos.row}-${pos.col}`)) sfx.select()
      else sfx.denied()
    } else {
      if (selected) sfx.cancel()
      else sfx.denied()
      setSelected(null)
      setPending(null)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (!["arrowup", "arrowdown", "arrowleft", "arrowright", "enter", "escape", "r"].includes(k)) return
      if (k === "escape" && menuOpen) {
        setMenuOpen(false)
        return
      }
      if (modal || onlineModal || searching || menuOpen) return
      e.preventDefault()
      if (k === "r") {
        if (!online) reset()
      }
      else if (k === "escape") {
        if (selected) sfx.cancel()
        setSelected(null)
        setPending(null)
      }
      else if (k === "enter") activate(cursor)
      else {
        sfx.cursor()
        setCursor((c) => ({
          row: Math.max(0, Math.min(7, c.row + (flip ? -1 : 1) * (k === "arrowdown" ? 1 : k === "arrowup" ? -1 : 0))),
          col: Math.max(0, Math.min(7, c.col + (flip ? -1 : 1) * (k === "arrowright" ? 1 : k === "arrowleft" ? -1 : 0))),
        }))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const openSettings = () => {
    setDraft({ fog, sound, level })
    setModal("settings")
    sfx.select()
  }

  const onlineModal: "connecting" | "error" | "waiting" | null = !online
    ? null
    : room.error
      ? "error"
      : !v
        ? "connecting"
        : v.phase === "waiting"
          ? "waiting"
          : null

  const pairs: string[] = []
  for (let i = 0; i < history.length; i += 2) pairs.push(history.slice(i, i + 2).join(" "))

  // Board shared by desktop (80px squares) and mobile (36px squares in 40px tracks; the
  // desktop square art is scaled to fit so all effects stay identical).
  const order = flip ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7]
  const boardGrid = (mobile: boolean) => (
    <div
      className={`grid relative shrink-0 p-[8px] ${mobile ? "gap-[4px] grid-cols-[repeat(8,40px)] grid-rows-[repeat(8,40px)]" : "gap-[8px] grid-cols-[repeat(8,80px)] grid-rows-[repeat(8,80px)] w-full"}`}
      aria-label="Chess board"
    >
      {order.map((r) =>
        order.map((c) => {
          const piece = board[r][c]
          const pos = { row: r, col: c }
          const dark = (r + c) % 2 === 0
          const isTarget = targets.some((t) => same(t, pos))
          const isPending = same(pending, pos)
          const key = `${r}-${c}`
          const fogged = fogOn && !visible.has(key)
          // Hide every hint of the AI's activity inside the fog: its cursor, its piece, and the dots / dimming
          // of its possible moves whenever the piece it picked stands on a square we can't see.
          const hideAi = turn === opp && !!selected && fogOn && !visible.has(`${selected.row}-${selected.col}`)
          const hide = (fogged && turn === opp) || hideAi
          const real = isPending && selected ? board[selected.row][selected.col] : same(pending ? selected : null, pos) ? null : piece
          const shown = fogged && real?.color !== me ? null : real
          const ready = !selected && !over && movable.has(key) && !hide
          const booming = boom && boom.row === r && boom.col === c
          return (
            <button
              key={key}
              onClick={(e) => {
                e.currentTarget.blur()
                activate(pos)
              }}
              aria-label={`${sq(pos)}${piece ? `, ${piece.color} ${piece.kind}` : ""}`}
              className={`relative ${mobile ? "size-[36px]" : "size-[80px]"} cursor-pointer ${booming ? "z-20" : ""} border-0 p-0 outline-none ${dark ? "bg-[#1c1c1c]" : "bg-[#232323]"}`}
            >
              <span className={`absolute left-0 top-0 size-[80px] ${mobile ? "origin-top-left scale-[0.45]" : ""} ${same(selected, pos) && !hide ? "shadow-[inset_0_0_0_2px_#fff]" : ""}`}>
                <span className={`absolute inset-0 ${selected && !hideAi && !fogged && !isTarget && !same(selected, pos) ? "opacity-40" : ""}`}>
                  {fogged ? <Fog dark={dark} /> : <Cell piece={shown} dark={dark} />}
                </span>
                {ready && (
                  <span className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute border border-[#666] border-solid h-[80px] left-[calc(50%+0.5px)] top-1/2 w-[75px] animate-pulse" />
                )}
                {same(cursor, pos) && !(fogged && turn === opp) && <span className="pointer-events-none absolute inset-[2px] border border-white/30" />}
                {booming && <Annihilation key={boom.id} piece={boom.piece} dark={dark} text={boom.text} word={boom.word} />}
                {isTarget && !isPending && !hide && (
                  <span className={`pointer-events-none absolute ${piece && !fogged ? "inset-0 shadow-[inset_0_0_0_2px_#fff]" : "left-1/2 top-1/2 size-[10px] -translate-x-1/2 -translate-y-1/2 bg-white"}`} />
                )}
                {isPending && !hide && (
                  <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_3px_#fff] font-['IBM_Plex_Mono:Bold'] text-[10px] text-white">
                    {!mobile && <span className="absolute bottom-[2px] left-0 right-0 text-center">{turn === me ? "CLICK TO OK" : "AI MOVE"}</span>}
                  </span>
                )}
              </span>
            </button>
          )
        }),
      )}
    </div>
  )

  const openMenu = () => {
    setMenuOpen(true)
    sfx.select()
  }
  const menuBtn = (cls: string) => (
    <button onClick={openMenu} className={`cursor-pointer border-0 bg-transparent p-0 text-left font-['IBM_Plex_Mono:Bold'] leading-[normal] text-white hover:underline ${cls}`}>
      | MENU
    </button>
  )
  const okButton = (cls: string) =>
    pending && selected && turn === me ? (
      <button onClick={() => play({ from: selected, to: pending })} className={`cursor-pointer border-0 bg-transparent p-0 text-left font-['IBM_Plex_Mono:Bold'] text-white underline whitespace-nowrap ${cls}`}>
        {`| OK ${sq(selected)}${sq(pending)}`}
      </button>
    ) : null

  return (
    <div className={`flex h-[100dvh] w-full flex-col overflow-hidden ${isMobile ? "bg-[#070707]" : "bg-black"}`}>
    <main className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden p-2">
      <div className="sr-only">
        <h1>ASCII Chess: play chess online in ASCII art</h1>
        <p>
          Free chess in your browser with an ASCII-art interface. Play against the Stockfish robot on three levels, challenge a friend with a link,
          or get matched with a random opponent. Optional war fog hides everything you can't see, and chess clocks are available online.
        </p>
      </div>
      {isMobile ? (
        <div className="relative flex w-[364px] flex-col items-center gap-[12px]" style={{ zoom: scale }}>
          <div className="flex w-full items-start">{boardGrid(true)}</div>
          <div className="flex w-[340px] items-start justify-between text-[16px] text-white">
            <div className="flex w-[116px] flex-col items-start gap-[8px]">
              <p className="font-['IBM_Plex_Mono:Bold'] leading-[normal] whitespace-nowrap">| TURN</p>
              <div className="font-['IBM_Plex_Mono:Regular'] whitespace-nowrap">
                <p className="leading-[normal] whitespace-pre">{turn === me ? "| YOUR MOVE, " : online ? "| HIS MOVE, " : "| MY MOVE, "}</p>
                <p className="leading-[normal] whitespace-pre">{turn === me ? "  HUMAN" : online ? "  FRIEND" : "  ROBOT"}</p>
              </div>
            </div>
            <div className="flex w-[116px] flex-col items-start gap-[8px] leading-[normal]">
              <p className="font-['IBM_Plex_Mono:Bold'] whitespace-nowrap">| STATUS</p>
              <p className="font-['IBM_Plex_Mono:Regular'] whitespace-pre">{`  ${status}`}</p>
              {okButton("text-[16px]")}
            </div>
            <div className="flex w-[80px] justify-end">{menuBtn("text-[16px]")}</div>
          </div>
          {online && v && (
            <div className="flex w-[340px] flex-col gap-[4px] text-[16px]">
              <OnlineClocks room={room} row />
              <DrawPrompt room={room} />
            </div>
          )}
        </div>
      ) : (
      <div className="flex items-start gap-[40px]" style={{ zoom: scale }}>
        <div className="flex shrink-0 items-start gap-[16px]">
          <Ranks flip={flip} />
          <div className="flex shrink-0 flex-col items-center gap-[16px]">
            <Files flip={flip} />
            {boardGrid(false)}
            <Files flip={flip} />
          </div>
          <Ranks flip={flip} />
        </div>

        <div className="relative w-[190px] shrink-0 self-stretch overflow-hidden">
          <div className="flex h-full flex-col items-start justify-between gap-[24px] py-[48px]">
            <div className="flex flex-col items-start gap-[28px] leading-[normal] text-[24px] text-white">
              <div className="flex w-[116px] flex-col items-start gap-[8px]">
                <p className="w-full font-['IBM_Plex_Mono:Bold']">| TURN</p>
                <p className="font-['IBM_Plex_Mono:Regular'] whitespace-nowrap">{turn === me ? "| YOURS" : online ? "| FRIEND" : "| ROBOT"}</p>
              </div>
              <div className="flex flex-col items-start gap-[8px]">
                <p className="font-['IBM_Plex_Mono:Bold'] whitespace-nowrap">| STATUS</p>
                <p className="font-['IBM_Plex_Mono:Regular'] whitespace-pre">{`  ${status}`}</p>
                {okButton("text-[24px]")}
              </div>
              {online && v && (
                <div className="flex flex-col gap-[8px] text-[20px]">
                  <OnlineClocks room={room} />
                  <DrawPrompt room={room} />
                </div>
              )}
              <div className="flex flex-col items-start gap-[8px]">
                <p className="font-['IBM_Plex_Mono:Bold'] whitespace-nowrap">| LAST MOVES</p>
                {pairs.slice(-6).map((p, i) => (
                  <p className="font-['IBM_Plex_Mono:Regular'] whitespace-pre" key={i}>{`  ${p}`}</p>
                ))}
              </div>
            </div>
            {menuBtn("h-[31px] w-[116px] text-[24px] whitespace-nowrap")}
          </div>
        </div>
      </div>
      )}

      {menuOpen && (
        <MenuSheet
          room={online && v ? room : null}
          pairs={pairs}
          onClose={() => setMenuOpen(false)}
          onSettings={() => {
            setMenuOpen(false)
            openSettings()
          }}
          onLeave={() => {
            setMenuOpen(false)
            leave()
          }}
        />
      )}

      {online && !modal && onlineModal === "connecting" && (
        <Modal mobile={isMobile} kind="settings" tone="dark" title="CONNECTING..." action="CANCEL" onAction={leave} />
      )}
      {online && !modal && onlineModal === "error" && (
        <Modal
          mobile={isMobile}
          kind="settings"
          tone="robot"
          title={room.error === "full" ? "ROOM IS FULL." : room.error === "not_found" ? "NO SUCH ROOM." : "SOMETHING BROKE."}
          action="OK"
          onAction={leave}
        />
      )}
      {online && !modal && onlineModal === "waiting" && v && (
        <Modal
          mobile={isMobile}
          kind="settings"
          tone="dark"
          title="WAITING FOR A FRIEND"
          action="COPY LINK"
          onAction={() => {
            navigator.clipboard?.writeText(roomUrl(v.code)).catch(() => {})
            sfx.toggle()
          }}
          secondary={{ label: "CANCEL", onClick: leave }}
        >
          <div className={`flex w-full flex-col gap-[8px] leading-[normal] text-white ${isMobile ? "text-[16px]" : "text-[24px]"}`}>
            <p className="font-['IBM_Plex_Mono:Bold']">| CODE</p>
            <p className="font-['IBM_Plex_Mono:Regular'] tracking-[0.3em]">{`  ${v.code}`}</p>
            <p className="font-['IBM_Plex_Mono:Regular'] break-all text-[14px] opacity-70">{roomUrl(v.code)}</p>
            <p className="font-['IBM_Plex_Mono:Regular'] text-[14px] opacity-70">{`${v.settings.fog ? "WAR FOG ON" : "WAR FOG OFF"} / ${v.settings.minutes ? `${v.settings.minutes} MIN` : "NO CLOCK"}`}</p>
          </div>
        </Modal>
      )}
      {searching && (
        <Modal
          mobile={isMobile}
          kind="settings"
          tone="dark"
          title="LOOKING FOR A HUMAN..."
          action="CANCEL"
          onAction={stopSearch}
          secondary={searchSecs >= CONFIG.robotOfferAfterSeconds ? { label: "PLAY THE ROBOT", onClick: playRobotInstead } : undefined}
        >
          <p className={`w-full font-['IBM_Plex_Mono:Regular'] leading-[normal] text-white opacity-70 ${isMobile ? "text-[14px]" : "text-[16px]"}`}>
            {`${searching.fog ? "WAR FOG ON" : "WAR FOG OFF"} / ${searching.minutes ? `${searching.minutes} MIN` : "NO CLOCK"}. Same settings only.${searchSecs >= CONFIG.robotOfferAfterSeconds ? " Nobody around yet: keep waiting or play the robot." : ""}`}
          </p>
        </Modal>
      )}
      {modal === "lobby" && (
        <Modal
          mobile={isMobile}
          kind="settings"
          tone="dark"
          title="PLAY ONLINE"
          action="RANDOM OPPONENT"
          onAction={findRandom}
          secondary={{ label: "PRIVATE ROOM", onClick: createRoom }}
        >
          <div className={`flex w-full flex-col leading-[normal] text-white ${isMobile ? "gap-[16px] text-[16px]" : "gap-[24px] text-[24px]"}`}>
            {([
              ["| CLOCK", lobby.minutes, (x: number) => setLobby((l) => ({ ...l, minutes: x })), CONFIG.clockMinutes.map((m) => [m, m ? `${m}M` : "OFF"] as const)],
              ["| WAR FOG", draft.fog ? 1 : 0, (x: number) => setDraft((d) => ({ ...d, fog: x === 1 })), [[1, "ON"], [0, "OFF"]]],
            ] as const).map(([label, cur, set, opts]) => (
              <div className="flex flex-col gap-[8px]" key={label}>
                <p className="font-['IBM_Plex_Mono:Bold']">{label}</p>
                <div className="flex gap-[16px] font-['IBM_Plex_Mono:Regular']">
                  {opts.map(([val, text]) => (
                    <button
                      key={val}
                      onClick={() => {
                        set(val)
                        sfx.toggle()
                      }}
                      className={`cursor-pointer border-0 bg-transparent p-0 font-['IBM_Plex_Mono:Regular'] leading-[normal] text-white ${isMobile ? "text-[16px]" : "text-[24px]"} ${cur === val ? "underline decoration-solid [text-underline-position:from-font]" : ""}`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex flex-col gap-[8px]">
              <p className="font-['IBM_Plex_Mono:Bold']">| JOIN BY CODE OR LINK</p>
              <input
                value={lobby.join}
                onChange={(e) => setLobby((l) => ({ ...l, join: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && joinRoom()}
                placeholder="ABCDE"
                spellCheck={false}
                className={`w-full border-2 border-solid border-white bg-transparent px-[8px] py-[4px] font-['IBM_Plex_Mono:Regular'] uppercase text-white outline-none placeholder:text-white/30 ${isMobile ? "text-[16px]" : "text-[24px]"}`}
              />
            </div>
            <button
              onClick={() => setModal("start")}
              className="cursor-pointer border-0 bg-transparent p-0 text-left font-['IBM_Plex_Mono:Regular'] text-[16px] leading-[normal] text-white underline"
            >
              BACK
            </button>
          </div>
        </Modal>
      )}
      {modal && modal !== "lobby" && (
        <Modal
          mobile={isMobile}
          kind={modal}
          tone={modal === "end" ? (online ? (!v?.result?.winner ? "draw" : v.result.winner === me ? "player" : "robot") : !checked ? "draw" : turn === HUMAN ? "robot" : "player") : "dark"}
          title={
            modal === "start"
              ? "How about a nice game of chess?"
              : modal === "settings"
                ? "SETTINGS"
                : (online ? !v?.result?.winner : !checked)
                  ? isMobile ? "WINNER:NONE." : "THE CAKE IS A LIE."
                  : online && v?.result?.winner === me
                    ? "WELL PLAYED, HUMAN."
                    : "ALL YOUR BASE ARE BELONG TO US."
          }
          action={modal === "start" ? "START" : modal === "settings" ? "APPLY" : online ? (v?.rematch[me] ? "WAITING..." : "REMATCH") : "OK"}
          secondary={
            modal === "start"
              ?           { label: "PLAY ONLINE", onClick: () => { setDraft({ fog, sound, level }); setModal("lobby"); sfx.select() } }
              : modal === "end" && online
                ? { label: "LEAVE", onClick: leave }
                : undefined
          }
          onAction={() => {
            if (modal === "end" && online) {
              if (!v?.rematch[me]) room.send({ t: "rematch" })
              return
            }
            if (modal === "end") {
              reset()
              setModal("start")
              setDraft({ fog, sound, level })
              return
            }
            setFog(draft.fog)
            setSound(draft.sound)
            setLevel(draft.level)
            setMuted(!draft.sound)
            setModal(null)
            if (modal === "start") reset()
            else sfx.toggle()
          }}
        >
          {modal === "end" && online && (
            <p className={`w-full font-['IBM_Plex_Mono:Regular'] leading-[normal] text-white uppercase ${isMobile ? "text-[16px]" : "text-[24px]"}`}>{`| ${endText(v?.result ?? null)}`}</p>
          )}
          {modal !== "end" && (
            <div className={`flex items-start leading-[normal] text-white w-full ${isMobile ? "flex-col gap-[16px] text-[16px]" : "gap-[32px] text-[24px]"}`}>
              {([
                ["| WAR FOG", "fog"],
                ["| SOUND", "sound"],
              ] as const).filter(([, k]) => !(online && k === "fog")).map(([label, k]) => (
                <div className="flex flex-col gap-[8px] items-end shrink-0 w-[159px]" key={k}>
                  <p className="font-['IBM_Plex_Mono:Bold'] w-full">{label}</p>
                  <div className="flex font-['IBM_Plex_Mono:Regular'] gap-[8px] items-start w-full whitespace-nowrap">
                    {[true, false].map((v) => (
                      <button
                        key={String(v)}
                        onClick={() => {
                          setDraft((d) => ({ ...d, [k]: v }))
                          if (k === "sound") setMuted(!v)
                          sfx.toggle()
                        }}
                        className={`shrink-0 cursor-pointer border-0 bg-transparent p-0 font-['IBM_Plex_Mono:Regular'] ${isMobile ? "text-[16px]" : "text-[24px]"} leading-[normal] text-white ${draft[k] === v ? "underline decoration-solid [text-underline-position:from-font]" : ""}`}
                      >
                        {v ? "ON" : "OFF"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {(modal === "start" || modal === "settings") && !online && (
            <div className={`flex w-full flex-col gap-[8px] leading-[normal] text-white ${isMobile ? "text-[16px]" : "text-[24px]"}`}>
              <p className="font-['IBM_Plex_Mono:Bold']">| ROBOT LEVEL</p>
              <div className="flex gap-[16px] font-['IBM_Plex_Mono:Regular']">
                {(Object.keys(CONFIG.robotLevels) as Level[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => {
                      setDraft((d) => ({ ...d, level: l }))
                      sfx.toggle()
                    }}
                    className={`cursor-pointer border-0 bg-transparent p-0 font-['IBM_Plex_Mono:Regular'] uppercase leading-[normal] text-white ${isMobile ? "text-[16px]" : "text-[24px]"} ${draft.level === l ? "underline decoration-solid [text-underline-position:from-font]" : ""}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Modal>
      )}
    </main>
    <footer className="flex shrink-0 flex-col items-center gap-[2px] px-4 pb-[8px] pt-[4px] text-center font-['IBM_Plex_Mono:Regular'] text-[12px] leading-[normal] text-white/60">
      <p>
        Original concept &amp; design &mdash;{" "}
        <a href="https://azykowww.com" target="_blank" rel="nofollow noreferrer noopener" className="text-white/80 underline hover:text-white">
          azykowww.com
        </a>
      </p>
      <p>
        Online version, bot engine, improvements &mdash;{" "}
        <a href="https://germanbragin.com" target="_blank" rel="noopener" className="text-white/80 underline hover:text-white">
          germanbragin.com
        </a>
      </p>
    </footer>
    </div>
  )
}
