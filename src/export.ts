import { strToU8, zipSync } from "fflate";
import { ensureOggBlob } from "./audio";
import type { CompatibilityMode, CustomVariantSound, MobDefinition, MobSoundsDataset, MobSoundEvent, MobSoundVariant } from "./types";

export const BROAD_COMPATIBILITY_MIN_FORMAT = 34;

interface BuildResourcePackOptions {
  compatibilityMode: CompatibilityMode;
  customizations: Record<string, CustomVariantSound>;
  dataset: MobSoundsDataset;
  mobs: MobDefinition[];
  mutedVariantIds: Record<string, boolean>;
  onProgress?: (message: string) => void;
}

export async function buildResourcePackBlob({
  compatibilityMode,
  customizations,
  dataset,
  mobs,
  mutedVariantIds,
  onProgress,
}: BuildResourcePackOptions): Promise<Blob> {
  const packFormat = dataset.resourcePack?.packFormat ?? 84;
  const modifiedMobCount = countModifiedMobs(mobs, customizations, mutedVariantIds);
  const description = `Mob Dub custom voices for ${modifiedMobCount} mob${modifiedMobCount === 1 ? "" : "s"}`;
  const zipEntries: Record<string, Uint8Array> = {
    "pack.mcmeta": strToU8(JSON.stringify({ pack: buildPackMetadata(packFormat, description, compatibilityMode) }, null, 2)),
  };
  const soundsJson: Record<string, { replace: true; sounds: Array<Record<string, unknown>>; subtitle?: string }> = {};

  for (const mob of mobs) {
    for (const eventDefinition of mob.soundEvents) {
      if (!eventDefinition.variants.some((variant) => customizations[variant.id] || mutedVariantIds[variant.id])) {
        continue;
      }

      onProgress?.(`Packing ${mob.displayName} / ${eventLabel(eventDefinition.id)}...`);
      soundsJson[eventDefinition.id] = {
        replace: true,
        ...(eventDefinition.subtitleKey ? { subtitle: eventDefinition.subtitleKey } : {}),
        sounds: [],
      };

      for (let index = 0; index < eventDefinition.variants.length; index += 1) {
        const variant = eventDefinition.variants[index];
        if (mutedVariantIds[variant.id]) {
          continue;
        }

        const customization = customizations[variant.id];
        const exportedName = customization
          ? await writeCustomVariant(zipEntries, mob, eventDefinition, variant, index, customization, onProgress)
          : variant.soundPath;

        soundsJson[eventDefinition.id].sounds.push(toSoundEntry(exportedName, variant));
      }
    }
  }

  onProgress?.("Compressing resource pack...");
  zipEntries["assets/minecraft/sounds.json"] = strToU8(JSON.stringify(soundsJson, null, 2));
  const zipBuffer = zipSync(zipEntries, {
    level: 6,
  });
  const zipBlobBuffer = new Uint8Array(zipBuffer.byteLength);
  zipBlobBuffer.set(zipBuffer);

  return new Blob([zipBlobBuffer.buffer], { type: "application/zip" });
}

function buildPackMetadata(packFormat: number, description: string, compatibilityMode: CompatibilityMode) {
  if (compatibilityMode === "broad") {
    return {
      description,
      pack_format: packFormat,
      supported_formats: {
        min_inclusive: BROAD_COMPATIBILITY_MIN_FORMAT,
        max_inclusive: packFormat,
      },
      min_format: BROAD_COMPATIBILITY_MIN_FORMAT,
      max_format: packFormat,
    };
  }

  return {
    description,
    pack_format: packFormat,
    supported_formats: {
      min_inclusive: packFormat,
      max_inclusive: packFormat,
    },
    min_format: packFormat,
    max_format: packFormat,
  };
}

async function writeCustomVariant(
  zipEntries: Record<string, Uint8Array>,
  mob: MobDefinition,
  eventDefinition: MobSoundEvent,
  variant: MobSoundVariant,
  variantIndex: number,
  customization: CustomVariantSound,
  onProgress?: (message: string) => void,
): Promise<string> {
  const oggBlob = await ensureOggBlob(customization.blob, onProgress);
  const arrayBuffer = await oggBlob.arrayBuffer();
  const customSoundName = `mob_dub/${mob.localId}/${slugify(eventDefinition.id)}/variant_${variantIndex + 1}`;
  zipEntries[`assets/minecraft/sounds/${customSoundName}.ogg`] = new Uint8Array(arrayBuffer);
  return customSoundName;
}

function toSoundEntry(name: string, variant: MobSoundVariant) {
  return {
    name,
    ...(variant.stream ? { stream: true } : {}),
    ...(variant.preload ? { preload: true } : {}),
    ...(variant.volume !== 1 ? { volume: variant.volume } : {}),
    ...(variant.pitch !== 1 ? { pitch: variant.pitch } : {}),
    ...(variant.weight !== 1 ? { weight: variant.weight } : {}),
    ...(variant.attenuationDistance !== undefined ? { attenuation_distance: variant.attenuationDistance } : {}),
  };
}

function countModifiedMobs(
  mobs: MobDefinition[],
  customizations: Record<string, CustomVariantSound>,
  mutedVariantIds: Record<string, boolean>,
) {
  return mobs.filter((mob) =>
    mob.soundEvents.some((eventDefinition) => eventDefinition.variants.some((variant) => customizations[variant.id] || mutedVariantIds[variant.id])),
  ).length;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function eventLabel(value: string) {
  return value.split(".").slice(2).join(" ").replace(/_/g, " ");
}
