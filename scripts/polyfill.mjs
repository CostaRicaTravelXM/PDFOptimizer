/**
 * Browser graphics globals, backed by @napi-rs/canvas, so the optimizer engine can be
 * exercised from Node.
 *
 * This exists purely for the verification harness (`scripts/bench.mjs`). The shipped app
 * runs the same engine code against the real browser implementations in a Web Worker.
 */

import { createCanvas, ImageData as NapiImageData, loadImage } from '@napi-rs/canvas';

class OffscreenCanvasShim {
  constructor(width, height) {
    this._canvas = createCanvas(Math.max(1, width), Math.max(1, height));
    this._w = width;
    this._h = height;
  }

  get width() {
    return this._w;
  }

  set width(v) {
    this._w = v;
    this._canvas = createCanvas(Math.max(1, v), Math.max(1, this._h));
  }

  get height() {
    return this._h;
  }

  set height(v) {
    this._h = v;
    this._canvas = createCanvas(Math.max(1, this._w), Math.max(1, v));
  }

  getContext(kind) {
    const ctx = this._canvas.getContext(kind);
    // drawImage must accept another shim as its source.
    if (!ctx.__patched) {
      const originalDraw = ctx.drawImage.bind(ctx);
      ctx.drawImage = (src, ...rest) =>
        originalDraw(src instanceof OffscreenCanvasShim ? src._canvas : src, ...rest);
      ctx.__patched = true;
    }
    return ctx;
  }

  async convertToBlob({ type = 'image/png', quality = 0.92 } = {}) {
    const format = type === 'image/jpeg' ? 'jpeg' : 'png';
    const buf = await this._canvas.encode(format, Math.round(quality * 100));
    return new Blob([buf], { type });
  }
}

globalThis.OffscreenCanvas ??= OffscreenCanvasShim;
globalThis.ImageData ??= NapiImageData;

globalThis.createImageBitmap ??= async (blob) => {
  const buf = Buffer.from(await blob.arrayBuffer());
  const img = await loadImage(buf);
  img.close ??= () => {};
  return img;
};
