/*
 * Recolour a mod folder into the MESX5 palette.
 *
 *   node tools/mesx5-colors.js "mesx5 ui"           # report only
 *   node tools/mesx5-colors.js "mesx5 ui" --write   # rewrite the .mnu files
 *
 * Only colour lines are touched, and only their four numbers change, so every
 * other byte of the file stays as it was. Neutral greys are mapped onto the
 * MESX5 ink -> ice ramp by luminance, saturated colours are moved onto the
 * blue / green / magenta accent family while keeping their lightness.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const COLOR_KEYS = /^(color|color1|color2|color3|backcolor|sortbackcolor|sortbartextcolor|sortbartextcolor2|sortbartextcolor3|textcolor)$/;
const COLOR_LINE = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s+)(\d+)\s+(\d+)\s+(\d+)\s+(\d+)(\s*)$/;

// Panel/list backgrounds where the meaning matters more than the luminance.
// Keyed on RGB; the alpha channel of the original is kept.
const BACKCOLOR = {
  '37 37 37': [11, 18, 46],
  '163 163 163': [26, 62, 168],
  '208 208 208': [18, 34, 96],
  '220 220 220': [22, 40, 110],
  '230 230 230': [20, 36, 100]
};

const RAMP = [
  [0.0, [5, 8, 24]],
  [0.1, [13, 22, 56]],
  [0.22, [30, 46, 104]],
  [0.34, [62, 88, 160]],
  [0.46, [96, 120, 180]],
  [0.58, [151, 165, 210]],
  [0.68, [195, 206, 239]],
  [0.78, [226, 233, 255]],
  [0.88, [240, 245, 255]],
  [1.0, [255, 255, 255]]
];

const ACCENT = {
  blue: [44, 107, 255],
  cyan: [90, 160, 255],
  green: [99, 245, 138],
  pink: [255, 46, 126]
};

function mix(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k)
  ];
}

function neutralRamp(lum) {
  for (let i = 1; i < RAMP.length; i++) {
    if (lum <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1];
      const [t1, c1] = RAMP[i];
      return mix(c0, c1, (lum - t0) / (t1 - t0 || 1));
    }
  }
  return RAMP[RAMP.length - 1][1];
}

function hueOf(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (!d) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

function mapColor(key, rgba) {
  const [a, r, g, b] = rgba;
  if (a === 0 && r === 0 && g === 0 && b === 0) return [0, 0, 0, 0];

  if (/backcolor$/i.test(key)) {
    const special = BACKCOLOR[[r, g, b].join(' ')];
    if (special) return [a, special[0], special[1], special[2]];
  }

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const sat = max === 0 ? 0 : (max - min) / max;

  if (sat < 0.16) {
    return [a, ...neutralRamp(lum)];
  }

  const hue = hueOf(r, g, b);
  let accent;
  if (hue >= 185 && hue < 265) accent = ACCENT.blue;
  else if (hue >= 265 && hue < 320) accent = ACCENT.pink;
  else if (hue >= 320 || hue < 25) accent = ACCENT.pink;
  else if (hue >= 25 && hue < 70) accent = ACCENT.green;
  else accent = ACCENT.cyan;

  const shift = (lum - 0.42) * 1.15;
  const out = shift >= 0
    ? mix(accent, [235, 245, 255], shift * 0.75)
    : mix(accent, [5, 8, 24], -shift * 0.7);
  return [a, ...out];
}

function processFile(file, write) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const changes = [];
  const out = lines.map((line, index) => {
    const match = COLOR_LINE.exec(line);
    if (!match) return line;
    const key = match[2];
    if (!COLOR_KEYS.test(key)) return line;
    const rgba = [parseInt(match[4], 10), parseInt(match[5], 10), parseInt(match[6], 10), parseInt(match[7], 10)];
    const mapped = mapColor(key, rgba);
    if (mapped.join(' ') === rgba.join(' ')) return line;
    changes.push({ line: index + 1, key, from: rgba.join(' '), to: mapped.join(' ') });
    return match[1] + key + match[3] + mapped.join(' ') + match[8];
  });

  if (write && changes.length) fs.writeFileSync(file, out.join('\n'));
  return changes;
}

function main(argv) {
  const dir = argv[0];
  const write = argv.includes('--write');
  if (!dir) {
    console.error('usage: node tools/mesx5-colors.js <mod-folder> [--write]');
    process.exit(1);
  }

  const files = fs.readdirSync(dir).filter((f) => /\.mnu$/i.test(f)).sort();
  const pairs = new Map();
  let total = 0;

  for (const name of files) {
    const changes = processFile(path.join(dir, name), write);
    total += changes.length;
    for (const change of changes) {
      const key = change.key + ' ' + change.from + ' -> ' + change.to;
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
  }

  [...pairs].sort((a, b) => b[1] - a[1]).forEach(([key, count]) => {
    console.log(String(count).padStart(4), key);
  });
  console.log('\n' + total + ' colour lines in ' + files.length + ' files ' + (write ? 'rewritten' : 'would change'));
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { mapColor, processFile };
