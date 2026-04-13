import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MOB_RELEASE_METADATA_BY_LOCAL_ID } from "./mob-release-metadata.mjs";
import { projectRoot, resolveMobDatasetSource } from "./datahub-source.mjs";

const outputPath = join(projectRoot, "public", "data", "mob-sounds.json");
const localImageBasePath = "/images/mobs";
const OMITTED_MOB_IDS = new Set(["giant"]);
const IMAGE_FILE_ALIASES_BY_LOCAL_ID = {
  pufferfish: ["pufferfish_small.gif"],
};

const requestedVersion = process.argv[2];

async function main() {
  const { root: datahubRoot, sourcePath, statePath, version } = await resolveMobDatasetSource(requestedVersion);
  const mobDataset = JSON.parse(await readFile(sourcePath, "utf8"));
  const normalizedMobDataset = withManualMobCorrections(withInheritedMobSounds(mobDataset));

  await mkdir(dirname(outputPath), { recursive: true });

  const missingReleaseMetadata = normalizedMobDataset.mobs
    .map((mob) => mob.localId)
    .filter((mobId) => !MOB_RELEASE_METADATA_BY_LOCAL_ID[mobId]);

  if (missingReleaseMetadata.length > 0) {
    throw new Error(`Missing release metadata for mob ids: ${missingReleaseMetadata.sort().join(", ")}`);
  }

  const enrichedMobs = await Promise.all(
    normalizedMobDataset.mobs.map(async (mob) => {
      const targetFileName = await resolveImageFileName(mob.localId);
      const releaseMetadata = MOB_RELEASE_METADATA_BY_LOCAL_ID[mob.localId];

      return {
        ...mob,
        ...releaseMetadata,
        imagePath: `${localImageBasePath}/${targetFileName}`,
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

  console.log(`Using mob dataset source ${datahubRoot}`);
  console.log(`Resolved ${version} from ${statePath}`);
  console.log(`Synced ${version} mob sound data from ${sourcePath} to ${outputPath}`);
  console.log(`Validated ${enrichedMobs.length} mob image references against ${localImageBasePath}`);
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

async function resolveImageFileName(mobId) {
  const candidates = [`${mobId}.gif`, `${mobId}.png`, ...(IMAGE_FILE_ALIASES_BY_LOCAL_ID[mobId] ?? [])].filter(
    (fileName, index, fileNames) => Boolean(fileName) && fileNames.indexOf(fileName) === index,
  );

  for (const fileName of candidates) {
    if (await imageExistsLocally(fileName)) {
      return fileName;
    }
  }

  throw new Error(
    `Missing mob image for ${mobId}: expected one of ${candidates.join(", ")} in ${localImageBasePath}.`,
  );
}

async function imageExistsLocally(fileName) {
  try {
    await access(join(projectRoot, "public", "images", "mobs", fileName));
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
