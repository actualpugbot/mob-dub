// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import type { MobSoundsDataset } from "../src/types";

const PROJECT_ROOT = resolve(__dirname, "..");
const DATASET_PATH = resolve(PROJECT_ROOT, "public/data/mob-sounds.json");
const WIKI_SOUND_CHECKS = [
  {
    localId: "cave_spider",
    pageTitle: "Cave_Spider",
  },
  {
    localId: "mooshroom",
    pageTitle: "Mooshroom",
  },
  {
    localId: "sheep",
    pageTitle: "Sheep",
  },
] as const;

describe("mob dataset", () => {
  it("ships no blank preview URLs for mob sound variants", async () => {
    const dataset = await readDataset();
    const blankVariants = dataset.mobs.flatMap((mob) =>
      mob.soundEvents.flatMap((eventDefinition) =>
        eventDefinition.variants
          .filter((variant) => !variant.url)
          .map((variant) => `${mob.localId}:${eventDefinition.id}:${variant.id}`),
      ),
    );

    expect(blankVariants).toEqual([]);
  });

  it("matches key wiki sound event coverage for tricky mobs", async () => {
    const dataset = await readDataset();

    for (const check of WIKI_SOUND_CHECKS) {
      const mob = dataset.mobs.find((entry) => entry.localId === check.localId);
      expect(mob, `Missing ${check.localId} from local dataset`).toBeTruthy();

      const wikiEventIds = await fetchWikiSoundEventIds(check.pageTitle);
      const localEventIds = new Set(mob!.soundEvents.map((eventDefinition) => eventDefinition.id));

      for (const wikiEventId of wikiEventIds) {
        expect(
          localEventIds.has(wikiEventId),
          `${check.localId} is missing wiki sound event ${wikiEventId}`,
        ).toBe(true);
      }
    }
  });
});

async function readDataset(): Promise<MobSoundsDataset> {
  return JSON.parse(await readFile(DATASET_PATH, "utf8")) as MobSoundsDataset;
}

async function fetchWikiSoundEventIds(pageTitle: string) {
  const html = await readFile(resolve(PROJECT_ROOT, "tests/fixtures/wiki", `${pageTitle}.html`), "utf8");
  const dom = new JSDOM(html);
  const soundTable = dom.window.document.querySelector("table[data-description='Sound']");
  expect(soundTable, `Could not find a sound table on the ${pageTitle} wiki page`).toBeTruthy();

  return new Set(
    Array.from(soundTable!.querySelectorAll("code"))
      .map((element) => element.textContent?.replace(/\s+/g, "") ?? "")
      .filter((value) => value.startsWith("entity.")),
  );
}
