// @vitest-environment node

import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildResourcePackBlob, getResourcePackFileName } from "./export";
import type { MobDefinition, MobSoundsDataset } from "./types";

const TEST_MOB: MobDefinition = {
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
          assetPath: "minecraft/sounds/mob/cow/say2.ogg",
          hash: "b",
          id: "entity.cow.ambient#2",
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
  soundVariantCount: 2,
  translationKey: "entity.minecraft.cow",
};

const TEST_DATASET: MobSoundsDataset = {
  generatedAt: "2026-04-04T00:00:00.000Z",
  mobs: [TEST_MOB],
  resourcePack: {
    packFormat: 84,
  },
  version: "26.1.1",
};

describe("buildResourcePackBlob", () => {
  it("keeps muted variants out of sounds.json while still exporting the event", async () => {
    const blob = await buildResourcePackBlob({
      compatibilityMode: "broad",
      customizations: {},
      dataset: TEST_DATASET,
      mobs: [TEST_MOB],
      mutedVariantIds: {
        "entity.cow.ambient#2": true,
      },
    });

    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const soundsJson = JSON.parse(strFromU8(zip["assets/minecraft/sounds.json"]));

    expect(Array.from(zip["pack.png"].slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(soundsJson["entity.cow.ambient"]).toEqual({
      replace: true,
      sounds: [{ name: "mob/cow/say1" }],
      subtitle: "subtitles.entity.cow.ambient",
    });
  });

  it("writes customized variants into the mobvoices export layout", async () => {
    const blob = await buildResourcePackBlob({
      compatibilityMode: "broad",
      customizations: {
        "entity.cow.ambient#1": {
          blob: new Blob(["moo"], { type: "audio/ogg" }),
          fileName: "custom-cow.ogg",
          kind: "upload",
          mimeType: "audio/ogg",
          url: "blob:custom-cow",
        },
      },
      dataset: TEST_DATASET,
      mobs: [TEST_MOB],
      mutedVariantIds: {},
    });

    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const packMeta = JSON.parse(strFromU8(zip["pack.mcmeta"]));
    const soundsJson = JSON.parse(strFromU8(zip["assets/minecraft/sounds.json"]));

    expect(getResourcePackFileName()).toBe("Mob_Dub.zip");
    expect(zip["assets/minecraft/sounds/mobvoices/cow/ambient/voice_1.ogg"]).toBeTruthy();
    expect(packMeta).toEqual({
      pack: {
        description: "Custom mob voices recorded with Mob Dub",
        max_format: 84,
        min_format: 34,
        pack_format: 84,
        supported_formats: {
          max_inclusive: 84,
          min_inclusive: 34,
        },
      },
    });
    expect(soundsJson["entity.cow.ambient"]).toEqual({
      replace: true,
      sounds: [{ name: "mobvoices/cow/ambient/voice_1" }, { name: "mob/cow/say2" }],
      subtitle: "subtitles.entity.cow.ambient",
    });
  });
});
