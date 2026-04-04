import type { CustomVariantSound, MobSoundEvent, MobSoundVariant } from "./types";

export interface SoundVariantGroup {
  id: string;
  label: string;
  pitchValues: number[];
  soundPath: string;
  variants: MobSoundVariant[];
}

export function groupVariantsBySoundPath(eventDefinition: MobSoundEvent): SoundVariantGroup[] {
  const groups = new Map<string, SoundVariantGroup>();

  for (const variant of eventDefinition.variants) {
    const existing = groups.get(variant.soundPath);
    if (existing) {
      existing.variants.push(variant);
      existing.pitchValues.push(variant.pitch);
      continue;
    }

    groups.set(variant.soundPath, {
      id: `${eventDefinition.id}:${variant.soundPath}`,
      label: variant.soundPath.split("/").pop() ?? variant.soundPath,
      pitchValues: [variant.pitch],
      soundPath: variant.soundPath,
      variants: [variant],
    });
  }

  return Array.from(groups.values());
}

export function getRepresentativeCustomization(
  variants: MobSoundVariant[],
  customizations: Record<string, CustomVariantSound>,
): CustomVariantSound | null {
  return variants.map((variant) => customizations[variant.id]).find(Boolean) ?? null;
}

export function isGroupedSoundMuted(variants: MobSoundVariant[], mutedVariantIds: Record<string, boolean>) {
  return variants.some((variant) => mutedVariantIds[variant.id]);
}

export function formatPitchSummary(pitchValues: number[]) {
  const uniquePitchValues = Array.from(new Set(pitchValues.map((value) => value.toFixed(2))));
  if (uniquePitchValues.length <= 1) {
    return null;
  }

  if (uniquePitchValues.length === 2) {
    return `Pitches ${uniquePitchValues[0]}x and ${uniquePitchValues[1]}x`;
  }

  return `Pitches ${uniquePitchValues.join("x, ")}x`;
}
