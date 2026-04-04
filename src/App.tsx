import { startTransition, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { getPreferredRecordingMimeType } from "./audio";
import { buildResourcePackBlob } from "./export";
import { MobModelPreview } from "./mobModelPreview";
import type { CustomVariantSound, MobDefinition, MobModelDefinition, MobSoundEvent, MobSoundVariant, MobSoundsDataset } from "./types";

const DATASET_URL = "/data/mob-sounds.json";
const MODEL_DATASET_URL = "/data/mob-models.json";
const FORCE_MODEL_PREVIEW_MOB_IDS = new Set(["giant", "illusioner"]);
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

export default function App() {
  const [dataset, setDataset] = useState<MobSoundsDataset | null>(null);
  const [mobModels, setMobModels] = useState<Record<string, MobModelDefinition>>({});
  const [search, setSearch] = useState("");
  const [activeMobFilter, setActiveMobFilter] = useState("all");
  const [selectedMobIds, setSelectedMobIds] = useState<string[]>([]);
  const [customizations, setCustomizations] = useState<Record<string, CustomVariantSound>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Loading mob sound data...");
  const [recordingVariantId, setRecordingVariantId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [expandedMobIds, setExpandedMobIds] = useState<Record<string, boolean>>({});

  const deferredSearch = useDeferredValue(search);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingTargetRef = useRef<{ eventId: string; fileName: string; variantId: string } | null>(null);
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

      if (audioRef.current) {
        audioRef.current.pause();
      }

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

      if (activeMobFilter === "classic" && mob.introducedVersion !== "Classic") {
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
  const customizedMobCount = selectedMobs.filter((mob) =>
    mob.soundEvents.some((eventDefinition) => eventDefinition.variants.some((variant) => customizations[variant.id])),
  ).length;
  const canCreateResourcePack = Boolean(dataset) && selectedMobs.length > 0 && customizedMobCount > 0;
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
    setSelectedMobIds((current) => current.filter((id) => id !== mob.id));
    setExpandedMobIds((current) => {
      if (!current[mob.id]) {
        return current;
      }

      const next = { ...current };
      delete next[mob.id];
      return next;
    });
    clearMobCustomizations(mob);
  }

  function toggleMobEventExpansion(mobId: string) {
    setExpandedMobIds((current) => ({
      ...current,
      [mobId]: !current[mobId],
    }));
  }

  async function playPreview(url: string) {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    const audio = new Audio(url);
    audioRef.current = audio;
    try {
      await audio.play();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The preview audio could not be played.");
    }
  }

  async function toggleRecording(variant: MobSoundVariant, eventDefinition: MobSoundEvent, mob: MobDefinition) {
    setErrorMessage(null);

    if (recordingVariantId === variant.id) {
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
        eventId: eventDefinition.id,
        fileName: `${mob.localId}_${variant.id.replace(/[^a-z0-9]+/gi, "_")}.ogg`,
        variantId: variant.id,
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recorderChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        setRecordingVariantId(null);
        setErrorMessage("Microphone recording failed.");
      };
      recorder.onstop = () => {
        const target = recordingTargetRef.current;
        setRecordingVariantId(null);
        if (!target || recorderChunksRef.current.length === 0) {
          return;
        }

        const blob = new Blob(recorderChunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        storeCustomization(target.variantId, {
          blob,
          fileName: target.fileName,
          kind: "recording",
          mimeType: blob.type || recorder.mimeType || "audio/webm",
          url: URL.createObjectURL(blob),
        });
      };

      recorderRef.current = recorder;
      recorder.start();
      setRecordingVariantId(variant.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Microphone access was denied.");
    }
  }

  function handlePickFile(variantId: string) {
    fileInputRefs.current[variantId]?.click();
  }

  function handleFileSelected(variant: MobSoundVariant, file: File | undefined) {
    if (!file) {
      return;
    }

    const blob = file.slice(0, file.size, file.type || "application/octet-stream");
    storeCustomization(variant.id, {
      blob,
      fileName: file.name,
      kind: "upload",
      mimeType: file.type || "application/octet-stream",
      url: URL.createObjectURL(blob),
    });
  }

  function storeCustomization(variantId: string, next: CustomVariantSound) {
    setCustomizations((current) => {
      const previous = current[variantId];
      if (previous) {
        URL.revokeObjectURL(previous.url);
      }

      return {
        ...current,
        [variantId]: next,
      };
    });
  }

  function clearCustomization(variantId: string) {
    setCustomizations((current) => {
      const existing = current[variantId];
      if (!existing) {
        return current;
      }

      URL.revokeObjectURL(existing.url);
      const next = { ...current };
      delete next[variantId];
      return next;
    });
  }

  function clearMobCustomizations(mob: MobDefinition) {
    const variantIds = mob.soundEvents.flatMap((eventDefinition) => eventDefinition.variants.map((variant) => variant.id));
    setCustomizations((current) => {
      const next = { ...current };
      for (const variantId of variantIds) {
        if (next[variantId]) {
          URL.revokeObjectURL(next[variantId].url);
          delete next[variantId];
        }
      }
      return next;
    });
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
        onProgress: (message) => setStatusMessage(message),
      });

      const fileName = `mob-dub-${dataset.version}-${customizedMobCount || "custom"}-mobs.zip`;
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
              <h3>Pick a mob from the left.</h3>
              <p>Each selection opens a card here with every sound event, every vanilla variant, and controls for recording or uploading replacements.</p>
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
                    eventDefinition.variants.some((variant) => customizations[variant.id]),
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
                        {visibleEvents.map((eventDefinition) => (
                      <section className="event-card" key={eventDefinition.id}>
                        <header className="event-header">
                          <div className="event-title">
                            <strong>{eventLabel(eventDefinition.id)}</strong>
                            <small>{eventDefinition.id}</small>
                          </div>
                        </header>
                        {eventDefinition.subtitle ? <p className="event-subtitle">Subtitle: {eventDefinition.subtitle}</p> : null}
                        <div className="variant-list">
                          {eventDefinition.variants.map((variant) => {
                            const customization = customizations[variant.id];
                            const isRecording = recordingVariantId === variant.id;
                            return (
                              <div className="variant-row" key={variant.id}>
                                <div className="variant-copy">
                                  <strong>{variant.soundPath.split("/").pop()}</strong>
                                  {customization ? (
                                    <span className="custom-chip">
                                      {customization.kind === "recording" ? "Mic Take" : "Uploaded File"}: {customization.fileName}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="variant-actions">
                                  <button onClick={() => playPreview(variant.url)} type="button">
                                    Play Original
                                  </button>
                                  <button disabled={!customization} onClick={() => customization && playPreview(customization.url)} type="button">
                                    Play Custom
                                  </button>
                                  <button className={isRecording ? "recording" : ""} onClick={() => toggleRecording(variant, eventDefinition, mob)} type="button">
                                    {isRecording ? "Stop" : "Record"}
                                  </button>
                                  <button onClick={() => handlePickFile(variant.id)} type="button">
                                    Upload
                                  </button>
                                  <button disabled={!customization} onClick={() => clearCustomization(variant.id)} type="button">
                                    Reset
                                  </button>
                                  <input
                                    accept="audio/*"
                                    hidden
                                    onChange={(event) => {
                                      handleFileSelected(variant, event.target.files?.[0]);
                                      event.currentTarget.value = "";
                                    }}
                                    ref={(element) => {
                                      fileInputRefs.current[variant.id] = element;
                                    }}
                                    type="file"
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                        ))}
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

function mobStatusLabel(mob: MobDefinition) {
  if (mob.releaseStatus === "unreleased") {
    return "Unreleased";
  }

  if (mob.isRecent) {
    return "Recent";
  }

  return "Released";
}
