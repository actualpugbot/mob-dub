export interface ResourcePackInfo {
  packFormat: number;
}

export interface MobSoundVariant {
  assetPath: string;
  hash: string;
  id: string;
  pitch: number;
  preload: boolean;
  size: number;
  soundPath: string;
  stream: boolean;
  url: string;
  volume: number;
  weight: number;
  attenuationDistance?: number;
}

export interface MobSoundEvent {
  id: string;
  subtitle?: string;
  subtitleKey?: string;
  variants: MobSoundVariant[];
}

export interface MobDefinition {
  category: string;
  displayName: string;
  id: string;
  imagePath?: string;
  introducedVersion: string;
  isRecent: boolean;
  localId: string;
  mobCategory: string;
  releaseStatus: "released" | "unreleased";
  soundEventCount: number;
  soundEvents: MobSoundEvent[];
  soundId: string;
  soundVariantCount: number;
  translationKey: string;
}

export interface MobSoundsDataset {
  generatedAt: string;
  mobs: MobDefinition[];
  resourcePack?: ResourcePackInfo;
  version: string;
}

export interface MobModelCube {
  d: number;
  growX: number;
  growY: number;
  growZ: number;
  h: number;
  id: string | null;
  mirror: boolean;
  u: number;
  v: number;
  w: number;
  x: number;
  y: number;
  z: number;
}

export interface MobModelPose {
  x: number;
  xRot: number;
  xScale: number;
  y: number;
  yRot: number;
  yScale: number;
  z: number;
  zRot: number;
  zScale: number;
}

export interface MobModelPart {
  children: Record<string, MobModelPart>;
  cubes: MobModelCube[];
  pose: MobModelPose;
}

export interface MobModelDefinition {
  root: MobModelPart;
  textureHeight: number;
  textureWidth: number;
}

export interface MobModelsDataset {
  mobs: Record<string, MobModelDefinition>;
}

export interface CustomVariantSound {
  blob: Blob;
  fileName: string;
  kind: "recording" | "upload";
  mimeType: string;
  url: string;
}

export type CompatibilityMode = "broad" | "current";
