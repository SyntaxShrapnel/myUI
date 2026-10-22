/*
 * Checks assets/tga.js against pixel values decoded independently with Python.
 * Run with: node tests/tga.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Tga = require('../assets/tga.js');

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

// Reference pixels produced by an independent Python decoder.
const fixtures = {
  'arrow_lf1.tga': {
    width: 32, height: 32,
    samples: [[16, 16, [163, 163, 163, 255]], [0, 0, [163, 163, 163, 0]], [10, 8, [163, 163, 163, 0]]]
  },
  'main3.tga': {
    width: 340, height: 40,
    samples: [[0, 0, [90, 90, 90, 255]], [170, 20, [90, 90, 90, 255]], [339, 39, [90, 90, 90, 255]]]
  },
  'dialog600x200.tga': {
    width: 600, height: 200,
    samples: [[300, 100, [37, 37, 37, 240]], [0, 0, [37, 37, 37, 0]], [599, 199, [37, 37, 37, 0]]]
  },
  'tyre.tga': {
    width: 512, height: 512,
    samples: [[170, 128, [255, 255, 255, 88]], [256, 256, [0, 0, 0, 0]]]
  },
  'bkgrnd.tga': {
    width: 3840, height: 2160,
    samples: [[0, 0, [74, 44, 48, 255]], [1920, 1080, [168, 163, 153, 255]], [3839, 2159, [59, 40, 17, 255]]]
  }
};

for (const file of Object.keys(fixtures)) {
  check(file, () => {
    const expected = fixtures[file];
    const image = Tga.decode(fs.readFileSync(path.join(MOD_DIR, file)));
    assert.strictEqual(image.width, expected.width);
    assert.strictEqual(image.height, expected.height);
    assert.strictEqual(image.rgba.length, expected.width * expected.height * 4);
    for (const [x, y, rgba] of expected.samples) {
      const offset = (y * expected.width + x) * 4;
      const actual = Array.from(image.rgba.slice(offset, offset + 4));
      assert.deepStrictEqual(actual, rgba, 'pixel ' + x + ',' + y);
    }
  });
}

check('decodes every .tga in the mod', () => {
  const files = fs.readdirSync(MOD_DIR).filter((f) => /\.tga$/i.test(f));
  assert(files.length > 50, 'expected the mod to ship many sprites, found ' + files.length);
  let decoded = 0;
  for (const file of files) {
    const image = Tga.decode(fs.readFileSync(path.join(MOD_DIR, file)));
    assert(image.width > 0 && image.height > 0, file + ' has no size');
    decoded++;
  }
  assert.strictEqual(decoded, files.length);
});

check('rejects non-image data', () => {
  assert.throws(() => Tga.decode(new Uint8Array(4)), /not a TGA file/);
});

console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
