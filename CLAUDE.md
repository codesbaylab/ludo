# ludoPWA

A Ludo (board game) PWA. Currently in the **design/mockup stage** — no build tooling,
no backend, no game engine yet. Everything lives in `design/` as plain static HTML/CSS/JS
pages, meant to be opened directly or served as static files.

## Structure

- `design/styles.css` — shared stylesheet for every page.
- `design/index.html`, `login.html`, `lobby.html`, `waiting-room.html`, `board.html`,
  `stake-confirm.html`, `wallet.html`, `history.html`, `profile.html` — one static page each.
- `design/board.html` — the in-game board screen. Has real interactive JS (see below);
  every other page is static markup only.

## Current state

- The 15x15 Ludo board grid, yards, tokens, players panel, and log panel in `board.html`
  are rendered from hardcoded sample data (`playersData`, `sampleTokens` — currently empty,
  so all tokens sit in their yards). There is **no game engine**: no turn enforcement, no
  token movement, no captures, no win logic.
- The dice in `board.html` is the one piece of real functionality: a genuine CSS 3D cube
  (`#dice-cube`, six `.dice-face-3d` faces built with `transform-style: preserve-3d`,
  opposite faces sum to 7). Clicking it (`#dice-face`) rolls a random 1-6, spins the cube
  through several full rotations over ~1.5s with an easing curve, and updates
  `#dice-status` / `#dice-badge`. It's visual-only — rolling doesn't drive any token
  movement or turn logic yet.
- Known gotcha: don't put `filter: drop-shadow(...)` on `.dice-cube` itself — it has
  `transform-style: preserve-3d` and combining the two flattens/hides the cube in
  Chromium. The drop-shadow lives on the outer `.dice-face` button instead.

## Running it

No dev server config exists. To preview a page, serve `design/` statically, e.g.
`python -m http.server` from `design/`, then open the page in a browser.

## Next steps (not yet started)

Turning this into an actual playable game needs: real game state (whose turn, token
positions per player), click-to-select-token-then-move flow after a roll, capture/safe-square/
home-entry rules, and turn passing — likely as a separate JS module rather than inline
script once it grows past `board.html`'s current inline `<script>`.
