/*
 * Monster Energy Supercross 5 UI — sprite generator.
 *
 * Builds the mod's whole TGA chrome set from the MESX5 palette instead of
 * shipping opaque photographs of a Photoshop session: every rectangle,
 * border, gloss, chevron and icon is drawn here, deterministically.
 *
 *   node tools/mesx5-art.js
 *
 * Writes into "mesx5 ui/". The photographic wallpapers (main menu background
 * and splash) are the Dark UI images re-graded to MESX5's dark navy look, so
 * this needs "true dark mode/" present.
 *
 * Style notes
 *   - panels:      deep navy, 1 px lapis border, faint top gloss
 *   - selection:   electric blue fill + neon green 2 px frame and left bar
 *   - confirm:     neon green pill
 *   - exit:        magenta chip (MESX5's red/pink B button colourway)
 *   - text is not baked into chrome: the .mnu files draw every label
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Tga = require('../assets/tga.js');

const OLD_DIR = path.join(__dirname, '..', 'true dark mode');
const OUT_DIR = path.join(__dirname, '..', 'mesx5 ui');

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */

const C = {
  ink900: [5, 8, 24],
  ink850: [7, 11, 30],
  ink800: [10, 16, 42],
  ink750: [13, 22, 56],
  ink700: [16, 30, 74],
  ink600: [22, 38, 92],
  ink500: [30, 50, 116],
  line: [62, 91, 191],
  lineBright: [96, 132, 236],
  ice: [232, 238, 255],
  ice2: [195, 206, 239],
  ice3: [151, 165, 210],
  blue: [44, 107, 255],
  blueDeep: [12, 63, 201],
  blueSoft: [90, 160, 255],
  green: [99, 245, 138],
  greenDeep: [18, 166, 60],
  greenSoft: [185, 255, 203],
  pink: [255, 46, 126],
  pinkDeep: [200, 18, 92],
  pinkSoft: [255, 150, 190],
  orange: [255, 106, 0]
};

function rgba(c, a) {
  return [c[0], c[1], c[2], a === undefined ? 255 : a];
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/* ------------------------------------------------------------------ *
 * Canvas
 * ------------------------------------------------------------------ */

function canvas(w, h) {
  return { w: Math.round(w), h: Math.round(h), data: new Uint8ClampedArray(w * h * 4) };
}

// Canvases hold premultiplied RGBA, which makes over-compositing exact;
// writeTga() un-premultiplies on the way out.
function blend(c, x, y, color, alpha) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const a = clamp(alpha === undefined ? 1 : alpha, 0, 1) * (color[3] === undefined ? 1 : color[3] / 255);
  if (a <= 0) return;
  const i = (y * c.w + x) * 4;
  const d = c.data;
  d[i] = color[0] * a + d[i] * (1 - a);
  d[i + 1] = color[1] * a + d[i + 1] * (1 - a);
  d[i + 2] = color[2] * a + d[i + 2] * (1 - a);
  d[i + 3] = 255 * a + d[i + 3] * (1 - a);
}

function clear(c) {
  c.data.fill(0);
}

// Signed distance to a rounded rectangle, negative inside.
function sdfBox(x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const halfW = w / 2 - radius;
  const halfH = h / 2 - radius;
  return function (px, py) {
    const dx = Math.abs(px - cx) - halfW;
    const dy = Math.abs(py - cy) - halfH;
    const ax = Math.max(dx, 0);
    const ay = Math.max(dy, 0);
    return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(dx, dy), 0) - radius;
  };
}

// Paint a region from an SDF. colorAt(px, py) returns a colour, coverage scales it.
function paintSdf(c, sdf, bounds, colorAt, coverage) {
  const [x0, y0, x1, y1] = bounds;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(c.h, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(c.w, Math.ceil(x1)); x++) {
      const d = sdf(x + 0.5, y + 0.5);
      const cov = coverage(d);
      if (cov <= 0) continue;
      blend(c, x, y, colorAt(x + 0.5, y + 0.5), cov);
    }
  }
}

function fillBox(c, x, y, w, h, r) {
  const sdf = sdfBox(x, y, w, h, r);
  const color = [0, 0, 0, 255];
  paintSdf(c, sdf, [x - 1, y - 1, x + w + 1, y + h + 1], () => color, (d) => clamp(0.5 - d, 0, 1));
}

// Rounded rect painted with a function of the local position + distance.
function roundRect(c, x, y, w, h, r, paint) {
  const sdf = sdfBox(x, y, w, h, r);
  const color = typeof paint.color === 'function' ? paint.color : () => paint.color;
  paintSdf(
    c,
    sdf,
    [x - 1, y - 1, x + w + 1, y + h + 1],
    (px, py) => color(px - x, py - y, w, h, sdf(px, py)),
    (d) => clamp(0.5 - d, 0, 1) * (paint.alpha === undefined ? 1 : paint.alpha)
  );
}

function ring(c, x, y, w, h, r, width, paint) {
  const sdf = sdfBox(x, y, w, h, r);
  paintSdf(
    c,
    sdf,
    [x - 2, y - 2, x + w + 2, y + h + 2],
    (px, py) => (typeof paint === 'function' ? paint(px - x, py - y, w, h) : paint),
    (d) => clamp(width / 2 - Math.abs(d) + 0.5, 0, 1)
  );
}

// Crisp border that lives entirely inside the shape (a centred ring gets
// clipped by the sprite edge and reads as 1 px).
function innerBorder(c, x, y, w, h, r, width, color) {
  const outer = sdfBox(x - 0.5, y - 0.5, w + 1, h + 1, r);
  const inner = sdfBox(x - 0.5 + width, y - 0.5 + width, w + 1 - width * 2, h + 1 - width * 2, Math.max(0, r - width));
  for (let py = Math.floor(y - 1); py < Math.ceil(y + h + 1); py++) {
    for (let px = Math.floor(x - 1); px < Math.ceil(x + w + 1); px++) {
      const cov = clamp(0.5 - outer(px + 0.5, py + 0.5), 0, 1) *
        clamp(0.5 + inner(px + 0.5, py + 0.5), 0, 1);
      if (cov > 0) blend(c, px, py, color, cov);
    }
  }
}

function vGradient(top, bottom, alphaTop, alphaBottom) {
  return (lx, ly, w, h) => {
    const t = h <= 1 ? 0 : clamp(ly / h, 0, 1);
    const color = mix(top, bottom, t);
    return rgba(color, Math.round((alphaTop === undefined ? 255 : alphaTop) +
      ((alphaBottom === undefined ? 255 : alphaBottom) - (alphaTop === undefined ? 255 : alphaTop)) * t));
  };
}

function diagGradient(from, to, angle) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  return (lx, ly, w, h) => {
    const t = clamp(((lx - w / 2) * dx + (ly - h / 2) * dy) / (Math.abs(dx * w) + Math.abs(dy * h)) + 0.5, 0, 1);
    return rgba(mix(from, to, t), 255);
  };
}

function lerpColorAt(stops) {
  return (t) => {
    const clamped = clamp(t, 0, 1);
    for (let i = 1; i < stops.length; i++) {
      if (clamped <= stops[i][0]) {
        const span = stops[i][0] - stops[i - 1][0] || 1;
        return mix(stops[i - 1][1], stops[i][1], (clamped - stops[i - 1][0]) / span);
      }
    }
    return stops[stops.length - 1][1];
  };
}

/* ------------------------------------------------------------------ *
 * Shape helpers
 * ------------------------------------------------------------------ */

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = clamp(t, 0, 1);
  const cx = x1 + dx * t;
  const cy = y1 + dy * t;
  return Math.hypot(px - cx, py - cy);
}

// Polyline stroke with round caps, coordinates normalised to the box.
function stroke(c, box, points, width, color, closed) {
  const { x, y, w, h } = box;
  const px = points.map((p) => [x + p[0] * w, y + p[1] * h]);
  const half = width / 2;
  for (let y2 = Math.max(0, Math.floor(y - width)); y2 < Math.min(c.h, Math.ceil(y + h + width)); y2++) {
    for (let x2 = Math.max(0, Math.floor(x - width)); x2 < Math.min(c.w, Math.ceil(x + w + width)); x2++) {
      let best = Infinity;
      for (let i = 1; i < px.length; i++) {
        best = Math.min(best, distanceToSegment(x2 + 0.5, y2 + 0.5, px[i - 1][0], px[i - 1][1], px[i][0], px[i][1]));
      }
      if (closed && px.length > 2) {
        best = Math.min(best, distanceToSegment(x2 + 0.5, y2 + 0.5, px[px.length - 1][0], px[px.length - 1][1], px[0][0], px[0][1]));
      }
      const cov = clamp(half - best + 0.5, 0, 1);
      if (cov > 0) blend(c, x2, y2, color, cov);
    }
  }
}

function strokeArc(c, cx, cy, radius, width, from, to, color) {
  const half = width / 2;
  const rOuter = radius + half + 1;
  for (let y = Math.floor(cy - rOuter); y <= Math.ceil(cy + rOuter); y++) {
    for (let x = Math.floor(cx - rOuter); x <= Math.ceil(cx + rOuter); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      let angle = Math.atan2(dy, dx);
      if (angle < 0) angle += Math.PI * 2;
      let a0 = from;
      let a1 = to;
      if (a0 < 0) a0 += Math.PI * 2;
      if (a1 < 0) a1 += Math.PI * 2;
      const inside = a0 <= a1 ? angle >= a0 && angle <= a1 : angle >= a0 || angle <= a1;
      if (!inside) continue;
      const cov = clamp(half - Math.abs(dist - radius) + 0.5, 0, 1);
      if (cov > 0) blend(c, x, y, color, cov);
    }
  }
}

// Point-in-polygon coverage with 4x4 supersampling.
function polygon(c, points, color) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs));
  const y0 = Math.floor(Math.min(...ys));
  const x1 = Math.ceil(Math.max(...xs));
  const y1 = Math.ceil(Math.max(...ys));
  const steps = 4;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let hits = 0;
      for (let sy = 0; sy < steps; sy++) {
        for (let sx = 0; sx < steps; sx++) {
          const px = x + (sx + 0.5) / steps;
          const py = y + (sy + 0.5) / steps;
          let inside = false;
          for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i][0];
            const yi = points[i][1];
            const xj = points[j][0];
            const yj = points[j][1];
            if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
          }
          if (inside) hits++;
        }
      }
      if (hits) blend(c, x, y, color, hits / (steps * steps));
    }
  }
}

// Deterministic value noise, used for the metal/carbon grain.
let seed = 0x2f6e2b1;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff;
}

function grain(c, amount, alpha) {
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const n = (rand() - 0.5) * amount;
      const i = (y * c.w + x) * 4;
      if (c.data[i + 3] === 0) continue;
      c.data[i] = c.data[i] + n;
      c.data[i + 1] = c.data[i + 1] + n;
      c.data[i + 2] = c.data[i + 2] + n;
      if (alpha !== undefined) c.data[i + 3] = Math.round(c.data[i + 3] * alpha);
    }
  }
}

// Diagonal speed stripes, clipped to a rounded rect.
function speedStripes(c, box, radius, spacing, width, color) {
  const { x, y, w, h } = box;
  const sdf = sdfBox(x, y, w, h, radius);
  const slope = 0.6;
  paintSdf(c, sdf, [x, y, x + w, y + h], (px, py) => {
    const t = (px - x) + (py - y) * slope;
    const phase = ((t % spacing) + spacing) % spacing;
    return rgba(color, Math.round(color[3] * (phase < width ? 1 : 0)));
  }, (d) => clamp(0.5 - d, 0, 1));
}

function vignette(c, strength) {
  const cx = c.w / 2;
  const cy = c.h / 2;
  const max = Math.hypot(cx, cy);
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const d = Math.hypot(x - cx, y - cy) / max;
      const amount = Math.pow(clamp(d * 1.25, 0, 1), 2.2) * strength;
      if (amount <= 0) continue;
      const i = (y * c.w + x) * 4;
      c.data[i] *= 1 - amount;
      c.data[i + 1] *= 1 - amount;
      c.data[i + 2] *= 1 - amount;
    }
  }
}

function downscale(image, width, height) {
  const out = canvas(width, height);
  const sx = image.w / width;
  const sy = image.h / height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(image.w, Math.ceil((x + 1) * sx));
      const y0 = Math.floor(y * sy);
      const y1 = Math.min(image.h, Math.ceil((y + 1) * sy));
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * image.w + xx) * 4;
          r += image.data[i];
          g += image.data[i + 1];
          b += image.data[i + 2];
          a += image.data[i + 3];
          n++;
        }
      }
      const d = (y * width + x) * 4;
      out.data[d] = r / n;
      out.data[d + 1] = g / n;
      out.data[d + 2] = b / n;
      out.data[d + 3] = a / n;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * TGA writer
 * ------------------------------------------------------------------ */

function writeTga(file, image, options) {
  const opts = options || {};
  const bpp = opts.bpp || 32;
  const rle = opts.rle !== false;
  const topDown = opts.topDown === true;
  const header = Buffer.alloc(18);
  header[2] = rle ? 10 : 2;
  header.writeUInt16LE(image.w, 12);
  header.writeUInt16LE(image.h, 14);
  header[16] = bpp;
  header[17] = (bpp === 32 ? 8 : 0) | (topDown ? 0x20 : 0);
  // Original files are bottom-up; both orientations load, bottom-up matches.
  const bytesPerPixel = bpp / 8;
  const pixels = Buffer.alloc(image.w * image.h * bytesPerPixel);

  for (let y = 0; y < image.h; y++) {
    const srcY = topDown ? y : image.h - 1 - y;
    for (let x = 0; x < image.w; x++) {
      const s = (srcY * image.w + x) * 4;
      const d = (y * image.w + x) * bytesPerPixel;
      const alpha = image.data[s + 3];
      // Un-premultiply: TGA stores straight colour plus alpha.
      const scale = alpha > 0 ? 255 / alpha : 0;
      const r = Math.min(255, image.data[s] * scale);
      const g = Math.min(255, image.data[s + 1] * scale);
      const b = Math.min(255, image.data[s + 2] * scale);
      // 24-bit backgrounds have no alpha channel; transparent pixels become black.
      if (bpp === 32) {
        pixels[d] = Math.round(b);
        pixels[d + 1] = Math.round(g);
        pixels[d + 2] = Math.round(r);
        pixels[d + 3] = alpha;
      } else {
        pixels[d] = Math.round(b);
        pixels[d + 1] = Math.round(g);
        pixels[d + 2] = Math.round(r);
      }
    }
  }

  let body;
  if (!rle) {
    body = pixels;
  } else {
    const chunks = [];
    const stride = bytesPerPixel;
    const total = image.w * image.h;
    const same = (a, b) => pixels[a] === pixels[b] && pixels[a + 1] === pixels[b + 1] &&
      pixels[a + 2] === pixels[b + 2] && (stride === 3 || pixels[a + 3] === pixels[b + 3]);
    let i = 0;
    while (i < total) {
      let run = 1;
      while (i + run < total && run < 128 && same(i * stride, (i + run) * stride)) run++;
      if (run > 1) {
        chunks.push(Buffer.from([0x80 | (run - 1)]), pixels.subarray(i * stride, i * stride + stride));
        i += run;
        continue;
      }
      let raw = 1;
      while (i + raw < total && raw < 128 && !same((i + raw - 1) * stride, (i + raw) * stride)) raw++;
      chunks.push(Buffer.from([raw - 1]), pixels.subarray(i * stride, (i + raw) * stride));
      i += raw;
    }
    body = Buffer.concat(chunks);
  }

  fs.writeFileSync(file, Buffer.concat([header, body]));
  return file;
}

/* ------------------------------------------------------------------ *
 * Chrome primitives
 * ------------------------------------------------------------------ */

const TILE_RADIUS = 4;

function plate(w, h, opts) {
  const o = opts || {};
  const c = canvas(w, h);
  const radius = o.radius === undefined ? TILE_RADIUS : o.radius;
  const active = o.active;
  const tint = o.tint || 'blue';

  const accent = tint === 'pink' ? C.pink : tint === 'green' ? C.green : C.green;
  const fillTop = active
    ? (tint === 'pink' ? [190, 26, 96] : mix(C.blue, [255, 255, 255], 0.06))
    : (tint === 'pink' ? [122, 18, 62] : C.ink700);
  const fillBottom = active
    ? (tint === 'pink' ? C.pinkDeep : C.blueDeep)
    : (tint === 'pink' ? [74, 8, 38] : C.ink850);

  roundRect(c, 0.5, 0.5, w - 1, h - 1, radius, {
    color: vGradient(fillTop, fillBottom, o.topAlpha === undefined ? 235 : o.topAlpha, o.bottomAlpha === undefined ? 245 : o.bottomAlpha)
  });

  // Faint speed stripes in the top-right corner, MESX5's tile motif.
  const stripeColor = active
    ? [255, 255, 255, 34]
    : tint === 'pink' ? [255, 150, 190, 22] : [120, 165, 255, 16];
  const stripeLayer = canvas(w, h);
  speedStripes(stripeLayer, { x: 0, y: 0, w, h }, radius, Math.max(14, h * 0.22), Math.max(2, h * 0.06), stripeColor);
  // Only keep the right 55% of the stripes.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < Math.min(w, Math.floor(w * 0.45)); x++) {
      const i = (y * w + x) * 4;
      stripeLayer.data[i] = 0;
      stripeLayer.data[i + 1] = 0;
      stripeLayer.data[i + 2] = 0;
      stripeLayer.data[i + 3] = 0;
    }
  }
  composite(c, stripeLayer);

  // Bottom scrim so light labels stay legible over the stripes.
  if (!active) {
    for (let y = Math.floor(h * 0.55); y < h; y++) {
      const t = (y - h * 0.55) / (h * 0.45);
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (c.data[i + 3] === 0) continue;
        blend(c, x, y, rgba(C.ink900, Math.round(48 * t)), 1);
      }
    }
  }

  // Top gloss.
  if (o.gloss !== false) {
    const gloss = canvas(w, h);
    roundRect(gloss, 1, 1, w - 2, Math.max(2, h * (active ? 0.5 : 0.34)), radius, {
      color: vGradient([255, 255, 255], [255, 255, 255], active ? 40 : 20, 0)
    });
    composite(c, gloss);
  }

  // Border.
  if (active) {
    innerBorder(c, 0, 0, w, h, radius, Math.max(2.5, h * 0.014), rgba(accent, 255));
    innerBorder(c, 3, 3, w - 6, h - 6, Math.max(0, radius - 2), 1, rgba(C.ink900, 90));
  } else {
    innerBorder(c, 0, 0, w, h, radius, 1, rgba(C.lineBright, 120));
    innerBorder(c, 0, 0, w, h, radius, 1, rgba([255, 255, 255], 26));
  }

  // Selected tiles get the green left bar from the MESX5 cards.
  if (active && o.leftBar !== false) {
    const barW = Math.max(3, Math.round(h * 0.055));
    roundRect(c, 0, 0, barW + 2, h, radius, { color: rgba(accent, 255), alpha: 1 });
    roundRect(c, 0, 0, 2, h, 0, { color: rgba(accent, 255) });
  }

  if (o.grain !== false) grain(c, 10);
  return c;
}

function composite(base, layer) {
  for (let i = 0; i < base.data.length; i += 4) {
    const a = layer.data[i + 3] / 255;
    if (a <= 0) continue;
    const keep = 1 - a;
    base.data[i] = layer.data[i] + base.data[i] * keep;
    base.data[i + 1] = layer.data[i + 1] + base.data[i + 1] * keep;
    base.data[i + 2] = layer.data[i + 2] + base.data[i + 2] * keep;
    base.data[i + 3] = layer.data[i + 3] + base.data[i + 3] * keep;
  }
}

function pill(w, h, state, opts) {
  const o = Object.assign({ radius: Math.min(h / 2, 4) }, opts);
  if (state === 1) {
    // Disabled / unselected: no fill, dim outline.
    const c = canvas(w, h);
    roundRect(c, 0.5, 0.5, w - 1, h - 1, o.radius, { color: rgba(C.ink800, o.dimAlpha || 150) });
    ring(c, 0.5, 0.5, w - 1, h - 1, o.radius, 1, rgba(C.lineBright, 46));
    return c;
  }
  return plate(w, h, Object.assign({
    active: state === 3,
    leftBar: state === 3 && o.leftBar !== false,
    radius: o.radius
  }, o));
}

// Chevron icon used by arrows, sliders, expanders.
function chevron(size, direction, color, weight) {
  const c = canvas(size, size);
  const inset = size * 0.28;
  const w = weight || Math.max(2, size * 0.085);
  const points = {
    left: [[1 - 0.28, 0.2], [0.28, 0.5], [1 - 0.28, 0.8]],
    right: [[0.28, 0.2], [1 - 0.28, 0.5], [0.28, 0.8]],
    up: [[0.2, 1 - 0.28], [0.5, 0.28], [0.8, 1 - 0.28]],
    down: [[0.2, 0.28], [0.5, 1 - 0.28], [0.8, 0.28]]
  }[direction];
  stroke(c, { x: inset, y: inset, w: size - inset * 2, h: size - inset * 2 }, points, w, color);
  return c;
}

function checkIcon(size, state) {
  const c = canvas(size, size);
  const r = size * 0.16;
  roundRect(c, 0.5, 0.5, size - 1, size - 1, r, { color: state ? rgba(C.greenDeep, 255) : rgba(C.ink800, 210) });
  ring(c, 0.5, 0.5, size - 1, size - 1, r, 1, state ? rgba(C.green, 255) : rgba(C.lineBright, 170));
  if (state) {
    stroke(c, { x: size * 0.2, y: size * 0.18, w: size * 0.6, h: size * 0.64 },
      [[0.06, 0.52], [0.36, 0.84], [0.96, 0.12]], Math.max(2, size * 0.14), rgba([255, 255, 255], 255));
  }
  return c;
}

function radioIcon(size, state) {
  const c = canvas(size, size);
  const cx = size / 2;
  const cy = size / 2;
  const outer = size * 0.36;
  roundRect(c, cx - outer, cy - outer, outer * 2, outer * 2, outer, { color: rgba(C.ink800, 210) });
  ring(c, cx - outer, cy - outer, outer * 2, outer * 2, outer, 1.5, state ? rgba(C.green, 255) : rgba(C.lineBright, 160));
  if (state) {
    roundRect(c, cx - outer * 0.45, cy - outer * 0.45, outer * 0.9, outer * 0.9, outer * 0.45, { color: rgba(C.green, 255) });
  }
  return c;
}

function switchIcon(w, h, on) {
  const c = canvas(w, h);
  const r = h / 2;
  roundRect(c, 0.5, 0.5, w - 1, h - 1, r, {
    color: vGradient(on ? C.green : C.ink700, on ? C.greenDeep : C.ink800, 255, 255)
  });
  ring(c, 0.5, 0.5, w - 1, h - 1, r, 1, on ? rgba(C.greenSoft, 230) : rgba(C.lineBright, 140));
  const knob = h * 0.36;
  const kx = on ? w - knob - h * 0.16 : h * 0.16;
  roundRect(c, kx, (h - knob) / 2, knob, knob, knob / 2, { color: rgba([255, 255, 255], 250) });
  return c;
}

function pillButton(w, h, state, tint) {
  const active = state === 3;
  const c = canvas(w, h);
  const radius = Math.min(h / 2, 5);
  const colors = tint === 'pink'
    ? [C.pink, C.pinkDeep]
    : tint === 'green'
      ? [[64, 226, 108], C.greenDeep]
      : active ? [C.blue, C.blueDeep] : [C.ink700, C.ink850];
  roundRect(c, 0.5, 0.5, w - 1, h - 1, radius, {
    color: vGradient(colors[0], colors[1], 245, 250)
  });
  // gloss
  const gloss = canvas(w, h);
  roundRect(gloss, 1, 1, w - 2, Math.max(2, h * 0.45), radius, {
    color: vGradient([255, 255, 255], [255, 255, 255], 28, 0)
  });
  composite(c, gloss);
  const frame = tint === 'pink' ? C.pinkSoft : tint === 'green' ? C.greenSoft : active ? C.green : C.lineBright;
  innerBorder(c, 0, 0, w, h, radius, tint || active ? 1.6 : 1,
    tint === 'pink' || tint === 'green' ? rgba(frame, 235) : rgba(frame, active ? 255 : 130));
  if (tint === 'green') {
    // Left green bar, MESX5's confirm chip.
    roundRect(c, 0, 0, Math.max(3, h * 0.09), h, radius, { color: rgba(C.greenSoft, 220) });
  }
  grain(c, 8);
  return c;
}

function tabSprite(w, h, state, vertical) {
  const c = state === 2
    ? pillButton(w, h, 3, null)
    : (() => {
      const out = canvas(w, h);
      roundRect(out, 0.5, 0.5, w - 1, h - 1, 3, { color: rgba(C.ink800, 235) });
      innerBorder(out, 0, 0, w, h, 3, 1, rgba(C.lineBright, 80));
      grain(out, 8);
      return out;
    })();
  if (state === 2 && vertical) {
    roundRect(c, 0, 0, 3, h, 0, { color: rgba(C.green, 255) });
  }
  return c;
}

function iconButton(size, glyph) {
  const c = pillButton(size, size, 2, null);
  const color = rgba(C.ice, 255);
  const box = { x: size * 0.22, y: size * 0.22, w: size * 0.56, h: size * 0.56 };
  switch (glyph) {
    case 'home':
      polygon(c, [
        [box.x + box.w * 0.5, box.y],
        [box.x + box.w, box.y + box.h * 0.46],
        [box.x, box.y + box.h * 0.46]
      ], color);
      stroke(c, box, [[0.16, 0.44], [0.16, 1], [0.84, 1], [0.84, 0.44]], Math.max(2, size * 0.09), color);
      break;
    case 'refresh':
      strokeArc(c, size / 2, size / 2, size * 0.24, Math.max(2, size * 0.075), Math.PI * 0.25, Math.PI * 1.82, color);
      polygon(c, [
        [size * 0.68, size * 0.2],
        [size * 0.86, size * 0.34],
        [size * 0.66, size * 0.42]
      ], color);
      break;
    case 'sort':
      polygon(c, [
        [size * 0.28, size * 0.42],
        [size * 0.5, size * 0.16],
        [size * 0.72, size * 0.42]
      ], color);
      polygon(c, [
        [size * 0.28, size * 0.6],
        [size * 0.5, size * 0.86],
        [size * 0.72, size * 0.6]
      ], rgba(C.ice3, 200));
      break;
    case 'plus':
      stroke(c, box, [[0.5, 0.06], [0.5, 0.94]], Math.max(2, size * 0.13), color);
      stroke(c, box, [[0.06, 0.5], [0.94, 0.5]], Math.max(2, size * 0.13), color);
      break;
    case 'minus':
      stroke(c, box, [[0.06, 0.5], [0.94, 0.5]], Math.max(2, size * 0.13), color);
      break;
    default:
      break;
  }
  return c;
}

function transportIcon(size, glyph, state) {
  const c = canvas(size, size);
  const color = state === 3 ? rgba(C.green, 255) : state === 1 ? rgba(C.ice3, 180) : rgba(C.ice, 235);
  const b = { x: size * 0.14, y: size * 0.16, w: size * 0.72, h: size * 0.68 };
  const W = b.w;
  const Hh = b.h;
  const tri = (cx, dir) => polygon(c, [
    [b.x + cx - W * 0.14 * dir, b.y],
    [b.x + cx + W * 0.18 * dir, b.y + Hh / 2],
    [b.x + cx - W * 0.14 * dir, b.y + Hh]
  ], color);
  const bar = (cx) => roundRect(c, b.x + cx, b.y, Math.max(1.5, size * 0.06), Hh, 1, { color });
  switch (glyph) {
    case 'play': tri(W * 0.42, 1); break;
    case 'pause':
      bar(W * 0.22);
      bar(W * 0.58);
      break;
    case 'rw': tri(W * 0.42, -1); bar(W * 0.02); break;
    case 'ff': tri(W * 0.36, 1); bar(W * 0.86); break;
    case 'rwone': bar(W * 0.1); tri(W * 0.5, -1); break;
    case 'ffone': tri(W * 0.24, 1); bar(W * 0.72); break;
    case 'rwend': tri(W * 0.36, -1); tri(W * 0.78, -1); break;
    case 'ffend': tri(W * 0.12, 1); tri(W * 0.54, 1); break;
    case 'slowmo':
      polygon(c, [[b.x, b.y], [b.x + W * 0.5, b.y + Hh / 2], [b.x, b.y + Hh]], color);
      polygon(c, [[b.x + W * 0.5, b.y], [b.x + W, b.y + Hh / 2], [b.x + W * 0.5, b.y + Hh]], rgba(C.ice, 150));
      break;
    case 'rwslow':
      bar(W * 0.04);
      polygon(c, [[b.x + W * 0.24, b.y], [b.x + W * 0.74, b.y + Hh / 2], [b.x + W * 0.24, b.y + Hh]], color);
      break;
    case 'live':
      roundRect(c, b.x + W * 0.15, b.y + Hh * 0.28, W * 0.7, Hh * 0.44, Hh * 0.22, { color: rgba(C.pink, 255) });
      roundRect(c, b.x + W * 0.22, b.y + Hh * 0.38, W * 0.56, Hh * 0.24, Hh * 0.12, { color: rgba([255, 255, 255], 230) });
      break;
    case 'marker':
      roundRect(c, b.x + W * 0.42, b.y, Math.max(1.5, size * 0.06), Hh, 1, { color: rgba(C.green, 255) });
      break;
    case 'splitstart':
    case 'splitend':
      roundRect(c, b.x + (glyph === 'splitstart' ? 0 : W * 0.8), b.y, Math.max(1.5, size * 0.06), Hh, 1, { color: rgba(C.blueSoft, 235) });
      break;
    default:
      break;
  }
  return c;
}

/* ------------------------------------------------------------------ *
 * Dialog frames
 * ------------------------------------------------------------------ */

function dialogFrame(w, h, kind) {
  const c = canvas(w, h);
  const radius = Math.min(8, Math.max(3, Math.min(w, h) * 0.02));
  const alpha = kind === 'small' ? 226 : 241;
  roundRect(c, 0.5, 0.5, w - 1, h - 1, radius, {
    color: vGradient(C.ink700, C.ink900, alpha, Math.min(255, alpha + 12))
  });

  if (kind !== 'bar') {
    // Header band, the strip the dialog's title text sits on.
    const bandH = Math.min(h * 0.16, 64);
    const band = canvas(w, h);
    roundRect(band, 1, 1, w - 2, bandH, radius, {
      color: vGradient([26, 44, 110], [16, 27, 70], 255, 235)
    });
    composite(c, band);
    // Accent line under the band.
    roundRect(c, 0, bandH - 1, w, 2, 0, { color: rgba(C.blue, 200) });
  }

  if (kind === 'bar' || kind === 'small') {
    // Left accent edge for slim bars (search fields, tooltips).
    roundRect(c, 0, 0, Math.max(3, w * 0.004), h, 0, { color: rgba(C.green, 235) });
  }

  innerBorder(c, 0, 0, w, h, radius, 1.4, rgba(C.lineBright, 165));

  // Inner top highlight.
  ring(c, 2, 2, w - 4, bandOrInner(h, kind), radius, 1, rgba([255, 255, 255], 18));
  // Grain only on small frames: noise on a 1580x730 panel only bloats the file.
  if (w * h < 120000) grain(c, 6);
  return c;
}

function bandOrInner(h) {
  return Math.max(4, h - 4);
}

/* ------------------------------------------------------------------ *
 * Wallpapers
 * ------------------------------------------------------------------ */

function gradePhoto(image, opts) {
  const o = opts || {};
  const ramp = o.ramp || [[4, 7, 22], [18, 34, 92], [92, 132, 226]];
  const lut = lerpColorAt([[0, ramp[0]], [0.55, ramp[1]], [1, ramp[2]]]);
  const out = canvas(image.w, image.h);
  for (let y = 0; y < image.h; y++) {
    for (let x = 0; x < image.w; x++) {
      const i = (y * image.w + x) * 4;
      const r = image.data[i];
      const g = image.data[i + 1];
      const b = image.data[i + 2];
      const lum = clamp((0.299 * r + 0.587 * g + 0.114 * b) / 255, 0, 1);
      const mapped = lut(Math.pow(lum, o.gamma === undefined ? 1.15 : o.gamma));
      const gray = [lum * 255, lum * 255, lum * 255];
      const base = mix(mapped, gray, o.desaturate === undefined ? 0.22 : o.desaturate);
      const brightness = o.brightness === undefined ? 0.72 : o.brightness;
      out.data[i] = base[0] * brightness;
      out.data[i + 1] = base[1] * brightness;
      out.data[i + 2] = base[2] * brightness;
      out.data[i + 3] = 255;
    }
  }
  return out;
}

function coolOverlay(image, opts) {
  const o = opts || {};
  const top = o.top || [10, 22, 68];
  const bottom = o.bottom || [4, 6, 18];
  const strength = o.strength === undefined ? 0.55 : o.strength;
  for (let y = 0; y < image.h; y++) {
    const t = y / image.h;
    const color = mix(top, bottom, t);
    for (let x = 0; x < image.w; x++) {
      const i = (y * image.w + x) * 4;
      const side = Math.pow(Math.abs(x / image.w - 0.5) * 2, 2) * 0.35;
      const amount = strength * (0.45 + t * 0.55) + side * 0.2;
      image.data[i] = image.data[i] * (1 - amount) + color[0] * amount;
      image.data[i + 1] = image.data[i + 1] * (1 - amount) + color[1] * amount;
      image.data[i + 2] = image.data[i + 2] * (1 - amount) + color[2] * amount;
    }
  }
}

function wallpaper(sourceFile, opts) {
  const o = opts || {};
  const decoded = Tga.decode(fs.readFileSync(sourceFile));
  let image = { w: decoded.width, h: decoded.height, data: decoded.rgba };
  if (image.w > 1920 || image.h > 1080) {
    image = downscale(image, 1920, 1080);
  }
  const graded = gradePhoto(image, o);
  coolOverlay(graded, o);
  vignette(graded, o.vignette === undefined ? 0.5 : o.vignette);
  if (o.glow) {
    // Stadium light pool behind the header, like MESX5's lit stands.
    const cx = graded.w * 0.5;
    const cy = graded.h * 0.08;
    const radius = graded.w * 0.45;
    for (let y = 0; y < graded.h * 0.55; y++) {
      for (let x = 0; x < graded.w; x++) {
        const d = Math.hypot(x - cx, y - cy) / radius;
        const amount = Math.pow(clamp(1 - d, 0, 1), 2.4) * o.glow;
        if (amount <= 0) continue;
        const i = (y * graded.w + x) * 4;
        graded.data[i] += 30 * amount;
        graded.data[i + 1] += 54 * amount;
        graded.data[i + 2] += 110 * amount;
      }
    }
  }
  grain(graded, o.grainAmount === undefined ? 7 : o.grainAmount);
  return graded;
}

/* ------------------------------------------------------------------ *
 * Wordmark
 * ------------------------------------------------------------------ */

function wordmark() {
  const decoded = Tga.decode(fs.readFileSync(path.join(OLD_DIR, 'logo_ui.tga')));
  const w = decoded.width;
  const h = decoded.height;
  const c = canvas(w, h);
  let maxAlpha = 0;
  for (let i = 3; i < decoded.rgba.length; i += 4) maxAlpha = Math.max(maxAlpha, decoded.rgba[i]);

  // Coverage comes from the source alpha when it exists, otherwise its luminance.
  const coverage = (i) => {
    const alpha = decoded.rgba[i + 3] / 255;
    const lum = (0.299 * decoded.rgba[i] + 0.587 * decoded.rgba[i + 1] + 0.114 * decoded.rgba[i + 2]) / 255;
    return maxAlpha > 8 ? alpha * Math.max(lum, 0.35) : lum;
  };

  const lut = lerpColorAt([[0, [186, 208, 255]], [0.55, [246, 249, 255]], [1, [255, 255, 255]]]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // The source art is a hairline outline; lift its coverage so the
      // wordmark still reads at menu scale.
      const cov = clamp(Math.pow(coverage(i), 0.55) * 1.5, 0, 1);
      if (cov <= 0.02) continue;
      const color = lut(x / w * 0.8 + y / h * 0.2);
      blend(c, x, y, rgba(color, 255), cov);
    }
  }

  // Green energy underline with a hard MESX5 cut.
  const barY = h * 0.82;
  roundRect(c, w * 0.02, barY, w * 0.3, Math.max(2, h * 0.028), 1, { color: rgba(C.green, 255) });
  polygon(c, [
    [w * 0.33, barY],
    [w * 0.39, barY],
    [w * 0.37, barY + Math.max(2, h * 0.028)],
    [w * 0.31, barY + Math.max(2, h * 0.028)]
  ], rgba(C.pink, 255));
  return c;
}

/* ------------------------------------------------------------------ *
 * Catalogue
 * ------------------------------------------------------------------ */

const built = [];

function emit(name, image, opts) {
  const file = path.join(OUT_DIR, name);
  writeTga(file, image, opts);
  built.push(name);
}

function buttonSet(base, width, height, opts) {
  emit(base + '1.tga', pill(width, height, 1), { bpp: 32 });
  emit(base + '2.tga', pill(width, height, 2, opts), { bpp: 32 });
  emit(base + '3.tga', pill(width, height, 3, opts), { bpp: 32 });
}

function dialogFiles() {
  return fs.readdirSync(OLD_DIR).filter((f) => /^dialog.*\.tga$/i.test(f));
}

function buildDialogs() {
  for (const name of dialogFiles()) {
    const match = /dialog(\d+)x(\d+)/i.exec(name);
    if (!match) continue;
    const w = parseInt(match[1], 10);
    const h = parseInt(match[2], 10);
    const kind = h <= 80 ? 'bar' : w * h < 260 * 160 ? 'small' : 'panel';
    emit(name, dialogFrame(w, h, kind), { bpp: 32 });
  }
}

function main(argv) {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  /* ---- main menu tiles ---- */
  buttonSet('main', 340, 40);
  emit('mainexit2.tga', plate(340, 40, { tint: 'pink' }), { bpp: 32 });
  emit('mainexit3.tga', plate(340, 40, { tint: 'pink', active: true }), { bpp: 32 });

  // Hub tiles, drawn at the size the redesigned main menu uses.
  const tiles = {
    'mesx_tile_l_2.tga': [430, 180, {}],
    'mesx_tile_l_3.tga': [430, 180, { active: true }],
    'mesx_tile_m_2.tga': [430, 108, {}],
    'mesx_tile_m_3.tga': [430, 108, { active: true }],
    'mesx_tile_hero_2.tga': [524, 428, {}],
    'mesx_tile_hero_3.tga': [524, 428, { active: true }],
    'mesx_tile_wide_2.tga': [524, 108, {}],
    'mesx_tile_wide_3.tga': [524, 108, { active: true }],
    'mesx_tile_exit_2.tga': [150, 44, { tint: 'pink', leftBar: false }],
    'mesx_tile_exit_3.tga': [150, 44, { tint: 'pink', active: true, leftBar: false }],
    'mesx_tile_s_2.tga': [534, 108, {}],
    'mesx_tile_s_3.tga': [534, 108, { active: true }],
    'mesx_tile_r_2.tga': [534, 180, {}],
    'mesx_tile_r_3.tga': [534, 180, { active: true }],
    'mesx_tile_xs_2.tga': [240, 56, {}],
    'mesx_tile_xs_3.tga': [240, 56, { active: true }]
  };
  for (const [name, [w, h, opts]] of Object.entries(tiles)) {
    emit(name, plate(w, h, opts), { bpp: 32 });
  }

  /* ---- generic buttons ---- */
  buttonSet('button', 200, 30);
  buttonSet('b_button', 160, 30);
  buttonSet('w_button', 240, 30);
  buttonSet('r_button', 200, 30);
  buttonSet('black', 200, 30, { gloss: false });

  // Confirm chip (right side of most dialogs): green.
  emit('done1.tga', pillButton(200, 30, 2, 'green'), { bpp: 32 });
  emit('done2.tga', pillButton(200, 30, 3, 'green'), { bpp: 32 });

  // Back chip with a chevron baked in.
  for (const state of [1, 2]) {
    const c = pillButton(160, 30, state, null);
    const icon = chevron(16, 'left', rgba(state === 2 ? C.ice : C.ice3, 240), 2.4);
    composite(c, icon);
    emit('back' + state + '.tga', c, { bpp: 32 });
  }

  /* ---- tabs ---- */
  emit('tabh1.tga', tabSprite(200, 30, 1, false), { bpp: 32 });
  emit('tabh2.tga', tabSprite(200, 30, 2, false), { bpp: 32 });
  emit('tabv1.tga', tabSprite(200, 30, 1, true), { bpp: 32 });
  emit('tabv2.tga', tabSprite(200, 30, 2, true), { bpp: 32 });

  /* ---- arrows / sliders ---- */
  for (const side of ['lf', 'rg']) {
    const direction = side === 'lf' ? 'left' : 'right';
    for (const state of [1, 2, 3]) {
      const color = state === 3 ? rgba(C.green, 255) : state === 1 ? rgba(C.ice3, 170) : rgba(C.ice, 235);
      emit(side === 'lf' ? 'arrow_lf' + state + '.tga' : 'arrow_rg' + state + '.tga',
        chevron(32, direction, color, 3.6), { bpp: 32 });
      const small = chevron(32, direction, state === 3 ? rgba(C.green, 255) : rgba(C.ice2, state === 1 ? 150 : 220), 2.4);
      emit((side === 'lf' ? 'r_arrow_lf' : 'r_arrow_rg') + state + '.tga', small, { bpp: 32 });
      emit((side === 'lf' ? 'slider_lf' : 'slider_rg') + state + '.tga',
        chevron(32, state === 3 ? 'left' : 'right', state === 3 ? rgba(C.green, 255) : rgba(C.ice2, 210), 2.8), { bpp: 32 });
    }
  }

  // Slider track + handle.
  const track = canvas(200, 20);
  roundRect(track, 0, 4, 200, 12, 6, { color: rgba(C.ink900, 235) });
  ring(track, 0, 4, 200, 12, 6, 1, rgba(C.lineBright, 120));
  // Filled portion hint on the left third.
  roundRect(track, 1, 5, 66, 10, 5, { color: vGradient(C.blue, C.blueDeep, 235, 235) });
  for (let i = 1; i < 10; i++) {
    roundRect(track, Math.round((200 * i) / 10) - 1, 6, 1, 8, 0, { color: rgba(C.lineBright, 70) });
  }
  grain(track, 6);
  emit('slider.tga', track, { bpp: 32 });

  const handle = canvas(32, 32);
  roundRect(handle, 2, 2, 28, 28, 5, { color: vGradient(C.ice, C.ice2, 255, 255) });
  roundRect(handle, 6, 6, 20, 20, 3, { color: vGradient(C.blue, C.blueDeep, 255, 255) });
  ring(handle, 2, 2, 28, 28, 5, 1, rgba(C.ice, 255));
  emit('slider_box.tga', handle, { bpp: 32 });

  /* ---- scrollbars ---- */
  const scrollTrack = canvas(20, 200);
  roundRect(scrollTrack, 4, 0, 12, 200, 6, { color: rgba(C.ink900, 220) });
  ring(scrollTrack, 4, 0, 12, 200, 6, 1, rgba(C.lineBright, 90));
  emit('scroll.tga', scrollTrack, { bpp: 32 });

  const thumb = canvas(32, 32);
  roundRect(thumb, 2, 2, 28, 28, 5, { color: vGradient(C.blueSoft, C.blueDeep, 245, 245) });
  ring(thumb, 2, 2, 28, 28, 5, 1, rgba(C.ice, 200));
  for (let i = 0; i < 3; i++) {
    roundRect(thumb, 11, 9 + i * 6, 10, 2, 1, { color: rgba([255, 255, 255], 190) });
  }
  emit('scroll_box.tga', thumb, { bpp: 32 });

  for (const state of [1, 2, 3]) {
    const color = state === 3 ? rgba(C.green, 255) : rgba(C.ice2, state === 1 ? 160 : 230);
    emit('scroll_up' + state + '.tga', chevron(32, 'up', color, 3), { bpp: 32 });
    emit('scroll_dw' + state + '.tga', chevron(32, 'down', color, 3), { bpp: 32 });
  }
  emit('sort1.tga', iconButton(32, 'sort'), { bpp: 32 });
  emit('sort2.tga', iconButton(32, 'sort'), { bpp: 32 });

  /* ---- checkboxes, radios, switches ---- */
  emit('check1.tga', checkIcon(32, false), { bpp: 32 });
  emit('check2.tga', checkIcon(32, true), { bpp: 32 });
  emit('c_box.tga', checkIcon(32, false), { bpp: 32 });
  emit('radio1.tga', radioIcon(32, false), { bpp: 32 });
  emit('radio2.tga', radioIcon(32, true), { bpp: 32 });
  emit('switch1.tga', switchIcon(32, 32, false), { bpp: 32 });
  emit('switch2.tga', switchIcon(32, 32, true), { bpp: 32 });
  emit('r_switch1.tga', switchIcon(32, 32, false), { bpp: 32 });
  emit('r_switch2.tga', switchIcon(32, 32, true), { bpp: 32 });

  /* ---- icon buttons ---- */
  emit('b_home1.tga', iconButton(32, 'home'), { bpp: 32 });
  emit('b_home2.tga', iconButton(32, 'home'), { bpp: 32 });
  emit('b_home3.tga', iconButton(32, 'home'), { bpp: 32 });
  emit('refresh1.tga', iconButton(64, 'refresh'), { bpp: 32 });
  emit('refresh2.tga', iconButton(64, 'refresh'), { bpp: 32 });
  emit('refresh3.tga', iconButton(64, 'refresh'), { bpp: 32 });
  for (const state of [1, 2, 3]) {
    emit('plus' + state + '.tga', iconButton(32, 'plus'), { bpp: 32 });
    emit('minus' + state + '.tga', iconButton(32, 'minus'), { bpp: 32 });
    emit('session' + state + '.tga', transportIcon(40, 'play', state), { bpp: 32 });
  }

  /* ---- replay transport ---- */
  const transport = ['play', 'rw', 'ff', 'rwone', 'ffone', 'rwend', 'ffend', 'slowmo', 'live', 'rwslow'];
  for (const glyph of transport) {
    for (const state of [1, 2, 3]) {
      emit(glyph + state + '.tga', transportIcon(32, glyph, state), { bpp: 32 });
    }
  }
  emit('splitstart.tga', transportIcon(32, 'splitstart', 2), { bpp: 32 });
  emit('splitend.tga', transportIcon(32, 'splitend', 2), { bpp: 32 });
  emit('markerstart.tga', transportIcon(32, 'marker', 2), { bpp: 32 });
  emit('markerend.tga', transportIcon(32, 'marker', 2), { bpp: 32 });

  /* ---- expanders ---- */
  for (const [name, size, dir] of [['open.tga', [16, 64], 'right'], ['close.tga', [16, 64], 'left'],
  ['r_open.tga', [16, 40], 'right'], ['r_close.tga', [16, 40], 'left']]) {
    const c = pill(16, size[1], 2, { radius: 3 });
    const icon = chevron(16, dir, rgba(C.ice, 240), 2.2);
    composite(c, icon);
    emit(name, c, { bpp: 32 });
  }

  /* ---- dialogs, logo, pointer ---- */
  buildDialogs();
  emit('logo_ui.tga', wordmark(), { bpp: 32 });

  for (const [name, shadow] of [['pointer.tga', false], ['pointer_shadow.tga', true]]) {
    const c = canvas(48, 64);
    const color = shadow ? rgba([0, 0, 0], 150) : rgba(C.ice, 255);
    const outline = shadow ? rgba([0, 0, 0], 150) : rgba(C.blueDeep, 255);
    const pts = [[0, 0], [0, 0.72], [0.2, 0.56], [0.36, 0.94], [0.52, 0.86], [0.36, 0.5], [0.6, 0.48]];
    const box = { x: 3, y: 2, w: 40, h: 58 };
    const offset = shadow ? 2 : 0;
    const shifted = { x: box.x + offset, y: box.y + offset, w: box.w, h: box.h };
    if (shadow) {
      stroke(c, shifted, pts, 4, outline, true);
      polygon(c, pts.map((p) => [shifted.x + p[0] * shifted.w, shifted.y + p[1] * shifted.h]), outline);
    } else {
      stroke(c, box, pts, 5, outline, true);
      polygon(c, pts.map((p) => [box.x + p[0] * box.w, box.y + p[1] * box.h]), outline);
      const inner = { x: box.x + 2, y: box.y + 2, w: box.w - 4, h: box.h - 4 };
      stroke(c, inner, pts, 3, color, true);
      polygon(c, pts.map((p) => [inner.x + p[0] * inner.w, inner.y + p[1] * inner.h]), color);
    }
    emit(name, c, { bpp: 32 });
  }

  /* ---- wallpapers ---- */
  emit('bkgrnd.tga', wallpaper(path.join(OLD_DIR, 'bkgrnd.tga'), {
    brightness: 0.6, desaturate: 0.15, strength: 0.62, vignette: 0.55, glow: 0.5, bpp: 24
  }), { bpp: 24 });
  emit('splash.tga', wallpaper(path.join(OLD_DIR, 'splash.tga'), {
    brightness: 0.74, desaturate: 0.1, strength: 0.5, vignette: 0.45, glow: 0.35
  }), { bpp: 24 });

  console.log('wrote ' + built.length + ' sprites to ' + path.relative(process.cwd(), OUT_DIR));
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  canvas, roundRect, ring, polygon, stroke, strokeArc, writeTga, plate, pillButton,
  chevron, iconButton, transportIcon, dialogFrame, gradePhoto, downscale, composite, C
};
