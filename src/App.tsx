import { startTransition, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { getPreferredRecordingMimeType } from "./audio";
import { buildResourcePackBlob } from "./export";
import { MobModelPreview } from "./mobModelPreview";
import { formatPitchSummary, getRepresentativeCustomization, groupVariantsBySoundPath, isGroupedSoundMuted } from "./soundGroups";
import type { CustomVariantSound, MobDefinition, MobModelDefinition, MobSoundEvent, MobSoundVariant, MobSoundsDataset } from "./types";

const DATASET_URL = "/data/mob-sounds.json";
const MODEL_DATASET_URL = "/data/mob-models.json";
const FORCE_MODEL_PREVIEW_MOB_IDS = new Set(["illusioner", "pufferfish"]);
const CLASSIC_FILTER_EXCLUDED_MOB_IDS = new Set(["skeleton"]);
const BROWSER_LIST_GAP = 16;
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
type StoredCustomizationSeed = Omit<CustomVariantSound, "url">;

export default function App() {
  const [dataset, setDataset] = useState<MobSoundsDataset | null>(null);
  const [mobModels, setMobModels] = useState<Record<string, MobModelDefinition>>({});
  const [search, setSearch] = useState("");
  const [activeMobFilter, setActiveMobFilter] = useState("all");
  const [selectedMobIds, setSelectedMobIds] = useState<string[]>([]);
  const [customizations, setCustomizations] = useState<Record<string, CustomVariantSound>>({});
  const [mutedVariantIds, setMutedVariantIds] = useState<Record<string, boolean>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Loading mob sound data...");
  const [recordingGroupId, setRecordingGroupId] = useState<string | null>(null);
  const [playingPreview, setPlayingPreview] = useState<{ groupId: string; source: PreviewSource } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [expandedMobIds, setExpandedMobIds] = useState<Record<string, boolean>>({});

  const deferredSearch = useDeferredValue(search);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingTargetRef = useRef<{ fileName: string; variantIds: string[] } | null>(null);
  const recorderChunksRef = useRef<BlobPart[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const customizationsRef = useRef<Record<string, CustomVariantSound>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const browserControlsRef = useRef<HTMLDivElement | null>(null);
  const exportReadyTimeoutRef = useRef<number | null>(null);
  const wasExportReadyRef = useRef(false);
  const [isExportButtonFlashing, setIsExportButtonFlashing] = useState(false);
  const [browserControlsHeight, setBrowserControlsHeight] = useState(0);

  useEffect(() => {
    let active = true;
    const abortController = new AbortController();

    Promise.all([
      fetch(DATASET_URL, { signal: abortController.signal }).then(async (response) => {
        if (!response.ok) {
          throw new Error(`Could not load ${DATASET_URL} (${response.status}). Run npm run sync:data first.`);
        }

        return (await response.json()) as MobSoundsDataset;
      }),
      fetch(MODEL_DATASET_URL, { signal: abortController.signal })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Could not load ${MODEL_DATASET_URL} (${response.status}).`);
          }

          return (await response.json()) as { mobs?: Record<string, MobModelDefinition> };
        })
        .catch(() => ({ mobs: {} })),
    ])
      .then(([loadedDataset, loadedModels]) => {
        if (!active) {
          return;
        }

        setDataset(loadedDataset);
        setMobModels(loadedModels.mobs ?? {});
        setStatusMessage(`Loaded ${loadedDataset.mobs.length} mobs from mc-datahub ${loadedDataset.version}.`);
      })
      .catch((error: Error) => {
        if (!active) {
          return;
        }

        setErrorMessage(error.message);
        setStatusMessage("Could not load Mob Dub data.");
      });

    return () => {
      active = false;
      abortController.abort();
    };
  }, []);

  useEffect(() => {
    customizationsRef.current = customizations;
  }, [customizations]);

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

      if (activeMobFilter === "unreleased" && mob.releaseStatus !== "unreleased") {
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

  function handleRemoveMob(mob: MobDefinition) {
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

  function stopPreview() {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onpause = null;
      audio.pause();
      audio.currentTime = 0;
      audioRef.current = null;
    }

    setPlayingPreview(null);
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

    if (playingPreview?.groupId === groupId && playingPreview.source === source) {
      stopPreview();
      return;
    }

    stopPreview();

    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlayingPreview(null);
      }
    };
    audio.onpause = () => {
      if (audioRef.current === audio && !audio.ended) {
        audioRef.current = null;
        setPlayingPreview(null);
      }
    };

    setPlayingPreview({ groupId, source });

    try {
      await audio.play();
    } catch (error) {
      if (audioRef.current === audio) {
        audioRef.current = null;
      }

      setPlayingPreview(null);
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
              <input aria-label="Search mobs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search for mob" />
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
            <div className="filter-bar">
              <button
                className={`filter-button${activeMobFilter === "all" ? " is-active" : ""}`}
                onClick={() => setActiveMobFilter("all")}
                type="button"
              >
                <span>All</span>
              </button>
              <button
                className={`filter-button${activeMobFilter === "classic" ? " is-active" : ""}`}
                onClick={() => setActiveMobFilter("classic")}
                type="button"
              >
                <span>Classic</span>
              </button>
              <button
                className={`filter-button${activeMobFilter === "recent" ? " is-active" : ""}`}
                onClick={() => setActiveMobFilter("recent")}
                type="button"
              >
                <span>Recent</span>
              </button>
              <button
                className={`filter-button${activeMobFilter === "unreleased" ? " is-active" : ""}`}
                onClick={() => setActiveMobFilter("unreleased")}
                type="button"
              >
                <span>Unreleased</span>
              </button>
            </div>
          </div>
          {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

          {selectedMobs.length === 0 ? (
            <div className="empty-state">
              <div aria-hidden="true" className="empty-state-arrow">
                <span className="empty-state-arrow-line" />
                <span className="empty-state-arrow-head" />
              </div>
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
                  const isExpanded = expandedMobIds[mob.id] || hasCustomizedHiddenEvents;
                  const visibleEvents = isExpanded ? orderedSoundEvents : defaultEvents;

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
                        <button className="ghost-button" onClick={() => handleRemoveMob(mob)} type="button">
                          Remove
                        </button>
                      </header>

                      <div className="event-stack">
                        {visibleEvents.map((eventDefinition) => {
                          const groupedVariants = groupVariantsBySoundPath(eventDefinition);

                          return (
                            <section className="event-card" key={eventDefinition.id}>
                              <header className="event-header">
                                <div className="event-title">
                                  <strong>{eventLabel(eventDefinition.id)}</strong>
                                  <small>{eventDefinition.id}</small>
                                </div>
                              </header>
                              {eventDefinition.subtitle ? <p className="event-subtitle">Subtitle: {eventDefinition.subtitle}</p> : null}
                              <div className="variant-list">
                                {groupedVariants.map((group) => {
                                  const customization = getRepresentativeCustomization(group.variants, customizations);
                                  const isMuted = isGroupedSoundMuted(group.variants, mutedVariantIds);
                                  const pitchSummary = formatPitchSummary(group.pitchValues);
                                  const sampleVariant = group.variants[0];
                                  const isRecording = recordingGroupId === group.id;
                                  const isPlayingOriginal = playingPreview?.groupId === group.id && playingPreview.source === "original";
                                  const isPlayingCustom = playingPreview?.groupId === group.id && playingPreview.source === "custom";
                                  const playbackStateLabel = isPlayingOriginal
                                    ? "Playing original"
                                    : isPlayingCustom
                                      ? "Playing custom"
                                      : null;

                                  return (
                                    <div
                                      className={`variant-row${isMuted ? " is-muted" : ""}${isPlayingOriginal || isPlayingCustom ? " is-playing" : ""}`}
                                      key={group.id}
                                    >
                                      <div className="variant-copy">
                                        <button
                                          className={`sound-label-button${isPlayingOriginal ? " is-playing" : ""}`}
                                          disabled={!sampleVariant.url}
                                          onClick={() => togglePreview(group.id, "original", sampleVariant.url)}
                                          type="button"
                                        >
                                          <WaveformBars isActive={isPlayingOriginal || isPlayingCustom} />
                                          <span className="sound-label-text">
                                            <strong>{group.label}</strong>
                                            {pitchSummary ? <span>{pitchSummary}</span> : null}
                                          </span>
                                        </button>
                                        <div className="variant-meta">
                                          {playbackStateLabel ? <span className="playback-chip">{playbackStateLabel}</span> : null}
                                          {customization ? (
                                            <span className="custom-chip">
                                              {customization.kind === "recording" ? "Mic Take" : "Uploaded File"}: {customization.fileName}
                                            </span>
                                          ) : null}
                                          {customization ? <span className="compare-chip">Compare original vs custom</span> : null}
                                          {isMuted ? <span className="muted-chip">Muted in pack</span> : null}
                                        </div>
                                      </div>
                                      <div className="variant-actions">
                                        <button
                                          className={isPlayingOriginal ? "is-active" : ""}
                                          disabled={!sampleVariant.url}
                                          onClick={() => togglePreview(group.id, "original", sampleVariant.url)}
                                          type="button"
                                        >
                                          Play Original
                                        </button>
                                        <button
                                          className={isPlayingCustom ? "is-active" : ""}
                                          disabled={!customization}
                                          onClick={() => customization && togglePreview(group.id, "custom", customization.url)}
                                          type="button"
                                        >
                                          Play Custom
                                        </button>
                                        <button
                                          className={isRecording ? "recording" : ""}
                                          onClick={() => toggleRecording(group.id, group.variants, mob, group.label)}
                                          type="button"
                                        >
                                          {isRecording ? "Stop" : "Record"}
                                        </button>
                                        <button onClick={() => handlePickFile(group.id)} type="button">
                                          Upload
                                        </button>
                                        <button
                                          disabled={!customization}
                                          onClick={() => customization && applyCustomizationToEvent(eventDefinition, customization)}
                                          type="button"
                                        >
                                          Override Event
                                        </button>
                                        <button className={isMuted ? "is-active" : ""} onClick={() => toggleMuteForGroup(group.variants)} type="button">
                                          {isMuted ? "Unmute" : "Mute"}
                                        </button>
                                        <button
                                          disabled={!customization && !isMuted}
                                          onClick={() => resetGroupedSound(group.variants)}
                                          type="button"
                                        >
                                          Reset
                                        </button>
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
                            {isExpanded ? "show less" : `more... (${hiddenEvents.length} more)`}
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
    </div>
  );
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
  if (mob.imagePath && !FORCE_MODEL_PREVIEW_MOB_IDS.has(mob.localId)) {
    return <img alt="" className={`mob-preview mob-preview--${size} mob-preview-image`} decoding="async" loading="lazy" src={mob.imagePath} />;
  }

  return <MobModelPreview mob={mob} model={model} size={size} />;
}

function WaveformBars({ isActive }: { isActive: boolean }) {
  return (
    <span aria-hidden="true" className={`waveform-bars${isActive ? " is-active" : ""}`}>
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  );
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
