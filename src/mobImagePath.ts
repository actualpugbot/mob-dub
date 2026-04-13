import type { MobDefinition } from "./types";

type MobImageReference = Pick<MobDefinition, "imagePath">;

export function getMobImagePath(mob: MobImageReference) {
  if (!mob.imagePath) {
    return undefined;
  }

  const normalizedSource = mob.imagePath.split(/[?#]/, 1)[0];
  const fileName = normalizedSource.split("/").pop();

  if (!fileName) {
    return mob.imagePath;
  }

  return `/images/mobs/${fileName}`;
}

export function isGifMobImagePath(imagePath?: string) {
  if (!imagePath) {
    return false;
  }

  return imagePath.split(/[?#]/, 1)[0].toLowerCase().endsWith(".gif");
}
