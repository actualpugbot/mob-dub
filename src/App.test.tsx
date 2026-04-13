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
      introducedVersion: "Classic",
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
    {
      category: "passive",
      displayName: "Pig",
      id: "minecraft:pig",
      imagePath: "/images/mobs/pig.png",
      introducedVersion: "Classic",
      isRecent: false,
      localId: "pig",
      mobCategory: "creature",
      releaseStatus: "released",
      soundEventCount: 1,
      soundEvents: [
        {
          id: "entity.pig.ambient",
          subtitle: "Pig oinks",
          subtitleKey: "subtitles.entity.pig.ambient",
          variants: [
            {
              assetPath: "minecraft/sounds/mob/pig/say1.ogg",
              hash: "e",
              id: "entity.pig.ambient#1",
              pitch: 1,
              preload: false,
              size: 1,
              soundPath: "mob/pig/say1",
              stream: false,
              url: "https://example.com/pig-say1.ogg",
              volume: 1,
              weight: 1,
            },
          ],
        },
      ],
      soundId: "pig",
      soundVariantCount: 1,
      translationKey: "entity.minecraft.pig",
    },
  ],
  resourcePack: {
    packFormat: 84,
  },
  version: "26.1.1",
};

function getVariantRow(label: RegExp | string) {
  const rowLabel = screen
    .getAllByText(label)
    .find((element) => element.tagName === "STRONG" && element.closest(".variant-row"));

  expect(rowLabel).toBeTruthy();
  if (!rowLabel) {
    throw new Error(`Could not find variant row label for ${String(label)}`);
  }
  const row = rowLabel.closest(".variant-row") as HTMLElement | null;
  expect(row).not.toBeNull();
  return row!;
}

function rect(top: number, height = 420) {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 0,
    toJSON: () => ({}),
    top,
    width: 0,
    x: 0,
    y: top,
  };
}

describe("App", () => {
  beforeEach(() => {
    AudioMock.instances = [];

    vi.stubGlobal("Audio", AudioMock as unknown as typeof Audio);
    vi.stubGlobal("AudioContext", AudioContextMock as unknown as typeof AudioContext);
    vi.stubGlobal("ResizeObserver", ResizeObserverMock as unknown as typeof ResizeObserver);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
      writable: true,
    });
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 0,
      writable: true,
    });
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });

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

  it("shows the zero state guidance and reflects playback, uploads, and expanded event details", async () => {
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

    expect(screen.queryByText(/^ambient$/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: /more\.\.\. \(1 more\)/i }));
    expect(screen.getByText(/^ambient$/i)).toBeTruthy();
    expect(screen.getByText(/^hurt$/i)).toBeTruthy();

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

  it("warns before unloading when recorded or uploaded custom audio would be lost", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /^cow$/i }));

    const initialEvent = new Event("beforeunload", { cancelable: true });
    Object.defineProperty(initialEvent, "returnValue", {
      configurable: true,
      value: "",
      writable: true,
    });

    window.dispatchEvent(initialEvent);
    expect(initialEvent.defaultPrevented).toBe(false);
    expect(initialEvent.returnValue).toBe("");

    const say1Row = getVariantRow(/say1/i);
    const fileInput = say1Row.querySelector("input[type='file']") as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput!, {
      target: {
        files: [new File(["moo"], "custom-cow.ogg", { type: "audio/ogg" })],
      },
    });

    expect(await within(say1Row).findByRole("button", { name: /play custom preview for say1/i })).toBeTruthy();

    const dirtyEvent = new Event("beforeunload", { cancelable: true });
    Object.defineProperty(dirtyEvent, "returnValue", {
      configurable: true,
      value: "",
      writable: true,
    });

    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
    expect(dirtyEvent.returnValue).toBe("Your recorded and uploaded sounds will be wiped if you leave this page.");

    await user.click(within(say1Row).getByRole("button", { name: "Reset Changes" }));

    const resetEvent = new Event("beforeunload", { cancelable: true });
    Object.defineProperty(resetEvent, "returnValue", {
      configurable: true,
      value: "",
      writable: true,
    });

    window.dispatchEvent(resetEvent);
    expect(resetEvent.defaultPrevented).toBe(false);
    expect(resetEvent.returnValue).toBe("");
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

  it("shows a floating scroll-to-top control only after scrolling far down", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Build a pack in three quick steps");
    expect(screen.queryByRole("button", { name: /scroll back to top/i })).toBeNull();

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 1400,
      writable: true,
    });
    fireEvent.scroll(window);

    const scrollToTopButton = await screen.findByRole("button", { name: /scroll back to top/i });
    await user.click(scrollToTopButton);

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 0,
      writable: true,
    });
    fireEvent.scroll(window);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /scroll back to top/i })).toBeNull();
    });
  });

  it("moves between selected mob cards from the floating controls", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(await screen.findByRole("button", { name: /^cow$/i }));
    await user.click(screen.getByRole("button", { name: /^pig$/i }));

    expect(await screen.findByRole("heading", { name: "Cow" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Pig" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /scroll to previous mob card/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /scroll to next mob card/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /scroll back to top/i })).toBeTruthy();

    const mobCards = Array.from(container.querySelectorAll<HTMLElement>(".mob-card"));
    expect(mobCards).toHaveLength(2);

    const cowScrollIntoView = vi.fn();
    const pigScrollIntoView = vi.fn();
    Object.defineProperty(mobCards[0], "scrollIntoView", {
      configurable: true,
      value: cowScrollIntoView,
    });
    Object.defineProperty(mobCards[1], "scrollIntoView", {
      configurable: true,
      value: pigScrollIntoView,
    });

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 1400,
      writable: true,
    });
    fireEvent.scroll(window);

    Object.defineProperty(mobCards[0], "getBoundingClientRect", {
      configurable: true,
      value: () => rect(80),
    });
    Object.defineProperty(mobCards[1], "getBoundingClientRect", {
      configurable: true,
      value: () => rect(860),
    });

    await user.click(await screen.findByRole("button", { name: /scroll to next mob card/i }));
    expect(pigScrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });

    Object.defineProperty(mobCards[0], "getBoundingClientRect", {
      configurable: true,
      value: () => rect(-760),
    });
    Object.defineProperty(mobCards[1], "getBoundingClientRect", {
      configurable: true,
      value: () => rect(120),
    });

    await user.click(screen.getByRole("button", { name: /scroll to previous mob card/i }));
    expect(cowScrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });
});
