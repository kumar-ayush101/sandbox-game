# Sandbox — a falling-sand physics playground

![type](https://img.shields.io/badge/pure-HTML%2FCSS%2FJS-f7df1e)
![canvas](https://img.shields.io/badge/render-Canvas%20ImageData-6ea8fe)
![deps](https://img.shields.io/badge/dependencies-none-success)
![License](https://img.shields.io/badge/License-MIT-green)

A falling-sand physics sandbox that runs entirely in the browser. Every pixel
is a simulated particle governed by simple **cellular-automata** rules — draw
sand, water, fire, oil, acid, plants, stone and walls, and watch them interact.

**Pure HTML + CSS + JavaScript + Canvas. No game engine, no libraries, no build
step, no accounts.** Open `index.html` and play.

![materials](https://img.shields.io/badge/materials-9-6ea8fe)

## Run it

Open `index.html` in any modern browser. That's it — no install, no server.

> Tip: to run from a local server instead (identical behaviour), use any static
> server, e.g. `python -m http.server` and open the printed URL.

## Controls

- **Click and drag** on the canvas to draw with the selected material.
- **Material palette** — pick sand, water, oil, fire, acid, plant, stone, wall,
  or the eraser.
- **Brush** slider — change the drawing radius.
- **Pause / Play** — freeze or resume the simulation (also <kbd>Space</kbd>).
- **Clear** — wipe the world (keeps the floor).
- **Number keys 1–9** — quick-select materials.

## Materials and how they behave

| Material | Behaviour |
| -------- | --------- |
| **Sand** | A powder: falls and piles into slopes; sinks through liquids. |
| **Water** | A liquid: falls, flows diagonally, and spreads sideways to find its level. |
| **Oil** | A lighter liquid: flows like water but **floats on top of water**. Flammable. |
| **Fire** | Short-lived: ignites oil and plants, is **doused by water**, rises and flickers, then decays into smoke. |
| **Smoke** | Rises, drifts, and fades away over time. |
| **Acid** | A corrosive liquid: flows, and **dissolves** sand, stone, plant and wall, consuming itself. |
| **Plant** | Grows into adjacent **water** (vines creep across the surface). Flammable. |
| **Stone / Wall** | Static solids. Walls border the floor; stone can be dissolved by acid. |

Try these: drop **fire** onto a pool of **oil**; pour **water** over a fire;
grow a **plant** across **water** then set it alight; eat through **stone** with
**acid**.

## How it works

The world is a grid of cells; each cell stores a material id. Every frame the
simulation scans the grid **bottom-to-top** (so a falling particle doesn't move
twice in one frame) and alternates horizontal scan direction each frame to avoid
a directional bias. Each material applies a few simple local rules:

- **Powders** (sand) try to move down, then diagonally down.
- **Liquids** (water, oil, acid) move down, then diagonally down, then spread
  sideways. Density differences make sand sink and oil float.
- **Gases** (fire, smoke) rise and drift upward.
- **Reactions** happen between neighbours: fire ignites flammable cells and is
  doused by water; acid dissolves solids; plants consume water.

Complex, lifelike behaviour emerges from these tiny rules — that is the essence
of a cellular automaton.

Rendering is fast because the whole grid is written into a single `ImageData`
buffer and blitted once per frame (rather than drawing thousands of rectangles).
Fire and smoke get animated colours — fire glows hotter when young and flickers;
smoke fades as it ages.

## Project structure

```text
.
├── index.html   # markup: canvas, palette, controls, HUD
├── style.css    # dark, responsive UI
├── game.js      # the whole engine: World, Renderer, Simulation, Painter, UI
└── README.md
```

`game.js` is organised top-to-bottom as: materials → world grid → renderer →
simulation (per-material rules) → input/painting → UI wiring → main loop.

## Verification

The simulation logic was exercised headlessly (Node) to confirm the physics
behave: water poured into a container spreads along the floor; fire dropped on
oil spreads through it and burns the oil away into smoke; a dropped grain of
sand settles to the bottom. The full `game.js` also loads and runs its first
frames under a stubbed DOM without errors.

## License

MIT — see [LICENSE](./LICENSE).
