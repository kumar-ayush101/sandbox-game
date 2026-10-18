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
    for (let i = 0; i < cells.length; i++) {
      const mat = cells[i];
      const base = COLORS[mat];
      // apply a small per-cell tint for texture
      const t = world.tint[i] - 16;
      const p = i * 4;
      data[p] = clamp(base[0] + t);
      data[p + 1] = clamp(base[1] + t);
      data[p + 2] = clamp(base[2] + t);
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
      // more materials added in later steps
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

function loop() {
  sim.step();
  renderer.draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
