import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const datahubRoot = resolve(process.env.MOB_DUB_DATAHUB_ROOT ?? join(projectRoot, "..", "mc-datahub"));
const datasetsRoot = join(datahubRoot, "workspace", "datasets");
const statePath = join(datahubRoot, "workspace", "state.json");
const outputPath = join(projectRoot, "public", "data", "mob-sounds.json");
const outputImagesDir = join(projectRoot, "public", "images", "mobs");

const PREFERRED_TEXTURE_IDS = {
  axolotl: "minecraft:entity/axolotl/axolotl_lucy",
  cat: "minecraft:entity/cat/cat_tabby",
  chicken: "minecraft:entity/chicken/chicken_temperate",
  cow: "minecraft:entity/cow/cow_temperate",
  elder_guardian: "minecraft:entity/guardian/guardian_elder",
  ender_dragon: "minecraft:entity/enderdragon/dragon",
  frog: "minecraft:entity/frog/frog_temperate",
  giant: "minecraft:entity/zombie/zombie",
  happy_ghast: "minecraft:entity/ghast/happy_ghast",
  horse: "minecraft:entity/horse/horse_brown",
  magma_cube: "minecraft:entity/slime/magmacube",
  mooshroom: "minecraft:entity/cow/mooshroom_red",
  parrot: "minecraft:entity/parrot/parrot_red_blue",
  pig: "minecraft:entity/pig/pig_temperate",
  polar_bear: "minecraft:entity/bear/polarbear",
  rabbit: "minecraft:entity/rabbit/rabbit_brown",
  skeleton_horse: "minecraft:entity/horse/horse_skeleton",
  trader_llama: "minecraft:entity/llama/llama_brown",
  tropical_fish: "minecraft:entity/fish/tropical_a",
  zombie_horse: "minecraft:entity/horse/horse_zombie",
};

const LOW_PRIORITY_TEXTURE_MARKERS = [
  "banner/",
  "shield/",
  "_overlay",
  "_eyes",
  "_armor",
  "_beam",
  "_crackiness",
  "_markings",
  "_wool",
  "_undercoat",
  "_coral",
  "_fireball",
  "_spit",
  "_harness",
  "_ropes",
  "_saddle",
  "_wind",
  "_heart",
  "_pulsating_spots",
  "_bioluminescent_layer",
  "/profession",
  "/profession_level",
  "/baby/",
  "_baby",
  "/spark",
  "_invulnerable",
  "_exploding",
];

const requestedVersion = process.argv[2];

async function main() {
  const version = requestedVersion ?? (await resolveLatestProcessedVersion());
  if (!version) {
    throw new Error(`Could not determine a processed mc-datahub version from ${statePath}.`);
  }

  const sourcePath = join(datasetsRoot, version, "mob-sounds.json");
  const texturesPath = join(datasetsRoot, version, "textures.json");
  const mobDataset = JSON.parse(await readFile(sourcePath, "utf8"));
  const textures = JSON.parse(await readFile(texturesPath, "utf8"));

  const texturesById = new Map(textures.map((texture) => [texture.id, texture]));
  const entityTextures = textures.filter((texture) => texture.id.startsWith("minecraft:entity/"));

  await mkdir(dirname(outputPath), { recursive: true });
  await rm(outputImagesDir, { force: true, recursive: true });
  await mkdir(outputImagesDir, { recursive: true });

  const enrichedMobs = await Promise.all(
    mobDataset.mobs.map(async (mob) => {
      const texture = resolveMobTexture(mob, entityTextures, texturesById);
      const sourceImagePath = join(datasetsRoot, version, texture.imagePath);
      const targetFileName = `${mob.localId}.png`;
      const targetImagePath = join(outputImagesDir, targetFileName);

      await copyFile(sourceImagePath, targetImagePath);

      return {
        ...mob,
        imagePath: `/images/mobs/${targetFileName}`,
      };
    }),
  );

  await writeFile(
    outputPath,
    JSON.stringify(
      {
        ...mobDataset,
        mobs: enrichedMobs,
      },
      null,
      2,
    ),
  );

  console.log(`Synced ${version} mob sound data from ${sourcePath} to ${outputPath}`);
  console.log(`Copied ${enrichedMobs.length} mob images into ${outputImagesDir}`);
}

async function resolveLatestProcessedVersion() {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const processedVersions = Object.entries(state.processedVersions ?? {})
    .map(([version, details]) => ({
      version,
      processedAt: new Date(details.processedAt ?? 0).getTime(),
    }))
    .sort((left, right) => right.processedAt - left.processedAt);

  return processedVersions[0]?.version;
}

function resolveMobTexture(mob, entityTextures, texturesById) {
  const preferredTextureId = PREFERRED_TEXTURE_IDS[mob.localId];
  if (preferredTextureId) {
    const preferredTexture = texturesById.get(preferredTextureId);
    if (!preferredTexture) {
      throw new Error(`Missing preferred texture ${preferredTextureId} for ${mob.localId}.`);
    }

    return preferredTexture;
  }

  const rankedTextures = entityTextures
    .map((texture) => ({
      score: scoreTextureCandidate(mob, texture),
      texture,
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.texture.id.localeCompare(right.texture.id));

  if (!rankedTextures[0]) {
    throw new Error(`Could not find a mob image texture for ${mob.localId}.`);
  }

  return rankedTextures[0].texture;
}

function scoreTextureCandidate(mob, texture) {
  const baseName = texture.id.slice(texture.id.lastIndexOf("/") + 1);
  const normalizedBaseName = normalizeLookup(baseName);
  const normalizedLocalId = normalizeLookup(mob.localId);
  const normalizedSoundId = normalizeLookup(mob.soundId);

  let score = 0;

  if (baseName === mob.localId) {
    score += 200;
  }

  if (baseName === mob.soundId) {
    score += 180;
  }

  if (texture.id.includes(`/${mob.localId}/`)) {
    score += 80;
  }

  if (texture.id.includes(`/${mob.soundId}/`)) {
    score += 70;
  }

  if (baseName.startsWith(`${mob.localId}_`)) {
    score += 120;
  }

  if (mob.soundId !== mob.localId && baseName.startsWith(`${mob.soundId}_`)) {
    score += 105;
  }

  if (normalizedBaseName === normalizedLocalId) {
    score += 160;
  }

  if (normalizedBaseName === normalizedSoundId) {
    score += 150;
  }

  if (normalizedBaseName.startsWith(normalizedLocalId)) {
    score += 90;
  }

  if (normalizedSoundId !== normalizedLocalId && normalizedBaseName.startsWith(normalizedSoundId)) {
    score += 80;
  }

  if (normalizedBaseName.includes(normalizedLocalId)) {
    score += 40;
  }

  if (normalizedSoundId !== normalizedLocalId && normalizedBaseName.includes(normalizedSoundId)) {
    score += 30;
  }

  for (const marker of LOW_PRIORITY_TEXTURE_MARKERS) {
    if (texture.id.includes(marker)) {
      score -= 70;
    }
  }

  if (texture.id.includes("equipment/")) {
    score -= 140;
  }

  return score;
}

function normalizeLookup(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
