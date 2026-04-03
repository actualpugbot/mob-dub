import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { getPreferredRecordingMimeType } from "./audio";
import { BROAD_COMPATIBILITY_MIN_FORMAT, buildResourcePackBlob } from "./export";
import { MobModelPreview } from "./mobModelPreview";
import type { CompatibilityMode, CustomVariantSound, MobDefinition, MobModelDefinition, MobSoundEvent, MobSoundVariant, MobSoundsDataset } from "./types";

const DATASET_URL = "/data/mob-sounds.json";
const MODEL_DATASET_URL = "/data/mob-models.json";

export default function App() {
  const [dataset, setDataset] = useState<MobSoundsDataset | null>(null);
  const [mobModels, setMobModels] = useState<Record<string, MobModelDefinition>>({});
  const [search, setSearch] = useState("");
  const [selectedMobIds, setSelectedMobIds] = useState<string[]>([]);
  const [customizations, setCustomizations] = useState<Record<string, CustomVariantSound>>({});
  const [compatibilityMode, setCompatibilityMode] = useState<CompatibilityMode>("broad");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Loading mob sound data...");
  const [recordingVariantId, setRecordingVariantId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const deferredSearch = useDeferredValue(search);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingTargetRef = useRef<{ eventId: string; fileName: string; variantId: string } | null>(null);
  const recorderChunksRef = useRef<BlobPart[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const customizationsRef = useRef<Record<string, CustomVariantSound>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});

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

  useEffect(() => {
    return () => {
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
    if (!normalizedQuery) {
      return mobs;
    }

    return mobs.filter((mob) =>
      [mob.displayName, mob.localId, mob.category, mob.soundId].some((value) => value.toLowerCase().includes(normalizedQuery)),
    );
  }, [deferredSearch, mobs]);

  const selectedMobs = selectedMobIds.map((id) => mobById.get(id)).filter(Boolean) as MobDefinition[];
  const customizedVariantCount = Object.keys(customizations).length;
  const customizedMobCount = selectedMobs.filter((mob) =>
    mob.soundEvents.some((eventDefinition) => eventDefinition.variants.some((variant) => customizations[variant.id])),
  ).length;
  const exportPackFormat = dataset?.resourcePack?.packFormat ?? 84;

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
    clearMobCustomizations(mob);
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
    if (!dataset || customizedVariantCount === 0) {
      return;
    }

    setErrorMessage(null);
    setIsExporting(true);
    setStatusMessage("Building your resource pack...");

    try {
      const blob = await buildResourcePackBlob({
        compatibilityMode,
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
      <header className="hero">
        <p className="eyebrow">Minecraft Resource-Pack Voice Lab</p>
        <h1>Mob Dub</h1>
        <p className="hero-copy">
          Pick any mob, audition every vanilla sound variant, then swap individual clips with your own microphone takes or uploaded audio
          before exporting a ready-to-drop resource pack.
        </p>
      </header>

      <main className="workspace">
        <aside className="browser-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Browser</p>
              <h2>Every Mob</h2>
            </div>
          </div>
          <label className="search-field">
            <span>Search mobs</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Try allay, warden, villager..." />
          </label>
          <div className="mob-list">
            {filteredMobs.map((mob) => {
              const isSelected = selectedMobIds.includes(mob.id);
              return (
                <button
                  key={mob.id}
                  className={`mob-list-item${isSelected ? " is-selected" : ""}`}
                  onClick={() => handleSelectMob(mob)}
                  type="button"
                >
                  <span className="mob-list-copy">
                    <MobModelPreview mob={mob} model={mobModels[mob.localId]} size="list" />
                    <span>
                      <strong>{mob.displayName}</strong>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="cards-panel">
          <div className="cards-toolbar">
            <div>
              <p className="panel-kicker">Selection</p>
              <h2>Dub Cards</h2>
            </div>

            <div className="export-panel">
              <label className="compatibility-field">
                <span>Export mode</span>
                <select value={compatibilityMode} onChange={(event) => setCompatibilityMode(event.target.value as CompatibilityMode)}>
                  <option value="broad">Broad compatibility (34-{exportPackFormat})</option>
                  <option value="current">Current release only ({exportPackFormat})</option>
                </select>
              </label>
              <button className="export-button" disabled={!dataset || customizedVariantCount === 0 || isExporting} onClick={handleExport} type="button">
                {isExporting ? "Building Pack..." : `Export Pack (${customizedVariantCount})`}
              </button>
            </div>
          </div>

          <div className="status-strip">
            <span>{statusMessage}</span>
            {compatibilityMode === "broad" ? (
              <span>
                Uses `min_format` / `max_format` plus `supported_formats` for a broad voice-pack range starting at format {BROAD_COMPATIBILITY_MIN_FORMAT}.
              </span>
            ) : (
              <span>Writes a strict single-version pack target using format {exportPackFormat}.</span>
            )}
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
                <article
                  key={mob.id}
                  className="mob-card"
                  ref={(element) => {
                    cardRefs.current[mob.id] = element;
                  }}
                >
                  <header className="mob-card-header">
                    <div className="mob-card-title">
                      <MobModelPreview mob={mob} model={mobModels[mob.localId]} size="card" />
                      <div>
                        <p className="panel-kicker">{mob.category}</p>
                        <h3>{mob.displayName}</h3>
                      </div>
                    </div>
                    <button className="ghost-button" onClick={() => handleRemoveMob(mob)} type="button">
                      Remove
                    </button>
                  </header>

                  <div className="mob-metrics">
                    <Metric label="Entity ID" value={mob.localId} />
                    <Metric label="Sound Root" value={mob.soundId} />
                    <Metric label="Events" value={String(mob.soundEventCount)} />
                    <Metric label="Variants" value={String(mob.soundVariantCount)} />
                  </div>

                  <div className="event-stack">
                    {mob.soundEvents.map((eventDefinition) => (
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
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function eventLabel(value: string) {
  return value
    .split(".")
    .slice(2)
    .join(" ")
    .replace(/_/g, " ");
}
