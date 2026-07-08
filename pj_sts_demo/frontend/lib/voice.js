export const DEFAULT_WS_URL = "";
export const TARGET_SAMPLE_RATE = 16000;

const AudioContextCtor = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;

export function getBrowserDefaultWsUrl() {
  return DEFAULT_WS_URL;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, value));
}

export function nowLabel(date = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function downsampleBuffer(buffer, inputRate, outputRate) {
  if (outputRate >= inputRate) return buffer;
  const ratio = inputRate / outputRate;
  const newLength = Math.max(1, Math.round(buffer.length / ratio));
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let total = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
      total += buffer[i];
      count += 1;
    }
    result[offsetResult] = count > 0 ? total / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

export function floatToPcm16(float32Array) {
  const out = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function pcm16ToFloat32(pcm16) {
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i += 1) {
    float32[i] = pcm16[i] / 0x8000;
  }
  return float32;
}

export function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = clampByte(binary.charCodeAt(i));
  }
  return bytes;
}

export function pcm16ToBase64(pcm16) {
  return bytesToBase64(new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength));
}

export function base64ToPcm16(base64) {
  const bytes = base64ToBytes(base64);
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}

export function audioStatsFromBase64(base64) {
  const pcm16 = base64ToPcm16(base64);
  if (!pcm16.length) {
    return { samples: 0, bytes: 0, peak: 0, rms: 0 };
  }

  let peak = 0;
  let sumSquares = 0;
  for (let i = 0; i < pcm16.length; i += 1) {
    const sample = Math.abs(pcm16[i] / 0x8000);
    peak = Math.max(peak, sample);
    sumSquares += sample * sample;
  }

  return {
    samples: pcm16.length,
    bytes: pcm16.byteLength,
    peak,
    rms: Math.sqrt(sumSquares / pcm16.length),
  };
}

function writeString(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

export function createPcm16WavUrl(base64Chunks, sampleRate = TARGET_SAMPLE_RATE) {
  const chunks = base64Chunks.map(base64ToBytes);
  const dataLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  const bytes = new Uint8Array(buffer, 44);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });

  const blob = new Blob([buffer], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

export async function startMicCapture({ onChunk, onLevel, sampleRate = TARGET_SAMPLE_RATE }) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is not available in this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const audioContext = new AudioContextCtor();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const mute = audioContext.createGain();
  mute.gain.value = 0;

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const downsampled = downsampleBuffer(input, audioContext.sampleRate, sampleRate);
    const pcm16 = floatToPcm16(downsampled);
    const level = Math.sqrt(input.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(1, input.length));
    onLevel?.(Math.min(1, level * 3));
    onChunk(pcm16ToBase64(pcm16));
  };

  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioContext.destination);
  await audioContext.resume();

  return {
    stop() {
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      audioContext.close();
    },
  };
}

export class PcmPlayer {
  constructor({ sampleRate = TARGET_SAMPLE_RATE } = {}) {
    this.sampleRate = sampleRate;
    this.context = null;
    this.closed = false;
    this.queue = Promise.resolve();
  }

  async _context() {
    if (this.closed) throw new Error("Audio player is closed.");
    if (!this.context) {
      this.context = new AudioContextCtor();
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    return this.context;
  }

  async enqueue(base64) {
    const pcm16 = base64ToPcm16(base64);
    if (!pcm16.length) return;

    this.queue = this.queue.then(async () => {
      const context = await this._context();
      const buffer = context.createBuffer(1, pcm16.length, this.sampleRate);
      buffer.getChannelData(0).set(pcm16ToFloat32(pcm16));

      await new Promise((resolve) => {
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = resolve;
        source.start();
      });
    });

    return this.queue;
  }

  async resume() {
    await this._context();
  }

  reset() {
    this.queue = Promise.resolve();
  }

  close() {
    this.closed = true;
    if (this.context) {
      this.context.close();
      this.context = null;
    }
  }
}
