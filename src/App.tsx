import { startTransition, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { getCachedWaveformBars, getPreferredRecordingMimeType, getWaveformBars } from "./audio";
import { buildResourcePackBlob } from "./export";
import { MobModelPreview } from "./mobModelPreview";
import { formatPitchSummary, getRepresentativeCustomization, groupVariantsBySoundPath, isGroupedSoundMuted } from "./soundGroups";
import type { CustomVariantSound, MobDefinition, MobModelDefinition, MobSoundEvent, MobSoundVariant, MobSoundsDataset } from "./types";

const DATASET_URL = "/data/mob-sounds.json";
const MODEL_DATASET_URL = "/data/mob-models.json";
// These assets are texture atlases, not finished thumbnail renders, so they need a
// static model preview instead of being shown directly as images.
const STATIC_MODEL_PREVIEW_MOB_IDS = new Set([
  "camel_husk",
  "cod",
  "happy_ghast",
  "illusioner",
  "nautilus",
  "pufferfish",
  "salmon",
  "zombie_nautilus",
]);
const CLASSIC_FILTER_EXCLUDED_MOB_IDS = new Set(["skeleton"]);
const BROWSER_LIST_GAP = 16;
const ESTIMATED_BROWSER_CONTROLS_HEIGHT = 68;
const VARIANT_WAVEFORM_BAR_COUNT = 64;
const DEFAULT_VISIBLE_EVENT_LABELS_BY_MOB: Record<string, string[]> = {
  allay: ["ambient with item"],
  armadillo: ["ambient"],
  axolotl: ["idle air"],
  bat: ["ambient"],
  bee: ["loop"],
  blaze: ["ambient"],
  bogged: ["ambient"],
  breeze: ["idle air", "idle ground"],
  camel: ["ambient"],
  camel_husk: ["ambient"],
  cat: ["ambient", "stray ambient"],
  cave_spider: ["ambient"],
  chicken: ["ambient"],
  cod: ["flop"],
  cow: ["ambient"],
  creaking: ["ambient"],
  creeper: ["primed"],
  dolphin: ["ambient water"],
  donkey: ["ambient"],
  drowned: ["ambient"],
  elder_guardian: ["ambient"],
  ender_dragon: ["ambient"],
  enderman: ["ambient"],
  endermite: ["ambient"],
  evoker: ["ambient"],
  fox: ["ambient"],
  frog: ["ambient"],
  ghast: ["ambient", "warn"],
  glow_squid: ["ambient"],
  goat: ["ambient", "screaming ambient"],
  guardian: ["ambient"],
  happy_ghast: ["ambient"],
  hoglin: ["ambient"],
  horse: ["ambient"],
  husk: ["ambient"],
  illusioner: ["ambient"],
  iron_golem: ["hurt"],
  llama: ["ambient"],
  magma_cube: ["squish"],
  mooshroom: ["ambient", "milk"],
  mule: ["ambient"],
  nautilus: ["ambient"],
  ocelot: ["ambient"],
  panda: ["ambient"],
  parched: ["ambient"],
  parrot: ["ambient"],
  phantom: ["ambient"],
  pig: ["ambient"],
  piglin: ["ambient"],
  piglin_brute: ["ambient"],
  pillager: ["ambient"],
  polar_bear: ["ambient"],
  pufferfish: ["blow up"],
  ravager: ["ambient"],
  salmon: ["flop"],
  sheep: ["ambient"],
  shulker: ["ambient"],
  silverfish: ["ambient"],
  skeleton: ["ambient"],
  skeleton_horse: ["ambient"],
  slime: ["squish"],
  sniffer: ["idle"],
  snow_golem: ["hurt"],
  spider: ["ambient"],
  squid: ["ambient"],
  stray: ["ambient"],
  strider: ["ambient"],
  tadpole: ["flop"],
  tropical_fish: ["flop"],
  turtle: ["ambient land"],
  vex: ["charge"],
  villager: ["ambient"],
  vindicator: ["ambient"],
  wandering_trader: ["ambient"],
  warden: ["ambient"],
  witch: ["ambient"],
  wither: ["ambient"],
  wither_skeleton: ["ambient"],
  wolf: ["ambient"],
  zoglin: ["ambient"],
  zombie: ["ambient"],
  zombie_horse: ["ambient"],
  zombie_nautilus: ["ambient"],
  zombie_villager: ["ambient"],
  zombified_piglin: ["ambient"],
};

type PreviewSource = "custom" | "original";
type PlayingPreview = { groupId: string; source: PreviewSource; url: string };
type StoredCustomizationSeed = Omit<CustomVariantSound, "url">;

export default function App() {
  const [dataset, setDataset] = useState<MobSoundsDataset | null>(null);
  const [mobModels, setMobModels] = useState<Record<string, MobModelDefinition>>({});
  const [search, setSearch] = useState("");
  const [activeMobFilter, setActiveMobFilter] = useState("classic");
  const [selectedMobIds, setSelectedMobIds] = useState<string[]>([]);
  const [customizations, setCustomizations] = useState<Record<string, CustomVariantSound>>({});
  const [mutedVariantIds, setMutedVariantIds] = useState<Record<string, boolean>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Loading mob sound data...");
  const [recordingGroupId, setRecordingGroupId] = useState<string | null>(null);
  const [playingPreview, setPlayingPreview] = useState<PlayingPreview | null>(null);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [expandedMobIds, setExpandedMobIds] = useState<Record<string, boolean>>({});
  const [mobPendingRemoval, setMobPendingRemoval] = useState<MobDefinition | null>(null);

  const deferredSearch = useDeferredValue(search);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingTargetRef = useRef<{ fileName: string; variantIds: string[] } | null>(null);
  const recorderChunksRef = useRef<BlobPart[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAnimationFrameRef = useRef<number | null>(null);
  const customizationsRef = useRef<Record<string, CustomVariantSound>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const browserControlsRef = useRef<HTMLDivElement | null>(null);
  const exportReadyTimeoutRef = useRef<number | null>(null);
  const wasExportReadyRef = useRef(false);
  const [isExportButtonFlashing, setIsExportButtonFlashing] = useState(false);
  const [browserControlsHeight, setBrowserControlsHeight] = useState(ESTIMATED_BROWSER_CONTROLS_HEIGHT);

  useEffect(() => {
    let active = true;
    const abortController = new AbortController();

    fetch(DATASET_URL, { signal: abortController.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Could not load ${DATASET_URL} (${response.status}). Run npm run sync:data first.`);
        }

        return (await response.json()) as MobSoundsDataset;
      })
      .then((loadedDataset) => {
        if (!active) {
          return;
        }

        setDataset(loadedDataset);
        setStatusMessage(`Loaded ${loadedDataset.mobs.length} mobs from mc-datahub ${loadedDataset.version}.`);
      })
      .catch((error: Error) => {
        if (!active) {
          return;
        }

        setErrorMessage(error.message);
        setStatusMessage("Could not load Mob Dub data.");
      });

    fetch(MODEL_DATASET_URL, { signal: abortController.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Could not load ${MODEL_DATASET_URL} (${response.status}).`);
        }

        return (await response.json()) as { mobs?: Record<string, MobModelDefinition> };
      })
      .then((loadedModels) => {
        if (!active) {
          return;
        }

        setMobModels(loadedModels.mobs ?? {});
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setMobModels({});
      });

    return () => {
      active = false;
      abortController.abort();
    };
  }, []);

  useEffect(() => {
    customizationsRef.current = customizations;
  }, [customizations]);

  useEffect(() => {
    if (!mobPendingRemoval) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobPendingRemoval(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobPendingRemoval]);

  useLayoutEffect(() => {
    const controlsElement = browserControlsRef.current;

    if (!controlsElement) {
      return;
    }

    const updateBrowserControlsHeight = () => {
      const nextOffset = Math.ceil(controlsElement.getBoundingClientRect().height + BROWSER_LIST_GAP);
      setBrowserControlsHeight((current) => (current === nextOffset ? current : nextOffset));
    };

    updateBrowserControlsHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateBrowserControlsHeight();
    });

    observer.observe(controlsElement);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (exportReadyTimeoutRef.current !== null) {
        window.clearTimeout(exportReadyTimeoutRef.current);
      }

      stopPreview();

      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }

      for (const customization of Object.values(customizationsRef.current)) {
        URL.revokeObjectURL(customization.url);
      }

      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const mobs = dataset?.mobs ?? [];
  const hasClassicMobs = useMemo(
    () => mobs.some((mob) => mob.introducedVersion === "Classic" && !CLASSIC_FILTER_EXCLUDED_MOB_IDS.has(mob.localId)),
    [mobs],
  );

  useEffect(() => {
    if (!dataset) {
      return;
    }

    if (activeMobFilter !== "classic" || hasClassicMobs) {
      return;
    }

    setActiveMobFilter("all");
  }, [activeMobFilter, dataset, hasClassicMobs]);

  const mobById = useMemo(() => new Map(mobs.map((mob) => [mob.id, mob])), [mobs]);
  const filteredMobs = useMemo(() => {
    const normalizedQuery = deferredSearch.trim().toLowerCase();
    return mobs.filter((mob) => {
      if (activeMobFilter === "recent" && !mob.isRecent) {
        return false;
      }

      if (activeMobFilter === "classic" && (mob.introducedVersion !== "Classic" || CLASSIC_FILTER_EXCLUDED_MOB_IDS.has(mob.localId))) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return [mob.displayName, mob.localId, mob.category, mob.soundId, mob.introducedVersion].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      );
    });
  }, [activeMobFilter, deferredSearch, mobs]);
  const selectedMobs = selectedMobIds.map((id) => mobById.get(id)).filter(Boolean) as MobDefinition[];
  const customizedVariantCount = Object.keys(customizations).length;
  const modifiedMobCount = selectedMobs.filter((mob) =>
    mob.soundEvents.some((eventDefinition) => eventDefinition.variants.some((variant) => customizations[variant.id] || mutedVariantIds[variant.id])),
  ).length;
  const canCreateResourcePack = Boolean(dataset) && selectedMobs.length > 0 && modifiedMobCount > 0;
  const isExportButtonDisabled = !canCreateResourcePack || isExporting;

  useEffect(() => {
    if (canCreateResourcePack && !wasExportReadyRef.current) {
      setIsExportButtonFlashing(true);

      if (exportReadyTimeoutRef.current !== null) {
        window.clearTimeout(exportReadyTimeoutRef.current);
      }

      exportReadyTimeoutRef.current = window.setTimeout(() => {
        setIsExportButtonFlashing(false);
        exportReadyTimeoutRef.current = null;
      }, 1400);
    }

    if (!canCreateResourcePack) {
      setIsExportButtonFlashing(false);

      if (exportReadyTimeoutRef.current !== null) {
        window.clearTimeout(exportReadyTimeoutRef.current);
        exportReadyTimeoutRef.current = null;
      }
    }

    wasExportReadyRef.current = canCreateResourcePack;
  }, [canCreateResourcePack]);

  function handleSelectMob(mob: MobDefinition) {
    setErrorMessage(null);
    if (selectedMobIds.includes(mob.id)) {
      cardRefs.current[mob.id]?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    startTransition(() => {
      setSelectedMobIds((current) => [...current, mob.id]);
    });
  }

  function removeMob(mob: MobDefinition) {
    stopPreview();
    setSelectedMobIds((current) => current.filter((id) => id !== mob.id));
    setExpandedMobIds((current) => {
      if (!current[mob.id]) {
        return current;
      }

      const next = { ...current };
      delete next[mob.id];
      return next;
    });
    clearMobEdits(mob);
  }

  function mobHasCustomAudio(mob: MobDefinition) {
    return mob.soundEvents.some((eventDefinition) => eventDefinition.variants.some((variant) => Boolean(customizations[variant.id])));
  }

  function handleRemoveMob(mob: MobDefinition) {
    if (mobHasCustomAudio(mob)) {
      setMobPendingRemoval(mob);
      return;
    }

    removeMob(mob);
  }

  function confirmRemoveMob() {
    if (!mobPendingRemoval) {
      return;
    }

    removeMob(mobPendingRemoval);
    setMobPendingRemoval(null);
  }

  function stopPreview() {
    if (previewAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(previewAnimationFrameRef.current);
      previewAnimationFrameRef.current = null;
    }

    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onloadedmetadata = null;
      audio.onpause = null;
      audio.ontimeupdate = null;
      audio.pause();
      audio.currentTime = 0;
      audioRef.current = null;
    }

    setPlayingPreview(null);
    setPreviewProgress(0);
  }

  function syncPreviewProgress(audio: HTMLAudioElement) {
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const nextProgress = duration > 0 ? Math.max(0, Math.min(1, audio.currentTime / duration)) : 0;
    setPreviewProgress((current) => (Math.abs(current - nextProgress) < 0.001 ? current : nextProgress));
  }

  function startPreviewProgressLoop(audio: HTMLAudioElement) {
    if (!(Number.isFinite(audio.duration) && audio.duration > 0)) {
      previewAnimationFrameRef.current = null;
      return;
    }

    if (previewAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(previewAnimationFrameRef.current);
    }

    const tick = () => {
      if (audioRef.current !== audio) {
        previewAnimationFrameRef.current = null;
        return;
      }

      syncPreviewProgress(audio);

      if (audio.ended) {
        previewAnimationFrameRef.current = null;
        return;
      }

      previewAnimationFrameRef.current = window.requestAnimationFrame(tick);
    };

    previewAnimationFrameRef.current = window.requestAnimationFrame(tick);
  }

  function toggleMobEventExpansion(mobId: string) {
    setExpandedMobIds((current) => ({
      ...current,
      [mobId]: !current[mobId],
    }));
  }

  async function togglePreview(groupId: string, source: PreviewSource, url?: string) {
    if (!url) {
      setErrorMessage("This sound does not have a preview audio file.");
      return;
    }

    setErrorMessage(null);
    setPreviewProgress(0);

    if (playingPreview?.groupId === groupId && playingPreview.source === source && playingPreview.url === url) {
      stopPreview();
      return;
    }

    stopPreview();

    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onloadedmetadata = () => {
      syncPreviewProgress(audio);
      startPreviewProgressLoop(audio);
    };
    audio.onended = () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        if (previewAnimationFrameRef.current !== null) {
          window.cancelAnimationFrame(previewAnimationFrameRef.current);
          previewAnimationFrameRef.current = null;
        }
        setPlayingPreview(null);
        setPreviewProgress(0);
      }
    };
    audio.ontimeupdate = () => {
      syncPreviewProgress(audio);
    };
    audio.onpause = () => {
      if (audioRef.current === audio && !audio.ended) {
        audioRef.current = null;
        if (previewAnimationFrameRef.current !== null) {
          window.cancelAnimationFrame(previewAnimationFrameRef.current);
          previewAnimationFrameRef.current = null;
        }
        setPlayingPreview(null);
        setPreviewProgress(0);
      }
    };

    setPlayingPreview({ groupId, source, url });

    try {
      await audio.play();
      syncPreviewProgress(audio);
      startPreviewProgressLoop(audio);
    } catch (error) {
      if (audioRef.current === audio) {
        audioRef.current = null;
      }

      if (previewAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(previewAnimationFrameRef.current);
        previewAnimationFrameRef.current = null;
      }

      setPlayingPreview(null);
      setPreviewProgress(0);
      setErrorMessage(error instanceof Error ? error.message : "The preview audio could not be played.");
    }
  }

  async function toggleRecording(groupId: string, variants: MobSoundVariant[], mob: MobDefinition, label: string) {
    setErrorMessage(null);

    if (recordingGroupId === groupId) {
      recorderRef.current?.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErrorMessage("This browser cannot record microphone audio.");
      return;
    }

    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }

    try {
      const stream =
        mediaStreamRef.current ??
        (await navigator.mediaDevices.getUserMedia({
          audio: true,
        }));
      mediaStreamRef.current = stream;

      const mimeType = getPreferredRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      recorderChunksRef.current = [];
      recordingTargetRef.current = {
        fileName: `${mob.localId}_${label.replace(/[^a-z0-9]+/gi, "_")}.ogg`,
        variantIds: variants.map((variant) => variant.id),
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recorderChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        setRecordingGroupId(null);
        setErrorMessage("Microphone recording failed.");
      };
      recorder.onstop = () => {
        const target = recordingTargetRef.current;
        setRecordingGroupId(null);
        if (!target || recorderChunksRef.current.length === 0) {
          return;
        }

        const blob = new Blob(recorderChunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        storeCustomizationGroup(target.variantIds, {
          blob,
          fileName: target.fileName,
          kind: "recording",
          mimeType: blob.type || recorder.mimeType || "audio/webm",
        });
      };

      recorderRef.current = recorder;
      recorder.start();
      setRecordingGroupId(groupId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Microphone access was denied.");
    }
  }

  function handlePickFile(groupId: string) {
    fileInputRefs.current[groupId]?.click();
  }

  function handleFileSelected(variants: MobSoundVariant[], file: File | undefined) {
    if (!file) {
      return;
    }

    const blob = file.slice(0, file.size, file.type || "application/octet-stream");
    storeCustomizationGroup(
      variants.map((variant) => variant.id),
      {
        blob,
        fileName: file.name,
        kind: "upload",
        mimeType: file.type || "application/octet-stream",
      },
    );
  }

  function storeCustomizationGroup(variantIds: string[], next: StoredCustomizationSeed) {
    setCustomizations((current) => {
      const updated = { ...current };
      for (const variantId of variantIds) {
        const previous = updated[variantId];
        if (previous) {
          URL.revokeObjectURL(previous.url);
        }

        updated[variantId] = {
          ...next,
          url: URL.createObjectURL(next.blob),
        };
      }

      return updated;
    });
  }

  function clearCustomizationGroup(variantIds: string[]) {
    setCustomizations((current) => {
      const next = { ...current };
      for (const variantId of variantIds) {
        const existing = next[variantId];
        if (!existing) {
          continue;
        }

        URL.revokeObjectURL(existing.url);
        delete next[variantId];
      }

      return next;
    });
  }

  function clearMuteGroup(variantIds: string[]) {
    setMutedVariantIds((current) => {
      if (!variantIds.some((variantId) => current[variantId])) {
        return current;
      }

      const next = { ...current };
      for (const variantId of variantIds) {
        delete next[variantId];
      }

      return next;
    });
  }

  function resetGroupedSound(variants: MobSoundVariant[]) {
    const variantIds = variants.map((variant) => variant.id);
    clearCustomizationGroup(variantIds);
    clearMuteGroup(variantIds);
  }

  function clearMobEdits(mob: MobDefinition) {
    const variantIds = mob.soundEvents.flatMap((eventDefinition) => eventDefinition.variants.map((variant) => variant.id));
    clearCustomizationGroup(variantIds);
    clearMuteGroup(variantIds);
  }

  function toggleMuteForGroup(variants: MobSoundVariant[]) {
    const variantIds = variants.map((variant) => variant.id);

    setMutedVariantIds((current) => {
      const shouldMute = !variantIds.some((variantId) => current[variantId]);
      const next = { ...current };
      for (const variantId of variantIds) {
        if (shouldMute) {
          next[variantId] = true;
        } else {
          delete next[variantId];
        }
      }

      return next;
    });
  }

  function applyCustomizationToEvent(eventDefinition: MobSoundEvent, customization: CustomVariantSound) {
    storeCustomizationGroup(
      eventDefinition.variants.map((variant) => variant.id),
      {
        blob: customization.blob,
        fileName: customization.fileName,
        kind: customization.kind,
        mimeType: customization.mimeType,
      },
    );
  }

  async function handleExport() {
    if (!canCreateResourcePack || !dataset) {
      return;
    }

    setErrorMessage(null);
    setIsExporting(true);
    setStatusMessage("Building your resource pack...");

    try {
      const blob = await buildResourcePackBlob({
        compatibilityMode: "broad",
        customizations,
        dataset,
        mobs: selectedMobs,
        mutedVariantIds,
        onProgress: (message) => setStatusMessage(message),
      });

      const fileName = `mob-dub-${dataset.version}-${modifiedMobCount || "custom"}-mobs.zip`;
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(anchor.href);
      setStatusMessage(`Resource pack ready: ${fileName}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The resource pack could not be created.");
      setStatusMessage("Resource pack export failed.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="shell">
      <div className="backdrop" aria-hidden="true" />
      <div className="shell-actions">
        <button
          className={`export-button${isExportButtonFlashing ? " is-ready-flash" : ""}`}
          disabled={isExportButtonDisabled}
          onClick={handleExport}
          type="button"
        >
          {isExporting ? "Building Pack..." : "Create Resource Pack"}
        </button>
      </div>
      <p aria-live="polite" className="sr-only" role="status">
        {statusMessage}
      </p>
      <header className="hero">
        <h1>Mob Dub</h1>
      </header>

      <main className="workspace" style={{ "--browser-controls-height": `${browserControlsHeight}px` } as CSSProperties}>
        <aside className="browser-panel">
          <div className="browser-controls" ref={browserControlsRef}>
            <label className="search-field">
              <span aria-hidden="true" className="search-field-icon" />
              <input aria-label="Search mobs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search for a mob" />
            </label>
          </div>
          <div className="mob-list">
            {filteredMobs.length === 0 ? (
              <div className="mob-list-empty">No mobs match this search and filter combo yet.</div>
            ) : (
              filteredMobs.map((mob) => {
                const isSelected = selectedMobIds.includes(mob.id);
                return (
                  <div className={`mob-list-item${isSelected ? " is-selected" : ""}`} key={mob.id}>
                    <button className="mob-list-select" onClick={() => handleSelectMob(mob)} type="button">
                      <span className="mob-list-copy">
                        <MobArtwork mob={mob} model={mobModels[mob.localId]} size="list" />
                        <span>
                          <strong>{mob.displayName}</strong>
                        </span>
                      </span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        <section className="cards-panel">
          <div aria-label="Mob filters" className="cards-toolbar">
            <button
              className={`filter-button filter-button--all${activeMobFilter === "all" ? " is-active" : ""}`}
              onClick={() => setActiveMobFilter("all")}
              type="button"
            >
              <span>All</span>
            </button>
            <button
              className={`filter-button filter-button--classic${activeMobFilter === "classic" ? " is-active" : ""}`}
              onClick={() => setActiveMobFilter("classic")}
              type="button"
            >
              <span>Classic</span>
            </button>
            <button
              className={`filter-button filter-button--recent${activeMobFilter === "recent" ? " is-active" : ""}`}
              onClick={() => setActiveMobFilter("recent")}
              type="button"
            >
              <span>Recently Added</span>
            </button>
          </div>
          {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

          {selectedMobs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-copy">
                <h3>Build a pack in three quick steps.</h3>
                <ol className="empty-state-steps">
                  <li>Pick a mob on the left.</li>
                  <li>Record or upload a sound.</li>
                  <li>Click Create Resource Pack.</li>
                </ol>
              </div>
            </div>
          ) : (
            <div className="cards-grid">
              {selectedMobs.map((mob) => (
                (() => {
                  const orderedSoundEvents = orderSoundEvents(mob);
                  const defaultVisibleLabels = DEFAULT_VISIBLE_EVENT_LABELS_BY_MOB[mob.localId];
                  const visibleLabelSet = defaultVisibleLabels ? new Set(defaultVisibleLabels) : null;
                  const defaultEvents = visibleLabelSet
                    ? orderedSoundEvents.filter((eventDefinition) => visibleLabelSet.has(eventLabel(eventDefinition.id)))
                    : orderedSoundEvents;
                  const hiddenEvents = visibleLabelSet
                    ? orderedSoundEvents.filter((eventDefinition) => !visibleLabelSet.has(eventLabel(eventDefinition.id)))
                    : [];
                  const hasCustomizedHiddenEvents = hiddenEvents.some((eventDefinition) =>
                    eventDefinition.variants.some((variant) => customizations[variant.id] || mutedVariantIds[variant.id]),
                  );
                  const isMobExpanded = expandedMobIds[mob.id] || hasCustomizedHiddenEvents;
                  const visibleEvents = isMobExpanded ? orderedSoundEvents : defaultEvents;

                  return (
                    <article
                      key={mob.id}
                      className="mob-card"
                      ref={(element) => {
                        cardRefs.current[mob.id] = element;
                      }}
                    >
                      <header className="mob-card-header">
                        <div className="mob-card-title">
                          <MobArtwork mob={mob} model={mobModels[mob.localId]} size="card" />
                          <div>
                            <h3>{mob.displayName}</h3>
                          </div>
                        </div>
                        <button className="ghost-button danger-button" onClick={() => handleRemoveMob(mob)} type="button">
                          Remove
                        </button>
                      </header>

                      <div className="event-stack">
                        {visibleEvents.map((eventDefinition) => {
                          const groupedVariants = groupVariantsBySoundPath(eventDefinition);

                          return (
                            <section className="event-card" key={eventDefinition.id}>
                              {isMobExpanded ? (
                                <>
                                  <header className="event-header">
                                    <div className="event-title">
                                      <strong>{eventLabel(eventDefinition.id)}</strong>
                                      <small>{eventDefinition.id}</small>
                                    </div>
                                  </header>
                                  {eventDefinition.subtitle ? <p className="event-subtitle">Subtitle: {eventDefinition.subtitle}</p> : null}
                                </>
                              ) : null}
                              <div className="variant-list">
                                {groupedVariants.map((group) => {
                                  const customization = getRepresentativeCustomization(group.variants, customizations);
                                  const isMuted = isGroupedSoundMuted(group.variants, mutedVariantIds);
                                  const pitchSummary = formatPitchSummary(group.pitchValues);
                                  const sampleVariant = group.variants[0];
                                  const isRecording = recordingGroupId === group.id;
                                  const isPlayingOriginal = playingPreview?.groupId === group.id && playingPreview.source === "original";
                                  const isPlayingCustom = playingPreview?.groupId === group.id && playingPreview.source === "custom";

                                  return (
                                    <div
                                      className={`variant-row${isMuted ? " is-muted" : ""}${isPlayingOriginal || isPlayingCustom ? " is-playing" : ""}`}
                                      key={group.id}
                                    >
                                      <div className="variant-summary">
                                        <div className="variant-copy">
                                          <div className="variant-heading-row">
                                            <strong>{group.label}</strong>
                                          </div>
                                          <div className="variant-waveform-stack">
                                            <VariantPreviewRow
                                              disabled={!sampleVariant.url}
                                              isPlaying={isPlayingOriginal}
                                              onToggle={() => togglePreview(group.id, "original", sampleVariant.url)}
                                              previewLabel="Original"
                                              variantLabel={group.label}
                                            >
                                              <VariantWaveform
                                                isPlaying={isPlayingOriginal}
                                                label={`${group.label} original`}
                                                progress={isPlayingOriginal ? previewProgress : 0}
                                                url={sampleVariant.url}
                                              />
                                            </VariantPreviewRow>
                                            {customization ? (
                                              <VariantPreviewRow
                                                disabled={!customization.url}
                                                isPlaying={isPlayingCustom}
                                                onToggle={() => togglePreview(group.id, "custom", customization.url)}
                                                previewLabel="Custom"
                                                variantLabel={group.label}
                                              >
                                                <VariantWaveform
                                                  isPlaying={isPlayingCustom}
                                                  label={`${group.label} custom`}
                                                  progress={isPlayingCustom ? previewProgress : 0}
                                                  url={customization.url}
                                                />
                                              </VariantPreviewRow>
                                            ) : null}
                                          </div>
                                          <div className="variant-detail-row">
                                            {pitchSummary ? <span className="variant-pitch-summary">{pitchSummary}</span> : null}
                                            <div className="variant-meta">
                                              {customization ? (
                                                <span className="custom-chip">
                                                  {customization.kind === "recording" ? "Recorded" : "Uploaded"}: {customization.fileName}
                                                </span>
                                              ) : null}
                                              {isMuted ? <span className="muted-chip">Muted in pack</span> : null}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                      <div className="variant-actions">
                                        <div
                                          aria-label={`${group.label} editing controls`}
                                          className="variant-action-row variant-action-row--edit"
                                          role="group"
                                        >
                                          <button
                                            className={`variant-primary-button${isRecording ? " recording" : ""}`}
                                            onClick={() => toggleRecording(group.id, group.variants, mob, group.label)}
                                            type="button"
                                          >
                                            {isRecording ? "Stop Recording" : "Record"}
                                          </button>
                                          <button className="variant-secondary-button" onClick={() => handlePickFile(group.id)} type="button">
                                            Upload
                                          </button>
                                          <button
                                            className="variant-secondary-button"
                                            disabled={!customization}
                                            onClick={() => {
                                              if (!customization) {
                                                return;
                                              }

                                              applyCustomizationToEvent(eventDefinition, customization);
                                            }}
                                            type="button"
                                          >
                                            Apply To Event
                                          </button>
                                          <button
                                            className={`variant-secondary-button${isMuted ? " is-active" : ""}`}
                                            onClick={() => toggleMuteForGroup(group.variants)}
                                            type="button"
                                          >
                                            {isMuted ? "Unmute In Pack" : "Mute In Pack"}
                                          </button>
                                          <button
                                            className="variant-secondary-button"
                                            disabled={!customization && !isMuted}
                                            onClick={() => resetGroupedSound(group.variants)}
                                            type="button"
                                          >
                                            Reset Changes
                                          </button>
                                        </div>
                                        <input
                                          accept="audio/*"
                                          hidden
                                          onChange={(event) => {
                                            handleFileSelected(group.variants, event.target.files?.[0]);
                                            event.currentTarget.value = "";
                                          }}
                                          ref={(element) => {
                                            fileInputRefs.current[group.id] = element;
                                          }}
                                          type="file"
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </section>
                          );
                        })}
                      </div>

                      {hiddenEvents.length > 0 ? (
                        <div className="event-toggle-row">
                          <button className="event-toggle-button" onClick={() => toggleMobEventExpansion(mob.id)} type="button">
                            {isMobExpanded ? "show less" : `more... (${hiddenEvents.length} more)`}
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })()
              ))}
            </div>
          )}
        </section>
      </main>
      <p className="sr-only">Modified sounds: {customizedVariantCount}</p>
      {mobPendingRemoval ? (
        <div className="modal-backdrop" onClick={() => setMobPendingRemoval(null)} role="presentation">
          <div
            aria-labelledby="remove-mob-title"
            aria-modal="true"
            className="confirm-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="confirm-modal-copy">
              <p className="confirm-modal-eyebrow">Remove Mob</p>
              <h2 id="remove-mob-title">Remove {mobPendingRemoval.displayName}?</h2>
              <p>
                This mob already has recorded or uploaded custom sounds. Removing it now will discard those audio edits for this mob.
              </p>
            </div>
            <div className="confirm-modal-actions">
              <button className="ghost-button" onClick={() => setMobPendingRemoval(null)} type="button">
                Cancel
              </button>
              <button className="ghost-button danger-button" onClick={confirmRemoveMob} type="button">
                Remove Mob
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VariantPreviewRow({
  children,
  disabled,
  isPlaying,
  onToggle,
  previewLabel,
  variantLabel,
}: {
  children: ReactNode;
  disabled: boolean;
  isPlaying: boolean;
  onToggle: () => void;
  previewLabel: string;
  variantLabel: string;
}) {
  return (
    <div className={`variant-waveform-row${isPlaying ? " is-playing" : ""}`}>
      <span className="variant-waveform-source">{previewLabel}</span>
      <button
        aria-label={`${isPlaying ? "Stop" : "Play"} ${previewLabel.toLowerCase()} preview for ${variantLabel}`}
        className={`variant-waveform-button${isPlaying ? " is-active" : ""}`}
        disabled={disabled}
        onClick={onToggle}
        type="button"
      >
        {isPlaying ? "Stop" : "Play"}
      </button>
      {children}
    </div>
  );
}

function VariantWaveform({
  isPlaying,
  label,
  progress,
  url,
}: {
  isPlaying: boolean;
  label: string;
  progress: number;
  url?: string;
}) {
  const cachedBars = url ? getCachedWaveformBars(url) : null;
  const [bars, setBars] = useState<number[]>(cachedBars ?? []);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">(
    url ? (cachedBars?.length ? "ready" : "loading") : "fallback",
  );

  useEffect(() => {
    let active = true;

    if (!url) {
      setBars([]);
      setStatus("fallback");
      return;
    }

    const cachedWaveform = getCachedWaveformBars(url);
    if (cachedWaveform) {
      setBars(cachedWaveform);
      setStatus(cachedWaveform.length > 0 ? "ready" : "fallback");
      return;
    }

    setStatus("loading");

    getWaveformBars(url, VARIANT_WAVEFORM_BAR_COUNT)
      .then((nextBars) => {
        if (!active) {
          return;
        }

        setBars(nextBars);
        setStatus(nextBars.length > 0 ? "ready" : "fallback");
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setBars([]);
        setStatus("fallback");
      });

    return () => {
      active = false;
    };
  }, [url]);

  const displayBars = bars.length > 0 ? bars : placeholderWaveformBars(label);
  const clampedProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const playedBarCount = Math.floor(clampedProgress * displayBars.length);
  const currentBarIndex = isPlaying && clampedProgress < 1 ? Math.min(displayBars.length - 1, playedBarCount) : -1;

  return (
    <div
      aria-label={`Waveform preview for ${label}`}
      className={`variant-waveform${status === "loading" ? " is-loading" : ""}${status === "fallback" ? " is-fallback" : ""}${
        isPlaying ? " is-playing" : ""
      }`}
      style={{ "--waveform-progress": `${clampedProgress * 100}%` } as CSSProperties}
      role="img"
    >
      <div className="waveform-layers">
        <div aria-hidden="true" className="waveform-bars">
          {displayBars.map((height, index) => (
            <span
              className={`waveform-bar${index < playedBarCount ? " is-played" : ""}${index === currentBarIndex ? " is-current" : ""}`}
              key={`${label}-bar-${index}`}
              style={{ "--bar-h": `${height}%` } as CSSProperties}
            />
          ))}
        </div>
        <span aria-hidden="true" className="waveform-cursor" />
      </div>
    </div>
  );
}

export function usesStaticModelPreview(localId: string) {
  return STATIC_MODEL_PREVIEW_MOB_IDS.has(localId);
}

function MobArtwork({
  mob,
  model,
  size,
}: {
  mob: MobDefinition;
  model?: MobModelDefinition;
  size: "card" | "list";
}) {
  if (mob.imagePath && !usesStaticModelPreview(mob.localId)) {
    return <img alt="" className={`mob-preview mob-preview--${size} mob-preview-image`} decoding="async" loading="lazy" src={mob.imagePath} />;
  }

  return <MobModelPreview mob={mob} model={model} size={size} />;
}

function eventLabel(value: string) {
  return value
    .split(".")
    .slice(2)
    .join(" ")
    .replace(/_/g, " ")
    .toLowerCase();
}

function orderSoundEvents(mob: MobDefinition) {
  if (mob.localId !== "villager") {
    return mob.soundEvents;
  }

  const yesEventIndex = mob.soundEvents.findIndex((eventDefinition) => eventDefinition.id === "entity.villager.yes");
  if (yesEventIndex === -1) {
    return mob.soundEvents;
  }

  const workEventIndexes = mob.soundEvents
    .map((eventDefinition, index) => ({ eventDefinition, index }))
    .filter(({ eventDefinition }) => eventDefinition.id.startsWith("entity.villager.work_"))
    .map(({ index }) => index);
  if (workEventIndexes.length === 0) {
    return mob.soundEvents;
  }

  const firstWorkEventIndex = Math.min(...workEventIndexes);
  if (yesEventIndex < firstWorkEventIndex) {
    return mob.soundEvents;
  }

  const orderedEvents = [...mob.soundEvents];
  const [yesEvent] = orderedEvents.splice(yesEventIndex, 1);
  orderedEvents.splice(firstWorkEventIndex, 0, yesEvent);
  return orderedEvents;
}

function placeholderWaveformBars(seedText: string) {
  const seed = Array.from(seedText).reduce((total, character, index) => total + character.charCodeAt(0) * (index + 1), 0);

  return Array.from({ length: VARIANT_WAVEFORM_BAR_COUNT }, (_, index) => {
    const wave = Math.sin((seed + index * 23) / 11) + Math.cos((seed + index * 17) / 19);
    const normalized = (wave + 2) / 4;
    return 18 + Math.round(normalized * 58);
  });
}
