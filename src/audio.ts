const OGG_CANDIDATES = ["audio/ogg;codecs=opus", "audio/ogg"] as const;
const DEFAULT_WAVEFORM_BAR_COUNT = 28;
const DEAD_AIR_THRESHOLD = 0.008;
const DEAD_AIR_FRAME_SECONDS = 0.01;
const DEAD_AIR_PADDING_SECONDS = 0.025;
const DEAD_AIR_MIN_TRIMMED_SECONDS = 0.12;
const FFMPEG_LOAD_TIMEOUT_MS = 120_000;
const FFMPEG_MASTER_FILTER =
  "highpass=f=80," +
  "acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120:makeup=3," +
  "loudnorm=I=-18:TP=-2:LRA=8," +
  "alimiter=limit=-1.5dB";
const MAX_REFERENCE_MATCH_GAIN = 6;
const MIN_REFERENCE_MATCH_GAIN = 0.25;
const MIN_REFERENCE_RMS = 1e-5;
const MIN_SIGNIFICANT_GAIN_DELTA = 0.015;
const TARGET_MAX_PEAK = 0.98;
const FFMPEG_PROVIDERS = [
  {
    coreBase: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm",
    ffmpegModule: "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js",
    utilModule: "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js",
    workerBase: "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm",
  },
  {
    coreBase: "https://cdn.jsdelivr.net/npm/@ffmpeg/core-st@0.12.6/dist/esm",
    ffmpegModule: "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js",
    utilModule: "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js",
    workerBase: "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm",
  },
  {
    coreBase: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm",
    ffmpegModule: "https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js",
    utilModule: "https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js",
    workerBase: "https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm",
  },
  {
    coreBase: "https://unpkg.com/@ffmpeg/core-st@0.12.6/dist/esm",
    ffmpegModule: "https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js",
    utilModule: "https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js",
    workerBase: "https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm",
  },
] as const;

const waveformCache = new Map<string, number[]>();
const waveformRequestCache = new Map<string, Promise<number[]>>();
const referenceLevelCache = new Map<string, Promise<AudioLevelAnalysis>>();

let analysisAudioContext: AudioContext | null = null;
let ffmpegRuntimePromise: Promise<FfmpegRuntime> | null = null;
let ffmpegRuntimeLoader: (progress?: ProgressCallback) => Promise<FfmpegRuntime> = loadFfmpegRuntime;
let nextConversionId = 0;

type ProgressCallback = (message: string) => void;

interface EnsureOggBlobOptions {
  mimeType?: string;
  onProgress?: ProgressCallback;
  sourceId?: string;
  sourceName?: string;
}

interface EnhanceCustomAudioBlobOptions {
  onProgress?: ProgressCallback;
  referenceUrl?: string;
}

interface AudioLevelAnalysis {
  peak: number;
  rms: number;
}

interface AudioTrimRange {
  durationSec: number;
  endFrame: number;
  startFrame: number;
  trimmedEndSec: number;
  trimmedStartSec: number;
  wasTrimmed: boolean;
}

export interface EnhancedCustomAudioBlob {
  appliedGain: number;
  blob: Blob;
  durationSec: number;
  matchedReferenceLevel: boolean;
  trimmedEndSec: number;
  trimmedStartSec: number;
  wasTrimmed: boolean;
}

interface FfmpegModule {
  FFmpeg: new () => FfmpegInstance;
}

interface FfmpegInstance {
  deleteFile(path: string): Promise<void>;
  exec(args: string[]): Promise<void>;
  load(options: { classWorkerURL: string; coreURL: string; wasmURL: string; workerURL: string }): Promise<void>;
  on?(event: "log", callback: (payload: { message: string }) => void): void;
  readFile(path: string): Promise<ArrayBuffer | Uint8Array | number[]>;
  writeFile(path: string, data: ArrayBuffer | BlobPart | Uint8Array): Promise<void>;
}

interface FfmpegUtilModule {
  fetchFile(input: Blob): Promise<Uint8Array> | Uint8Array;
  toBlobURL(url: string, mimeType: string): Promise<string>;
}

interface FfmpegRuntime {
  ffmpeg: Pick<FfmpegInstance, "deleteFile" | "exec" | "readFile" | "writeFile">;
  fetchFile: FfmpegUtilModule["fetchFile"];
}

export function getPreferredRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  return OGG_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

export function getCachedWaveformBars(url: string): number[] | null {
  return waveformCache.get(url) ?? null;
}

export async function getWaveformBars(url: string, barCount = DEFAULT_WAVEFORM_BAR_COUNT): Promise<number[]> {
  if (!url || typeof fetch === "undefined") {
    return [];
  }

  const cached = waveformCache.get(url);
  if (cached) {
    return cached;
  }

  const existingRequest = waveformRequestCache.get(url);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    const audioContext = getAnalysisAudioContext();
    if (!audioContext) {
      return [];
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not load audio preview (${response.status}).`);
    }

    const audioBuffer = await decodeBlob(audioContext, await response.blob());
    const bars = buildWaveformBars(audioBuffer, barCount);
    waveformCache.set(url, bars);
    return bars;
  })();

  waveformRequestCache.set(url, request);

  try {
    return await request;
  } finally {
    waveformRequestCache.delete(url);
  }
}

export async function ensureOggBlob(blob: Blob, options: EnsureOggBlobOptions = {}): Promise<Blob> {
  if (isOggLike(blob, options.mimeType, options.sourceName)) {
    return blob;
  }

  options.onProgress?.("Loading audio converter...");
  return transcodeBlobToOgg(blob, options);
}

export async function enhanceCustomAudioBlob(
  blob: Blob,
  options: EnhanceCustomAudioBlobOptions = {},
): Promise<EnhancedCustomAudioBlob> {
  if (!blob.size) {
    return {
      appliedGain: 1,
      blob,
      durationSec: 0,
      matchedReferenceLevel: false,
      trimmedEndSec: 0,
      trimmedStartSec: 0,
      wasTrimmed: false,
    };
  }

  const audioContext = getAnalysisAudioContext();
  if (!audioContext) {
    return {
      appliedGain: 1,
      blob,
      durationSec: 0,
      matchedReferenceLevel: false,
      trimmedEndSec: 0,
      trimmedStartSec: 0,
      wasTrimmed: false,
    };
  }

  options.onProgress?.("Cleaning up audio...");
  const audioBuffer = await decodeBlob(audioContext, blob);
  const monoSamples = mixAudioBufferToMono(audioBuffer);
  const trimRange = resolveTrimRange(monoSamples, audioBuffer.sampleRate);
  const sourceLevels = analyzeSampleWindow(monoSamples, trimRange.startFrame, trimRange.endFrame);
  const referenceLevels = options.referenceUrl ? await getReferenceAudioLevels(options.referenceUrl).catch(() => null) : null;
  const appliedGain = resolveReferenceMatchGain(sourceLevels, referenceLevels);
  const matchedReferenceLevel = Math.abs(appliedGain - 1) >= MIN_SIGNIFICANT_GAIN_DELTA;

  if (!trimRange.wasTrimmed && !matchedReferenceLevel) {
    return {
      appliedGain: 1,
      blob,
      durationSec: trimRange.durationSec,
      matchedReferenceLevel: false,
      trimmedEndSec: 0,
      trimmedStartSec: 0,
      wasTrimmed: false,
    };
  }

  return {
    appliedGain,
    blob: encodeWavFromAudioBuffer(audioBuffer, {
      endFrame: trimRange.endFrame,
      gain: appliedGain,
      startFrame: trimRange.startFrame,
    }),
    durationSec: trimRange.durationSec,
    matchedReferenceLevel,
    trimmedEndSec: trimRange.trimmedEndSec,
    trimmedStartSec: trimRange.trimmedStartSec,
    wasTrimmed: trimRange.wasTrimmed,
  };
}

async function transcodeBlobToOgg(blob: Blob, options: EnsureOggBlobOptions): Promise<Blob> {
  const { ffmpeg, fetchFile } = await getFfmpegRuntime(options.onProgress);
  const safeId = sanitizeFfmpegId(options.sourceId ?? options.sourceName ?? `clip_${nextConversionId + 1}`);
  const inputExtension = guessInputExtension(options.mimeType ?? blob.type);
  const inputFile = `in_${safeId}.${inputExtension}`;
  const outputFile = `out_${safeId}.ogg`;

  nextConversionId += 1;
  options.onProgress?.("Re-encoding audio to OGG...");

  try {
    await ffmpeg.writeFile(inputFile, await Promise.resolve(fetchFile(blob)));
    await ffmpeg.exec([
      "-y",
      "-i",
      inputFile,
      "-vn",
      "-af",
      FFMPEG_MASTER_FILTER,
      "-c:a",
      "libvorbis",
      "-q:a",
      "4",
      outputFile,
    ]);

    const data = toUint8Array(await ffmpeg.readFile(outputFile));
    if (!data.byteLength) {
      throw new Error("Audio conversion finished without producing any data.");
    }

    const blobBuffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(blobBuffer).set(data);
    return new Blob([blobBuffer], { type: "audio/ogg" });
  } finally {
    try {
      await ffmpeg.deleteFile(inputFile);
    } catch {}

    try {
      await ffmpeg.deleteFile(outputFile);
    } catch {}
  }
}

async function decodeBlob(audioContext: AudioContext, blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blobToArrayBuffer(blob);
  return audioContext.decodeAudioData(arrayBuffer.slice(0));
}

function getAnalysisAudioContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") {
    return null;
  }

  analysisAudioContext ??= new AudioContext();
  return analysisAudioContext;
}

function buildWaveformBars(audioBuffer: AudioBuffer, barCount: number): number[] {
  const safeBarCount = Math.max(16, Math.min(barCount, 64));
  const monoSamples = mixAudioBufferToMono(audioBuffer);
  if (!monoSamples.length) {
    return [];
  }

  const samplesPerBar = Math.max(1, Math.floor(monoSamples.length / safeBarCount));
  const bars: number[] = [];
  let maxRms = 0;

  for (let index = 0; index < safeBarCount; index += 1) {
    const start = index * samplesPerBar;
    if (start >= monoSamples.length) {
      break;
    }

    const end = Math.min(monoSamples.length, start + samplesPerBar);
    let energy = 0;

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      const sample = monoSamples[sampleIndex] ?? 0;
      energy += sample * sample;
    }

    const rms = Math.sqrt(energy / Math.max(1, end - start));
    bars.push(rms);
    if (rms > maxRms) {
      maxRms = rms;
    }
  }

  if (!bars.length || maxRms <= 0) {
    return [];
  }

  return bars.map((value) => Math.max(12, Math.round((value / maxRms) * 100)));
}

async function getReferenceAudioLevels(url: string): Promise<AudioLevelAnalysis> {
  const cached = referenceLevelCache.get(url);
  if (cached) {
    return cached;
  }

  const request = (async () => {
    const audioContext = getAnalysisAudioContext();
    if (!audioContext) {
      throw new Error("Audio analysis is unavailable.");
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not load original audio preview (${response.status}).`);
    }

    const audioBuffer = await decodeBlob(audioContext, await response.blob());
    const monoSamples = mixAudioBufferToMono(audioBuffer);
    const trimRange = resolveTrimRange(monoSamples, audioBuffer.sampleRate);
    return analyzeSampleWindow(monoSamples, trimRange.startFrame, trimRange.endFrame);
  })();

  referenceLevelCache.set(url, request);

  try {
    return await request;
  } catch (error) {
    referenceLevelCache.delete(url);
    throw error;
  }
}

function mixAudioBufferToMono(audioBuffer: AudioBuffer): Float32Array {
  const channelCount = Math.max(1, audioBuffer.numberOfChannels || 1);
  const monoSamples = new Float32Array(audioBuffer.length || 0);

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelData = audioBuffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < monoSamples.length; sampleIndex += 1) {
      monoSamples[sampleIndex] += (channelData[sampleIndex] ?? 0) / channelCount;
    }
  }

  return monoSamples;
}

function resolveTrimRange(samples: Float32Array, sampleRate: number): AudioTrimRange {
  const safeSampleRate = Math.max(1, Number(sampleRate || 44_100));
  const totalFrames = samples.length;
  const fullRange = createDefaultTrimRange(totalFrames, safeSampleRate);
  if (!totalFrames) {
    return fullRange;
  }

  const frameSize = Math.max(1, Math.floor(safeSampleRate * DEAD_AIR_FRAME_SECONDS));
  const paddingFrames = Math.max(0, Math.floor(safeSampleRate * DEAD_AIR_PADDING_SECONDS));
  let firstSoundFrame = -1;
  let lastSoundFrameExclusive = -1;

  for (let frameStart = 0; frameStart < totalFrames; frameStart += frameSize) {
    const frameEnd = Math.min(totalFrames, frameStart + frameSize);
    let peak = 0;

    for (let sampleIndex = frameStart; sampleIndex < frameEnd; sampleIndex += 1) {
      peak = Math.max(peak, Math.abs(samples[sampleIndex] ?? 0));
    }

    if (peak >= DEAD_AIR_THRESHOLD) {
      if (firstSoundFrame < 0) {
        firstSoundFrame = frameStart;
      }
      lastSoundFrameExclusive = frameEnd;
    }
  }

  if (firstSoundFrame < 0 || lastSoundFrameExclusive <= firstSoundFrame) {
    return fullRange;
  }

  const startFrame = Math.max(0, firstSoundFrame - paddingFrames);
  const endFrame = Math.min(totalFrames, lastSoundFrameExclusive + paddingFrames);
  const durationSec = (endFrame - startFrame) / safeSampleRate;

  if ((startFrame <= 0 && endFrame >= totalFrames) || durationSec < DEAD_AIR_MIN_TRIMMED_SECONDS) {
    return fullRange;
  }

  return {
    durationSec,
    endFrame,
    startFrame,
    trimmedEndSec: (totalFrames - endFrame) / safeSampleRate,
    trimmedStartSec: startFrame / safeSampleRate,
    wasTrimmed: true,
  };
}

function createDefaultTrimRange(totalFrames: number, sampleRate: number): AudioTrimRange {
  return {
    durationSec: totalFrames / Math.max(1, sampleRate),
    endFrame: totalFrames,
    startFrame: 0,
    trimmedEndSec: 0,
    trimmedStartSec: 0,
    wasTrimmed: false,
  };
}

function analyzeSampleWindow(samples: Float32Array, startFrame = 0, endFrame = samples.length): AudioLevelAnalysis {
  const safeStart = Math.max(0, Math.min(samples.length, startFrame));
  const safeEnd = Math.max(safeStart, Math.min(samples.length, endFrame));
  let energy = 0;
  let peak = 0;

  for (let sampleIndex = safeStart; sampleIndex < safeEnd; sampleIndex += 1) {
    const sample = samples[sampleIndex] ?? 0;
    const magnitude = Math.abs(sample);
    energy += sample * sample;
    if (magnitude > peak) {
      peak = magnitude;
    }
  }

  const frameCount = Math.max(0, safeEnd - safeStart);
  return {
    peak,
    rms: frameCount ? Math.sqrt(energy / frameCount) : 0,
  };
}

function resolveReferenceMatchGain(source: AudioLevelAnalysis, reference: AudioLevelAnalysis | null) {
  if (!reference || reference.rms <= MIN_REFERENCE_RMS || source.rms <= MIN_REFERENCE_RMS) {
    return 1;
  }

  const desiredGain = clamp(reference.rms / source.rms, MIN_REFERENCE_MATCH_GAIN, MAX_REFERENCE_MATCH_GAIN);
  if (!Number.isFinite(desiredGain) || desiredGain <= 0) {
    return 1;
  }

  const peakLimitedGain = source.peak > 0 ? Math.min(desiredGain, TARGET_MAX_PEAK / source.peak) : desiredGain;
  return Math.max(0, peakLimitedGain);
}

function encodeWavFromAudioBuffer(
  audioBuffer: AudioBuffer,
  options: {
    endFrame?: number;
    gain?: number;
    startFrame?: number;
  } = {},
) {
  const totalFrames = audioBuffer.length || 0;
  const channelCount = Math.max(1, audioBuffer.numberOfChannels || 1);
  const safeStartFrame = Math.max(0, Math.min(totalFrames, options.startFrame ?? 0));
  const requestedEndFrame = options.endFrame ?? totalFrames;
  const safeEndFrame = Math.max(safeStartFrame, Math.min(totalFrames, requestedEndFrame));
  const frameCount = Math.max(0, safeEndFrame - safeStartFrame);
  const sampleRate = Math.max(1, Math.round(audioBuffer.sampleRate || 44_100));
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataBytes = frameCount * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(arrayBuffer);
  const gain = Number.isFinite(options.gain) ? Math.max(0, options.gain ?? 1) : 1;
  let offset = 0;

  const writeAscii = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset, value.charCodeAt(index));
      offset += 1;
    }
  };
  const writeUint16 = (value: number) => {
    view.setUint16(offset, value, true);
    offset += 2;
  };
  const writeUint32 = (value: number) => {
    view.setUint32(offset, value, true);
    offset += 4;
  };

  writeAscii("RIFF");
  writeUint32(36 + dataBytes);
  writeAscii("WAVE");
  writeAscii("fmt ");
  writeUint32(16);
  writeUint16(1);
  writeUint16(channelCount);
  writeUint32(sampleRate);
  writeUint32(sampleRate * blockAlign);
  writeUint16(blockAlign);
  writeUint16(16);
  writeAscii("data");
  writeUint32(dataBytes);

  const channels = Array.from({ length: channelCount }, (_, channelIndex) => audioBuffer.getChannelData(channelIndex));
  for (let frameIndex = safeStartFrame; frameIndex < safeEndFrame; frameIndex += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const inputSample = (channels[channelIndex]?.[frameIndex] ?? 0) * gain;
      const clampedSample = clamp(inputSample, -1, 1);
      const pcmValue = clampedSample < 0 ? Math.round(clampedSample * 0x8000) : Math.round(clampedSample * 0x7fff);
      view.setInt16(offset, pcmValue, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function getFfmpegRuntime(progress?: ProgressCallback): Promise<FfmpegRuntime> {
  ffmpegRuntimePromise ??= ffmpegRuntimeLoader(progress);
  return ffmpegRuntimePromise;
}

async function loadFfmpegRuntime(progress?: ProgressCallback): Promise<FfmpegRuntime> {
  let lastError: unknown = null;

  for (const provider of FFMPEG_PROVIDERS) {
    let workerURL = "";
    let coreURL = "";
    let wasmURL = "";

    try {
      progress?.("Loading audio converter...");
      const [ffmpegModule, utilModule] = (await Promise.all([
        import(/* @vite-ignore */ provider.ffmpegModule) as Promise<FfmpegModule>,
        import(/* @vite-ignore */ provider.utilModule) as Promise<FfmpegUtilModule>,
      ])) as [FfmpegModule, FfmpegUtilModule];

      const ffmpeg = new ffmpegModule.FFmpeg();
      ffmpeg.on?.("log", ({ message }) => {
        if (message === "Aborted()") {
          return;
        }
      });

      progress?.("Preparing audio converter...");
      workerURL = await buildFfmpegWorkerBlobURL(provider.workerBase, progress);
      coreURL = await utilModule.toBlobURL(`${provider.coreBase}/ffmpeg-core.js`, "text/javascript");
      wasmURL = await utilModule.toBlobURL(`${provider.coreBase}/ffmpeg-core.wasm`, "application/wasm");

      await Promise.race([
        ffmpeg.load({ classWorkerURL: workerURL, workerURL, coreURL, wasmURL }),
        new Promise<never>((_, reject) => {
          globalThis.setTimeout(() => {
            reject(new Error(`ffmpeg load timeout (${Math.round(FFMPEG_LOAD_TIMEOUT_MS / 1000)}s)`));
          }, FFMPEG_LOAD_TIMEOUT_MS);
        }),
      ]);

      return {
        ffmpeg,
        fetchFile: utilModule.fetchFile,
      };
    } catch (error) {
      lastError = error;
    } finally {
      if (workerURL) {
        URL.revokeObjectURL(workerURL);
      }
      if (coreURL) {
        URL.revokeObjectURL(coreURL);
      }
      if (wasmURL) {
        URL.revokeObjectURL(wasmURL);
      }
    }
  }

  ffmpegRuntimePromise = null;

  throw new Error(
    `Could not initialize ffmpeg for audio conversion (${String((lastError as Error | undefined)?.message ?? lastError)}). ` +
      "Make sure you're running from a local server and that CDN requests are not blocked.",
  );
}

async function buildFfmpegWorkerBlobURL(workerBase: string, progress?: ProgressCallback) {
  progress?.("Preparing audio converter...");

  const [workerSource, constSource, errorSource] = await Promise.all([
    fetchText(`${workerBase}/worker.js`),
    fetchText(`${workerBase}/const.js`),
    fetchText(`${workerBase}/errors.js`),
  ]);
  const workerWithoutImports = workerSource.replace(/^import\s+[^;]+;\s*$/gm, "");
  const workerBlob = new Blob([`${errorSource}\n${constSource}\n${workerWithoutImports}`], { type: "text/javascript" });
  return URL.createObjectURL(workerBlob);
}

async function fetchText(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

async function blobToArrayBuffer(blob: Blob) {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }

  return new Response(blob).arrayBuffer();
}

function toUint8Array(data: ArrayBuffer | Uint8Array | number[]) {
  if (data instanceof Uint8Array) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  return Uint8Array.from(data);
}

function guessInputExtension(value: string) {
  const mimeType = value.toLowerCase();

  if (mimeType.includes("ogg")) {
    return "ogg";
  }

  if (mimeType.includes("webm")) {
    return "webm";
  }

  if (mimeType.includes("mp4") || mimeType.includes("m4a") || mimeType.includes("aac")) {
    return "m4a";
  }

  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) {
    return "mp3";
  }

  if (mimeType.includes("wav")) {
    return "wav";
  }

  return "dat";
}

function isOggLike(blob: Blob, mimeTypeHint?: string, sourceName?: string) {
  const normalizedMimeTypes = [blob.type, mimeTypeHint].map((value) => String(value ?? "").toLowerCase()).filter(Boolean);
  if (normalizedMimeTypes.length) {
    return normalizedMimeTypes.some((value) => value.includes("audio/ogg") || value.includes("application/ogg"));
  }

  return [sourceName].some((value) => {
    const normalized = String(value ?? "").toLowerCase();
    return normalized.endsWith(".ogg");
  });
}

function sanitizeFfmpegId(value: string) {
  return value.replace(/[^a-z0-9_-]/gi, "_").replace(/^_+|_+$/g, "") || "clip";
}

export function __setFfmpegRuntimeLoaderForTests(loader: ((progress?: ProgressCallback) => Promise<FfmpegRuntime>) | null) {
  analysisAudioContext = null;
  ffmpegRuntimeLoader = loader ?? loadFfmpegRuntime;
  ffmpegRuntimePromise = null;
  nextConversionId = 0;
  referenceLevelCache.clear();
  waveformCache.clear();
  waveformRequestCache.clear();
}
