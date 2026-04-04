import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { MobSoundsDataset } from "./types";

class AudioMock {
  static instances: AudioMock[] = [];

  currentTime = 0;
  ended = false;
  onended: (() => void) | null = null;
  onpause: (() => void) | null = null;
  pause = vi.fn(() => {
    this.onpause?.();
  });
  play = vi.fn().mockResolvedValue(undefined);

  constructor(public url: string) {
    AudioMock.instances.push(this);
  }
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
      soundEventCount: 1,
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
      ],
      soundId: "cow",
      soundVariantCount: 3,
      translationKey: "entity.minecraft.cow",
    },
  ],
  resourcePack: {
    packFormat: 84,
  },
  version: "26.1.1",
};

describe("App", () => {
  beforeEach(() => {
    AudioMock.instances = [];
    vi.stubGlobal("Audio", AudioMock as unknown as typeof Audio);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("mob-sounds.json")) {
          return new Response(JSON.stringify(TEST_DATASET), { status: 200 });
        }

        return new Response(JSON.stringify({ mobs: {} }), { status: 200 });
      }),
    );
  });

  it("shows the zero state guidance and reflects playback, uploads, overrides, and mute state", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    expect(await screen.findByText("Build a pack in three quick steps.")).toBeTruthy();
    expect(screen.getByText("Pick a mob on the left.")).toBeTruthy();
    expect(screen.getByText("Record or upload a sound.")).toBeTruthy();
    expect(screen.getByText("Click Create Resource Pack.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /cow/i }));

    const say1Button = await screen.findByRole("button", { name: /say1/i });
    await user.click(say1Button);

    expect(AudioMock.instances).toHaveLength(1);
    expect(AudioMock.instances[0]?.url).toBe("https://example.com/cow-say1.ogg");
    expect(AudioMock.instances[0]?.play).toHaveBeenCalled();
    expect(screen.getByText("Playing original")).toBeTruthy();

    const say1Row = say1Button.closest(".variant-row") as HTMLElement | null;
    expect(say1Row).not.toBeNull();

    const fileInput = say1Row?.querySelector("input[type='file']") as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput!, {
      target: {
        files: [new File(["moo"], "custom-cow.ogg", { type: "audio/ogg" })],
      },
    });

    expect(await within(say1Row!).findByText(/custom-cow\.ogg/i)).toBeTruthy();

    await user.click(within(say1Row!).getByRole("button", { name: "Override Event" }));

    const say2Label = screen.getByRole("button", { name: /say2/i });
    const say2Row = say2Label.closest(".variant-row") as HTMLElement | null;
    expect(say2Row).not.toBeNull();
    expect(within(say2Row!).getByRole("button", { name: "Play Custom" }).hasAttribute("disabled")).toBe(false);

    await user.click(within(say2Row!).getByRole("button", { name: "Mute" }));
    expect(await within(say2Row!).findByText("Muted in pack")).toBeTruthy();

    expect(container.querySelectorAll(".waveform-bars").length).toBeGreaterThan(0);
  });
});
