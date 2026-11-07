/*
 * Checks for the MESX5 overhaul: the new mod must round-trip byte-for-byte,
 * keep every dialog, item, text id, guide and sound of the Dark UI mod it is
 * based on, and ship decodable sprites for everything main.mnu draws.
 *
 * Run with: node tests/mesx5.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const M = require('../assets/mnu-format.js');
const Tga = require('../assets/tga.js');

const ROOT = path.join(__dirname, '..');
const NEW_DIR = path.join(ROOT, 'mesx5 ui');
const OLD_DIR = path.join(ROOT, 'true dark mode');

let checks = 0;
let failures = 0;

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

const menus = fs.readdirSync(NEW_DIR).filter((f) => /\.mnu$/i.test(f)).sort();

console.log('round-trip every .mnu file');
for (const file of menus) {
  check(file, () => {
    const original = fs.readFileSync(path.join(NEW_DIR, file), 'utf8');
    assert.strictEqual(M.serialize(M.parse(original)), original);
  });
}

/* ------------------------------------------------------------------ *
 * Parity with the mod this one is based on
 * ------------------------------------------------------------------ */

// Values a restyle is allowed to change. Everything else must match.
const MUTABLE = new Set([
  'rect', 'sprite', 'sprite1', 'sprite2', 'sprite3',
  'color', 'color1', 'color2', 'color3', 'backcolor', 'textcolor',
  'sortbackcolor', 'sortbartextcolor', 'sortbartextcolor2', 'sortbartextcolor3',
  'pullbackcolor', 'pulltextcolor1', 'pulltextcolor2',
  'pos', 'fontsize', 'align',
  'spriteposx', 'spriteposy', 'spritesizex', 'spritesizey',
  'switchsize', 'spacing', 'sort', 'sortbar', 'sortbarheight'
]);

function skeleton(item, depth) {
  const rows = [];
  for (const child of M.children(item)) {
    if (MUTABLE.has(child.key)) continue;
    if (child.children) {
      rows.push('>'.repeat(depth) + child.key + '{');
      rows.push(...skeleton(child, depth + 1));
    } else {
      rows.push('>'.repeat(depth) + child.key + '=' + child.value);
    }
  }
  return rows;
}

function compareMenus(file) {
  const oldText = fs.readFileSync(path.join(OLD_DIR, file), 'utf8');
  const newText = fs.readFileSync(path.join(NEW_DIR, file), 'utf8');
  const oldDialogs = M.dialogsOf(M.parse(oldText));
  const newDialogs = M.dialogsOf(M.parse(newText));

  assert.strictEqual(newDialogs.length, oldDialogs.length, file + ': dialog count');
  oldDialogs.forEach((oldDialog, dialogIndex) => {
    const newDialog = newDialogs[dialogIndex];
    const label = file + ' › ' + M.dialogName(oldDialog);
    assert.strictEqual(M.dialogName(newDialog), M.dialogName(oldDialog), label + ': dialog name');
    const oldItems = M.itemsOf(oldDialog);
    const newItems = M.itemsOf(newDialog);
    assert.strictEqual(newItems.length, oldItems.length, label + ': item count');
    oldItems.forEach((oldItem, itemIndex) => {
      const newItem = newItems[itemIndex];
      const itemLabel = label + ' › ' + M.itemName(oldItem);
      assert.strictEqual(newItem.key, oldItem.key, itemLabel + ': item type');
      assert.strictEqual(M.itemName(newItem), M.itemName(oldItem), itemLabel + ': item name');
      assert.deepStrictEqual(skeleton(newItem, 0), skeleton(oldItem, 0), itemLabel + ': non-visual values');
    });
  });
}

console.log('keeps every dialog, item, text id and sound');
for (const file of menus) {
  check(file, () => compareMenus(file));
}

/* ------------------------------------------------------------------ *
 * Sprites
 * ------------------------------------------------------------------ */

function spriteNames(file) {
  const text = fs.readFileSync(file, 'utf8');
  const names = new Set();
  for (const match of text.matchAll(/^\s*(?:sprite\d?|shadow)\s+(\S+)\s*$/gm)) names.add(match[1]);
  return names;
}

function findSprite(name) {
  const candidates = [
    path.join(NEW_DIR, name),
    path.join(NEW_DIR, name.replace(/\.tga$/i, '.TGA')),
    path.join(OLD_DIR, name),
    path.join(OLD_DIR, name.replace(/\.tga$/i, '.TGA'))
  ];
  return candidates.find((file) => fs.existsSync(file)) || null;
}

console.log('sprites');
check('main.mnu draws only sprites this mod ships', () => {
  const missing = [...spriteNames(path.join(NEW_DIR, 'main.mnu'))].filter((name) => !findSprite(name));
  assert.deepStrictEqual(missing, [], 'missing: ' + missing.join(', '));
});

// A strict reader for the stream a game's TGA loader will actually walk:
// uncompressed images must be exactly sized, RLE packets must not cross a
// scanline, and nothing may be left over. Our decoder is lenient, so this is
// the check that keeps a malformed sprite from reaching the game.
function checkStream(buffer, name) {
  const width = buffer.readUInt16LE(12);
  const height = buffer.readUInt16LE(14);
  const bpp = buffer[16];
  const type = buffer[2];
  const descriptor = buffer[17];
  const bytesPerPixel = bpp / 8;
  const pixels = width * height;

  assert(bpp === 24 || bpp === 32, name + ': unsupported depth ' + bpp);
  assert.strictEqual(descriptor & 0x20, 0, name + ': expected bottom-up rows');
  assert.strictEqual(descriptor & 0x0f, bpp === 32 ? 8 : 0, name + ': attribute bits');

  if (type === 2) {
    assert.strictEqual(buffer.length, 18 + pixels * bytesPerPixel, name + ': uncompressed size');
    return;
  }
  assert.strictEqual(type, 10, name + ': unexpected image type ' + type);

  let pos = 18;
  let pixel = 0;
  while (pixel < pixels) {
    assert(pos < buffer.length, name + ': stream ends at pixel ' + pixel);
    const packet = buffer[pos++];
    const count = (packet & 0x7f) + 1;
    assert(count <= width - (pixel % width), name + ': packet crosses a scanline at pixel ' + pixel);
    if (packet & 0x80) {
      assert(pos + bytesPerPixel <= buffer.length, name + ': truncated run at pixel ' + pixel);
      pos += bytesPerPixel;
    } else {
      const need = count * bytesPerPixel;
      assert(pos + need <= buffer.length, name + ': truncated raw packet at pixel ' + pixel + ' (' + (buffer.length - pos) + ' of ' + need + ' bytes)');
      pos += need;
    }
    pixel += count;
  }
  assert.strictEqual(pos, buffer.length, name + ': ' + (buffer.length - pos) + ' trailing bytes');
}

check('every shipped TGA decodes and has a strict, row-safe stream', () => {
  const files = fs.readdirSync(NEW_DIR).filter((f) => /\.tga$/i.test(f));
  assert(files.length > 150, 'expected the full chrome set, found ' + files.length + ' sprites');
  for (const name of files) {
    const buffer = fs.readFileSync(path.join(NEW_DIR, name));
    const image = Tga.decode(buffer);
    assert(image.width > 0 && image.height > 0, name + ': no pixels');

    // Files copied byte-for-byte from the Dark UI mod are original artwork the
    // game already loads; their legacy encoder pads a few bytes after the
    // image, so they are only checked by decoding.
    const oldFile = path.join(OLD_DIR, name);
    if (fs.existsSync(oldFile) && fs.readFileSync(oldFile).equals(buffer)) continue;

    checkStream(buffer, name);
  }
});

check('replaced sprites keep the original pixel size', () => {
  for (const name of fs.readdirSync(NEW_DIR).filter((f) => /\.tga$/i.test(f))) {
    const oldFile = path.join(OLD_DIR, name);
    if (!fs.existsSync(oldFile)) continue;
    const before = Tga.decode(fs.readFileSync(oldFile));
    const after = Tga.decode(fs.readFileSync(path.join(NEW_DIR, name)));
    assert.strictEqual(after.width, before.width, name + ': width');
    assert.strictEqual(after.height, before.height, name + ': height');
  }
});

check('wallpapers match the Dark UI size and are opaque', () => {
  for (const name of ['bkgrnd.tga', 'splash.tga']) {
    const before = Tga.decode(fs.readFileSync(path.join(OLD_DIR, name)));
    const image = Tga.decode(fs.readFileSync(path.join(NEW_DIR, name)));
    assert.strictEqual(image.width, before.width, name + ': width');
    assert.strictEqual(image.height, before.height, name + ': height');
    for (let i = 3; i < image.rgba.length; i += 4) {
      if (image.rgba[i] !== 255) throw new Error(name + ': alpha at byte ' + i);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Main menu layout
 * ------------------------------------------------------------------ */

console.log('main menu layout');
check('hub tiles stay inside the screen and do not overlap', () => {
  const root = M.parse(fs.readFileSync(path.join(NEW_DIR, 'main.mnu'), 'utf8'));
  const dialog = M.dialogsOf(root).find((d) => M.dialogName(d) === 'main_menu');
  const skip = new Set(['ID_DARKBOX', 'ID_BITMAP', 'ID_HOME', 'ID_ERROR']);
  const boxes = M.itemsOf(dialog)
    .filter((item) => !skip.has(M.itemName(item)))
    .map((item) => {
      const rect = M.parseRect(M.primaryRect(item).node);
      assert(rect, M.itemName(item) + ': no rect');
      rect.forEach((value) => {
        assert(value >= 0 && value <= 1, M.itemName(item) + ': rect outside 0-1 (' + rect.join(' ') + ')');
      });
      return { name: M.itemName(item), box: M.rectToPixels(rect, 1600, 900) };
    });

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].box;
      const b = boxes[j].box;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert(!overlap, boxes[i].name + ' overlaps ' + boxes[j].name);
    }
  }
});

console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
