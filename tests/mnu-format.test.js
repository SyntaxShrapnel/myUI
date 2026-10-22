/*
 * Round-trip + rect maths checks for assets/mnu-format.js.
 * Run with: node tests/mnu-format.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const M = require('../assets/mnu-format.js');

const MOD_DIR = path.join(__dirname, '..', 'true dark mode');
let failures = 0;
let checks = 0;

function check(name, fn) {
  checks++;
  try {
    fn();
    console.log('  ok   ' + name);
  } catch (err) {
    failures++;
    console.log('  FAIL ' + name + '\n       ' + err.message.split('\n').join('\n       '));
  }
}

console.log('round-trip every .mnu file');
const files = fs.readdirSync(MOD_DIR).filter((f) => f.toLowerCase().endsWith('.mnu')).sort();
assert(files.length > 0, 'no .mnu files found in ' + MOD_DIR);

for (const file of files) {
  check(file, () => {
    const original = fs.readFileSync(path.join(MOD_DIR, file), 'utf8');
    const rewritten = M.serialize(M.parse(original));
    if (rewritten !== original) {
      // Point at the first differing line to keep the failure readable.
      const a = original.split('\n');
      const b = rewritten.split('\n');
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
          throw new Error(
            'line ' + (i + 1) + ' differs\n  original: ' + JSON.stringify(a[i]) +
            '\n  rewritten: ' + JSON.stringify(b[i])
          );
        }
      }
      throw new Error('output differs but no differing line found (length mismatch)');
    }
  });
}

console.log('structure');
check('parses dialogs and items', () => {
  const root = M.parse(fs.readFileSync(path.join(MOD_DIR, 'main.mnu'), 'utf8'));
  const dialogs = M.dialogsOf(root);
  assert.deepStrictEqual(dialogs.map(M.dialogName), ['main_menu', 'exit_confirm', 'IDD_SPLASH', 'idd_home', 'idd_viewer', 'idd_background', 'idd_corruptedpaints']);
  const main = M.itemsOf(dialogs[0]);
  assert.strictEqual(main.length, 12);
  assert.strictEqual(main[0].key, 'item_darkbox');
  assert.strictEqual(M.itemName(main[0]), 'ID_DARKBOX');
});

const graphicOptions = (() => {
  const root = M.parse(fs.readFileSync(path.join(MOD_DIR, 'options.mnu'), 'utf8'));
  return M.dialogsOf(root).find((d) => M.dialogName(d) === 'idd_graphic_options');
})();

check('lists every rect of a spin item', () => {
  const spin = M.itemsOf(graphicOptions).find((n) => M.itemName(n) === 'id_resolution');
  assert(spin, 'id_resolution not found');
  assert.deepStrictEqual(M.rectsOf(spin).map((r) => r.path), ['rect', 'spin.button1.rect', 'spin.button2.rect']);
});

check('primary rect falls back to the child block (slider)', () => {
  const slider = M.itemsOf(graphicOptions).find((n) => M.itemName(n) === 'id_texturesize');
  const primary = M.primaryRect(slider);
  assert.strictEqual(primary.path, 'slider.rect');
  assert.deepStrictEqual(M.parseRect(primary.node), [0.01875, 0.522222, 0.20625, 0.544444]);
});

console.log('rect maths');
const W = 1600;
const H = 900;

check('formula matches the reference values', () => {
  const rect = [0, 0.2, 0.24375, 0.866667];
  const px = M.rectToPixels(rect, W, H);
  assert.deepStrictEqual(px, { x: 0, y: 180, x2: 390, y2: 780, w: 390, h: 600 });
});

check('pixel -> normalised -> pixel is stable', () => {
  for (const box of [
    { x: 0, y: 0, w: 1600, h: 900 },
    { x: 1, y: 2, w: 3, h: 4 },
    { x: 511, y: 233, w: 97, h: 41 },
    { x: 1599, y: 899, w: 1, h: 1 },
    { x: 123, y: 456, w: 789, h: 321 }
  ]) {
    const rect = M.pixelsToRect(box, W, H);
    const back = M.rectToPixels(rect, W, H);
    assert.deepStrictEqual(
      { x: back.x, y: back.y, w: back.w, h: back.h },
      box,
      'box ' + JSON.stringify(box) + ' -> ' + rect.join(' ') + ' -> ' + JSON.stringify(back)
    );
  }
});

check('writeRectPixels writes six decimals and keeps order', () => {
  const root = M.parse('dialog\n{\n\titem_bitmap\n\t{\n\t\trect 0.1 0.1 0.2 0.2\n\t}\n}\n');
  const rectNode = M.primaryRect(M.itemsOf(M.dialogsOf(root)[0])[0]).node;
  M.writeRectPixels(rectNode, { x: 300, y: 100, w: -50, h: 20 }, W, H);
  assert.strictEqual(rectNode.value, '0.156250 0.111111 0.187500 0.133333');
  const px = M.rectToPixels(M.parseRect(rectNode), W, H);
  assert.deepStrictEqual({ x: px.x, y: px.y, w: px.w, h: px.h }, { x: 250, y: 100, w: 50, h: 20 });
});

check('ratio and base resolution', () => {
  const ui = fs.readFileSync(path.join(MOD_DIR, 'ui.ui'), 'utf8');
  assert.deepStrictEqual(M.parseRatio(ui), { w: 16, h: 9 });
  assert.deepStrictEqual(M.ratioToBase({ w: 16, h: 9 }), { w: 1600, h: 900 });
  assert.deepStrictEqual(M.ratioToBase({ w: 4, h: 3 }), { w: 1024, h: 768 });
  assert.deepStrictEqual(M.ratioToBase({ w: 21, h: 9 }), { w: 2100, h: 900 });
});

check('colors', () => {
  assert.deepStrictEqual(M.parseColor('255 240 240 240'), { a: 255, r: 240, g: 240, b: 240 });
  assert.strictEqual(M.parseColor('main2.tga'), null);
  assert.strictEqual(M.parseColor('0 0 0'), null);
});

check('editing one value only touches that line', () => {
  const original = fs.readFileSync(path.join(MOD_DIR, 'main.mnu'), 'utf8');
  const root = M.parse(original);
  const item = M.itemsOf(M.dialogsOf(root)[0]).find((n) => M.itemName(n) === 'ID_HOME');
  M.writeRectPixels(M.primaryRect(item).node, { x: 0, y: 700, w: 30, h: 30 }, W, H);
  const out = M.serialize(root).split('\n');
  const before = original.split('\n');
  assert.strictEqual(out.length, before.length);
  const diffs = out.map((line, i) => (line !== before[i] ? i : -1)).filter((i) => i >= 0);
  assert.strictEqual(diffs.length, 1, 'expected exactly one changed line, got ' + diffs.length);
  assert(out[diffs[0]].includes('rect 0.000000 0.777778 0.018750 0.811111'), out[diffs[0]]);
});

console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
