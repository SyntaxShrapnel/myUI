/*
 * Main menu layout for the MESX5 overhaul.
 *
 *   node tools/mesx5-layout.js
 *
 * Rewrites only the rect / sprite / text-size values of the named main_menu
 * items, through the editor's own parser, so every other line of main.mnu is
 * written back untouched. Item names, text ids, guides and sounds are kept, so
 * the game's bindings and all controls keep working.
 *
 * Coordinates are pixels on the UI's 1600 x 900 base; the tool converts them
 * to the 0-1 rect floats the game stores.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const M = require('../assets/mnu-format.js');

const FILE = path.join(__dirname, '..', 'mesx5 ui', 'main.mnu');
const BASE = { w: 1600, h: 900 };

// MESX5 hub: exit chip + logo in the header band, a three-column tile grid with
// one hero tile, and a wide settings tile under it.
const LAYOUT = {
  ID_DARKBOX: { box: { x: 0, y: 0, w: 1600, h: 76 }, color: '220 7 11 30' },

  id_exit: {
    box: { x: 36, y: 16, w: 150, h: 44 },
    sprite2: 'mesx_tile_exit_2.tga',
    sprite3: 'mesx_tile_exit_3.tga',
    text: { pos: [22, 10], fontsize: 24, align: 'left' },
    colors: ['255 238 243 255', '255 255 255 255', '255 255 255 255']
  },

  ID_BIKE: {
    box: { x: 36, y: 100, w: 430, h: 180 },
    sprite2: 'mesx_tile_l_2.tga',
    sprite3: 'mesx_tile_l_3.tga',
    text: { pos: [24, 69], fontsize: 41, align: 'left' }
  },
  id_profiles: {
    box: { x: 36, y: 296, w: 430, h: 108 },
    sprite2: 'mesx_tile_m_2.tga',
    sprite3: 'mesx_tile_m_3.tga',
    text: { pos: [24, 36], fontsize: 35, align: 'left' }
  },
  ID_BESTLAPS: {
    box: { x: 36, y: 420, w: 430, h: 108 },
    sprite2: 'mesx_tile_m_2.tga',
    sprite3: 'mesx_tile_m_3.tga',
    text: { pos: [24, 36], fontsize: 35, align: 'left' }
  },

  ID_MULTIPLAYER: {
    box: { x: 482, y: 100, w: 524, h: 428 },
    sprite2: 'mesx_tile_hero_2.tga',
    sprite3: 'mesx_tile_hero_3.tga',
    text: { pos: [45, 40], fontsize: 56, align: 'left' }
  },
  id_settings: {
    box: { x: 482, y: 544, w: 524, h: 108 },
    sprite2: 'mesx_tile_wide_2.tga',
    sprite3: 'mesx_tile_wide_3.tga',
    text: { pos: [24, 36], fontsize: 35, align: 'left' }
  },

  // The single-player entry is textid Single_race on the item named id_testing.
  id_testing: {
    box: { x: 1026, y: 100, w: 534, h: 180 },
    sprite2: 'mesx_tile_r_2.tga',
    sprite3: 'mesx_tile_r_3.tga',
    text: { pos: [24, 69], fontsize: 41, align: 'left' }
  },
  id_viewreplays: {
    box: { x: 1026, y: 296, w: 534, h: 108 },
    sprite2: 'mesx_tile_s_2.tga',
    sprite3: 'mesx_tile_s_3.tga',
    text: { pos: [24, 36], fontsize: 35, align: 'left' }
  },

  ID_BITMAP: { box: { x: 1324, y: 8, w: 240, h: 60 } },
  ID_HOME: { box: { x: 36, y: 828, w: 32, h: 32 } },
  ID_ERROR: {
    box: { x: 80, y: 828, w: 30, h: 30 },
    colors: ['255 238 243 255', '255 255 255 255', '255 255 46 126']
  }
};

function apply(text) {
  const root = M.parse(text);
  const dialog = M.dialogsOf(root).find((d) => M.dialogName(d) === 'main_menu');
  if (!dialog) throw new Error('main_menu dialog not found');

  const seen = new Set();
  for (const item of M.itemsOf(dialog)) {
    const name = M.itemName(item);
    const layout = LAYOUT[name];
    if (!layout) continue;
    seen.add(name);

    if (layout.box) {
      const primary = M.primaryRect(item);
      if (!primary) throw new Error(name + ' has no rect');
      M.writeRectValues(primary.node, M.pixelsToRect(layout.box, BASE.w, BASE.h));
    }

    if (layout.sprite2 || layout.sprite3) {
      const block = M.child(item, 'button') || M.child(item, 'bitmap') || item;
      if (layout.sprite2) M.setChildValue(block, 'sprite2', layout.sprite2);
      if (layout.sprite3) M.setChildValue(block, 'sprite3', layout.sprite3);
    }

    if (layout.text) {
      const textBlock = M.child(item, 'text');
      if (!textBlock) throw new Error(name + ' has no text block');
      const { pos, fontsize, align } = layout.text;
      M.setChildValue(textBlock, 'pos', M.formatFloat(pos[0] / BASE.w) + ' ' + M.formatFloat(pos[1] / BASE.h));
      M.setChildValue(textBlock, 'fontsize', M.formatFloat(fontsize / BASE.h));
      M.setChildValue(textBlock, 'align', align);
    }

    if (layout.color && M.child(item, 'color')) {
      M.setChildValue(item, 'color', layout.color);
    }

    if (layout.colors) {
      ['color1', 'color2', 'color3'].forEach((key, index) => {
        if (M.child(item, key)) M.setChildValue(item, key, layout.colors[index]);
      });
    }
  }

  const missing = Object.keys(LAYOUT).filter((name) => !seen.has(name));
  if (missing.length) throw new Error('items not found: ' + missing.join(', '));
  return M.serialize(root);
}

function main() {
  const original = fs.readFileSync(FILE, 'utf8');
  const next = apply(original);
  fs.writeFileSync(FILE, next);
  const before = original.split('\n');
  const after = next.split('\n');
  const changed = after.filter((line, i) => line !== before[i]).length;
  console.log('main.mnu: ' + changed + ' of ' + after.length + ' lines updated');
}

module.exports = { apply };
if (require.main === module) main();
