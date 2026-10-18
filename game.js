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
      // more materials added in later steps
    }
  }

  // Sand: fall straight down, else slide diagonally into an empty cell.
  updateSand(x, y) {
    const w = this.world;
    if (y + 1 >= w.h) return;
    if (w.get(x, y + 1) === MAT.EMPTY) {
      w.swap(x, y, x, y + 1);
      return;
    }
    // try diagonals (randomize order to avoid directional bias)
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (const dx of [dir, -dir]) {
      const nx = x + dx;
      if (w.inBounds(nx, y + 1) && w.get(nx, y + 1) === MAT.EMPTY && w.get(nx, y) === MAT.EMPTY) {
        w.swap(x, y, nx, y + 1);
        return;
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

// A little demo content so the first load isn't blank: a wall floor and some
// sand falling onto it.
for (let x = 0; x < world.w; x++) world.set(x, world.h - 1, MAT.WALL);
for (let i = 0; i < 1200; i++) {
  const x = (Math.random() * world.w) | 0;
  const y = (Math.random() * (world.h / 3)) | 0;
  world.set(x, y, MAT.SAND);
}

function loop() {
  sim.step();
  renderer.draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
