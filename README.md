# ASCII Chess

**Chess drawn in ASCII art, playable in the browser.** Play against a Stockfish-powered robot, challenge a friend with a link, or get matched with a random opponent online. Real-time multiplayer runs on Cloudflare Workers + Durable Objects, no server to maintain.

**Play: https://germanbragin.com/ascii-chess/**

## Features

- **Online multiplayer**: private room by link or 5-letter code, or **random opponent** matchmaking (paired by the same clock / fog settings).
- **Robot opponent**: Stockfish (WebAssembly, runs in your browser) with **Easy / Medium / Hard** levels.
- **War fog** mode: you only see the squares near your own pieces.
- **Chess clocks** (3 / 5 / 10 min), draw offers, resign, rematch with colour swap.
- **Reconnect** to a game after closing the tab or losing the connection.
- **Mobile friendly**, keyboard controls (arrows + Enter), sound effects, capture animations.
- The server is authoritative: it validates every move, runs the clocks and, under war fog, never sends you the pieces you can't see.

Rules are classic chess without castling, en passant, under-promotion or draw by repetition (pawns always promote to a queen).

## Tech stack

React 19, TypeScript, Vite, Tailwind CSS v4, Cloudflare Workers (static assets + WebSockets), Durable Objects (game rooms and the matchmaking lobby), Stockfish 19 lite (WASM) in a Web Worker.

```
src/rules.ts      chess rules shared by the browser and the Worker
src/engine.ts     Stockfish wrapper (Web Worker, UCI, difficulty levels)
src/useRoom.ts    WebSocket client for rooms and matchmaking
worker/index.ts   Worker + Room and Lobby Durable Objects
```

## Run it

Requires Node 22 and pnpm.

```bash
pnpm install
pnpm dev          # UI only (play against the robot)
pnpm online       # build + run the Worker locally with online rooms: http://localhost:8787/ascii-chess/
pnpm typecheck
```

## Deploy to Cloudflare

```bash
pnpm exec wrangler login
pnpm deploy
```

The app is served under the base path `/ascii-chess/` (`vite.config.ts`, `PREFIX` in `worker/index.ts`). `wrangler.jsonc` contains the author's route for it (`germanbragin.com/ascii-chess*`); replace it with your own zone/route, or remove `routes` to use the `workers.dev` address (open `/ascii-chess/` on it). The Worker passes any other path on a zone route through to the existing site untouched.

The GitHub Action in `.github/workflows/deploy.yml` deploys on every push to `main` when the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set.

## Credits

- Original concept and design: [azykowww.com](https://azykowww.com)
- Online version, bot engine, improvements: [germanbragin.com](https://germanbragin.com)
- Chess engine: [Stockfish](https://stockfishchess.org/) via [stockfish.js](https://github.com/nmrugg/stockfish.js) (GPL-3.0)

## License

GPL-3.0, see [LICENSE](LICENSE). The game bundles Stockfish, which is GPL-3.0 licensed.
