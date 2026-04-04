import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MOB_RELEASE_METADATA_BY_LOCAL_ID } from "./mob-release-metadata.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const datahubRoot = resolve(process.env.MOB_DUB_DATAHUB_ROOT ?? join(projectRoot, "..", "mc-datahub"));
const datasetsRoot = join(datahubRoot, "workspace", "datasets");
const statePath = join(datahubRoot, "workspace", "state.json");
const outputPath = join(projectRoot, "public", "data", "mob-sounds.json");
const outputImagesDir = join(projectRoot, "public", "images", "mobs");
const OMITTED_MOB_IDS = new Set(["giant"]);

const requestedVersion = process.argv[2];

async function main() {
  const version = requestedVersion ?? (await resolveLatestProcessedVersion());
  if (!version) {
    throw new Error(`Could not determine a processed mc-datahub version from ${statePath}.`);
  }

  const sourcePath = join(datasetsRoot, version, "mob-sounds.json");
  const mobDataset = JSON.parse(await readFile(sourcePath, "utf8"));
  const normalizedMobDataset = withManualMobCorrections(withInheritedMobSounds(mobDataset));

  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(outputImagesDir, { recursive: true });

  const missingReleaseMetadata = normalizedMobDataset.mobs
    .map((mob) => mob.localId)
    .filter((mobId) => !MOB_RELEASE_METADATA_BY_LOCAL_ID[mobId]);

  if (missingReleaseMetadata.length > 0) {
    throw new Error(`Missing release metadata for mob ids: ${missingReleaseMetadata.sort().join(", ")}`);
  }

  const enrichedMobs = await Promise.all(
    normalizedMobDataset.mobs.map(async (mob) => {
      const targetFileName = await resolveLocalImageFileName(mob.localId);
      const targetImagePath = join(outputImagesDir, targetFileName);
      await assertLocalImageExists(targetImagePath, targetFileName, mob.localId);
      const releaseMetadata = MOB_RELEASE_METADATA_BY_LOCAL_ID[mob.localId];

      return {
        ...mob,
        ...releaseMetadata,
        imagePath: `/images/mobs/${targetFileName}`,
      };
    }),
  );

  await writeFile(
    outputPath,
    JSON.stringify(
      {
        ...normalizedMobDataset,
        mobs: enrichedMobs,
      },
      null,
      2,
    ),
  );

  console.log(`Synced ${version} mob sound data from ${sourcePath} to ${outputPath}`);
  console.log(`Validated ${enrichedMobs.length} vendored mob images in ${outputImagesDir}`);
}

function withInheritedMobSounds(mobDataset) {
  const inheritedMobSoundConfigs = [
    {
      targetLocalId: "cave_spider",
      sourceLocalId: "spider",
      mode: "replace-if-empty",
    },
    {
      targetLocalId: "trader_llama",
      sourceLocalId: "llama",
      mode: "replace-if-empty",
    },
    {
      targetLocalId: "mooshroom",
      sourceLocalId: "cow",
      mode: "merge-missing-events",
      eventIds: ["entity.cow.ambient", "entity.cow.death", "entity.cow.hurt", "entity.cow.milk", "entity.cow.step"],
    },
  ];

  let nextMobs = mobDataset.mobs;

  for (const config of inheritedMobSoundConfigs) {
    nextMobs = applyInheritedMobSounds(nextMobs, config);
  }

  if (nextMobs === mobDataset.mobs) {
    return mobDataset;
  }

  return {
    ...mobDataset,
    mobs: nextMobs,
  };
}

function withManualMobCorrections(mobDataset) {
  const nextMobs = mobDataset.mobs.filter((mob) => !OMITTED_MOB_IDS.has(mob.localId));

  if (nextMobs === mobDataset.mobs) {
    return mobDataset;
  }

  return {
    ...mobDataset,
    mobs: nextMobs,
  };
}

function applyInheritedMobSounds(mobs, config) {
  const targetMob = mobs.find((mob) => mob.localId === config.targetLocalId);
  const sourceMob = mobs.find((mob) => mob.localId === config.sourceLocalId);

  if (!targetMob || !sourceMob || sourceMob.soundEvents.length === 0) {
    return mobs;
  }

  if (config.mode === "replace-if-empty") {
    if (targetMob.soundEvents.length > 0) {
      return mobs;
    }

    return mobs.map((mob) => {
      if (mob.localId !== config.targetLocalId) {
        return mob;
      }

      return withUpdatedSoundEventCounts(mob, structuredClone(sourceMob.soundEvents));
    });
  }

  const inheritedEventIds = new Set(config.eventIds ?? []);
  const existingEventIds = new Set(targetMob.soundEvents.map((eventDefinition) => eventDefinition.id));
  const missingInheritedEvents = sourceMob.soundEvents
    .filter((eventDefinition) => inheritedEventIds.has(eventDefinition.id))
    .filter((eventDefinition) => !existingEventIds.has(eventDefinition.id));

  if (missingInheritedEvents.length === 0) {
    return mobs;
  }

  const mergedSoundEvents = [...structuredClone(missingInheritedEvents), ...targetMob.soundEvents];
  return mobs.map((mob) => {
    if (mob.localId !== config.targetLocalId) {
      return mob;
    }

    return withUpdatedSoundEventCounts(mob, mergedSoundEvents);
  });
}

function withUpdatedSoundEventCounts(mob, soundEvents) {
  return {
    ...mob,
    soundEventCount: soundEvents.length,
    soundEvents,
    soundVariantCount: soundEvents.reduce((total, eventDefinition) => total + eventDefinition.variants.length, 0),
  };
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

async function resolveLocalImageFileName(mobId) {
  const candidates = [`${mobId}.png`, `${mobId}.gif`].filter(
    (fileName, index, fileNames) => Boolean(fileName) && fileNames.indexOf(fileName) === index,
  );

  for (const fileName of candidates) {
    try {
      await access(join(outputImagesDir, fileName));
      return fileName;
    } catch {
      // Try the next local candidate.
    }
  }

  throw new Error(
    `Missing vendored mob image for ${mobId}: expected one of ${candidates.join(", ")} in ${outputImagesDir}. Copy it from ../mob-voice-over/public/assets/mobs before syncing.`,
  );
}

async function assertLocalImageExists(targetImagePath, targetFileName, mobId) {
  try {
    await access(targetImagePath);
  } catch {
    throw new Error(
      `Missing vendored mob image for ${mobId}: expected ${targetFileName} in ${outputImagesDir}. Copy it from ../mob-voice-over/public/assets/mobs before syncing.`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
