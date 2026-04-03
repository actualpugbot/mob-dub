const OGG_CANDIDATES = ["audio/ogg;codecs=opus", "audio/ogg"] as const;

export function getPreferredRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  return OGG_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
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
