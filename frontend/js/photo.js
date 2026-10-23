// Read barcodes from a still photo (file picker, gallery, clipboard, drag & drop).
// A phone photo has far more resolution and better focus than a live video frame,
// so this rescues worn / small / glossy labels the live scanner cannot lock onto.
//
// Strategy: native BarcodeDetector when the platform has it (Android/ChromeOS/macOS,
// finds every code in the picture), otherwise @zxing/library with TRY_HARDER on
// several variants of the image (scale, 90° rotation, crops, contrast), stopping at
// the first hit. ZXing (~340 KB) is loaded only when a photo is actually used.

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const TIME_BUDGET_MS = 7000; // give up instead of freezing a phone on a codeless 12 MP photo

let zxingLoading = null;
let nativeDetector; // undefined = not probed yet, null = unavailable

async function getNativeDetector() {
  if (nativeDetector !== undefined) return nativeDetector;
  nativeDetector = null;
  try {
    if ('BarcodeDetector' in window) {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
      if (formats.length) nativeDetector = new window.BarcodeDetector({ formats });
    }
  } catch {
    nativeDetector = null;
  }
  return nativeDetector;
}

function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  zxingLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/zxing.min.js';
    script.onload = () => resolve(window.ZXing);
    script.onerror = () => {
      zxingLoading = null;
      reject(new Error('Не удалось загрузить декодер штрих-кодов'));
    };
    document.head.append(script);
  });
  return zxingLoading;
}

function zxingDecoder(Z) {
  const F = Z.BarcodeFormat;
  const hints = new Map([
    [Z.DecodeHintType.POSSIBLE_FORMATS, [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE]],
    // Scan every row and retry rotated; html5-qrcode's built-in ZXing runs without it.
    [Z.DecodeHintType.TRY_HARDER, true],
  ]);
  const reader = new Z.MultiFormatReader();
  return (canvas) => {
    try {
      const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
      return reader.decode(bitmap, hints).getText();
    } catch {
      return null; // NotFoundException / ChecksumException / FormatException
    }
  };
}

/** Decode the file into something drawable, honouring EXIF orientation. */
async function loadImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('Не удалось открыть изображение (формат не поддерживается браузером?)');
    }
    img.revoke = () => URL.revokeObjectURL(url);
    return img;
  }
}

/**
 * Draw a region of the image (fractions of width/height) scaled down to `maxSide`,
 * optionally rotated by 90° and contrast-stretched.
 */
function render(src, { maxSide = 1600, region = FULL, rotate = 0, contrast = false }) {
  const sx = Math.round(src.width * region.x);
  const sy = Math.round(src.height * region.y);
  const w0 = Math.round(src.width * region.w);
  const h0 = Math.round(src.height * region.h);
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.round(w0 * k);
  const h = Math.round(h0 * k);
  const canvas = document.createElement('canvas');
  canvas.width = rotate ? h : w;
  canvas.height = rotate ? w : h;
  const ctx = canvas.getContext('2d', { willReadFrequently: contrast });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (rotate) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotate * Math.PI) / 180);
    ctx.drawImage(src, sx, sy, w0, h0, -w / 2, -h / 2, w, h);
  } else {
    ctx.drawImage(src, sx, sy, w0, h0, 0, 0, w, h);
  }
  if (contrast) stretchContrast(ctx, canvas.width, canvas.height);
  return canvas;
}

/** Grayscale + linear contrast stretch: helps with glare and faded thermal labels. */
function stretchContrast(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(max - min, 1);
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i] - min) * 255) / range;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

const FULL = { x: 0, y: 0, w: 1, h: 1 };
const center = (f) => ({ x: (1 - f) / 2, y: (1 - f) / 2, w: f, h: f });

const quadrant = (x, y) => ({ x, y, w: 0.6, h: 0.6 });

/**
 * Attempts, ordered from most to least likely to succeed. Crops keep full sensor
 * resolution for a small code shot from a distance (centre first: people aim at
 * the code); quadrants catch a code sitting in a corner of the frame. Explicit 90°
 * variants help sideways codes that are also slightly tilted.
 * A failed attempt costs ~30-150 ms.
 */
function* variants() {
  yield { maxSide: 1600 };
  yield { maxSide: 1000 };
  yield { maxSide: 2400 };
  yield { maxSide: 1600, rotate: 90 };
  yield { region: center(0.5) };
  yield { region: center(0.5), rotate: 90 };
  for (const [x, y] of [[0, 0], [0.4, 0], [0, 0.4], [0.4, 0.4]]) {
    yield { region: quadrant(x, y) };
    yield { region: quadrant(x, y), rotate: 90 };
  }
  yield { region: center(0.3) };
  yield { region: center(0.3), rotate: 90 };
  yield { region: center(0.6), contrast: true };
  yield { region: center(0.6), rotate: 90, contrast: true };
}
const VARIANT_COUNT = [...variants()].length;

/**
 * @param {File|Blob} file
 * @param {(msg: string) => void} [onProgress]
 * @returns {Promise<{codes: string[], method: 'native'|'zxing', ms: number}>}
 */
export async function readBarcodesFromPhoto(file, onProgress = () => {}) {
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Это не изображение');
  if (file.size > MAX_FILE_BYTES) throw new Error('Файл больше 30 МБ');
  const t0 = performance.now();
  const src = await loadImage(file);
  try {
    const detector = await getNativeDetector();
    if (detector) {
      onProgress('Распознаю…');
      const found = await detector.detect(render(src, { maxSide: 2400 }));
      const codes = [...new Set(found.map((b) => String(b.rawValue).trim()).filter(Boolean))];
      if (codes.length) return { codes, method: 'native', ms: Math.round(performance.now() - t0) };
    }

    const decode = zxingDecoder(await loadZxing());
    const longSide = Math.max(src.width, src.height);
    let i = 0;
    for (const v of variants()) {
      onProgress(`Распознаю… ${Math.round((++i / VARIANT_COUNT) * 100)}%`);
      if (performance.now() - t0 > TIME_BUDGET_MS) break;
      // On a small picture the 1000/2400 px renders are identical to the 1600 px one.
      if (!v.region && v.maxSide !== 1600 && longSide <= Math.min(v.maxSide, 1600)) continue;
      // Decoding is synchronous: yield so the progress text and UI stay responsive.
      await new Promise((r) => setTimeout(r));
      const text = decode(render(src, v));
      if (text) return { codes: [String(text).trim()], method: 'zxing', ms: Math.round(performance.now() - t0) };
    }
    return { codes: [], method: detector ? 'native' : 'zxing', ms: Math.round(performance.now() - t0) };
  } finally {
    src.close?.();
    src.revoke?.();
  }
}
