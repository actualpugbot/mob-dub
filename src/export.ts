import { strToU8, zipSync } from "fflate";
import { RESOURCE_PACK_IMAGE_BASE64 } from "./resourcePackImage";
import { ensureOggBlob } from "./audio";
import type { CompatibilityMode, CustomVariantSound, MobDefinition, MobSoundsDataset, MobSoundEvent, MobSoundVariant } from "./types";

export const BROAD_COMPATIBILITY_MIN_FORMAT = 34;
const CUSTOM_SOUND_DIRECTORY = "mobvoices";
const RESOURCE_PACK_DESCRIPTION = "Custom mob voices recorded with Mob Dub";
const RESOURCE_PACK_FILE_NAME_FALLBACK = "MobDub";
const RESOURCE_PACK_NAME = "Mob Dub";
const RESOURCE_PACK_IMAGE_BYTES = Uint8Array.from(decodeBase64(RESOURCE_PACK_IMAGE_BASE64), (char) => char.charCodeAt(0));

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
  const zipEntries: Record<string, Uint8Array> = {
    "pack.mcmeta": strToU8(JSON.stringify({ pack: buildPackMetadata(packFormat, compatibilityMode) }, null, 2)),
    "pack.png": RESOURCE_PACK_IMAGE_BYTES.slice(),
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

export function getResourcePackFileName() {
  return `${sanitizePackName(RESOURCE_PACK_NAME)}.zip`;
}

function buildPackMetadata(packFormat: number, compatibilityMode: CompatibilityMode) {
  if (compatibilityMode === "broad") {
    return {
      description: RESOURCE_PACK_DESCRIPTION,
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
    description: RESOURCE_PACK_DESCRIPTION,
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
  const customSoundName = buildCustomSoundName(mob, eventDefinition, variantIndex);
  const oggBlob = await ensureOggBlob(customization.blob, {
    mimeType: customization.mimeType,
    onProgress,
    sourceId: customSoundName,
    sourceName: customization.fileName,
  });
  const arrayBuffer = await oggBlob.arrayBuffer();
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

function buildCustomSoundName(mob: MobDefinition, eventDefinition: MobSoundEvent, variantIndex: number) {
  return `${CUSTOM_SOUND_DIRECTORY}/${mob.localId}/${soundEventPath(eventDefinition.id)}/voice_${variantIndex + 1}`;
}

function soundEventPath(value: string) {
  const parts = value
    .split(".")
    .slice(2)
    .map((segment) => slugify(segment))
    .filter(Boolean);

  return parts.join("/") || "custom";
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function eventLabel(value: string) {
  return value.split(".").slice(2).join(" ").replace(/_/g, " ");
}

function decodeBase64(value: string) {
  if (typeof globalThis.atob === "function") {
    return globalThis.atob(value);
  }

  const bufferCtor = (globalThis as typeof globalThis & {
    Buffer?: {
      from(input: string, encoding: string): { toString(encoding: string): string };
    };
  }).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(value, "base64").toString("binary");
  }

  throw new Error("This environment cannot decode the bundled resource pack image.");
}

function sanitizePackName(value: string) {
  return value.replace(/[^a-z0-9-_ ]/gi, "").trim().replace(/\s+/g, "_") || RESOURCE_PACK_FILE_NAME_FALLBACK;
}
