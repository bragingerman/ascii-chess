// Tiny 8-bit style sound effects built with the Web Audio API (square/triangle waves).
let ctx: AudioContext | null = null
let muted = false

export const setMuted = (m: boolean) => {
  muted = m
}

function audio() {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new Ctor()
  }
  if (ctx.state !== "running") void ctx.resume()
  return ctx
}

// Browsers only allow audio after a user gesture: unlock on the first click/key press.
if (typeof window !== "undefined") {
  const unlock = () => {
    const a = audio()
    // A silent blip fully wakes up the context on iOS/Safari.
    const buf = a.createBuffer(1, 1, 22050)
    const src = a.createBufferSource()
    src.buffer = buf
    src.connect(a.destination)
    src.start(0)
  }
  window.addEventListener("pointerdown", unlock, { capture: true })
  window.addEventListener("keydown", unlock, { capture: true })
}

type Note = [freq: number, dur: number, type?: OscillatorType]

function seq(notes: Note[], volume = 0.08) {
  if (muted) return
  try {
    const a = audio()
    let t = a.currentTime + 0.01
    for (const [freq, dur, type = "square"] of notes) {
      const osc = a.createOscillator()
      const gain = a.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(Math.max(freq, 20), t)
      if (freq < 20) gain.gain.value = 0
      gain.gain.setValueAtTime(volume, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      osc.connect(gain).connect(a.destination)
      osc.start(t)
      osc.stop(t + dur)
      t += dur * 0.9
    }
  } catch {
    // Audio unavailable; ignore.
  }
}

export const sfx = {
  select: () => seq([[660, 0.06], [990, 0.06]]),
  cancel: () => seq([[440, 0.06], [300, 0.08]]),
  preview: () => seq([[880, 0.05], [1175, 0.07]]),
  move: () => seq([[520, 0.05, "triangle"], [260, 0.08, "triangle"]], 0.14),
  capture: () => seq([[200, 0.05], [140, 0.06], [90, 0.12]], 0.1),
  check: () => seq([[1320, 0.08], [0.01, 0.04], [1320, 0.08]]),
  aiThink: () => seq([[330, 0.04], [392, 0.04]], 0.05),
  aiPick: () => seq([[392, 0.06], [523, 0.06]]),
  cursor: () => seq([[1500, 0.02]], 0.03),
  denied: () => seq([[110, 0.1]], 0.08),
  toggle: () => seq([[784, 0.05], [1046, 0.05]]),
  win: () => seq([[523, 0.1], [659, 0.1], [784, 0.1], [1046, 0.25]]),
  lose: () => seq([[392, 0.15], [330, 0.15], [262, 0.15], [196, 0.35]]),
  start: () => seq([[262, 0.07], [330, 0.07], [392, 0.07], [523, 0.12]]),
}
