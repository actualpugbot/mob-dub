import { startTransition, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MutableRefObject, ReactNode } from "react";
import { getCachedWaveformBars, getPreferredRecordingMimeType, getWaveformBars } from "./audio";
import { buildResourcePackBlob } from "./export";
import { MobModelPreview } from "./mobModelPreview";
import { formatPitchSummary, getRepresentativeCustomization, groupVariantsBySoundPath, isGroupedSoundMuted } from "./soundGroups";
import type { CustomVariantSound, MobDefinition, MobModelDefinition, MobSoundEvent, MobSoundVariant, MobSoundsDataset } from "./types";

const DATASET_URL = "/data/mob-sounds.json";
const MODEL_DATASET_URL = "/data/mob-models.json";
const CLASSIC_FILTER_EXCLUDED_MOB_IDS = new Set(["skeleton"]);
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

const BROWSER_LIST_GAP = 16;
const ESTIMATED_BROWSER_CONTROLS_HEIGHT = 68;
const VARIANT_WAVEFORM_BAR_COUNT = 64;
const EXPORT_READY_FLASH_DURATION_MS = 1400;
const DEFAULT_RECORDING_MIME_TYPE = "audio/webm";
const DEFAULT_FILE_MIME_TYPE = "application/octet-stream";

type MobFilter = "all" | "classic" | "recent";
type PreviewSource = "custom" | "original";
type PlayingPreview = { groupId: string; source: PreviewSource; url: string };
type StoredCustomizationSeed = Omit<CustomVariantSound, "url">;
type MobModelsResponse = { mobs?: Record<string, MobModelDefinition> };
type FileInputRefMap = MutableRefObject<Record<string, HTMLInputElement | null>>;
type CardRefMap = MutableRefObject<Record<string, HTMLElement | null>>;
type VariantEditorHandlers = {
  onApplyCustomizationToEvent: (eventDefinition: MobSoundEvent, customization: CustomVariantSound) => void;
  onFileSelected: (variants: MobSoundVariant[], file?: File) => void;
  onPickFile: (groupId: string) => void;
  onResetGroupedSound: (variants: MobSoundVariant[]) => void;
  onToggleMuteForGroup: (variants: MobSoundVariant[]) => void;
  onTogglePreview: (groupId: string, source: PreviewSource, url?: string) => Promise<void>;
  onToggleRecording: (groupId: string, variants: MobSoundVariant[], mob: MobDefinition, label: string) => Promise<void>;
};

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

export default function App() {
  const [dataset, setDataset] = useState<MobSoundsDataset | null>(null);
  const [mobModels, setMobModels] = useState<Record<string, MobModelDefinition>>({});
  const [search, setSearch] = useState("");
  const [activeMobFilter, setActiveMobFilter] = useState<MobFilter>("classic");
  const [selectedMobIds, setSelectedMobIds] = useState<string[]>([]);
  const [customizations, setCustomizations] = useState<Record<string, CustomVariantSound>>({});
  const [mutedVariantIds, setMutedVariantIds] = useState<Record<string, boolean>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Loading mob sound data...");
  const [isExporting, setIsExporting] = useState(false);
  const [expandedMobIds, setExpandedMobIds] = useState<Record<string, boolean>>({});
  const [mobPendingRemoval, setMobPendingRemoval] = useState<MobDefinition | null>(null);

  const deferredSearch = useDeferredValue(search);
  const customizationsRef = useSyncedRef(customizations);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});

  const storeCustomizationGroup = useCallback((variantIds: string[], next: StoredCustomizationSeed) => {
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
  }, []);

  const clearCustomizationGroup = useCallback((variantIds: string[]) => {
    setCustomizations((current) => {
      let changed = false;
      const next = { ...current };

      for (const variantId of variantIds) {
        const existing = next[variantId];
        if (!existing) {
          continue;
        }

        changed = true;
        URL.revokeObjectURL(existing.url);
        delete next[variantId];
      }

      return changed ? next : current;
    });
  }, []);

  const clearMuteGroup = useCallback((variantIds: string[]) => {
    setMutedVariantIds((current) => removeKeys(current, variantIds));
  }, []);

  const resetGroupedSound = useCallback(
    (variants: MobSoundVariant[]) => {
      const variantIds = getVariantIds(variants);
      clearCustomizationGroup(variantIds);
      clearMuteGroup(variantIds);
    },
    [clearCustomizationGroup, clearMuteGroup],
  );

  const clearMobEdits = useCallback(
    (mob: MobDefinition) => {
      const variantIds = getMobVariantIds(mob);
      clearCustomizationGroup(variantIds);
      clearMuteGroup(variantIds);
    },
    [clearCustomizationGroup, clearMuteGroup],
  );

  const { browserControlsHeight, browserControlsRef } = useBrowserControlsHeight();
  const { playingPreview, previewProgress, stopPreview, togglePreview } = useAudioPreview(setErrorMessage);
  const { recordingGroupId, toggleRecording } = useGroupRecorder({
    onStoreGroup: storeCustomizationGroup,
    setErrorMessage,
  });

  useEscapeToDismiss(Boolean(mobPendingRemoval), () => {
    setMobPendingRemoval(null);
  });

  useEffect(() => {
    let active = true;
    const abortController = new AbortController();

    void loadDataset({ abortController, onError: setErrorMessage, onLoaded: setDataset, onStatus: setStatusMessage, active: () => active });
    void loadMobModels({ abortController, onLoaded: setMobModels, active: () => active });

    return () => {
      active = false;
      abortController.abort();
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const customization of Object.values(customizationsRef.current)) {
        URL.revokeObjectURL(customization.url);
      }
    };
  }, [customizationsRef]);

  const mobs = dataset?.mobs ?? [];
  const hasClassicMobs = useMemo(
    () => mobs.some((mob) => mob.introducedVersion === "Classic" && !CLASSIC_FILTER_EXCLUDED_MOB_IDS.has(mob.localId)),
    [mobs],
  );

  useEffect(() => {
    if (dataset && activeMobFilter === "classic" && !hasClassicMobs) {
      setActiveMobFilter("all");
    }
  }, [activeMobFilter, dataset, hasClassicMobs]);

  const mobById = useMemo(() => new Map(mobs.map((mob) => [mob.id, mob])), [mobs]);

  const filteredMobs = useMemo(
    () => mobs.filter((mob) => isMobVisible(mob, activeMobFilter, deferredSearch)),
    [activeMobFilter, deferredSearch, mobs],
  );

  const selectedMobs = useMemo(
    () => selectedMobIds.map((id) => mobById.get(id)).filter(isDefined),
    [mobById, selectedMobIds],
  );

  const customizedVariantCount = Object.keys(customizations).length;
  const modifiedMobCount = useMemo(
    () => selectedMobs.filter((mob) => hasMobEdits(mob, customizations, mutedVariantIds)).length,
    [customizations, mutedVariantIds, selectedMobs],
  );

  const canCreateResourcePack = Boolean(dataset) && selectedMobs.length > 0 && modifiedMobCount > 0;
  const isExportButtonDisabled = !canCreateResourcePack || isExporting;
  const isExportButtonFlashing = useExportReadyFlash(canCreateResourcePack);

  const handleSelectMob = useCallback(
    (mob: MobDefinition) => {
      setErrorMessage(null);

      if (selectedMobIds.includes(mob.id)) {
        cardRefs.current[mob.id]?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      startTransition(() => {
        setSelectedMobIds((current) => [...current, mob.id]);
      });
    },
    [selectedMobIds],
  );

  const removeMob = useCallback(
    (mob: MobDefinition) => {
      stopPreview();
      setSelectedMobIds((current) => current.filter((id) => id !== mob.id));
      setExpandedMobIds((current) => removeKey(current, mob.id));
      clearMobEdits(mob);
    },
    [clearMobEdits, stopPreview],
  );

  const handleRemoveMob = useCallback(
    (mob: MobDefinition) => {
      if (mobHasCustomAudio(mob, customizations)) {
        setMobPendingRemoval(mob);
        return;
      }

      removeMob(mob);
    },
    [customizations, removeMob],
  );

  const confirmRemoveMob = useCallback(() => {
    if (!mobPendingRemoval) {
      return;
    }

    removeMob(mobPendingRemoval);
    setMobPendingRemoval(null);
  }, [mobPendingRemoval, removeMob]);

  const toggleMobEventExpansion = useCallback((mobId: string) => {
    setExpandedMobIds((current) => ({
      ...current,
      [mobId]: !current[mobId],
    }));
  }, []);

  const handlePickFile = useCallback((groupId: string) => {
    fileInputRefs.current[groupId]?.click();
  }, []);

  const handleFileSelected = useCallback(
    (variants: MobSoundVariant[], file?: File) => {
      if (!file) {
        return;
      }

      const blob = file.slice(0, file.size, file.type || DEFAULT_FILE_MIME_TYPE);
      storeCustomizationGroup(getVariantIds(variants), {
        blob,
        fileName: file.name,
        kind: "upload",
        mimeType: file.type || DEFAULT_FILE_MIME_TYPE,
      });
    },
    [storeCustomizationGroup],
  );

  const toggleMuteForGroup = useCallback((variants: MobSoundVariant[]) => {
    const variantIds = getVariantIds(variants);
    setMutedVariantIds((current) => toggleKeys(current, variantIds));
  }, []);

  const applyCustomizationToEvent = useCallback(
    (eventDefinition: MobSoundEvent, customization: CustomVariantSound) => {
      storeCustomizationGroup(getVariantIds(eventDefinition.variants), {
        blob: customization.blob,
        fileName: customization.fileName,
        kind: customization.kind,
        mimeType: customization.mimeType,
      });
    },
    [storeCustomizationGroup],
  );

  const handleExport = useCallback(async () => {
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
        onProgress: setStatusMessage,
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
  }, [canCreateResourcePack, customizations, dataset, modifiedMobCount, mutedVariantIds, selectedMobs]);

  const editorHandlers = useMemo<VariantEditorHandlers>(
    () => ({
      onApplyCustomizationToEvent: applyCustomizationToEvent,
      onFileSelected: handleFileSelected,
      onPickFile: handlePickFile,
      onResetGroupedSound: resetGroupedSound,
      onToggleMuteForGroup: toggleMuteForGroup,
      onTogglePreview: togglePreview,
      onToggleRecording: toggleRecording,
    }),
    [applyCustomizationToEvent, handleFileSelected, handlePickFile, resetGroupedSound, toggleMuteForGroup, togglePreview, toggleRecording],
  );

  return (
    <div className="shell">
      <div className="backdrop" aria-hidden="true" />

      <div className="shell-actions">
        <button
          className={cx("export-button", isExportButtonFlashing && "is-ready-flash")}
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
        <MobBrowser
          browserControlsRef={browserControlsRef}
          filteredMobs={filteredMobs}
          mobModels={mobModels}
          onSelectMob={handleSelectMob}
          search={search}
          selectedMobIds={selectedMobIds}
          setSearch={setSearch}
        />

        <section className="cards-panel">
          <FilterToolbar activeMobFilter={activeMobFilter} onChange={setActiveMobFilter} />

          {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

          {selectedMobs.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="cards-grid">
              {selectedMobs.map((mob) => (
                <MobCard
                  cardRefs={cardRefs}
                  customizations={customizations}
                  expanded={Boolean(expandedMobIds[mob.id])}
                  fileInputRefs={fileInputRefs}
                  handlers={editorHandlers}
                  key={mob.id}
                  mob={mob}
                  model={mobModels[mob.localId]}
                  mutedVariantIds={mutedVariantIds}
                  onRemove={handleRemoveMob}
                  onToggleExpansion={toggleMobEventExpansion}
                  playingPreview={playingPreview}
                  previewProgress={previewProgress}
                  recordingGroupId={recordingGroupId}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <p className="sr-only">Modified sounds: {customizedVariantCount}</p>

      <RemoveMobModal mob={mobPendingRemoval} onCancel={() => setMobPendingRemoval(null)} onConfirm={confirmRemoveMob} />
    </div>
  );
}

function MobBrowser({
  browserControlsRef,
  filteredMobs,
  mobModels,
  onSelectMob,
  search,
  selectedMobIds,
  setSearch,
}: {
  browserControlsRef: MutableRefObject<HTMLDivElement | null>;
  filteredMobs: MobDefinition[];
  mobModels: Record<string, MobModelDefinition>;
  onSelectMob: (mob: MobDefinition) => void;
  search: string;
  selectedMobIds: string[];
  setSearch: (value: string) => void;
}) {
  return (
    <aside className="browser-panel">
      <div className="browser-controls" ref={browserControlsRef}>
        <label className="search-field">
          <span aria-hidden="true" className="search-field-icon" />
          <input aria-label="Search mobs" onChange={(event) => setSearch(event.target.value)} placeholder="Search for a mob" value={search} />
        </label>
      </div>

      <div className="mob-list">
        {filteredMobs.length === 0 ? (
          <div className="mob-list-empty">No mobs match this search and filter combo yet.</div>
        ) : (
          filteredMobs.map((mob) => {
            const isSelected = selectedMobIds.includes(mob.id);

            return (
              <div className={cx("mob-list-item", isSelected && "is-selected")} key={mob.id}>
                <button className="mob-list-select" onClick={() => onSelectMob(mob)} type="button">
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
  );
}

function FilterToolbar({
  activeMobFilter,
  onChange,
}: {
  activeMobFilter: MobFilter;
  onChange: (filter: MobFilter) => void;
}) {
  return (
    <div aria-label="Mob filters" className="cards-toolbar">
      <FilterButton active={activeMobFilter === "all"} label="All" modifier="all" onClick={() => onChange("all")} />
      <FilterButton active={activeMobFilter === "classic"} label="Classic" modifier="classic" onClick={() => onChange("classic")} />
      <FilterButton active={activeMobFilter === "recent"} label="Recently Added" modifier="recent" onClick={() => onChange("recent")} />
    </div>
  );
}

function FilterButton({
  active,
  label,
  modifier,
  onClick,
}: {
  active: boolean;
  label: string;
  modifier: MobFilter;
  onClick: () => void;
}) {
  return (
    <button className={cx("filter-button", `filter-button--${modifier}`, active && "is-active")} onClick={onClick} type="button">
      <span aria-hidden="true" className="filter-button-icon" role="presentation">
        {renderFilterIcon(modifier)}
      </span>
      <span>{label}</span>
    </button>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state-copy">
        <h3>Build a pack in three quick steps</h3>
        <ol className="empty-state-steps">
          <li>Pick a mob</li>
          <li>Record or upload a sound</li>
          <li>Click Create Resource Pack</li>
        </ol>
      </div>
    </div>
  );
}

function MobCard({
  cardRefs,
  customizations,
  expanded,
  fileInputRefs,
  handlers,
  mob,
  model,
  mutedVariantIds,
  onRemove,
  onToggleExpansion,
  playingPreview,
  previewProgress,
  recordingGroupId,
}: {
  cardRefs: CardRefMap;
  customizations: Record<string, CustomVariantSound>;
  expanded: boolean;
  fileInputRefs: FileInputRefMap;
  handlers: VariantEditorHandlers;
  mob: MobDefinition;
  model?: MobModelDefinition;
  mutedVariantIds: Record<string, boolean>;
  onRemove: (mob: MobDefinition) => void;
  onToggleExpansion: (mobId: string) => void;
  playingPreview: PlayingPreview | null;
  previewProgress: number;
  recordingGroupId: string | null;
}) {
  const orderedSoundEvents = useMemo(() => orderSoundEvents(mob), [mob]);
  const defaultVisibleLabels = DEFAULT_VISIBLE_EVENT_LABELS_BY_MOB[mob.localId];
  const visibleLabelSet = defaultVisibleLabels ? new Set(defaultVisibleLabels) : null;

  const defaultEvents = visibleLabelSet
    ? orderedSoundEvents.filter((eventDefinition) => visibleLabelSet.has(eventLabel(eventDefinition.id)))
    : orderedSoundEvents;

  const hiddenEvents = visibleLabelSet
    ? orderedSoundEvents.filter((eventDefinition) => !visibleLabelSet.has(eventLabel(eventDefinition.id)))
    : [];

  const hasCustomizedHiddenEvents = hiddenEvents.some((eventDefinition) =>
    eventDefinition.variants.some((variant) => Boolean(customizations[variant.id] || mutedVariantIds[variant.id])),
  );

  const isExpanded = expanded || hasCustomizedHiddenEvents;
  const visibleEvents = isExpanded ? orderedSoundEvents : defaultEvents;

  return (
    <article
      className="mob-card"
      ref={(element) => {
        cardRefs.current[mob.id] = element;
      }}
    >
      <header className="mob-card-header">
        <div className="mob-card-title">
          <MobArtwork mob={mob} model={model} size="card" />
          <div>
            <h3>{mob.displayName}</h3>
          </div>
        </div>
        <button className="ghost-button danger-button" onClick={() => onRemove(mob)} type="button">
          Remove
        </button>
      </header>

      <div className="event-stack">
        {visibleEvents.map((eventDefinition) => (
          <EventCard
            customizations={customizations}
            eventDefinition={eventDefinition}
            fileInputRefs={fileInputRefs}
            handlers={handlers}
            isMobExpanded={isExpanded}
            key={eventDefinition.id}
            mob={mob}
            mutedVariantIds={mutedVariantIds}
            playingPreview={playingPreview}
            previewProgress={previewProgress}
            recordingGroupId={recordingGroupId}
          />
        ))}
      </div>

      {hiddenEvents.length > 0 ? (
        <div className="event-toggle-row">
          <button className="event-toggle-button" onClick={() => onToggleExpansion(mob.id)} type="button">
            {isExpanded ? "show less" : `more... (${hiddenEvents.length} more)`}
          </button>
        </div>
      ) : null}
    </article>
  );
}

function EventCard({
  customizations,
  eventDefinition,
  fileInputRefs,
  handlers,
  isMobExpanded,
  mob,
  mutedVariantIds,
  playingPreview,
  previewProgress,
  recordingGroupId,
}: {
  customizations: Record<string, CustomVariantSound>;
  eventDefinition: MobSoundEvent;
  fileInputRefs: FileInputRefMap;
  handlers: VariantEditorHandlers;
  isMobExpanded: boolean;
  mob: MobDefinition;
  mutedVariantIds: Record<string, boolean>;
  playingPreview: PlayingPreview | null;
  previewProgress: number;
  recordingGroupId: string | null;
}) {
  const groupedVariants = useMemo(() => groupVariantsBySoundPath(eventDefinition), [eventDefinition]);

  return (
    <section className="event-card">
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
        {groupedVariants.map((group) => (
          <VariantGroupRow
            customizations={customizations}
            eventDefinition={eventDefinition}
            fileInputRefs={fileInputRefs}
            group={group}
            handlers={handlers}
            key={group.id}
            mob={mob}
            mutedVariantIds={mutedVariantIds}
            playingPreview={playingPreview}
            previewProgress={previewProgress}
            recordingGroupId={recordingGroupId}
          />
        ))}
      </div>
    </section>
  );
}

function VariantGroupRow({
  customizations,
  eventDefinition,
  fileInputRefs,
  group,
  handlers,
  mob,
  mutedVariantIds,
  playingPreview,
  previewProgress,
  recordingGroupId,
}: {
  customizations: Record<string, CustomVariantSound>;
  eventDefinition: MobSoundEvent;
  fileInputRefs: FileInputRefMap;
  group: ReturnType<typeof groupVariantsBySoundPath>[number];
  handlers: VariantEditorHandlers;
  mob: MobDefinition;
  mutedVariantIds: Record<string, boolean>;
  playingPreview: PlayingPreview | null;
  previewProgress: number;
  recordingGroupId: string | null;
}) {
  const customization = getRepresentativeCustomization(group.variants, customizations);
  const isMuted = isGroupedSoundMuted(group.variants, mutedVariantIds);
  const pitchSummary = formatPitchSummary(group.pitchValues);
  const sampleVariant = group.variants[0];
  const isRecording = recordingGroupId === group.id;
  const isPlayingOriginal = playingPreview?.groupId === group.id && playingPreview.source === "original";
  const isPlayingCustom = playingPreview?.groupId === group.id && playingPreview.source === "custom";

  return (
    <div className={cx("variant-row", isMuted && "is-muted", (isPlayingOriginal || isPlayingCustom) && "is-playing")}>
      <div className="variant-summary">
        <div className="variant-copy">
          <div className="variant-heading-row">
            <div className="variant-heading-main">
              <strong>{group.label}</strong>
            </div>
            <div className="variant-meta">
              {pitchSummary ? <span className="variant-info-chip">{pitchSummary}</span> : null}
              {isMuted ? <span className="muted-chip">Muted in pack</span> : null}
            </div>
          </div>

          <div className="variant-content-row">
            <div className="variant-waveform-stack">
              <VariantPreviewRow
                disabled={!sampleVariant.url}
                isPlaying={isPlayingOriginal}
                onToggle={() => {
                  void handlers.onTogglePreview(group.id, "original", sampleVariant.url);
                }}
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
                  onToggle={() => {
                    void handlers.onTogglePreview(group.id, "custom", customization.url);
                  }}
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

            <div className="variant-actions">
              <div aria-label={`${group.label} editing controls`} className="variant-action-row variant-action-row--edit" role="group">
                <button
                  className={cx("variant-primary-button", isRecording && "recording")}
                  onClick={() => {
                    void handlers.onToggleRecording(group.id, group.variants, mob, group.label);
                  }}
                  type="button"
                >
                  {isRecording ? "Stop Recording" : "Record"}
                </button>
                <button className="variant-secondary-button" onClick={() => handlers.onPickFile(group.id)} type="button">
                  Upload
                </button>
              </div>

              <div aria-label={`${group.label} pack controls`} className="variant-action-row" role="group">
                <button
                  className="variant-secondary-button"
                  disabled={!customization}
                  onClick={() => {
                    if (customization) {
                      handlers.onApplyCustomizationToEvent(eventDefinition, customization);
                    }
                  }}
                  type="button"
                >
                  Apply To Event
                </button>
                <button
                  className={cx("variant-secondary-button", isMuted && "is-active")}
                  onClick={() => handlers.onToggleMuteForGroup(group.variants)}
                  type="button"
                >
                  {isMuted ? "Unmute In Pack" : "Mute In Pack"}
                </button>
                <button
                  className="variant-secondary-button"
                  disabled={!customization && !isMuted}
                  onClick={() => handlers.onResetGroupedSound(group.variants)}
                  type="button"
                >
                  Reset Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <input
        accept="audio/*"
        hidden
        onChange={(event) => {
          handlers.onFileSelected(group.variants, event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
        ref={(element) => {
          fileInputRefs.current[group.id] = element;
        }}
        type="file"
      />
    </div>
  );
}

function RemoveMobModal({
  mob,
  onCancel,
  onConfirm,
}: {
  mob: MobDefinition | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!mob) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onCancel} role="presentation">
      <div
        aria-labelledby="remove-mob-title"
        aria-modal="true"
        className="confirm-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="confirm-modal-copy">
          <p className="confirm-modal-eyebrow">Remove Mob</p>
          <h2 id="remove-mob-title">Remove {mob.displayName}?</h2>
          <p>This mob already has recorded or uploaded custom sounds. Removing it now will discard those audio edits for this mob.</p>
        </div>
        <div className="confirm-modal-actions">
          <button className="ghost-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="ghost-button danger-button" onClick={onConfirm} type="button">
            Remove Mob
          </button>
        </div>
      </div>
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
    <div className={cx("variant-waveform-row", isPlaying && "is-playing")}>
      <span className="variant-waveform-source">{previewLabel}</span>
      <button
        aria-label={`${isPlaying ? "Stop" : "Play"} ${previewLabel.toLowerCase()} preview for ${variantLabel}`}
        className={cx("variant-waveform-button", isPlaying && "is-active")}
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
  const [status, setStatus] = useState<"fallback" | "loading" | "ready">(url ? (cachedBars?.length ? "ready" : "loading") : "fallback");

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
  const clampedProgress = clamp(progress, 0, 1);
  const playedBarCount = Math.floor(clampedProgress * displayBars.length);
  const currentBarIndex = isPlaying && clampedProgress < 1 ? Math.min(displayBars.length - 1, playedBarCount) : -1;

  return (
    <div
      aria-label={`Waveform preview for ${label}`}
      className={cx("variant-waveform", status === "loading" && "is-loading", status === "fallback" && "is-fallback", isPlaying && "is-playing")}
      role="img"
      style={{ "--waveform-progress": `${clampedProgress * 100}%` } as CSSProperties}
    >
      <div className="waveform-layers">
        <div aria-hidden="true" className="waveform-bars">
          {displayBars.map((height, index) => (
            <span
              className={cx("waveform-bar", index < playedBarCount && "is-played", index === currentBarIndex && "is-current")}
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

function useSyncedRef<T>(value: T) {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}

function useEscapeToDismiss(enabled: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, onDismiss]);
}

function useBrowserControlsHeight() {
  const browserControlsRef = useRef<HTMLDivElement | null>(null);
  const [browserControlsHeight, setBrowserControlsHeight] = useState(ESTIMATED_BROWSER_CONTROLS_HEIGHT);

  useLayoutEffect(() => {
    const controlsElement = browserControlsRef.current;
    if (!controlsElement) {
      return;
    }

    const updateBrowserControlsHeight = () => {
      const nextHeight = Math.ceil(controlsElement.getBoundingClientRect().height + BROWSER_LIST_GAP);
      setBrowserControlsHeight((current) => (current === nextHeight ? current : nextHeight));
    };

    updateBrowserControlsHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateBrowserControlsHeight);
    observer.observe(controlsElement);

    return () => {
      observer.disconnect();
    };
  }, []);

  return { browserControlsHeight, browserControlsRef };
}

function useExportReadyFlash(isReady: boolean) {
  const timeoutRef = useRef<number | null>(null);
  const wasReadyRef = useRef(false);
  const [isFlashing, setIsFlashing] = useState(false);

  useEffect(() => {
    if (isReady && !wasReadyRef.current) {
      setIsFlashing(true);

      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = window.setTimeout(() => {
        setIsFlashing(false);
        timeoutRef.current = null;
      }, EXPORT_READY_FLASH_DURATION_MS);
    }

    if (!isReady) {
      setIsFlashing(false);

      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }

    wasReadyRef.current = isReady;
  }, [isReady]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return isFlashing;
}

function useAudioPreview(setErrorMessage: (message: string | null) => void) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAnimationFrameRef = useRef<number | null>(null);
  const [playingPreview, setPlayingPreview] = useState<PlayingPreview | null>(null);
  const [previewProgress, setPreviewProgress] = useState(0);

  const stopPreview = useCallback(() => {
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
  }, []);

  const syncPreviewProgress = useCallback((audio: HTMLAudioElement) => {
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const nextProgress = duration > 0 ? clamp(audio.currentTime / duration, 0, 1) : 0;
    setPreviewProgress((current) => (Math.abs(current - nextProgress) < 0.001 ? current : nextProgress));
  }, []);

  const startPreviewProgressLoop = useCallback(
    (audio: HTMLAudioElement) => {
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
    },
    [syncPreviewProgress],
  );

  const clearActiveAudio = useCallback((audio: HTMLAudioElement) => {
    if (audioRef.current !== audio) {
      return;
    }

    audioRef.current = null;

    if (previewAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(previewAnimationFrameRef.current);
      previewAnimationFrameRef.current = null;
    }

    setPlayingPreview(null);
    setPreviewProgress(0);
  }, []);

  const togglePreview = useCallback(
    async (groupId: string, source: PreviewSource, url?: string) => {
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
        clearActiveAudio(audio);
      };
      audio.ontimeupdate = () => {
        syncPreviewProgress(audio);
      };
      audio.onpause = () => {
        if (!audio.ended) {
          clearActiveAudio(audio);
        }
      };

      setPlayingPreview({ groupId, source, url });

      try {
        await audio.play();
        syncPreviewProgress(audio);
        startPreviewProgressLoop(audio);
      } catch (error) {
        clearActiveAudio(audio);
        setErrorMessage(error instanceof Error ? error.message : "The preview audio could not be played.");
      }
    },
    [clearActiveAudio, playingPreview, setErrorMessage, startPreviewProgressLoop, stopPreview, syncPreviewProgress],
  );

  useEffect(() => stopPreview, [stopPreview]);

  return { playingPreview, previewProgress, stopPreview, togglePreview };
}

function useGroupRecorder({
  onStoreGroup,
  setErrorMessage,
}: {
  onStoreGroup: (variantIds: string[], next: StoredCustomizationSeed) => void;
  setErrorMessage: (message: string | null) => void;
}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingTargetRef = useRef<{ fileName: string; variantIds: string[] } | null>(null);
  const recorderChunksRef = useRef<BlobPart[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [recordingGroupId, setRecordingGroupId] = useState<string | null>(null);

  const toggleRecording = useCallback(
    async (groupId: string, variants: MobSoundVariant[], mob: MobDefinition, label: string) => {
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

        const preferredMimeType = getPreferredRecordingMimeType();
        const recorder = new MediaRecorder(stream, preferredMimeType ? { mimeType: preferredMimeType } : undefined);

        recorderChunksRef.current = [];
        recordingTargetRef.current = {
          fileName: `${mob.localId}_${label.replace(/[^a-z0-9]+/gi, "_")}.ogg`,
          variantIds: getVariantIds(variants),
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
            type: recorder.mimeType || preferredMimeType || DEFAULT_RECORDING_MIME_TYPE,
          });

          onStoreGroup(target.variantIds, {
            blob,
            fileName: target.fileName,
            kind: "recording",
            mimeType: blob.type || recorder.mimeType || DEFAULT_RECORDING_MIME_TYPE,
          });
        };

        recorderRef.current = recorder;
        recorder.start();
        setRecordingGroupId(groupId);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Microphone access was denied.");
      }
    },
    [onStoreGroup, recordingGroupId, setErrorMessage],
  );

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }

      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return { recordingGroupId, toggleRecording };
}

async function loadDataset({
  abortController,
  active,
  onError,
  onLoaded,
  onStatus,
}: {
  abortController: AbortController;
  active: () => boolean;
  onError: (message: string | null) => void;
  onLoaded: (dataset: MobSoundsDataset) => void;
  onStatus: (message: string) => void;
}) {
  try {
    const dataset = await fetchJson<MobSoundsDataset>(DATASET_URL, abortController.signal, (status) =>
      `Could not load ${DATASET_URL} (${status}). Run npm run sync:data first.`,
    );

    if (!active()) {
      return;
    }

    onLoaded(dataset);
    onStatus(`Loaded ${dataset.mobs.length} mobs from mc-datahub ${dataset.version}.`);
  } catch (error) {
    if (!active()) {
      return;
    }

    onError(error instanceof Error ? error.message : "Could not load Mob Dub data.");
    onStatus("Could not load Mob Dub data.");
  }
}

async function loadMobModels({
  abortController,
  active,
  onLoaded,
}: {
  abortController: AbortController;
  active: () => boolean;
  onLoaded: (models: Record<string, MobModelDefinition>) => void;
}) {
  try {
    const response = await fetchJson<MobModelsResponse>(MODEL_DATASET_URL, abortController.signal, (status) =>
      `Could not load ${MODEL_DATASET_URL} (${status}).`,
    );

    if (active()) {
      onLoaded(response.mobs ?? {});
    }
  } catch {
    if (active()) {
      onLoaded({});
    }
  }
}

async function fetchJson<T>(url: string, signal: AbortSignal, buildErrorMessage: (status: number) => string): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(buildErrorMessage(response.status));
  }

  return (await response.json()) as T;
}

function renderFilterIcon(filter: MobFilter) {
  switch (filter) {
    case "all":
      return (
        <svg fill="none" viewBox="0 0 20 20">
          <rect height="5" rx="1.4" width="5" x="2.5" y="2.5" />
          <rect height="5" rx="1.4" width="5" x="12.5" y="2.5" />
          <rect height="5" rx="1.4" width="5" x="2.5" y="12.5" />
          <rect height="5" rx="1.4" width="5" x="12.5" y="12.5" />
        </svg>
      );
    case "classic":
      return (
        <svg fill="none" viewBox="0 0 20 20">
          <path d="M10 2.5 16.5 6v8L10 17.5 3.5 14V6L10 2.5Z" />
          <path d="M3.5 6 10 10l6.5-4M10 10v7.5" />
        </svg>
      );
    case "recent":
      return (
        <svg fill="none" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="7.2" />
          <path d="M10 5.7v4.55l3 1.8" />
        </svg>
      );
  }
}

function isMobVisible(mob: MobDefinition, filter: MobFilter, query: string) {
  if (filter === "recent" && !mob.isRecent) {
    return false;
  }

  if (filter === "classic" && (mob.introducedVersion !== "Classic" || CLASSIC_FILTER_EXCLUDED_MOB_IDS.has(mob.localId))) {
    return false;
  }

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [mob.displayName, mob.localId, mob.category, mob.soundId, mob.introducedVersion].some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  );
}

function getVariantIds(variants: MobSoundVariant[]) {
  return variants.map((variant) => variant.id);
}

function getMobVariantIds(mob: MobDefinition) {
  return mob.soundEvents.flatMap((eventDefinition) => getVariantIds(eventDefinition.variants));
}

function hasMobEdits(
  mob: MobDefinition,
  customizations: Record<string, CustomVariantSound>,
  mutedVariantIds: Record<string, boolean>,
) {
  return mob.soundEvents.some((eventDefinition) =>
    eventDefinition.variants.some((variant) => Boolean(customizations[variant.id] || mutedVariantIds[variant.id])),
  );
}

function mobHasCustomAudio(mob: MobDefinition, customizations: Record<string, CustomVariantSound>) {
  return mob.soundEvents.some((eventDefinition) => eventDefinition.variants.some((variant) => Boolean(customizations[variant.id])));
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value != null;
}

function removeKey<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) {
    return record;
  }

  const next = { ...record };
  delete next[key];
  return next;
}

function removeKeys<T>(record: Record<string, T>, keys: string[]) {
  let changed = false;
  const next = { ...record };

  for (const key of keys) {
    if (!(key in next)) {
      continue;
    }

    changed = true;
    delete next[key];
  }

  return changed ? next : record;
}

function toggleKeys(record: Record<string, boolean>, keys: string[]) {
  const shouldAdd = !keys.some((key) => record[key]);
  const next = { ...record };

  for (const key of keys) {
    if (shouldAdd) {
      next[key] = true;
    } else {
      delete next[key];
    }
  }

  return next;
}
