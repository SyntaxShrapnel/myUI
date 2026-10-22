/*
 * Minimal TGA (Targa) decoder.
 *
 * MX Bikes UI sprites are Targa images, which browsers cannot display, so the
 * editor decodes them itself. Covers what this mod ships with: uncompressed and
 * RLE true-colour (24/32 bpp) and 8-bit greyscale.
 *
 *   Tga.decode(bytes)      -> { width, height, rgba: Uint8Array }   (also in Node)
 *   Tga.toCanvas(bytes)    -> HTMLCanvasElement
 */
(function (root) {
  'use strict';

  function decode(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    if (bytes.length < 18) throw new Error('not a TGA file');

    var header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var idLength = bytes[0];
    var colorMapType = bytes[1];
    var imageType = bytes[2];
    var colorMapLength = header.getUint16(5, true);
    var colorMapDepth = bytes[7];
    var width = header.getUint16(12, true);
    var height = header.getUint16(14, true);
    var pixelDepth = bytes[16];
    var descriptor = bytes[17];

    if (!width || !height) throw new Error('TGA has no image data');

    var offset = 18 + idLength;
    if (colorMapType === 1) {
      offset += colorMapLength * Math.ceil(colorMapDepth / 8);
    }

    var isRle = imageType === 10 || imageType === 11;
    var isGray = imageType === 3 || imageType === 11;
    var isTrueColor = imageType === 2 || imageType === 10;
    if (!isTrueColor && !isGray) {
      throw new Error('unsupported TGA image type ' + imageType);
    }
    if (pixelDepth !== 8 && pixelDepth !== 24 && pixelDepth !== 32) {
      throw new Error('unsupported TGA pixel depth ' + pixelDepth);
    }

    var bytesPerPixel = pixelDepth / 8;
    var alphaBits = descriptor & 0x0f;
    var pixelCount = width * height;
    var rgba = new Uint8Array(pixelCount * 4);
    var topDown = (descriptor & 0x20) !== 0;
    var rightToLeft = (descriptor & 0x10) !== 0;

    var pixelIndex = 0;

    function store(pixelOffset) {
      var x = pixelIndex % width;
      var y = (pixelIndex - x) / width;
      var target = ((topDown ? y : height - 1 - y) * width + (rightToLeft ? width - 1 - x : x)) * 4;
      if (isGray) {
        var gray = bytes[pixelOffset];
        rgba[target] = gray;
        rgba[target + 1] = gray;
        rgba[target + 2] = gray;
        rgba[target + 3] = 255;
      } else {
        rgba[target] = bytes[pixelOffset + 2];
        rgba[target + 1] = bytes[pixelOffset + 1];
        rgba[target + 2] = bytes[pixelOffset];
        rgba[target + 3] = alphaBits && bytesPerPixel === 4 ? bytes[pixelOffset + 3] : 255;
      }
      pixelIndex++;
    }

    if (!isRle) {
      for (var i = 0; i < pixelCount; i++) store(offset + i * bytesPerPixel);
    } else {
      var pos = offset;
      while (pixelIndex < pixelCount) {
        if (pos >= bytes.length) throw new Error('truncated TGA pixel data');
        var packet = bytes[pos++];
        var count = (packet & 0x7f) + 1;
        if (packet & 0x80) {
          var base = pos;
          pos += bytesPerPixel;
          for (var r = 0; r < count && pixelIndex < pixelCount; r++) store(base);
        } else {
          for (var n = 0; n < count && pixelIndex < pixelCount; n++) {
            store(pos);
            pos += bytesPerPixel;
          }
        }
      }
    }

    return { width: width, height: height, rgba: rgba };
  }

  function toCanvas(bytes) {
    var image = decode(bytes);
    var canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    var ctx = canvas.getContext('2d');
    var data = ctx.createImageData(image.width, image.height);
    data.data.set(image.rgba);
    ctx.putImageData(data, 0, 0);
    return canvas;
  }

  root.Tga = { decode: decode, toCanvas: toCanvas };
  if (typeof module === 'object' && module.exports) module.exports = root.Tga;
})(typeof globalThis !== 'undefined' ? globalThis : this);
