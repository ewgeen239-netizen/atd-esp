// Camera scanning via html5-qrcode (loaded as a global from /vendor).

const COOLDOWN_MS = 3000;

export class CameraScanner {
  constructor(elementId, onCode) {
    this.elementId = elementId;
    this.onCode = onCode;
    this.instance = null;
    this.running = false;
    this.cameras = [];
    this.cameraIndex = -1;
    this.last = { code: '', at: 0 };
    this.paused = false;
    this.torchOn = false;
  }

  #create() {
    const F = window.Html5QrcodeSupportedFormats;
    this.instance = new window.Html5Qrcode(this.elementId, {
      verbose: false,
      formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE],
      // Native BarcodeDetector (Chrome/Android) is much faster than the JS decoder.
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
  }

  async start() {
    if (!window.Html5Qrcode) throw new Error('Библиотека сканера не загрузилась');
    if (!window.isSecureContext) throw new Error('Камера доступна только по HTTPS или на localhost');
    if (!this.instance) this.#create();
    const camera = this.cameraIndex >= 0 && this.cameras[this.cameraIndex]
      ? { deviceId: { exact: this.cameras[this.cameraIndex].id } }
      : { facingMode: 'environment' };
    await this.instance.start(
      camera,
      {
        fps: 12,
        // Wide, short box: 1D barcodes on parts boxes
        qrbox: (w, hgt) => ({ width: Math.floor(Math.min(w * 0.9, 420)), height: Math.floor(Math.min(hgt * 0.45, 180)) }),
        disableFlip: true,
      },
      (text) => this.#handle(text),
      () => {},
    );
    this.running = true;
    if (!this.cameras.length) {
      try {
        this.cameras = await window.Html5Qrcode.getCameras();
      } catch {
        this.cameras = [];
      }
    }
  }

  #handle(text) {
    const code = String(text).trim();
    const now = Date.now();
    if (this.paused) return;
    if (code === this.last.code && now - this.last.at < COOLDOWN_MS) return;
    this.last = { code, at: now };
    this.onCode(code);
  }

  /** Ignore decodes while a lookup is running. */
  pause(v) {
    this.paused = v;
  }

  async stop() {
    if (this.instance && this.running) {
      try {
        await this.instance.stop();
      } catch {
        /* already stopped */
      }
    }
    this.running = false;
    this.torchOn = false;
  }

  async switchCamera() {
    if (this.cameras.length < 2) return false;
    this.cameraIndex = (this.cameraIndex + 1) % this.cameras.length;
    await this.stop();
    await this.start();
    return true;
  }

  torchSupported() {
    try {
      return !!this.instance?.getRunningTrackCameraCapabilities?.().torchFeature().isSupported();
    } catch {
      return false;
    }
  }

  async toggleTorch() {
    const torch = this.instance.getRunningTrackCameraCapabilities().torchFeature();
    this.torchOn = !this.torchOn;
    await torch.apply(this.torchOn);
    return this.torchOn;
  }
}

/**
 * Hardware scanners in keyboard-wedge mode type the code very fast and finish with Enter.
 * Catch that even when no input is focused.
 */
export function listenKeyboardWedge(onCode, isActive) {
  let buf = '';
  let lastAt = 0;
  window.addEventListener('keydown', (e) => {
    if (!isActive()) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const now = performance.now();
    if (now - lastAt > 60) buf = '';
    lastAt = now;
    if (e.key === 'Enter') {
      if (buf.length >= 6) {
        e.preventDefault();
        onCode(buf);
      }
      buf = '';
    } else if (e.key.length === 1) {
      buf += e.key;
    }
  });
}
