/*
 * MNU script format: parser, serializer and rect helpers.
 *
 * The .mnu files are a simple brace-delimited block format:
 *
 *   dialog
 *   {
 *       name main_menu
 *       item_button
 *       {
 *           name id_exit
 *           button
 *           {
 *               rect 0.000000 0.788889 0.243750 0.833333
 *           }
 *       }
 *   }
 *
 * Every line is either `key`, `key value` or a brace. Unknown keys are kept
 * verbatim so a file can be parsed and written back byte-for-byte.
 *
 * Usable from the browser (window.MnuFormat) and from Node (require()).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MnuFormat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Parsing
   * ------------------------------------------------------------------ */

  function blankNode(parent) {
    return { key: '', value: '', children: null, blank: true, parent: parent };
  }

  function parse(text) {
    var rootNode = { key: '', value: null, children: [], blank: false, parent: null };
    var lines = String(text).split('\n');
    var stack = [rootNode];

    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      var current = stack[stack.length - 1];

      if (trimmed === '') {
        current.children.push(blankNode(current));
        continue;
      }
      if (trimmed === '{') {
        var previous = current.children.length
          ? current.children[current.children.length - 1]
          : null;
        if (!previous || previous.blank) {
          // Stray brace with nothing to attach to: keep it out of the tree.
          continue;
        }
        previous.children = [];
        stack.push(previous);
        continue;
      }
      if (trimmed === '}') {
        if (stack.length > 1) stack.pop();
        continue;
      }

      var split = trimmed.search(/[ \t]/);
      var key = split < 0 ? trimmed : trimmed.slice(0, split);
      var value = split < 0 ? '' : trimmed.slice(split + 1).trim();
      current.children.push({ key: key, value: value, children: null, blank: false, parent: current });
    }

    return rootNode;
  }

  function serialize(rootNode) {
    var out = [];

    function walk(node, depth) {
      var prefix = '';
      for (var d = 0; d < depth; d++) prefix += '\t';
      for (var i = 0; i < node.children.length; i++) {
        var child = node.children[i];
        if (child.blank) {
          out.push('');
          continue;
        }
        out.push(child.value === '' || child.value === null || child.value === undefined
          ? prefix + child.key
          : prefix + child.key + ' ' + child.value);
        if (child.children) {
          out.push(prefix + '{');
          walk(child, depth + 1);
          out.push(prefix + '}');
        }
      }
    }

    walk(rootNode, 0);
    return out.join('\n');
  }

  /* ------------------------------------------------------------------ *
   * Tree helpers
   * ------------------------------------------------------------------ */

  function children(node) {
    return node && node.children ? node.children.filter(function (c) { return !c.blank; }) : [];
  }

  function child(node, key) {
    var list = children(node);
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) return list[i];
    }
    return null;
  }

  function childValue(node, key, fallback) {
    var found = child(node, key);
    if (!found || found.value === '') return fallback === undefined ? null : fallback;
    return found.value;
  }

  function childNumber(node, key, fallback) {
    var raw = childValue(node, key);
    if (raw === null) return fallback === undefined ? null : fallback;
    var num = parseFloat(raw);
    return isNaN(num) ? fallback : num;
  }

  function setChildValue(node, key, value) {
    var found = child(node, key);
    if (found) {
      found.value = String(value);
      return found;
    }
    var created = { key: key, value: String(value), children: null, blank: false, parent: node };
    node.children.push(created);
    return created;
  }

  function isItem(node) {
    return !!node && /^item_/.test(node.key);
  }

  function itemsOf(dialog) {
    return children(dialog).filter(isItem);
  }

  function dialogsOf(rootNode) {
    return children(rootNode).filter(function (n) { return n.key === 'dialog'; });
  }

  function dialogName(dialog) {
    return childValue(dialog, 'name', '(unnamed dialog)');
  }

  function itemName(item) {
    return childValue(item, 'name', '(unnamed ' + item.key.replace(/^item_/, '') + ')');
  }

  /* ------------------------------------------------------------------ *
   * Rect values  (stored normalised: X1 Y1 X2 Y2, 0..1 of the UI surface)
   * ------------------------------------------------------------------ */

  // Every `rect` in an item's subtree, with a readable path label such as
  // "rect", "button.rect", "slider.rect" or "button1.rect".
  function rectsOf(item) {
    var found = [];

    function walk(node, path) {
      var list = children(node);
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        var label = path ? path + '.' + c.key : c.key;
        if (c.key === 'rect' && !c.children) {
          found.push({ node: c, path: label, owner: node });
        } else if (c.children) {
          walk(c, label);
        }
      }
    }

    walk(item, '');
    return found;
  }

  function parseRect(node) {
    if (!node || !node.value) return null;
    var parts = node.value.trim().split(/\s+/).map(parseFloat);
    if (parts.length < 4 || parts.some(isNaN)) return null;
    return parts.slice(0, 4);
  }

  // The rect that sizes the item itself: the item's own rect when it has one,
  // otherwise the first rect of its first child block (slider/list/button...).
  function primaryRect(item) {
    var all = rectsOf(item);
    for (var i = 0; i < all.length; i++) {
      if (all[i].path === 'rect') return all[i];
    }
    return all.length ? all[0] : null;
  }

  /* ------------------------------------------------------------------ *
   * Normalised <-> pixel conversion
   *
   *   X      = round(X1 * W)
   *   Y      = round(Y1 * H)
   *   Width  = round(X2 * W) - X
   *   Height = round(Y2 * H) - Y
   * ------------------------------------------------------------------ */

  function rectToPixels(rect, width, height) {
    var x1 = Math.round(rect[0] * width);
    var y1 = Math.round(rect[1] * height);
    var x2 = Math.round(rect[2] * width);
    var y2 = Math.round(rect[3] * height);
    return { x: x1, y: y1, x2: x2, y2: y2, w: x2 - x1, h: y2 - y1 };
  }

  function pixelsToRect(box, width, height) {
    return [box.x / width, box.y / height, (box.x + box.w) / width, (box.y + box.h) / height];
  }

  // Six decimals is what the game's own tools write.
  function formatFloat(value) {
    var num = Number(value);
    if (!isFinite(num)) return '0.000000';
    if (Object.is(num, -0)) num = 0;
    return num.toFixed(6);
  }

  function formatRect(rect) {
    return rect.map(formatFloat).join(' ');
  }

  // Write pixel values back into a rect node. Snaps to whole pixels and keeps
  // X1 <= X2 / Y1 <= Y2 so the game never sees an inverted rectangle.
  function writeRectPixels(rectNode, box, width, height) {
    var x = Math.round(box.x);
    var y = Math.round(box.y);
    var w = Math.round(box.w);
    var h = Math.round(box.h);
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    rectNode.value = formatRect(pixelsToRect({ x: x, y: y, w: w, h: h }, width, height));
    return { x: x, y: y, w: w, h: h };
  }

  function writeRectValues(rectNode, rect) {
    rectNode.value = formatRect(rect);
  }

  /* ------------------------------------------------------------------ *
   * Small value parsers used by the inspector and the renderer
   * ------------------------------------------------------------------ */

  function parseColor(value) {
    if (typeof value !== 'string') return null;
    var parts = value.trim().split(/\s+/);
    if (parts.length !== 4) return null;
    var nums = parts.map(function (p) { return parseInt(p, 10); });
    if (nums.some(function (n) { return isNaN(n); })) return null;
    return { a: nums[0], r: nums[1], g: nums[2], b: nums[3] };
  }

  function parseNumberList(value) {
    if (typeof value !== 'string') return null;
    var parts = value.trim().split(/\s+/);
    if (!parts.length) return null;
    var nums = parts.map(parseFloat);
    return nums.some(isNaN) ? null : nums;
  }

  // "ratio 16:9"
  function parseRatio(text) {
    var match = /^\s*ratio\s+(\d+)\s*:\s*(\d+)/m.exec(String(text));
    if (!match) return null;
    return { w: parseInt(match[1], 10), h: parseInt(match[2], 10) };
  }

  function ratioToBase(ratio) {
    // Pick the smallest "standard" resolution for the ratio; 16:9 -> 1600x900
    // is what the UI was authored against.
    var presets = [
      [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160],
      [1280, 720], [1024, 768], [1280, 1024], [1680, 1050], [3440, 1440]
    ];
    var target = ratio.w / ratio.h;
    for (var i = 0; i < presets.length; i++) {
      if (Math.abs(presets[i][0] / presets[i][1] - target) < 0.001) {
        return { w: presets[i][0], h: presets[i][1] };
      }
    }
    var h = 900;
    return { w: Math.round(h * target), h: h };
  }

  return {
    parse: parse,
    serialize: serialize,
    children: children,
    child: child,
    childValue: childValue,
    childNumber: childNumber,
    setChildValue: setChildValue,
    isItem: isItem,
    itemsOf: itemsOf,
    dialogsOf: dialogsOf,
    dialogName: dialogName,
    itemName: itemName,
    rectsOf: rectsOf,
    parseRect: parseRect,
    primaryRect: primaryRect,
    rectToPixels: rectToPixels,
    pixelsToRect: pixelsToRect,
    writeRectPixels: writeRectPixels,
    writeRectValues: writeRectValues,
    formatFloat: formatFloat,
    formatRect: formatRect,
    parseColor: parseColor,
    parseNumberList: parseNumberList,
    parseRatio: parseRatio,
    ratioToBase: ratioToBase
  };
});
