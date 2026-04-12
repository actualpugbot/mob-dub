import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

export const projectRoot = resolve(scriptDir, "..");

const DEFAULT_DATAHUB_ROOTS = [
  resolve(projectRoot, "..", "sandbox", "mc-data-source"),
  resolve(projectRoot, "..", "mc-datahub"),
];

export async function resolveMobDatasetSource(requestedVersion) {
  const roots = resolveCandidateRoots();
  const candidates = await collectMobDatasetCandidates(roots);

  if (requestedVersion) {
    const matches = candidates
      .filter((candidate) => candidate.version === requestedVersion)
      .sort(compareDatasetCandidates);

    if (matches.length === 0) {
      throw new Error(
        `Could not find mob-sounds.json for ${requestedVersion} in ${roots.join(", ")}.`,
      );
    }

    return matches[0];
  }

  const [latest] = candidates.sort(compareDatasetCandidates);
  if (!latest) {
    throw new Error(`Could not find any mob-sounds datasets in ${roots.join(", ")}.`);
  }

  return latest;
}

export async function resolveModelSource({ preferredVersion, preferredRoots = [] } = {}) {
  const roots = resolveCandidateRoots(preferredRoots);

  if (preferredVersion) {
    for (const root of roots) {
      const source = await inspectModelSource(root, preferredVersion);
      if (source) {
        return source;
      }
    }
  }

  for (const root of roots) {
    const versionCandidates = await collectModelVersionCandidates(root, preferredVersion);

    for (const version of versionCandidates) {
      if (version === preferredVersion) {
        continue;
      }

      const source = await inspectModelSource(root, version);
      if (source) {
        return source;
      }
    }
  }

  throw new Error(`Could not locate decompiled client model sources in ${roots.join(", ")}.`);
}

function resolveCandidateRoots(extraRoots = []) {
  const envRoot = process.env.MOB_DUB_DATAHUB_ROOT;

  if (envRoot) {
    return uniqueStrings([resolve(envRoot)]);
  }

  return uniqueStrings([...extraRoots.map((root) => resolve(root)), ...DEFAULT_DATAHUB_ROOTS]);
}

async function collectMobDatasetCandidates(roots) {
  const candidates = [];

  for (const root of roots) {
    const processedVersions = await readProcessedVersions(root);

    for (const processedVersion of processedVersions) {
      const sourcePath = join(root, "workspace", "datasets", processedVersion.version, "mob-sounds.json");

      if (!(await pathExists(sourcePath))) {
        continue;
      }

      candidates.push({
        ...processedVersion,
        root,
        sourcePath,
      });
    }
  }

  return candidates;
}

async function collectModelVersionCandidates(root, preferredVersion) {
  const processedVersions = await readProcessedVersions(root);
  const workspaceVersions = await listDirectoryNames(join(root, "workspace"));
  const nestedWorkspaceVersions = await listDirectoryNames(join(root, "workspace", "versions"));

  return uniqueStrings([
    preferredVersion ?? "",
    ...processedVersions.map((entry) => entry.version),
    ...workspaceVersions,
    ...nestedWorkspaceVersions,
  ]).filter(Boolean);
}

async function inspectModelSource(root, version) {
  const clientRoots = [
    join(root, "workspace", version, "decompiled", "net", "minecraft", "client"),
    join(root, "workspace", "versions", version, "decompiled", "client", "net", "minecraft", "client"),
  ];

  for (const clientRoot of clientRoots) {
    const modelRoot = join(clientRoot, "model");
    const rendererRoot = join(clientRoot, "renderer", "entity");
    const rendererRegistryPath = join(rendererRoot, "EntityRenderers.java");
    const layerDefinitionsPath = join(modelRoot, "geom", "LayerDefinitions.java");

    if (!(await pathExists(rendererRegistryPath)) || !(await pathExists(layerDefinitionsPath))) {
      continue;
    }

    return {
      root,
      version,
      modelRoot,
      rendererRegistryPath,
      rendererRoot,
      layerDefinitionsPath,
    };
  }

  return null;
}

async function readProcessedVersions(root) {
  const statePath = join(root, "workspace", "state.json");

  if (!(await pathExists(statePath))) {
    return [];
  }

  const state = JSON.parse(await readFile(statePath, "utf8"));
  return Object.entries(state.processedVersions ?? {})
    .map(([version, details]) => ({
      processedAt: normalizeTimestamp(details?.processedAt),
      statePath,
      version,
    }))
    .sort((left, right) => right.processedAt - left.processedAt || right.version.localeCompare(left.version));
}

async function listDirectoryNames(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name !== "datasets" && name !== "diffs");
  } catch {
    return [];
  }
}

function compareDatasetCandidates(left, right) {
  return right.processedAt - left.processedAt || right.version.localeCompare(left.version);
}

function normalizeTimestamp(value) {
  const timestamp = new Date(value ?? 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}
