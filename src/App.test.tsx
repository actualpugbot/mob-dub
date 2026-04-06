import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App, { usesStaticModelPreview } from "./App";
import type { MobSoundsDataset } from "./types";

class AudioMock {
  static instances: AudioMock[] = [];

  currentTime = 0;
  duration = 1;
  ended = false;
  onended: (() => void) | null = null;
  onloadedmetadata: (() => void) | null = null;
  onpause: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  pause = vi.fn(() => {
    this.onpause?.();
  });
  play = vi.fn().mockImplementation(async () => {
    this.onloadedmetadata?.();
  });

  constructor(public url: string) {
    AudioMock.instances.push(this);
  }
}

class AudioContextMock {
  decodeAudioData = vi.fn(async () => ({
    length: 56,
    numberOfChannels: 1,
    sampleRate: 48_000,
    getChannelData: () =>
      Float32Array.from([
        0.05,
        0.18,
        0.32,
        0.56,
        0.74,
        0.48,
        0.28,
        0.1,
        0.08,
        0.22,
        0.36,
        0.58,
        0.78,
        0.54,
      ]),
  }));
}

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

const TEST_DATASET: MobSoundsDataset = {
  generatedAt: "2026-04-04T00:00:00.000Z",
  mobs: [
    {
      category: "passive",
      displayName: "Cow",
      id: "minecraft:cow",
      imagePath: "/images/mobs/cow.png",
      introducedVersion: "Alpha",
      isRecent: false,
      localId: "cow",
      mobCategory: "creature",
      releaseStatus: "released",
      soundEventCount: 2,
      soundEvents: [
        {
          id: "entity.cow.ambient",
          subtitle: "Cow moos",
          subtitleKey: "subtitles.entity.cow.ambient",
          variants: [
            {
              assetPath: "minecraft/sounds/mob/cow/say1.ogg",
              hash: "a",
              id: "entity.cow.ambient#1",
              pitch: 1,
              preload: false,
              size: 1,
              soundPath: "mob/cow/say1",
              stream: false,
              url: "https://example.com/cow-say1.ogg",
              volume: 1,
              weight: 1,
            },
            {
              assetPath: "minecraft/sounds/mob/cow/say1.ogg",
              hash: "b",
              id: "entity.cow.ambient#2",
              pitch: 0.9,
              preload: false,
              size: 1,
              soundPath: "mob/cow/say1",
              stream: false,
              url: "https://example.com/cow-say1-low.ogg",
              volume: 1,
              weight: 1,
            },
            {
              assetPath: "minecraft/sounds/mob/cow/say2.ogg",
              hash: "c",
              id: "entity.cow.ambient#3",
              pitch: 1,
              preload: false,
              size: 1,
              soundPath: "mob/cow/say2",
              stream: false,
              url: "https://example.com/cow-say2.ogg",
              volume: 1,
              weight: 1,
            },
          ],
        },
        {
          id: "entity.cow.hurt",
          subtitle: "Cow hurts",
          subtitleKey: "subtitles.entity.cow.hurt",
          variants: [
            {
              assetPath: "minecraft/sounds/mob/cow/hurt1.ogg",
              hash: "d",
              id: "entity.cow.hurt#1",
              pitch: 1,
              preload: false,
              size: 1,
              soundPath: "mob/cow/hurt1",
              stream: false,
              url: "https://example.com/cow-hurt1.ogg",
              volume: 1,
              weight: 1,
            },
          ],
        },
      ],
      soundId: "cow",
      soundVariantCount: 4,
      translationKey: "entity.minecraft.cow",
    },
  ],
  resourcePack: {
    packFormat: 84,
  },
  version: "26.1.1",
};

function getVariantRow(label: RegExp | string) {
  const rowLabel = screen.getByText(label);
  const row = rowLabel.closest(".variant-row") as HTMLElement | null;
  expect(row).not.toBeNull();
  return row!;
}

describe("App", () => {
  beforeEach(() => {
    AudioMock.instances = [];

    vi.stubGlobal("Audio", AudioMock as unknown as typeof Audio);
    vi.stubGlobal("AudioContext", AudioContextMock as unknown as typeof AudioContext);
    vi.stubGlobal("ResizeObserver", ResizeObserverMock as unknown as typeof ResizeObserver);

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:mock-audio"),
      writable: true,
    });

    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("mob-sounds.json")) {
        return new Response(JSON.stringify(TEST_DATASET), { status: 200 });
      }

      if (url.endsWith(".ogg")) {
        return new Response(new Uint8Array([1, 3, 5, 7]).buffer, {
          status: 200,
          headers: { "Content-Type": "audio/ogg" },
        });
      }

      return new Response(JSON.stringify({ mobs: {} }), { status: 200 });
    }));
  });

  it("shows the zero state guidance and reflects playback, uploads, overrides, and mute state", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    expect(await screen.findByText("Build a pack in three quick steps")).toBeTruthy();
    expect(screen.getByText("Pick a mob")).toBeTruthy();
    expect(screen.getByText("Record or upload a sound")).toBeTruthy();
    expect(screen.getByText("Click Create Resource Pack")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^cow$/i }));

    const say1Row = getVariantRow(/say1/i);
    await user.click(within(say1Row).getByRole("button", { name: /play original preview for say1/i }));

    expect(AudioMock.instances).toHaveLength(1);
    expect(AudioMock.instances[0]?.url).toBe("https://example.com/cow-say1.ogg");
    expect(AudioMock.instances[0]?.play).toHaveBeenCalled();
    expect(within(say1Row).getByRole("button", { name: /stop original preview for say1/i })).toBeTruthy();
    expect(screen.queryByText("entity.cow.ambient")).toBeNull();

    const fileInput = say1Row.querySelector("input[type='file']") as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput!, {
      target: {
        files: [new File(["moo"], "custom-cow.ogg", { type: "audio/ogg" })],
      },
    });

    expect(await within(say1Row).findByRole("button", { name: /play custom preview for say1/i })).toBeTruthy();
    expect(say1Row.querySelectorAll(".variant-waveform-row")).toHaveLength(2);

    await user.click(within(say1Row).getByRole("button", { name: "Apply To Event" }));

    const say2Row = getVariantRow(/say2/i);
    expect(within(say2Row).getByRole("button", { name: /play custom preview for say2/i }).hasAttribute("disabled")).toBe(false);

    await user.click(within(say2Row).getByRole("button", { name: "Mute In Pack" }));
    expect(await within(say2Row).findByText("Muted in pack")).toBeTruthy();

    expect(screen.queryByText("entity.cow.ambient")).toBeNull();
    await user.click(screen.getByRole("button", { name: /more\.\.\. \(1 more\)/i }));
    expect(screen.getByText("entity.cow.ambient")).toBeTruthy();
    expect(screen.getByText("entity.cow.hurt")).toBeTruthy();

    await waitFor(() => {
      expect(container.querySelectorAll(".waveform-bar").length).toBeGreaterThan(0);
    });
  });

  it("removes a mob immediately when it has no uploaded or recorded custom audio", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /^cow$/i }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("Build a pack in three quick steps")).toBeTruthy();
  });

  it("asks for confirmation before removing a mob with uploaded custom audio", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /^cow$/i }));

    const say1Row = getVariantRow(/say1/i);
    const fileInput = say1Row.querySelector("input[type='file']") as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput!, {
      target: {
        files: [new File(["moo"], "custom-cow.ogg", { type: "audio/ogg" })],
      },
    });

    expect(await within(say1Row).findByRole("button", { name: /play custom preview for say1/i })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Remove Cow?" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "Cow" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Remove Mob" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("Build a pack in three quick steps")).toBeTruthy();
  });

  it("uses static model previews for mobs whose local assets are texture atlases", () => {
    expect(usesStaticModelPreview("camel_husk")).toBe(true);
    expect(usesStaticModelPreview("cod")).toBe(true);
    expect(usesStaticModelPreview("happy_ghast")).toBe(true);
    expect(usesStaticModelPreview("illusioner")).toBe(true);
    expect(usesStaticModelPreview("nautilus")).toBe(true);
    expect(usesStaticModelPreview("pufferfish")).toBe(true);
    expect(usesStaticModelPreview("salmon")).toBe(true);
    expect(usesStaticModelPreview("zombie_nautilus")).toBe(true);
    expect(usesStaticModelPreview("cow")).toBe(false);
  });
});
