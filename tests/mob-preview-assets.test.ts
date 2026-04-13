// @vitest-environment node

import { access, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { MobSoundsDataset } from "../src/types";

const PROJECT_ROOT = resolve(__dirname, "..");
const DATASET_PATH = resolve(PROJECT_ROOT, "public/data/mob-sounds.json");
const KNOWN_WIKI_GIF_MOB_IDS = ["camel_husk", "cod", "happy_ghast", "nautilus", "pufferfish", "salmon", "zombie_nautilus"];

describe("mob preview assets", () => {
  it("prefers local mob GIFs whenever they exist", async () => {
    const dataset = await readDataset();
    const mobImageFiles = await readdir(resolve(PROJECT_ROOT, "public", "images", "mobs"));
    const datasetMobIds = new Set(dataset.mobs.map((mob) => mob.localId));
    const gifMobIds = mobImageFiles
      .filter((fileName) => fileName.endsWith(".gif"))
      .map((fileName) => fileName.slice(0, -4))
      .filter((mobId) => datasetMobIds.has(mobId));

    expect(gifMobIds).toEqual(expect.arrayContaining(KNOWN_WIKI_GIF_MOB_IDS));

    for (const mobId of gifMobIds) {
      const mob = dataset.mobs.find((entry) => entry.localId === mobId);
      expect(mob, `Missing ${mobId} from local dataset`).toBeTruthy();
      expect(mob!.imagePath).toBe(`/images/mobs/${mobId}.gif`);

      await expect(access(resolve(PROJECT_ROOT, "public", "images", "mobs", `${mobId}.gif`))).resolves.toBeUndefined();
    }
  });
});

async function readDataset(): Promise<MobSoundsDataset> {
  return JSON.parse(await readFile(DATASET_PATH, "utf8")) as MobSoundsDataset;
}
