import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { JSDOM } from "jsdom";
import { projectRoot, resolveMobDatasetSource } from "./datahub-source.mjs";

const execFile = promisify(execFileCallback);
const WIKI_BASE_URL = "https://minecraft.wiki";
const outputRoot = join(projectRoot, "public", "images", "mobs");
const reportPath = join(projectRoot, "public", "data", "wiki-mob-gifs.json");
const OMITTED_MOB_IDS = new Set(["giant"]);
const requestedVersion = process.argv[2];

async function main() {
  await mkdir(outputRoot, { recursive: true });

  const datasetSource = await resolveMobDatasetSource(requestedVersion);
  const mobDataset = JSON.parse(await readFile(datasetSource.sourcePath, "utf8"));
  const mobs = mobDataset.mobs.filter((mob) => !OMITTED_MOB_IDS.has(mob.localId));
  const downloads = [];
  const misses = [];

  for (const mob of mobs) {
    const resolvedPage = await resolveWikiPage(mob);
    if (!resolvedPage) {
      misses.push({ localId: mob.localId, reason: "page-not-found" });
      continue;
    }

    const gifInfo = extractPrimaryInfoboxGif(resolvedPage.html);
    if (!gifInfo) {
      misses.push({ localId: mob.localId, pageTitle: resolvedPage.pageTitle, reason: "no-infobox-gif" });
      continue;
    }

    const binary = await curlBinary(gifInfo.sourceUrl);
    const outputPath = join(outputRoot, `${mob.localId}.gif`);
    await writeFile(outputPath, binary);

    downloads.push({
      displayName: mob.displayName,
      fileName: gifInfo.fileName,
      localId: mob.localId,
      outputPath,
      pageTitle: resolvedPage.pageTitle,
      sourceUrl: gifInfo.sourceUrl,
    });
    console.log(`Downloaded ${mob.localId}.gif from ${gifInfo.sourceUrl}`);
  }

  await mkdir(join(projectRoot, "public", "data"), { recursive: true });
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        downloadedAt: new Date().toISOString(),
        downloads,
        misses,
        version: datasetSource.version,
      },
      null,
      2,
    ),
  );

  console.log(`Downloaded ${downloads.length} wiki GIF mob images to ${outputRoot}`);
  console.log(`Recorded ${misses.length} non-GIF or missing wiki mob pages in ${reportPath}`);
}

async function resolveWikiPage(mob) {
  for (const pageTitle of buildWikiPageCandidates(mob)) {
    const url = new URL(`/w/${pageTitle}`, WIKI_BASE_URL);

    try {
      const html = await curlText(url.toString());
      return {
        html,
        pageTitle,
      };
    } catch {
      continue;
    }
  }

  return null;
}

function buildWikiPageCandidates(mob) {
  const displayNameCandidate = mob.displayName.replaceAll(" ", "_");
  const localIdCandidate = mob.localId
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("_");

  return [...new Set([displayNameCandidate, localIdCandidate].filter(Boolean))];
}

function extractPrimaryInfoboxGif(html) {
  const document = new JSDOM(html).window.document;
  const imageArea = document.querySelector(".infobox .infobox-imagearea, .infobox-imagearea");

  if (!imageArea) {
    return null;
  }

  const gifLink = Array.from(imageArea.querySelectorAll('a[href^="/w/File:"]')).find((link) =>
    decodeURIComponent(link.getAttribute("href") ?? "").toLowerCase().endsWith(".gif"),
  );

  if (!gifLink) {
    return null;
  }

  const href = decodeURIComponent(gifLink.getAttribute("href") ?? "");
  const fileName = href.split("/w/File:", 2)[1];
  if (!fileName) {
    return null;
  }

  return {
    fileName,
    sourceUrl: new URL(`/images/${encodeURIComponent(fileName)}`, WIKI_BASE_URL).toString(),
  };
}

async function curlText(url) {
  const { stdout } = await execFile("curl", ["-L", "--fail", "--silent", "--show-error", url], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function curlBinary(url) {
  const { stdout } = await execFile("curl", ["-L", "--fail", "--silent", "--show-error", url], {
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
