/*
 * MX Bikes MNU editor.
 *
 * Loads the mod's .mnu dialog scripts (plus ui.ui, english.str and the .tga
 * sprites), previews a dialog at the UI's aspect ratio and writes changes back
 * to the same lines in the file.
 */
(function () {
  'use strict';

  var M = window.MnuFormat;

  // Folder inside this repo holding the mod. Used for the automatic load when
  // the page is served over HTTP (a file:// page cannot fetch it).
  var MOD_DIR = 'true dark mode/';

  var PRESETS = [
    [1280, 720], [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160],
    [1024, 768], [1280, 1024], [1680, 1050], [2560, 1080], [3440, 1440],
    [800, 600], [1920, 1200]
  ];

  var UI_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  var HANDLE_ORDER = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'];
  var HANDLE_CURSOR = {
    nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize'
  };

  var state = {
    docs: [],
    activeDoc: -1,
    dialogIndex: -1,
    itemIndex: -1,
    ratio: { w: 16, h: 9 },
    base: { w: 1600, h: 900 },
    strings: new Map(),
    search: '',
    showGrid: false,
    showLabels: false,
    showSprites: true,
    openDocs: new Set(),
    openDialogs: new Set(),
    bundledAvailable: false,
    hoverItem: -1
  };

  var view = { scale: 1, cssW: 0, cssH: 0, baseToCss: 1 };
  var drag = null;

  var els = {};
  [
    'btn-folder', 'btn-files', 'btn-undo', 'btn-redo', 'btn-save', 'btn-save-all',
    'btn-help', 'ratio-label', 'base-select', 'search', 'tree', 'btn-expand',
    'btn-collapse', 'stage', 'canvas', 'stage-empty', 'stage-info', 'opt-grid',
    'opt-labels', 'opt-sprites', 'btn-source', 'inspector', 'status', 'cursor',
    'file-input', 'dir-input', 'help-dialog', 'source-dialog', 'source-title',
    'source-text', 'source-note', 'btn-copy-source', 'btn-close-source'
  ].forEach(function (id) {
    els[id.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); })] = document.getElementById(id);
  });

  /* ================================================================== *
   * Small helpers
   * ================================================================== */

  function W() { return state.base.w; }
  function H() { return state.base.h; }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function setStatus(message) {
    els.status.textContent = message;
  }

  function activeDoc() {
    return state.activeDoc >= 0 ? state.docs[state.activeDoc] : null;
  }

  function activeDialog() {
    var doc = activeDoc();
    if (!doc) return null;
    return doc.dialogs[state.dialogIndex] || null;
  }

  function activeItem() {
    var dialog = activeDialog();
    if (!dialog) return null;
    return M.itemsOf(dialog)[state.itemIndex] || null;
  }

  function cssColor(color) {
    return 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',' +
      Math.max(0, Math.min(1, color.a / 255)).toFixed(3) + ')';
  }

  function rectBox(rectNode) {
    var rect = M.parseRect(rectNode);
    return rect ? M.rectToPixels(rect, W(), H()) : null;
  }

  function resolveString(id) {
    if (!id) return null;
    return state.strings.get(String(id).toLowerCase()) || null;
  }

  function resolveItemText(node) {
    var id = M.childValue(node, 'textid');
    if (!id) return null;
    return resolveString(id) || id;
  }

  /* ================================================================== *
   * Sprites and strings
   * ================================================================== */

  var assetLoaders = new Map();   // lowercase file name -> () => Promise<ArrayBuffer>
  var spriteCache = new Map();    // lowercase file name -> canvas | null
  var spritePending = new Set();

  function registerAsset(name, loader) {
    assetLoaders.set(String(name).toLowerCase(), loader);
  }

  async function fetchAsset(name) {
    var candidates = [name];
    if (/\.tga$/i.test(name)) candidates.push(name.replace(/\.tga$/i, '.TGA'));
    candidates.push(String(name).toLowerCase());
    for (var i = 0; i < candidates.length; i++) {
      try {
        var res = await fetch(encodeURI(MOD_DIR + candidates[i]));
        if (res.ok) return await res.arrayBuffer();
      } catch (err) { /* try the next spelling */ }
    }
    throw new Error('missing sprite: ' + name);
  }

  // Returns the decoded sprite immediately when it is available, otherwise
  // starts loading it and repaints once it arrives.
  function requestSprite(name) {
    var key = String(name || '').toLowerCase();
    if (!key) return null;
    if (spriteCache.has(key)) return spriteCache.get(key);
    if (spritePending.has(key)) return null;

    var loader = assetLoaders.get(key);
    if (!loader && state.bundledAvailable) loader = function () { return fetchAsset(name); };
    if (!loader) {
      spriteCache.set(key, null);
      return null;
    }

    spritePending.add(key);
    Promise.resolve()
      .then(loader)
      .then(function (buffer) {
        var canvas = null;
        try {
          canvas = window.Tga.toCanvas(new Uint8Array(buffer));
        } catch (err) {
          canvas = null;
        }
        spriteCache.set(key, canvas);
      })
      .catch(function () {
        spriteCache.set(key, null);
      })
      .then(function () {
        spritePending.delete(key);
        renderCanvas();
        refreshValueExtras();
      });
    return null;
  }

  function loadStrings(text) {
    state.strings.clear();
    var lines = String(text).split(/\r?\n/);
    for (var i = 0; i + 1 < lines.length; i += 2) {
      var id = lines[i].trim();
      var value = lines[i + 1].trim();
      if (id) state.strings.set(id.toLowerCase(), value);
    }
  }

  /* ================================================================== *
   * Documents
   * ================================================================== */

  function createDoc(name, text, options) {
    options = options || {};
    var root = M.parse(text);
    return {
      name: name,
      root: root,
      text: text,
      dialogs: M.dialogsOf(root),
      dirty: false,
      undo: [],
      redo: [],
      handle: options.handle || null,
      source: options.source || 'file'
    };
  }

  function addDocs(docs) {
    if (!docs.length) return;
    docs.forEach(function (doc) {
      var existing = state.docs.findIndex(function (d) { return d.name === doc.name && d.source === doc.source; });
      if (existing >= 0) state.docs.splice(existing, 1, doc);
      else state.docs.push(doc);
    });

    var first = docs[0];
    state.activeDoc = state.docs.indexOf(first);
    state.dialogIndex = 0;
    state.itemIndex = -1;
    state.openDocs.add(docKey(first));
    var dialog = first.dialogs[0];
    if (dialog) state.openDialogs.add(dialogKey(first, 0));

    setStatus('Loaded ' + docs.length + ' file' + (docs.length === 1 ? '' : 's'));
    renderAll();
  }

  function docKey(doc) { return doc.name; }
  function dialogKey(doc, index) { return doc.name + '#' + index; }

  // The automatic copy of the mod folder is only a convenience preview: as soon
  // as the user opens real files, drop it so menus do not appear twice.
  function dropBundledDocs() {
    state.docs = state.docs.filter(function (doc) { return doc.source !== 'bundled'; });
    state.activeDoc = -1;
    state.dialogIndex = -1;
    state.itemIndex = -1;
    state.openDocs.clear();
    state.openDialogs.clear();
  }

  async function loadBundled() {
    try {
      var uiRes = await fetch(encodeURI(MOD_DIR + 'ui.ui'));
      if (!uiRes.ok) throw new Error('ui.ui not reachable');
      var uiText = await uiRes.text();
      applyRatio(M.parseRatio(uiText));

      var names = [];
      var re = /addmenu\s+(\S+)/g;
      var match;
      while ((match = re.exec(uiText))) names.push(match[1]);

      var docs = [];
      for (var i = 0; i < names.length; i++) {
        try {
          var res = await fetch(encodeURI(MOD_DIR + names[i]));
          if (!res.ok) continue;
          docs.push(createDoc(names[i], await res.text(), { source: 'bundled' }));
        } catch (err) { /* skip unreadable menu */ }
      }
      if (!docs.length) throw new Error('no menus loaded');

      state.bundledAvailable = true;
      try {
        var strRes = await fetch(encodeURI(MOD_DIR + 'english.str'));
        if (strRes.ok) loadStrings(await strRes.text());
      } catch (err) { /* strings are optional */ }

      addDocs(docs);
      setStatus('Loaded the bundled "true dark mode" mod — save downloads the file');
    } catch (err) {
      setStatus('Open the mod folder to start');
    }
  }

  async function openModFolder() {
    if (!window.showDirectoryPicker) {
      els.dirInput.click();
      return;
    }
    var dir;
    try {
      dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      els.dirInput.click();
      return;
    }

    var docs = [];
    assetLoaders.clear();
    spriteCache.clear();
    try {
      for await (var entry of dir.values()) {
        if (!entry || entry.kind !== 'file') continue;
        var name = entry.name;
        var lower = name.toLowerCase();
        if (lower.endsWith('.mnu')) {
          var file = await entry.getFile();
          docs.push(createDoc(name, await file.text(), { handle: entry, source: 'file' }));
        } else if (lower.endsWith('.tga')) {
          registerAsset(name, makeEntryLoader(entry));
        } else if (lower === 'english.str') {
          loadStrings(await (await entry.getFile()).text());
        } else if (lower.endsWith('.ui')) {
          applyRatio(M.parseRatio(await (await entry.getFile()).text()));
        }
      }
    } catch (err) {
      setStatus('Could not read that folder: ' + err.message);
      return;
    }

    if (!docs.length) {
      setStatus('No .mnu files in that folder');
      return;
    }
    dropBundledDocs();
    addDocs(docs);
    setStatus('Loaded ' + docs.length + ' menus — Save writes straight into the folder');
  }

  function makeEntryLoader(entry) {
    return async function () {
      var file = await entry.getFile();
      return file.arrayBuffer();
    };
  }

  async function loadFromFileList(files) {
    var docs = [];
    var list = Array.prototype.slice.call(files);
    spriteCache.clear();
    for (var i = 0; i < list.length; i++) {
      var file = list[i];
      var lower = file.name.toLowerCase();
      try {
        if (lower.endsWith('.mnu')) {
          docs.push(createDoc(file.name, await file.text(), { source: 'file' }));
        } else if (lower.endsWith('.tga')) {
          registerAsset(file.name, makeFileLoader(file));
        } else if (lower === 'english.str') {
          loadStrings(await file.text());
        } else if (lower.endsWith('.ui')) {
          applyRatio(M.parseRatio(await file.text()));
        }
      } catch (err) {
        setStatus('Could not read ' + file.name);
      }
    }

    if (!docs.length) {
      if (list.length) setStatus('That selection has no .mnu files');
      return;
    }
    dropBundledDocs();
    addDocs(docs);
    setStatus('Loaded ' + docs.length + ' menus — Save downloads the changed file');
  }

  function makeFileLoader(file) {
    return function () { return file.arrayBuffer(); };
  }

  /* ================================================================== *
   * Base resolution / ratio
   * ================================================================== */

  function applyRatio(ratio) {
    if (ratio && ratio.w && ratio.h) state.ratio = { w: ratio.w, h: ratio.h };
    var target = state.ratio.w / state.ratio.h;

    var options = PRESETS.filter(function (preset) {
      return Math.abs(preset[0] / preset[1] - target) < 0.002;
    });
    if (!options.length) {
      var fallback = M.ratioToBase(state.ratio);
      options = [[fallback.w, fallback.h]];
    }

    els.baseSelect.textContent = '';
    options.forEach(function (preset) {
      var option = document.createElement('option');
      option.value = preset[0] + 'x' + preset[1];
      option.textContent = preset[0] + ' × ' + preset[1];
      els.baseSelect.append(option);
    });

    var chosen = options.find(function (p) { return p[0] === state.base.w && p[1] === state.base.h; })
      || options.find(function (p) { return p[0] === 1600 && p[1] === 900; })
      || options[0];

    state.base = { w: chosen[0], h: chosen[1] };
    els.baseSelect.value = chosen[0] + 'x' + chosen[1];
    els.ratioLabel.textContent = state.ratio.w + ':' + state.ratio.h;
    afterBaseChange();
  }

  function afterBaseChange() {
    fitStage();
    layoutCanvas();
    if (activeItem()) renderInspector();
    renderCanvas();
    updateStageInfo();
  }

  /* ================================================================== *
   * Tree
   * ================================================================== */

  function renderTree() {
    var host = els.tree;
    host.textContent = '';

    if (!state.docs.length) {
      var empty = el('div', 'tree-empty');
      empty.append(
        el('div', null, 'No files loaded.'),
        el('div', null, 'Use “Open mod folder” and pick the folder that contains ui.ui and the .mnu files.')
      );
      host.append(empty);
      return;
    }

    var query = state.search.trim().toLowerCase();
    var activeDocRef = activeDoc();
    var activeDialogIndex = state.dialogIndex;

    state.docs.forEach(function (doc, docIndex) {
      var dialogs = doc.dialogs;
      var visible = dialogs.map(function (dialog, dialogIndex) {
        var items = M.itemsOf(dialog);
        var nameMatch = !query || M.dialogName(dialog).toLowerCase().indexOf(query) >= 0;
        var matchingItems = !query ? items : items.filter(function (item) {
          return M.itemName(item).toLowerCase().indexOf(query) >= 0;
        });
        return {
          dialog: dialog,
          dialogIndex: dialogIndex,
          items: query ? matchingItems : items,
          show: !query || nameMatch || matchingItems.length > 0,
          nameMatch: nameMatch
        };
      }).filter(function (entry) { return entry.show; });

      if (query && !visible.length) return;

      var fileDetails = document.createElement('details');
      fileDetails.className = 'tree-file';
      var key = docKey(doc);
      fileDetails.open = query ? true : state.openDocs.has(key);
      fileDetails.addEventListener('toggle', function () {
        if (fileDetails.open) state.openDocs.add(key);
        else state.openDocs.delete(key);
      });

      var fileSummary = document.createElement('summary');
      var dot = el('span', 'dot' + (doc.dirty ? '' : ' hidden'));
      dot.dataset.dirtyFor = doc.name;
      var fileName = el('span', 'who', doc.name);
      var count = el('span', 'tree-count', dialogs.length + ' dialogs');
      fileSummary.append(dot, fileName, count);
      fileDetails.append(fileSummary);

      visible.forEach(function (entry) {
        var dialogDetails = document.createElement('details');
        dialogDetails.className = 'tree-dialog';
        if (activeDocRef === doc && entry.dialogIndex === activeDialogIndex) dialogDetails.classList.add('is-active');
        var dKey = dialogKey(doc, entry.dialogIndex);
        dialogDetails.open = query ? true : state.openDialogs.has(dKey);
        dialogDetails.addEventListener('toggle', function () {
          if (dialogDetails.open) state.openDialogs.add(dKey);
          else state.openDialogs.delete(dKey);
        });

        var dialogSummary = document.createElement('summary');
        dialogSummary.append(el('span', 'who', M.dialogName(entry.dialog)));
        var itemCount = el('span', 'tree-count', M.itemsOf(entry.dialog).length + '');
        dialogSummary.append(itemCount);
        dialogSummary.addEventListener('click', function () {
          selectDialog(docIndex, entry.dialogIndex, false);
        });
        dialogDetails.append(dialogSummary);

        var items = M.itemsOf(entry.dialog);
        entry.items.forEach(function (item) {
          var index = items.indexOf(item);
          var row = el('div', 'tree-item');
          row.dataset.doc = String(docIndex);
          row.dataset.dialog = String(entry.dialogIndex);
          row.dataset.item = String(index);
          if (activeDocRef === doc && entry.dialogIndex === activeDialogIndex && index === state.itemIndex) {
            row.classList.add('is-active');
          }
          row.append(el('span', 'tag', typeTag(item.key)));
          row.append(el('span', 'who', M.itemName(item)));

          var primary = M.primaryRect(item);
          var box = primary ? rectBox(primary.node) : null;
          if (box) row.append(el('span', 'dims', box.w + '×' + box.h));

          row.title = item.key + ' — ' + (box ? 'x ' + box.x + ', y ' + box.y + ', ' + box.w + '×' + box.h + ' px' : 'no rect');
          row.addEventListener('click', function (event) {
            event.stopPropagation();
            selectItem(docIndex, entry.dialogIndex, index);
          });
          dialogDetails.append(row);
        });

        fileDetails.append(dialogDetails);
      });

      host.append(fileDetails);
    });

    var activeRow = host.querySelector('.tree-item.is-active');
    if (activeRow && !host.dataset.skipScroll) activeRow.scrollIntoView({ block: 'nearest' });
    host.dataset.skipScroll = '';
  }

  function typeTag(key) {
    return String(key).replace(/^item_/, '').slice(0, 4);
  }

  function selectDialog(docIndex, dialogIndex, keepItem) {
    if (state.activeDoc !== docIndex) state.activeDoc = docIndex;
    var doc = activeDoc();
    if (state.dialogIndex !== dialogIndex) state.itemIndex = -1;
    state.hoverItem = -1;
    state.dialogIndex = dialogIndex;
    if (!keepItem) state.itemIndex = -1;
    state.openDocs.add(docKey(doc));
    state.openDialogs.add(dialogKey(doc, dialogIndex));
    renderAll();
  }

  function selectItem(docIndex, dialogIndex, itemIndex) {
    state.activeDoc = docIndex;
    state.dialogIndex = dialogIndex;
    state.itemIndex = itemIndex;
    state.hoverItem = -1;
    var doc = activeDoc();
    state.openDocs.add(docKey(doc));
    state.openDialogs.add(dialogKey(doc, dialogIndex));
    renderAll();
  }

  /* ================================================================== *
   * Canvas
   * ================================================================== */

  function fitStage() {
    var frame = els.stage.parentElement;
    if (!frame) return;
    var box = frame.getBoundingClientRect();
    var availW = Math.max(120, box.width - 32);
    var availH = Math.max(60, box.height - 32);
    var ratio = W() / H();
    var width = availW;
    var height = width / ratio;
    if (height > availH) {
      height = availH;
      width = height * ratio;
    }
    els.stage.style.width = Math.round(width) + 'px';
    els.stage.style.height = Math.round(height) + 'px';
  }

  function layoutCanvas() {
    var canvas = els.canvas;
    var cssW = els.stage.clientWidth || 640;
    var cssH = els.stage.clientHeight || 360;
    var dpr = window.devicePixelRatio || 1;
    var width = Math.max(1, Math.round(cssW * dpr));
    var height = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    view.cssW = cssW;
    view.cssH = cssH;
    view.scale = canvas.width / W();
    view.baseToCss = cssW / W();
  }

  function renderCanvas() {
    var canvas = els.canvas;
    var ctx = canvas.getContext('2d');
    layoutCanvas();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#050506';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    var dialog = activeDialog();
    els.stageEmpty.classList.toggle('hidden', !!dialog);
    if (!dialog) return;

    ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
    drawGrid(ctx);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W(), H());
    ctx.clip();

    var items = M.itemsOf(dialog);
    items.forEach(function (item) {
      var box = drawItem(ctx, item);
      if (box && state.showLabels) drawLabel(ctx, M.itemName(item) + '  ·  ' + item.key.replace(/^item_/, ''), box);
    });

    ctx.restore();
    drawOverlay(ctx);
  }

  function drawGrid(ctx) {
    if (!state.showGrid) return;
    var step = 50;
    var thin = Math.max(0.4, 1 / view.scale);
    ctx.save();
    ctx.lineWidth = thin;
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.beginPath();
    for (var x = step; x < W(); x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H()); }
    for (var y = step; y < H(); y += step) { ctx.moveTo(0, y); ctx.lineTo(W(), y); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath();
    ctx.moveTo(W() / 2, 0); ctx.lineTo(W() / 2, H());
    ctx.moveTo(0, H() / 2); ctx.lineTo(W(), H() / 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawSpriteIn(ctx, name, box) {
    if (!name || box.w <= 0 || box.h <= 0) return false;
    var sprite = requestSprite(name);
    if (!sprite) return false;
    ctx.drawImage(sprite, box.x, box.y, box.w, box.h);
    return true;
  }

  function fitLabel(ctx, text, maxWidth) {
    if (!text) return '';
    if (ctx.measureText(text).width <= maxWidth) return text;
    var cut = text;
    while (cut.length > 1 && ctx.measureText(cut + '…').width > maxWidth) cut = cut.slice(0, -1);
    return cut + '…';
  }

  function drawPlaceholder(ctx, box, label) {
    if (box.w <= 0 || box.h <= 0) return;
    ctx.save();
    ctx.fillStyle = 'rgba(140,160,200,0.06)';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = 'rgba(150,175,215,0.35)';
    ctx.lineWidth = Math.max(0.6, 1 / view.scale);
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.setLineDash([]);
    if (label && box.w > 26 && box.h > 10) {
      var size = Math.max(6, Math.min(box.h * 0.5, 12));
      ctx.font = size + 'px ' + UI_FONT;
      ctx.fillStyle = 'rgba(200,216,235,0.7)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fitLabel(ctx, label, box.w - 6), box.x + box.w / 2, box.y + box.h / 2);
    }
    ctx.restore();
  }

  function drawTextBlock(ctx, block, box, text, color) {
    if (!text) return;
    var fontSize = M.childNumber(block, 'fontsize', 0.022222) || 0.022222;
    var size = Math.max(4, fontSize * H());
    var pos = M.parseNumberList(M.childValue(block, 'pos')) || [0, 0];
    var align = String(M.childValue(block, 'align', 'left') || 'left').toLowerCase();
    // pos is an inset from the item's aligned edge: left edge for left, right edge
    // for right (so the text stays inside the item), and a nudge from the centre.
    var inset = pos[0] * W();
    var x = box.x + inset;
    if (align === 'center') x = box.x + box.w / 2 + inset;
    else if (align === 'right') x = box.x + box.w - inset;
    var y = box.y + pos[1] * H() + Math.min(box.h, size) * 0.82;

    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    ctx.font = size + 'px ' + UI_FONT;
    ctx.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color ? cssColor(color) : 'rgba(240,240,240,1)';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawLabel(ctx, text, box) {
    var size = Math.max(7, 10 / view.baseToCss);
    ctx.save();
    ctx.font = size + 'px ' + UI_FONT;
    var y = box.y - size * 0.45 > 0 ? box.y - size * 0.45 : box.y + size;
    ctx.fillStyle = 'rgba(120,200,235,0.85)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fitLabel(ctx, text, Math.max(60, box.w * 2)), box.x, y);
    ctx.restore();
  }

  function drawFaintLabel(ctx, box, text) {
    if (!text || box.w < 30 || box.h < 8) return;
    var size = Math.max(6, Math.min(box.h * 0.5, 12));
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.font = size + 'px ' + UI_FONT;
    ctx.fillStyle = 'rgba(210,220,235,0.85)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitLabel(ctx, text, box.w - 6), box.x + 3, box.y + box.h / 2);
    ctx.restore();
  }

  function itemLabelColor(item, key) {
    return M.parseColor(M.childValue(item, key))
      || M.parseColor(M.childValue(item, 'color'))
      || { a: 255, r: 240, g: 240, b: 240 };
  }

  function drawSubBlock(ctx, block, spriteKey) {
    if (!block) return;
    var rect = M.parseRect(M.child(block, 'rect'));
    if (!rect) return;
    var box = M.rectToPixels(rect, W(), H());
    if (!drawSpriteIn(ctx, M.childValue(block, spriteKey || 'sprite1'), box)) {
      drawPlaceholder(ctx, box, '');
    }
  }

  // Returns the item's pixel box so labels/overlays can reuse it.
  function drawItem(ctx, item) {
    var primary = M.primaryRect(item);
    if (!primary) return null;
    var box = rectBox(primary.node);
    if (!box) return null;
    var visible = box.w > 0 && box.h > 0;
    var showSprites = state.showSprites;

    switch (item.key) {
      case 'item_darkbox': {
        if (!visible) break;
        var color = M.parseColor(M.childValue(item, 'color'));
        if (color) {
          ctx.fillStyle = cssColor(color);
          ctx.fillRect(box.x, box.y, box.w, box.h);
        }
        break;
      }

      case 'item_bitmap': {
        var sprite = M.childValue(item, 'sprite');
        if (!(showSprites && visible && drawSpriteIn(ctx, sprite, box))) {
          drawPlaceholder(ctx, box, sprite || M.itemName(item));
        }
        break;
      }

      case 'item_text': {
        if (!visible) break;
        var back = M.parseColor(M.childValue(item, 'backcolor'));
        if (back && back.a > 0) {
          ctx.fillStyle = cssColor(back);
          ctx.fillRect(box.x, box.y, box.w, box.h);
        }
        drawTextBlock(ctx, M.child(item, 'text'), box, resolveItemText(item), itemLabelColor(item, 'color'));
        break;
      }

      case 'item_button':
      case 'item_tab': {
        if (!visible) break;
        var buttonSprite = M.childValue(item, 'sprite2') || M.childValue(item, 'sprite1');
        if (!(showSprites && drawSpriteIn(ctx, buttonSprite, box))) {
          drawPlaceholder(ctx, box, '');
        }
        drawTextBlock(ctx, M.child(item, 'text'), box, resolveItemText(item), itemLabelColor(item, 'color1'));
        break;
      }

      case 'item_checkbox':
      case 'item_radio': {
        if (!visible) break;
        var tickX = (M.childNumber(item, 'spriteposx', 0) || 0) * W();
        var tickY = (M.childNumber(item, 'spriteposy', 0) || 0) * H();
        var tickW = (M.childNumber(item, 'spritesizex', 0) || 0) * W() || box.h;
        var tickH = (M.childNumber(item, 'spritesizey', 0) || 0) * H() || box.h;
        var tickBox = { x: box.x + tickX, y: box.y + tickY, w: tickW, h: tickH };
        if (!(showSprites && drawSpriteIn(ctx, M.childValue(item, 'sprite1'), tickBox))) {
          drawPlaceholder(ctx, tickBox, '');
        }
        drawTextBlock(ctx, M.child(item, 'text'), box, resolveItemText(item), itemLabelColor(item, 'color'));
        break;
      }

      case 'item_pull': {
        if (!visible) break;
        var pullBack = M.parseColor(M.childValue(item, 'backcolor'));
        if (pullBack && pullBack.a > 0) {
          ctx.fillStyle = cssColor(pullBack);
          ctx.fillRect(box.x, box.y, box.w, box.h);
        }
        var switchSize = (M.childNumber(item, 'switchsize', 0) || 0) * W() || box.h;
        var switchBox = {
          x: box.x + box.w - switchSize,
          y: box.y + (box.h - Math.min(switchSize, box.h)) / 2,
          w: switchSize,
          h: Math.min(switchSize, box.h)
        };
        if (!(showSprites && drawSpriteIn(ctx, M.childValue(item, 'sprite1'), switchBox))) {
          drawPlaceholder(ctx, switchBox, '');
        }
        drawFaintLabel(ctx, { x: box.x, y: box.y, w: box.w - switchSize - 4, h: box.h }, M.itemName(item));
        break;
      }

      case 'item_editbox': {
        if (!visible) break;
        var editbox = M.child(item, 'editbox');
        var editBack = M.parseColor(M.childValue(editbox, 'backcolor'));
        if (editBack && editBack.a > 0) {
          ctx.fillStyle = cssColor(editBack);
          ctx.fillRect(box.x, box.y, box.w, box.h);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = Math.max(0.6, 1 / view.scale);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        drawTextBlock(ctx, M.child(editbox, 'text'), box, resolveItemText(item), itemLabelColor(editbox, 'color1'));
        break;
      }

      case 'item_spin': {
        if (!visible) break;
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fillRect(box.x, box.y, box.w, box.h);
        var spin = M.child(item, 'spin');
        if (showSprites) {
          drawSubBlock(ctx, spin && M.child(spin, 'button1'));
          drawSubBlock(ctx, spin && M.child(spin, 'button2'));
        }
        drawFaintLabel(ctx, {
          x: box.x + (M.childNumber(spin, 'buttonssize', 0) || 0) * W() * 2,
          y: box.y,
          w: box.w - (M.childNumber(spin, 'buttonssize', 0) || 0) * W() * 2,
          h: box.h
        }, M.itemName(item));
        break;
      }

      case 'item_slider': {
        var sliderBlock = M.child(item, 'slider');
        var trackRect = M.parseRect(M.child(sliderBlock, 'rect'));
        var track = trackRect ? M.rectToPixels(trackRect, W(), H()) : box;
        if (!(showSprites && drawSpriteIn(ctx, M.childValue(sliderBlock, 'sprite1'), track))) {
          drawPlaceholder(ctx, track, '');
        }
        if (showSprites) {
          drawSpriteIn(ctx, M.childValue(sliderBlock, 'sprite2'), {
            x: track.x, y: track.y, w: track.w * 0.5, h: track.h
          });
          drawSubBlock(ctx, sliderBlock && M.child(sliderBlock, 'button0'));
          drawSubBlock(ctx, sliderBlock && M.child(sliderBlock, 'button1'));
        }
        break;
      }

      case 'item_list': {
        drawListItem(ctx, item, box);
        break;
      }

      default: {
        drawPlaceholder(ctx, box, item.key.replace(/^item_/, ''));
        break;
      }
    }

    return box;
  }

  function drawListItem(ctx, item, box) {
    var list = M.child(item, 'list') || item;
    var meta = M.child(list, 'slider');
    var sliderRect = meta ? M.parseRect(M.child(meta, 'rect')) : null;

    var back = M.parseColor(M.childValue(list, 'backcolor'));
    if (back && back.a > 0) {
      ctx.fillStyle = cssColor(back);
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();

    var spacing = (M.childNumber(list, 'spacing', 0) || 0) * H();
    var columns = [];
    for (var i = 0; i < 16; i++) {
      var size = M.childNumber(list, 'columnsize' + i);
      if (size === null) break;
      columns.push(size * W());
    }

    var sortbar = M.childNumber(list, 'sortbar', 0);
    var barHeight = (M.childNumber(list, 'sortbarheight', 0) || 0) * H();

    if (sortbar && barHeight > 0) {
      var sortBack = M.parseColor(M.childValue(list, 'sortbackcolor'));
      ctx.fillStyle = sortBack && sortBack.a > 0 ? cssColor(sortBack) : 'rgba(255,255,255,0.05)';
      ctx.fillRect(box.x, box.y, box.w, barHeight);
    }

    ctx.lineWidth = Math.max(0.4, 1 / view.scale);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';

    var columnX = box.x;
    columns.forEach(function (width, index) {
      columnX += width;
      if (index < columns.length - 1 && columnX < box.x + box.w) {
        ctx.beginPath();
        ctx.moveTo(columnX, box.y);
        ctx.lineTo(columnX, box.y + box.h);
        ctx.stroke();
      }
    });

    if (spacing > 0) {
      for (var y = box.y + (sortbar ? barHeight : 0) + spacing; y < box.y + box.h; y += spacing) {
        ctx.beginPath();
        ctx.moveTo(box.x, y);
        ctx.lineTo(box.x + box.w, y);
        ctx.stroke();
      }
    }

    if (sortbar && barHeight > 0) {
      var sortText = M.child(list, 'sortbartext');
      var sortColor = M.parseColor(M.childValue(list, 'sortbartextcolor')) || { a: 255, r: 200, g: 200, b: 200 };
      var cursorX = box.x;
      columns.forEach(function (width, index) {
        var id = M.childValue(list, 'columntextid' + index);
        var text = resolveString(id) || id;
        if (text) {
          drawTextBlock(ctx, sortText, { x: cursorX, y: box.y, w: width, h: barHeight }, text, sortColor);
        }
        cursorX += width;
      });
    }

    ctx.restore();

    if (sliderRect) {
      var sliderBox = M.rectToPixels(sliderRect, W(), H());
      ctx.save();
      ctx.strokeStyle = 'rgba(120,190,225,0.25)';
      ctx.lineWidth = Math.max(0.5, 1 / view.scale);
      ctx.strokeRect(sliderBox.x, sliderBox.y, sliderBox.w, sliderBox.h);
      ctx.restore();
    }
  }

  function handlePoints(box) {
    return {
      nw: [box.x, box.y],
      ne: [box.x + box.w, box.y],
      se: [box.x + box.w, box.y + box.h],
      sw: [box.x, box.y + box.h],
      n: [box.x + box.w / 2, box.y],
      e: [box.x + box.w, box.y + box.h / 2],
      s: [box.x + box.w / 2, box.y + box.h],
      w: [box.x, box.y + box.h / 2]
    };
  }

  function drawOverlay(ctx) {
    var hover = state.hoverItem >= 0 && state.hoverItem !== state.itemIndex ? M.itemsOf(activeDialog())[state.hoverItem] : null;
    if (hover) {
      var hoverPrimary = M.primaryRect(hover);
      var hoverBox = hoverPrimary ? rectBox(hoverPrimary.node) : null;
      if (hoverBox) {
        ctx.save();
        ctx.strokeStyle = 'rgba(120,200,235,0.35)';
        ctx.lineWidth = Math.max(0.6, 1 / view.scale);
        ctx.strokeRect(hoverBox.x, hoverBox.y, hoverBox.w, hoverBox.h);
        ctx.restore();
      }
    }

    var item = activeItem();
    if (!item) return;
    var rects = M.rectsOf(item);
    var primary = M.primaryRect(item);
    var primaryNode = primary ? primary.node : null;

    ctx.save();
    rects.forEach(function (entry) {
      if (entry.node === primaryNode) return;
      var box = rectBox(entry.node);
      if (!box || box.w <= 0 || box.h <= 0) return;
      ctx.strokeStyle = 'rgba(88,196,245,0.22)';
      ctx.lineWidth = Math.max(0.5, 1 / view.scale);
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.setLineDash([]);
    });

    if (primaryNode) {
      var box = rectBox(primaryNode);
      if (box) {
        ctx.strokeStyle = '#58c4f5';
        ctx.lineWidth = Math.max(0.8, 1.6 / view.scale);
        ctx.strokeRect(box.x, box.y, box.w, box.h);

        var size = 7 / view.baseToCss;
        var points = handlePoints(box);
        ctx.fillStyle = '#58c4f5';
        ctx.strokeStyle = '#08080a';
        ctx.lineWidth = Math.max(0.6, 1 / view.scale);
        HANDLE_ORDER.forEach(function (name) {
          var p = points[name];
          ctx.fillRect(p[0] - size / 2, p[1] - size / 2, size, size);
          ctx.strokeRect(p[0] - size / 2, p[1] - size / 2, size, size);
        });

        var label = Math.round(box.w) + ' × ' + Math.round(box.h) + '  @  ' + box.x + ', ' + box.y;
        var fontSize = Math.max(8, 11 / view.baseToCss);
        ctx.font = fontSize + 'px ' + UI_FONT;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        var textWidth = ctx.measureText(label).width;
        var labelX = Math.min(Math.max(box.x, 2), W() - textWidth - 8);
        var labelY = box.y - fontSize * 0.7;
        if (labelY < fontSize) labelY = box.y + box.h + fontSize * 1.1;
        ctx.fillStyle = 'rgba(8,8,10,0.8)';
        ctx.fillRect(labelX - 3, labelY - fontSize, textWidth + 6, fontSize * 1.25);
        ctx.fillStyle = '#9fe3ff';
        ctx.fillText(label, labelX, labelY - fontSize * 0.15);
      }
    }
    ctx.restore();
  }

  /* ================================================================== *
   * Pointer interaction
   * ================================================================== */

  function pointFromEvent(event) {
    var rect = els.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width * W(),
      y: (event.clientY - rect.top) / rect.height * H()
    };
  }

  function hitHandle(box, point) {
    var tolerance = 9 / view.baseToCss;
    var points = handlePoints(box);
    for (var i = 0; i < HANDLE_ORDER.length; i++) {
      var name = HANDLE_ORDER[i];
      var p = points[name];
      if (Math.abs(point.x - p[0]) <= tolerance && Math.abs(point.y - p[1]) <= tolerance) return name;
    }
    return null;
  }

  function hitItem(dialog, point) {
    var items = M.itemsOf(dialog);
    for (var i = items.length - 1; i >= 0; i--) {
      var primary = M.primaryRect(items[i]);
      if (!primary) continue;
      var box = rectBox(primary.node);
      if (!box || box.w <= 0 || box.h <= 0) continue;
      if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) {
        return i;
      }
    }
    return -1;
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    var doc = activeDoc();
    var dialog = activeDialog();
    if (!doc || !dialog) return;
    var point = pointFromEvent(event);

    var item = activeItem();
    if (item) {
      var primary = M.primaryRect(item);
      var box = primary ? rectBox(primary.node) : null;
      if (box) {
        var handle = hitHandle(box, point);
        if (handle) {
          startDrag(event, {
            mode: 'resize', handle: handle, doc: doc, item: item,
            rectNode: primary.node, box: box, start: point
          });
          return;
        }
      }
    }

    var index = hitItem(dialog, point);
    if (index < 0) {
      if (state.itemIndex !== -1) {
        state.itemIndex = -1;
        renderTree();
        renderInspector();
        renderCanvas();
        updateStageInfo();
        updateToolbar();
      }
      return;
    }

    if (index !== state.itemIndex) {
      state.itemIndex = index;
      renderTree();
      renderInspector();
      updateToolbar();
    }

    var picked = activeItem();
    var pickedPrimary = picked ? M.primaryRect(picked) : null;
    if (!pickedPrimary) {
      renderCanvas();
      return;
    }
    startDrag(event, {
      mode: 'move', handle: null, doc: doc, item: picked,
      rectNode: pickedPrimary.node, box: rectBox(pickedPrimary.node), start: point
    });
  }

  function startDrag(event, info) {
    info.before = info.doc.text;
    info.moved = false;
    drag = info;
    els.canvas.setPointerCapture(event.pointerId);
    els.canvas.style.cursor = info.mode === 'move' ? 'move' : HANDLE_CURSOR[info.handle];
    event.preventDefault();
  }

  function onPointerMove(event) {
    var doc = activeDoc();
    var dialog = activeDialog();

    if (!drag) {
      if (!dialog) {
        els.cursor.textContent = '';
        return;
      }
      var point = pointFromEvent(event);
      els.cursor.textContent = 'x ' + Math.round(point.x) + '  y ' + Math.round(point.y) + '   ·   ' + W() + '×' + H();

      var item = activeItem();
      var box = item && M.primaryRect(item) ? rectBox(M.primaryRect(item).node) : null;
      var handle = box ? hitHandle(box, point) : null;
      var index = hitItem(dialog, point);
      if (index !== state.hoverItem) {
        state.hoverItem = index;
        renderCanvas();
        updateStageInfo();
      }
      els.canvas.style.cursor = handle ? HANDLE_CURSOR[handle] : index >= 0 ? 'move' : 'default';
      return;
    }

    var p = pointFromEvent(event);
    var next = { x: drag.box.x, y: drag.box.y, w: drag.box.w, h: drag.box.h };
    var dx = p.x - drag.start.x;
    var dy = p.y - drag.start.y;
    if (event.shiftKey) {
      dx = Math.round(dx / 10) * 10;
      dy = Math.round(dy / 10) * 10;
    }

    if (drag.mode === 'move') {
      next.x += dx;
      next.y += dy;
    } else {
      if (drag.handle.indexOf('w') >= 0) { next.x += dx; next.w -= dx; }
      if (drag.handle.indexOf('e') >= 0) { next.w += dx; }
      if (drag.handle.indexOf('n') >= 0) { next.y += dy; next.h -= dy; }
      if (drag.handle.indexOf('s') >= 0) { next.h += dy; }
      if (next.w < 1) next.w = 1;
      if (next.h < 1) next.h = 1;
    }

    M.writeRectPixels(drag.rectNode, next, W(), H());
    drag.doc.text = M.serialize(drag.doc.root);
    drag.doc.dirty = true;
    drag.moved = true;

    syncRectInputs();
    renderCanvas();
    updateStageInfo();
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (!drag) return;
    var finished = drag;
    drag = null;
    try { els.canvas.releasePointerCapture(event.pointerId); } catch (err) { /* already released */ }
    els.canvas.style.cursor = 'default';

    if (finished.moved && finished.doc.text !== finished.before) {
      finished.doc.undo.push(finished.before);
      if (finished.doc.undo.length > 200) finished.doc.undo.shift();
      finished.doc.redo.length = 0;
      finished.doc.dirty = true;
      updateSource();
      renderTree();
      updateToolbar();
      setStatus('Moved ' + M.itemName(finished.item) + ' — ' + (finished.doc.dirty ? 'unsaved' : ''));
    }
  }

  function nudge(dx, dy) {
    var item = activeItem();
    var primary = item && M.primaryRect(item);
    if (!primary) return;
    var box = rectBox(primary.node);
    if (!box) return;
    applyEdit(function () {
      M.writeRectPixels(primary.node, { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }, W(), H());
    });
    syncRectInputs();
    renderCanvas();
    updateStageInfo();
  }

  /* ================================================================== *
   * Inspector
   * ================================================================== */

  function card(title, subtitle) {
    var node = el('section', 'card');
    var heading = el('h3', null, title);
    if (subtitle) {
      var note = el('span', 'muted', subtitle);
      note.style.fontWeight = '400';
      note.style.textTransform = 'none';
      note.style.letterSpacing = '0';
      heading.append(note);
    }
    node.append(heading);
    return node;
  }

  function renderInspector() {
    var host = els.inspector;
    host.textContent = '';

    var doc = activeDoc();
    var dialog = activeDialog();
    var item = activeItem();

    if (!item) {
      var tip = el('div', 'tip');
      tip.append(el('div', 'empty-note', dialog
        ? 'Dialog ' + M.dialogName(dialog) + ' — pick an item in the tree or click it in the preview.'
        : 'Select a dialog and an item to start editing.'));
      var list = el('ul');
      [
        'Drag an item to move it, drag a handle to resize.',
        'Pixel fields convert through X = round(X1 · W), so the file keeps its 0–1 floats.',
        'Arrow keys nudge 1 px, Shift + arrows nudge 10 px.',
        'Every untouched line is written back exactly as it was.'
      ].forEach(function (text) {
        var li = document.createElement('li');
        li.textContent = text;
        list.append(li);
      });
      tip.append(list);
      host.append(tip);
      return;
    }

    var head = el('div', 'insp-head');
    head.append(el('div', 'insp-type', item.key));
    head.append(el('div', 'insp-name', M.itemName(item)));
    head.append(el('div', 'insp-path', doc.name + '  ›  ' + M.dialogName(dialog)));
    host.append(head);

    var rects = M.rectsOf(item);
    var rectCard = card('Rectangles', W() + ' × ' + H() + ' px');
    if (!rects.length) {
      rectCard.append(el('div', 'empty-note', 'This item has no rect to edit.'));
    } else {
      rects.forEach(function (entry, index) {
        rectCard.append(buildRectGroup(entry, index));
      });
      var formula = el('div', 'hint', 'X = round(X1 · W), Width = round(X2 · W) − X');
      rectCard.append(formula);
    }
    host.append(rectCard);

    var valuesCard = card('Values', 'as stored in the file');
    buildValueTree(item, valuesCard, 0);
    host.append(valuesCard);
  }

  function buildRectGroup(entry, index) {
    var node = entry.node;
    var rect = M.parseRect(node) || [0, 0, 0, 0];
    var box = M.rectToPixels(rect, W(), H());

    var details = document.createElement('details');
    details.className = 'rect-group';
    details.dataset.rectIndex = String(index);
    details.open = index === 0;

    var summary = document.createElement('summary');
    summary.append(el('span', null, entry.path));
    summary.append(el('span', 'dims', box.x + ', ' + box.y + ' · ' + box.w + ' × ' + box.h));
    details.append(summary);

    var body = el('div', 'rect-body');
    var grid = el('div', 'grid4');

    [['x', 'X'], ['y', 'Y'], ['w', 'Width'], ['h', 'Height']].forEach(function (pair) {
      var label = document.createElement('label');
      label.append(document.createTextNode(pair[1]));
      var input = document.createElement('input');
      input.type = 'number';
      input.step = '1';
      input.value = String(box[pair[0]]);
      input.dataset.field = pair[0];
      input.addEventListener('change', function () {
        commitPxInputs(grid, node);
      });
      label.append(input);
      grid.append(label);
    });

    var floats = el('div', 'float-row');
    ['X1', 'Y1', 'X2', 'Y2'].forEach(function (label, i) {
      var input = document.createElement('input');
      input.type = 'number';
      input.step = '0.000001';
      input.value = M.formatFloat(rect[i]);
      input.dataset.float = String(i);
      input.title = label + ' (0–1)';
      input.addEventListener('change', function () {
        var current = M.parseRect(node);
        var value = parseFloat(input.value);
        if (!current || !isFinite(value)) { syncRectInputs(); return; }
        current[i] = value;
        applyEdit(function () { M.writeRectValues(node, current); });
        syncRectInputs();
      });
      floats.append(input);
    });

    var hint = el('div', 'hint', 'rect ' + M.formatRect(rect));
    body.append(grid, floats, hint);
    details.append(body);
    return details;
  }

  function commitPxInputs(grid, node) {
    var values = { x: 0, y: 0, w: 0, h: 0 };
    var ok = true;
    grid.querySelectorAll('input[data-field]').forEach(function (input) {
      var value = Number(input.value);
      if (!isFinite(value)) ok = false;
      values[input.dataset.field] = value;
    });
    if (!ok) { syncRectInputs(); return; }
    applyEdit(function () { M.writeRectPixels(node, values, W(), H()); });
    syncRectInputs();
    renderCanvas();
    updateStageInfo();
  }

  function syncRectInputs() {
    var item = activeItem();
    if (!item) return;
    var rects = M.rectsOf(item);
    var groups = els.inspector.querySelectorAll('.rect-group');
    Array.prototype.forEach.call(groups, function (group) {
      var entry = rects[Number(group.dataset.rectIndex)];
      if (!entry) return;
      var rect = M.parseRect(entry.node);
      if (!rect) return;
      var box = M.rectToPixels(rect, W(), H());

      group.querySelectorAll('input[data-field]').forEach(function (input) {
        if (document.activeElement !== input) input.value = String(box[input.dataset.field]);
      });
      group.querySelectorAll('input[data-float]').forEach(function (input) {
        if (document.activeElement !== input) input.value = M.formatFloat(rect[Number(input.dataset.float)]);
      });
      var dims = group.querySelector('summary .dims');
      if (dims) dims.textContent = box.x + ', ' + box.y + ' · ' + box.w + ' × ' + box.h;
      var hint = group.querySelector('.hint');
      if (hint) hint.textContent = 'rect ' + M.formatRect(rect);
    });

    var nameNode = els.inspector.querySelector('.insp-name');
    if (nameNode) nameNode.textContent = M.itemName(item);
  }

  function buildValueTree(node, host, depth) {
    M.children(node).forEach(function (child) {
      if (child.key === 'rect') return;
      if (child.children) {
        var details = document.createElement('details');
        details.className = 'val-block';
        details.open = depth < 1;
        var summary = document.createElement('summary');
        summary.textContent = child.key;
        details.append(summary);
        buildValueTree(child, details, depth + 1);
        host.append(details);
        return;
      }
      host.append(buildValueRow(child));
    });
  }

  var ALIGN_VALUES = ['left', 'center', 'right'];

  function buildValueRow(node) {
    var row = el('div', 'val-row');
    row.append(el('div', 'val-key', node.key));
    if (node.key === 'align') return buildAlignRow(node, row);

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'val-input';
    input.value = node.value;
    input.spellcheck = false;
    input.dataset.valKey = node.key;

    var extra = el('div', 'val-extra');
    updateValueExtras(extra, node, node.value);

    input.addEventListener('change', function () {
      var value = input.value.trim();
      if (value === node.value) return;
      applyEdit(function () { node.value = value; });
      updateValueExtras(extra, node, value);
      updateStageInfo();
    });

    row.append(input, extra);
    return row;
  }

  // align only accepts left / center / right, so it gets a dropdown instead of free text.
  function buildAlignRow(node, row) {
    var select = document.createElement('select');
    select.className = 'val-input';
    select.dataset.valKey = node.key;
    select.title = 'align — left, center or right';

    var current = String(node.value || '').trim();
    var values = ALIGN_VALUES.slice();
    if (current && ALIGN_VALUES.indexOf(current.toLowerCase()) === -1) values.push(current);

    values.forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      if (value.toLowerCase() === current.toLowerCase()) option.selected = true;
      select.append(option);
    });

    select.addEventListener('change', function () {
      var value = select.value;
      if (value === node.value) return;
      applyEdit(function () { node.value = value; });
      updateStageInfo();
    });

    row.append(select);
    return row;
  }

  function refreshValueExtras() {
    if (!els.inspector) return;
    if (!activeItem()) return;
    var rows = els.inspector.querySelectorAll('.val-row');
    // Rebuild extras for sprite rows only (cheap, keeps focus in inputs).
    Array.prototype.forEach.call(rows, function (row) {
      var input = row.querySelector('input');
      var extra = row.querySelector('.val-extra');
      if (!input || !extra) return;
      if (!/\.(tga|png|jpg|dds)$/i.test(input.value)) return;
      updateValueExtras(extra, { key: input.dataset.valKey, value: input.value }, input.value);
    });
  }

  function updateValueExtras(host, node, value) {
    host.textContent = '';

    var color = M.parseColor(value);
    if (color) {
      var swatch = el('span', 'swatch');
      swatch.style.backgroundColor = 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',' + (color.a / 255).toFixed(3) + ')';
      host.append(swatch);
      host.append(el('span', null, 'A ' + color.a + '  R ' + color.r + '  G ' + color.g + '  B ' + color.b));
      return;
    }

    if (/\.(tga|png|jpg|dds)$/i.test(String(value))) {
      var sprite = requestSprite(value);
      if (sprite) {
        var thumb = document.createElement('canvas');
        thumb.className = 'thumb';
        thumb.width = 56;
        thumb.height = 56;
        var ctx = thumb.getContext('2d');
        var scale = Math.min(56 / sprite.width, 56 / sprite.height, 1);
        var w = Math.max(1, sprite.width * scale);
        var h = Math.max(1, sprite.height * scale);
        ctx.drawImage(sprite, (56 - w) / 2, (56 - h) / 2, w, h);
        host.append(thumb);
        host.append(el('span', null, sprite.width + ' × ' + sprite.height));
      } else {
        host.append(el('span', 'muted', 'sprite not loaded'));
      }
      return;
    }

    if (node.key === 'textid') {
      var resolved = resolveString(value);
      if (resolved) host.append(el('span', null, '“' + resolved + '”'));
      else host.append(el('span', 'muted', 'no english.str entry'));
      return;
    }

    var numbers = M.parseNumberList(value);
    if (numbers && numbers.length === 2 && node.key === 'pos') {
      host.append(el('span', 'muted', 'offset ' + Math.round(numbers[0] * W()) + ', ' + Math.round(numbers[1] * H()) + ' px'));
      return;
    }
    if (numbers && numbers.length === 1) {
      var f = numbers[0];
      if (node.key === 'fontsize' || node.key === 'size' || node.key === 'spacing' ||
          node.key === 'switchsize' || node.key === 'buttonssize') {
        host.append(el('span', 'muted', '≈ ' + Math.round(f * Math.min(W(), H())) + ' px'));
      }
    }
  }

  /* ================================================================== *
   * Edits, undo, saving
   * ================================================================== */

  function applyEdit(mutate) {
    var doc = activeDoc();
    if (!doc) return false;
    var before = doc.text;
    mutate();
    doc.text = M.serialize(doc.root);
    if (doc.text === before) return false;
    doc.undo.push(before);
    if (doc.undo.length > 200) doc.undo.shift();
    doc.redo.length = 0;
    doc.dirty = true;
    afterChange();
    return true;
  }

  function afterChange() {
    updateSource();
    renderCanvas();
    renderTree();
    updateToolbar();
    updateStageInfo();
  }

  function undo() {
    var doc = activeDoc();
    if (!doc || !doc.undo.length) return;
    doc.redo.push(doc.text);
    doc.text = doc.undo.pop();
    reloadDoc(doc);
    setStatus('Undo');
  }

  function redo() {
    var doc = activeDoc();
    if (!doc || !doc.redo.length) return;
    doc.undo.push(doc.text);
    doc.text = doc.redo.pop();
    reloadDoc(doc);
    setStatus('Redo');
  }

  function reloadDoc(doc) {
    doc.root = M.parse(doc.text);
    doc.dialogs = M.dialogsOf(doc.root);
    doc.dirty = true;
    var dialog = activeDialog();
    if (!dialog) { state.dialogIndex = 0; state.itemIndex = -1; }
    else {
      state.dialogIndex = Math.min(state.dialogIndex, doc.dialogs.length - 1);
      var items = M.itemsOf(doc.dialogs[state.dialogIndex]);
      state.itemIndex = Math.min(state.itemIndex, items.length - 1);
    }
    renderAll();
    updateToolbar();
  }

  function canWrite(doc) {
    return !!(doc && doc.handle && typeof doc.handle.createWritable === 'function');
  }

  async function saveActive() {
    var doc = activeDoc();
    if (!doc) return;
    await saveDoc(doc);
  }

  async function saveDoc(doc) {
    if (!doc) return;
    try {
      if (canWrite(doc)) {
        var writable = await doc.handle.createWritable();
        await writable.write(doc.text);
        await writable.close();
        setStatus('Saved ' + doc.name);
      } else {
        download(doc.name, doc.text);
        setStatus('Downloaded ' + doc.name + ' — replace the original file with it');
      }
      doc.dirty = false;
      updateToolbar();
      renderTree();
      updateSource();
    } catch (err) {
      setStatus('Save failed: ' + err.message);
    }
  }

  async function saveAll() {
    var dirty = state.docs.filter(function (doc) { return doc.dirty; });
    if (!dirty.length) { setStatus('Nothing to save'); return; }
    for (var i = 0; i < dirty.length; i++) {
      await saveDoc(dirty[i]);
    }
    setStatus('Saved ' + dirty.length + ' file' + (dirty.length === 1 ? '' : 's'));
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* ================================================================== *
   * Chrome: toolbar, status, source view
   * ================================================================== */

  function updateToolbar() {
    var doc = activeDoc();
    els.btnUndo.disabled = !doc || !doc.undo.length;
    els.btnRedo.disabled = !doc || !doc.redo.length;
    els.btnSave.disabled = !doc;
    els.btnSave.textContent = canWrite(doc) ? 'Save' : 'Download';
    els.btnSaveAll.disabled = !state.docs.some(function (d) { return d.dirty; });
    els.btnSource.disabled = !doc;
    els.ratioLabel.textContent = state.ratio.w + ':' + state.ratio.h;
  }

  function updateStageInfo() {
    var item = activeItem();
    var hovered = state.hoverItem >= 0 ? M.itemsOf(activeDialog())[state.hoverItem] : null;
    var target = hovered || item;
    if (!target) {
      els.stageInfo.textContent = activeDialog() ? M.dialogName(activeDialog()) : '—';
      return;
    }
    var primary = M.primaryRect(target);
    var box = primary ? rectBox(primary.node) : null;
    var prefix = hovered && hovered !== item ? 'hover  ' : '';
    els.stageInfo.textContent = prefix + target.key + '  ·  ' + M.itemName(target) +
      (box ? '  ·  x ' + box.x + '  y ' + box.y + '  ' + box.w + ' × ' + box.h : '  ·  no rect');
  }

  function refreshSource() {
    var doc = activeDoc();
    if (!doc) {
      els.sourceTitle.textContent = 'Source';
      els.sourceText.value = '';
      els.sourceNote.textContent = 'no file loaded';
      return;
    }
    els.sourceTitle.textContent = doc.name;
    els.sourceText.value = doc.text;
    els.sourceNote.textContent = doc.dirty ? 'modified — not saved yet' : 'unchanged';
  }

  function updateSource() {
    if (els.sourceDialog.open) refreshSource();
  }

  function renderAll() {
    renderTree();
    fitStage();
    renderCanvas();
    renderInspector();
    updateToolbar();
    updateStageInfo();
    updateSource();
  }

  /* ================================================================== *
   * Events / boot
   * ================================================================== */

  function bindEvents() {
    els.btnFolder.addEventListener('click', openModFolder);
    els.btnFiles.addEventListener('click', function () { els.fileInput.click(); });

    els.fileInput.addEventListener('change', function (event) {
      loadFromFileList(event.target.files);
      event.target.value = '';
    });
    els.dirInput.addEventListener('change', function (event) {
      loadFromFileList(event.target.files);
      event.target.value = '';
    });

    els.btnUndo.addEventListener('click', undo);
    els.btnRedo.addEventListener('click', redo);
    els.btnSave.addEventListener('click', saveActive);
    els.btnSaveAll.addEventListener('click', saveAll);
    els.btnHelp.addEventListener('click', function () { els.helpDialog.showModal(); });

    els.search.addEventListener('input', function () {
      state.search = els.search.value;
      renderTree();
    });

    els.btnExpand.addEventListener('click', function () { setAllOpen(true); });
    els.btnCollapse.addEventListener('click', function () { setAllOpen(false); });

    els.baseSelect.addEventListener('change', function () {
      var parts = els.baseSelect.value.split('x');
      state.base = { w: Number(parts[0]), h: Number(parts[1]) };
      afterBaseChange();
      setStatus('Base resolution ' + state.base.w + ' × ' + state.base.h);
    });

    els.optGrid.addEventListener('change', function () {
      state.showGrid = els.optGrid.checked;
      renderCanvas();
    });
    els.optLabels.addEventListener('change', function () {
      state.showLabels = els.optLabels.checked;
      renderCanvas();
    });
    els.optSprites.addEventListener('change', function () {
      state.showSprites = els.optSprites.checked;
      renderCanvas();
    });

    els.btnSource.addEventListener('click', function () {
      refreshSource();
      els.sourceDialog.showModal();
    });
    els.btnCloseSource.addEventListener('click', function () { els.sourceDialog.close(); });
    els.btnCopySource.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(els.sourceText.value);
        setStatus('Source copied');
      } catch (err) {
        els.sourceText.select();
        setStatus('Press Ctrl/⌘+C to copy the selected source');
      }
    });

    els.canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    els.canvas.addEventListener('pointerleave', function () {
      if (drag) return;
      els.cursor.textContent = '';
      if (state.hoverItem !== -1) {
        state.hoverItem = -1;
        renderCanvas();
        updateStageInfo();
      }
    });

    document.addEventListener('keydown', function (event) {
      var tag = (event.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      var meta = event.ctrlKey || event.metaKey;

      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveActive();
        return;
      }
      // Undo/redo operate on the file, so they work while a field has focus too.
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (typing) return;

      if (event.key.indexOf('Arrow') === 0 && activeItem()) {
        event.preventDefault();
        var step = event.shiftKey ? 10 : 1;
        var dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        var dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        nudge(dx, dy);
      }
    });

    window.addEventListener('dragover', function (event) { event.preventDefault(); });
    window.addEventListener('drop', function (event) {
      event.preventDefault();
      if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
        loadFromFileList(event.dataTransfer.files);
      }
    });

    var frame = els.stage.parentElement;
    if (window.ResizeObserver && frame) {
      new ResizeObserver(function () {
        fitStage();
        layoutCanvas();
        renderCanvas();
      }).observe(frame);
    }
    window.addEventListener('resize', function () {
      fitStage();
      layoutCanvas();
      renderCanvas();
    });
  }

  function setAllOpen(open) {
    state.openDocs.clear();
    state.openDialogs.clear();
    els.tree.querySelectorAll('details').forEach(function (node) {
      node.open = open;
    });
    if (open) {
      state.docs.forEach(function (doc, docIndex) {
        state.openDocs.add(docKey(doc));
        doc.dialogs.forEach(function (_, dialogIndex) {
          state.openDialogs.add(dialogKey(doc, dialogIndex));
        });
      });
    }
  }

  function boot() {
    bindEvents();
    applyRatio(null);
    fitStage();
    layoutCanvas();
    renderAll();
    loadBundled();
  }

  boot();
})();
