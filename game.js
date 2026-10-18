"use strict";

/*
 * Sandbox — a falling-sand physics playground.
 *
 * The world is a grid of cells. Each cell holds a material id. Every frame the
 * simulation scans the grid bottom-to-top and applies simple local rules per
 * material (sand falls, water spreads, fire rises, ...). Complex behaviour
 * emerges from these tiny rules — this is a cellular automaton.
 *
 * Rendering: we write cell colours into an ImageData buffer and blit it to the
 * canvas once per frame, which is far faster than drawing thousands of rects.
 */

// ---- Materials -------------------------------------------------------------

const MAT = {
  EMPTY: 0,
  WALL: 1,
  SAND: 2,
  WATER: 3,
  FIRE: 4,
  SMOKE: 5,
  OIL: 6,
  ACID: 7,
  PLANT: 8,
  STONE: 9,
};

// Base colours (RGB). Some materials add per-cell variation at paint time so
// large areas don't look flat.
const COLORS = {
  [MAT.EMPTY]: [16, 18, 24],
  [MAT.WALL]: [90, 95, 110],
  [MAT.SAND]: [194, 168, 98],
  [MAT.WATER]: [54, 108, 214],
  [MAT.FIRE]: [230, 110, 30],
  [MAT.SMOKE]: [60, 60, 68],
  [MAT.OIL]: [70, 54, 40],
  [MAT.ACID]: [120, 220, 60],
  [MAT.PLANT]: [50, 160, 70],
  [MAT.STONE]: [120, 120, 128],
};

// 4-directional neighbour offsets (up, down, left, right).
const NEIGHBORS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

// ---- World -----------------------------------------------------------------

class World {
  constructor(width, height) {
    this.w = width;
    this.h = height;
    this.cells = new Uint8Array(width * height);
    // Per-cell random tint (0..31) baked at paint time for texture, and a
    // generic "life/age" byte reused by fire, smoke and plant growth.
    this.tint = new Uint8Array(width * height);
    this.life = new Uint8Array(width * height);
  }

  idx(x, y) {
    return y * this.w + x;
  }

  inBounds(x, y) {
    return x >= 0 && x < this.w && y >= 0 && y < this.h;
  }

  get(x, y) {
    return this.cells[y * this.w + x];
  }

  set(x, y, mat) {
    const i = y * this.w + x;
    this.cells[i] = mat;
    this.tint[i] = (Math.random() * 32) | 0;
    this.life[i] = 0;
  }

  clear() {
    this.cells.fill(MAT.EMPTY);
    this.life.fill(0);
  }

  // Swap two cells (used to move particles).
  swap(x1, y1, x2, y2) {
    const i = y1 * this.w + x1;
    const j = y2 * this.w + x2;
    const c = this.cells[i];
    this.cells[i] = this.cells[j];
    this.cells[j] = c;
    const t = this.tint[i];
    this.tint[i] = this.tint[j];
    this.tint[j] = t;
    const l = this.life[i];
    this.life[i] = this.life[j];
    this.life[j] = l;
  }
}

// ---- Renderer --------------------------------------------------------------

class Renderer {
  constructor(canvas, world, scale) {
    this.canvas = canvas;
    this.world = world;
    this.scale = scale; // pixels per cell
    this.ctx = canvas.getContext("2d", { alpha: false });
    canvas.width = world.w;
    canvas.height = world.h;
    this.image = this.ctx.createImageData(world.w, world.h);
    // CSS scales the small canvas up to a crisp pixel look.
    canvas.style.width = world.w * scale + "px";
    canvas.style.height = world.h * scale + "px";
    canvas.style.imageRendering = "pixelated";
  }

  draw() {
    const { world, image } = this;
    const data = image.data;
    const cells = world.cells;
    const life = world.life;
    const flick = (this.frameCount = (this.frameCount || 0) + 1);
    for (let i = 0; i < cells.length; i++) {
      const mat = cells[i];
      const p = i * 4;
      let r, g, b;

      if (mat === MAT.FIRE) {
        // Fire glows hotter (whiter/yellower) when young, dims to red as it
        // ages, with a per-cell flicker.
        const age = life[i];
        const heat = Math.max(0, 1 - age / 50);
        const f = ((world.tint[i] + flick) % 16) - 8;
        r = clamp(235 + f);
        g = clamp(90 + heat * 110 + f);
        b = clamp(20 + heat * 40);
      } else if (mat === MAT.SMOKE) {
        // Smoke fades (gets darker/translucent-looking) as it ages.
        const age = life[i];
        const fade = Math.max(0, 1 - age / 160);
        const v = 40 + fade * 40;
        r = v;
        g = v;
        b = clamp(v + 6);
      } else {
        const base = COLORS[mat];
        const t = world.tint[i] - 16;
        r = clamp(base[0] + t);
        g = clamp(base[1] + t);
        b = clamp(base[2] + t);
      }

      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }
    this.ctx.putImageData(image, 0, 0);
  }
}

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// ---- Simulation ------------------------------------------------------------

class Simulation {
  constructor(world) {
    this.world = world;
    this.frame = 0;
  }

  step() {
    const w = this.world;
    this.frame++;
    // Scan bottom-to-top so falling particles don't move twice per frame.
    // Alternate horizontal scan direction each frame to avoid a left bias.
    const leftToRight = (this.frame & 1) === 0;
    for (let y = w.h - 1; y >= 0; y--) {
      if (leftToRight) {
        for (let x = 0; x < w.w; x++) this.updateCell(x, y);
      } else {
        for (let x = w.w - 1; x >= 0; x--) this.updateCell(x, y);
      }
    }
  }

  updateCell(x, y) {
    const mat = this.world.get(x, y);
    switch (mat) {
      case MAT.SAND:
        this.updateSand(x, y);
        break;
      case MAT.WATER:
        this.updateWater(x, y);
        break;
      case MAT.FIRE:
        this.updateFire(x, y);
        break;
      case MAT.SMOKE:
        this.updateSmoke(x, y);
        break;
      case MAT.OIL:
        this.updateOil(x, y);
        break;
      case MAT.ACID:
        this.updateAcid(x, y);
        break;
      case MAT.PLANT:
        this.updatePlant(x, y);
        break;
      // STONE and WALL are static — no update.
    }
  }

  // Sand: fall straight down (through water/empty), else slide diagonally.
  updateSand(x, y) {
    const w = this.world;
    if (y + 1 >= w.h) return;
    const below = w.get(x, y + 1);
    if (below === MAT.EMPTY || below === MAT.WATER || below === MAT.OIL) {
      w.swap(x, y, x, y + 1); // sand is denser, sinks through liquids
      return;
    }
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (const dx of [dir, -dir]) {
      const nx = x + dx;
      if (!w.inBounds(nx, y + 1)) continue;
      const diag = w.get(nx, y + 1);
      if ((diag === MAT.EMPTY || diag === MAT.WATER || diag === MAT.OIL) && w.get(nx, y) !== MAT.WALL) {
        w.swap(x, y, nx, y + 1);
        return;
      }
    }
  }

  // Water: fall, else flow diagonally down, else spread sideways to level out.
  updateWater(x, y) {
    const w = this.world;
    if (y + 1 < w.h && w.get(x, y + 1) === MAT.EMPTY) {
      w.swap(x, y, x, y + 1);
      return;
    }
    const dir = Math.random() < 0.5 ? -1 : 1;
    // diagonal down
    for (const dx of [dir, -dir]) {
      const nx = x + dx;
      if (w.inBounds(nx, y + 1) && w.get(nx, y + 1) === MAT.EMPTY && w.get(nx, y) !== MAT.WALL) {
        w.swap(x, y, nx, y + 1);
        return;
      }
    }
    // sideways spread (travel a few cells so water levels out quickly)
    for (const dx of [dir, -dir]) {
      for (let step = 1; step <= 4; step++) {
        const nx = x + dx * step;
        if (!w.inBounds(nx, y) || w.get(nx, y) !== MAT.EMPTY) break;
        // only move into the farthest reachable empty cell
        if (!w.inBounds(nx + dx, y) || w.get(nx + dx, y) !== MAT.EMPTY) {
          w.swap(x, y, nx, y);
          return;
        }
      }
    }
  }

  // Fire: short-lived. It ignites flammable neighbours, is doused by water,
  // rises/flickers, and decays into smoke (or nothing) when its life runs out.
  updateFire(x, y) {
    const w = this.world;
    const i = w.idx(x, y);

    // age the flame
    w.life[i]++;
    const maxLife = 40 + (w.tint[i] % 20);

    // doused by adjacent water?
    if (this.hasNeighbor(x, y, MAT.WATER)) {
      w.set(x, y, MAT.SMOKE);
      return;
    }

    // ignite flammable neighbours
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!w.inBounds(nx, ny)) continue;
      const m = w.get(nx, ny);
      if ((m === MAT.OIL || m === MAT.PLANT) && Math.random() < 0.35) {
        w.set(nx, ny, MAT.FIRE);
      }
    }

    // burn out
    if (w.life[i] > maxLife) {
      // leave smoke most of the time, else clear
      w.set(x, y, Math.random() < 0.7 ? MAT.SMOKE : MAT.EMPTY);
      return;
    }

    // flicker upward: try to rise into empty/smoke above
    if (y - 1 >= 0) {
      const up = w.get(x, y - 1);
      if (up === MAT.EMPTY && Math.random() < 0.4) {
        w.swap(x, y, x, y - 1);
        return;
      }
    }
  }

  // Smoke: rises, drifts sideways, and fades out over time.
  updateSmoke(x, y) {
    const w = this.world;
    const i = w.idx(x, y);
    w.life[i]++;
    if (w.life[i] > 120 + (w.tint[i] % 40)) {
      w.set(x, y, MAT.EMPTY);
      return;
    }
    if (y - 1 >= 0) {
      const up = w.get(x, y - 1);
      if (up === MAT.EMPTY) {
        w.swap(x, y, x, y - 1);
        return;
      }
      // drift diagonally up
      const dir = Math.random() < 0.5 ? -1 : 1;
      for (const dx of [dir, -dir]) {
        const nx = x + dx;
        if (w.inBounds(nx, y - 1) && w.get(nx, y - 1) === MAT.EMPTY) {
          w.swap(x, y, nx, y - 1);
          return;
        }
      }
    }
  }

  hasNeighbor(x, y, mat) {
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.world.inBounds(nx, ny) && this.world.get(nx, ny) === mat) return true;
    }
    return false;
  }

  // Oil: a liquid like water but lighter — it floats on water (so if water is
  // below, oil rises above it). It is flammable (handled by fire's ignition).
  updateOil(x, y) {
    const w = this.world;
    // float above water: if water is directly below, swap up
    if (y + 1 < w.h && w.get(x, y + 1) === MAT.WATER && Math.random() < 0.3) {
      w.swap(x, y, x, y + 1);
      return;
    }
    if (y + 1 < w.h && w.get(x, y + 1) === MAT.EMPTY) {
      w.swap(x, y, x, y + 1);
      return;
    }
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (const dx of [dir, -dir]) {
      const nx = x + dx;
      if (w.inBounds(nx, y + 1) && w.get(nx, y + 1) === MAT.EMPTY && w.get(nx, y) !== MAT.WALL) {
        w.swap(x, y, nx, y + 1);
        return;
      }
    }
    for (const dx of [dir, -dir]) {
      const nx = x + dx;
      if (w.inBounds(nx, y) && w.get(nx, y) === MAT.EMPTY) {
        w.swap(x, y, nx, y);
        return;
      }
    }
  }

  // Acid: a corrosive liquid. It falls like water, and with some probability
  // dissolves a solid it touches (sand, stone, plant, wall), consuming itself.
  updateAcid(x, y) {
    const w = this.world;
    // try to corrode a neighbour
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!w.inBounds(nx, ny)) continue;
      const m = w.get(nx, ny);
      if (m === MAT.SAND || m === MAT.STONE || m === MAT.PLANT || m === MAT.WALL) {
        if (Math.random() < 0.08) {
          w.set(nx, ny, MAT.EMPTY); // dissolved
          if (Math.random() < 0.5) {
            w.set(x, y, MAT.EMPTY); // acid used up
            return;
          }
        }
      }
    }
    // fall / spread like a liquid
    if (y + 1 < w.h && w.get(x, y + 1) === MAT.EMPTY) {
      w.swap(x, y, x, y + 1);
      return;
    }
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (const dx of [dir, -dir]) {
      const nx = x + dx;
      if (w.inBounds(nx, y + 1) && w.get(nx, y + 1) === MAT.EMPTY) {
        w.swap(x, y, nx, y + 1);
        return;
      }
    }
    for (const dx of [dir, -dir]) {
      const nx = x + dx;
      if (w.inBounds(nx, y) && w.get(nx, y) === MAT.EMPTY) {
        w.swap(x, y, nx, y);
        return;
      }
    }
  }

  // Plant: static, but grows into adjacent water (slowly turning water to
  // plant). Flammable — fire spreads through it. This creates vines that
  // creep across water surfaces.
  updatePlant(x, y) {
    const w = this.world;
    if (Math.random() < 0.04) {
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (w.inBounds(nx, ny) && w.get(nx, ny) === MAT.WATER) {
          w.set(nx, ny, MAT.PLANT);
          return;
        }
      }
    }
  }
}

// ---- Input / painting ------------------------------------------------------

class Painter {
  constructor(canvas, world, scale) {
    this.canvas = canvas;
    this.world = world;
    this.scale = scale;
    this.material = MAT.SAND;
    this.brush = 3; // radius in cells
    this.drawing = false;
    this.last = null;

    const pos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX ?? (e.touches && e.touches[0].clientX);
      const cy = e.clientY ?? (e.touches && e.touches[0].clientY);
      const x = Math.floor(((cx - rect.left) / rect.width) * world.w);
      const y = Math.floor(((cy - rect.top) / rect.height) * world.h);
      return { x, y };
    };

    const start = (e) => {
      this.drawing = true;
      const p = pos(e);
      this.paint(p.x, p.y);
      this.last = p;
      e.preventDefault();
    };
    const move = (e) => {
      if (!this.drawing) return;
      const p = pos(e);
      // interpolate between last and current so fast drags leave no gaps
      if (this.last) this.line(this.last.x, this.last.y, p.x, p.y);
      else this.paint(p.x, p.y);
      this.last = p;
      e.preventDefault();
    };
    const end = () => {
      this.drawing = false;
      this.last = null;
    };

    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
  }

  // Stamp a filled circle of the current material around (cx, cy).
  paint(cx, cy) {
    const w = this.world;
    const r = this.brush;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!w.inBounds(x, y)) continue;
        // Only draw over empty cells unless placing a solid, so you can layer.
        const target = w.get(x, y);
        if (this.material === MAT.EMPTY || target === MAT.EMPTY || this.material === MAT.WALL) {
          w.set(x, y, this.material);
        } else if (target !== MAT.WALL) {
          w.set(x, y, this.material);
        }
      }
    }
  }

  // Paint along a line (Bresenham) for smooth dragging.
  line(x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.paint(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
}

// ---- Bootstrap -------------------------------------------------------------

const CELL_SCALE = 4;
const canvas = document.getElementById("world");
const world = new World(200, 150);
const renderer = new Renderer(canvas, world, CELL_SCALE);
const sim = new Simulation(world);
const painter = new Painter(canvas, world, CELL_SCALE);

// Floor so sand has something to pile on.
for (let x = 0; x < world.w; x++) world.set(x, world.h - 1, MAT.WALL);

// ---- UI wiring -------------------------------------------------------------

// Palette definition: id, label, swatch colour.
const PALETTE = [
  { mat: MAT.SAND, name: "Sand" },
  { mat: MAT.WATER, name: "Water" },
  { mat: MAT.OIL, name: "Oil" },
  { mat: MAT.FIRE, name: "Fire" },
  { mat: MAT.ACID, name: "Acid" },
  { mat: MAT.PLANT, name: "Plant" },
  { mat: MAT.STONE, name: "Stone" },
  { mat: MAT.WALL, name: "Wall" },
  { mat: MAT.EMPTY, name: "Eraser" },
];

const paletteEl = document.getElementById("palette");
const matButtons = [];
for (const item of PALETTE) {
  const btn = document.createElement("button");
  btn.className = "mat" + (item.mat === painter.material ? " active" : "");
  const [r, g, b] = COLORS[item.mat];
  btn.innerHTML =
    `<span class="swatch" style="background:rgb(${r},${g},${b})"></span>` + item.name;
  btn.addEventListener("click", () => {
    painter.material = item.mat;
    for (const b2 of matButtons) b2.classList.remove("active");
    btn.classList.add("active");
  });
  paletteEl.appendChild(btn);
  matButtons.push(btn);
}

const brush = document.getElementById("brush");
const brushVal = document.getElementById("brushVal");
brush.addEventListener("input", () => {
  painter.brush = Number(brush.value);
  brushVal.textContent = brush.value;
});

let paused = false;
const pauseBtn = document.getElementById("pause");
pauseBtn.addEventListener("click", () => {
  paused = !paused;
  pauseBtn.textContent = paused ? "▶ Play" : "⏸ Pause";
});

document.getElementById("clear").addEventListener("click", () => {
  world.clear();
  for (let x = 0; x < world.w; x++) world.set(x, world.h - 1, MAT.WALL);
});

// Keyboard: space toggles pause, number keys pick materials.
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    pauseBtn.click();
  } else if (e.key >= "1" && e.key <= "9") {
    const idx = Number(e.key) - 1;
    if (matButtons[idx]) matButtons[idx].click();
  }
});

// ---- HUD + main loop -------------------------------------------------------

const fpsEl = document.getElementById("fps");
const countEl = document.getElementById("count");
let lastTime = performance.now();
let fpsSmoothed = 60;
let hudTimer = 0;

function countParticles() {
  let n = 0;
  const cells = world.cells;
  for (let i = 0; i < cells.length; i++) {
    const m = cells[i];
    if (m !== MAT.EMPTY && m !== MAT.WALL) n++;
  }
  return n;
}

function loop(now) {
  const dt = now - lastTime;
  lastTime = now;
  fpsSmoothed = fpsSmoothed * 0.9 + (1000 / Math.max(dt, 1)) * 0.1;

  if (!paused) sim.step();
  renderer.draw();

  hudTimer += dt;
  if (hudTimer > 250) {
    hudTimer = 0;
    fpsEl.textContent = Math.round(fpsSmoothed) + " fps";
    countEl.textContent = countParticles().toLocaleString() + " particles";
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
