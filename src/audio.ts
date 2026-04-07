const OGG_CANDIDATES = ["audio/ogg;codecs=opus", "audio/ogg"] as const;
const DEFAULT_WAVEFORM_BAR_COUNT = 28;
const FFMPEG_LOAD_TIMEOUT_MS = 120_000;
const FFMPEG_MASTER_FILTER =
  "highpass=f=80," +
  "acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120:makeup=3," +
  "loudnorm=I=-18:TP=-2:LRA=8," +
  "alimiter=limit=-1.5dB";
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
  const arrayBuffer = await blob.arrayBuffer();
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
  return [blob.type, mimeTypeHint, sourceName].some((value) => {
    const normalized = String(value ?? "").toLowerCase();
    return normalized.includes("audio/ogg") || normalized.endsWith(".ogg");
  });
}

function sanitizeFfmpegId(value: string) {
  return value.replace(/[^a-z0-9_-]/gi, "_").replace(/^_+|_+$/g, "") || "clip";
}

export function __setFfmpegRuntimeLoaderForTests(loader: ((progress?: ProgressCallback) => Promise<FfmpegRuntime>) | null) {
  ffmpegRuntimeLoader = loader ?? loadFfmpegRuntime;
  ffmpegRuntimePromise = null;
  nextConversionId = 0;
}
