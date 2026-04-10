import { afterEach, describe, expect, it, vi } from "vitest";
import { __setFfmpegRuntimeLoaderForTests, enhanceCustomAudioBlob, ensureOggBlob } from "./audio";

describe("ensureOggBlob", () => {
  afterEach(() => {
    __setFfmpegRuntimeLoaderForTests(null);
  });

  it("skips conversion when the uploaded filename is already OGG", async () => {
    const loader = vi.fn(async () => {
      throw new Error("ffmpeg loader should not run for existing ogg files");
    });
    const blob = new Blob(["ogg-bytes"], { type: "" });

    __setFfmpegRuntimeLoaderForTests(loader);

    const result = await ensureOggBlob(blob, {
      sourceName: "custom-cow.ogg",
    });

    expect(result).toBe(blob);
    expect(loader).not.toHaveBeenCalled();
  });

  it("converts non-ogg uploads with the ffmpeg runtime", async () => {
    const writeFile = vi.fn(async () => undefined);
    const exec = vi.fn(async () => undefined);
    const readFile = vi.fn(async () => new Uint8Array([79, 103, 103]));
    const deleteFile = vi.fn(async () => undefined);
    const fetchFile = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const loader = vi.fn(async () => ({
      ffmpeg: {
        deleteFile,
        exec,
        readFile,
        writeFile,
      },
      fetchFile,
    }));
    const progress = vi.fn();
    const blob = new Blob(["wave-bytes"], { type: "audio/wav" });

    __setFfmpegRuntimeLoaderForTests(loader);

    const result = await ensureOggBlob(blob, {
      onProgress: progress,
      sourceId: "entity.cow.ambient#1",
    });

    expect(loader).toHaveBeenCalledOnce();
    expect(fetchFile).toHaveBeenCalledWith(blob);
    expect(writeFile).toHaveBeenCalledWith("in_entity_cow_ambient_1.wav", new Uint8Array([1, 2, 3]));
    expect(exec).toHaveBeenCalledWith([
      "-y",
      "-i",
      "in_entity_cow_ambient_1.wav",
      "-vn",
      "-af",
      "highpass=f=80,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120:makeup=3,loudnorm=I=-18:TP=-2:LRA=8,alimiter=limit=-1.5dB",
      "-c:a",
      "libvorbis",
      "-q:a",
      "4",
      "out_entity_cow_ambient_1.ogg",
    ]);
    expect(deleteFile).toHaveBeenCalledWith("in_entity_cow_ambient_1.wav");
    expect(deleteFile).toHaveBeenCalledWith("out_entity_cow_ambient_1.ogg");
    expect(progress).toHaveBeenCalled();
    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("audio/ogg");
  });
});

describe("enhanceCustomAudioBlob", () => {
  afterEach(() => {
    __setFfmpegRuntimeLoaderForTests(null);
  });

  it("trims dead air and matches the original preview loudness", async () => {
    const decodeResults = [
      createAudioBufferMock([
        ...new Array<number>(100).fill(0),
        ...new Array<number>(100).fill(0.1),
        ...new Array<number>(100).fill(0),
      ]),
      createAudioBufferMock(new Array<number>(120).fill(0.5)),
    ];

    class AudioContextMock {
      decodeAudioData = vi.fn(async () => decodeResults.shift() as unknown as AudioBuffer);
    }

    vi.stubGlobal("AudioContext", AudioContextMock as unknown as typeof AudioContext);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/ogg" }),
        ok: true,
      })),
    );

    const blob = new Blob([new Uint8Array([4, 5, 6])], { type: "audio/webm" });
    const result = await enhanceCustomAudioBlob(blob, {
      referenceUrl: "https://example.com/cow-say1.ogg",
    });

    expect(result.blob.type).toBe("audio/wav");
    expect(result.wasTrimmed).toBe(true);
    expect(result.trimmedStartSec).toBeCloseTo(0.075, 3);
    expect(result.trimmedEndSec).toBeCloseTo(0.075, 3);
    expect(result.durationSec).toBeCloseTo(0.15, 3);
    expect(result.matchedReferenceLevel).toBe(true);
    expect(result.appliedGain).toBeCloseTo(6, 4);
  });
});

function createAudioBufferMock(samples: number[], sampleRate = 1_000) {
  const data = Float32Array.from(samples);

  return {
    length: data.length,
    numberOfChannels: 1,
    sampleRate,
    getChannelData: () => data,
  };
}
