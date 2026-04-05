const OGG_CANDIDATES = ["audio/ogg;codecs=opus", "audio/ogg"] as const;
const DEFAULT_WAVEFORM_BAR_COUNT = 28;

const waveformCache = new Map<string, number[]>();
const waveformRequestCache = new Map<string, Promise<number[]>>();

let analysisAudioContext: AudioContext | null = null;

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

export async function ensureOggBlob(blob: Blob, progress?: (message: string) => void): Promise<Blob> {
  if (blob.type.includes("ogg")) {
    return blob;
  }

  progress?.("Re-encoding audio to OGG...");
  return transcodeBlobToOgg(blob);
}

async function transcodeBlobToOgg(blob: Blob): Promise<Blob> {
  const mimeType = getPreferredRecordingMimeType();
  if (!mimeType) {
    throw new Error("This browser cannot encode OGG audio for Minecraft resource packs.");
  }

  const audioContext = new AudioContext();
  try {
    await audioContext.resume();
    const audioBuffer = await decodeBlob(audioContext, blob);
    const destination = audioContext.createMediaStreamDestination();
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(destination);

    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(destination.stream, { mimeType });

    const completed = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = () => {
        reject(new Error("Could not encode uploaded audio as OGG."));
      };
      recorder.onstop = () => {
        if (chunks.length === 0) {
          reject(new Error("Audio conversion finished without producing any data."));
          return;
        }

        resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));
      };
    });

    recorder.start();
    source.start();

    await new Promise<void>((resolve) => {
      source.onended = () => {
        resolve();
      };
    });

    recorder.stop();
    return completed;
  } finally {
    await audioContext.close();
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
