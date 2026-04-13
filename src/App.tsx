import { startTransition, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MutableRefObject } from "react";
import { enhanceCustomAudioBlob, getCachedWaveformBars, getPreferredRecordingMimeType, getWaveformBars } from "./audio";
import { buildResourcePackBlob, getResourcePackFileName } from "./export";
import { getMobImagePath, isGifMobImagePath } from "./mobImagePath";
import { MobModelPreview } from "./mobModelPreview";
import { publicUrl } from "./publicUrl";
import { getRepresentativeCustomization, groupVariantsBySoundPath, isGroupedSoundMuted } from "./soundGroups";
import type { CustomVariantSound, MobDefinition, MobModelDefinition, MobSoundEvent, MobSoundVariant, MobSoundsDataset } from "./types";

const DATASET_URL = publicUrl("data/mob-sounds.json");
const MODEL_DATASET_URL = publicUrl("data/mob-models.json");
const CLASSIC_FILTER_EXCLUDED_MOB_IDS = new Set(["skeleton"]);
const STATIC_MODEL_PREVIEW_MOB_IDS = new Set<string>();

const BROWSER_LIST_GAP = 16;
const ESTIMATED_BROWSER_CONTROLS_HEIGHT = 68;
const VARIANT_WAVEFORM_BAR_COUNT = 64;
const EXPORT_READY_FLASH_DURATION_MS = 1400;
const DEFAULT_RECORDING_MIME_TYPE = "audio/webm";
const DEFAULT_FILE_MIME_TYPE = "application/octet-stream";
const SCROLL_TO_TOP_REVEAL_OFFSET_PX = 900;
const MOB_CARD_NAVIGATION_ANCHOR_RATIO = 0.25;
const MOB_CARD_NAVIGATION_ANCHOR_MAX_PX = 160;
const UNSAVED_CUSTOM_AUDIO_WARNING = "Your recorded and uploaded sounds will be wiped if you leave this page.";

type MobFilter = "all" | "classic" | "recent";
type MobCardNavigationDirection = "previous" | "next";
type PreviewSource = "custom" | "original";
type PlayingPreview = { groupId: string; source: PreviewSource; url: string };
type StoredCustomizationSeed = Omit<CustomVariantSound, "url">;
type MobModelsResponse = { mobs?: Record<string, MobModelDefinition> };
type FileInputRefMap = MutableRefObject<Record<string, HTMLInputElement | null>>;
type CardRefMap = MutableRefObject<Record<string, HTMLElement | null>>;
type VariantEditorHandlers = {
  onFileSelected: (variants: MobSoundVariant[], file?: File) => void;
  onPickFile: (groupId: string) => void;
  onResetGroupedSound: (variants: MobSoundVariant[]) => void;
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

  const storeProcessedCustomizationGroup = useCallback(
    async (variants: MobSoundVariant[], next: StoredCustomizationSeed) => {
      const variantIds = getVariantIds(variants);

      try {
        const processed = await prepareCustomizationSeed(next, variants);
        storeCustomizationGroup(variantIds, processed);
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? `Audio cleanup failed, so the original clip was kept: ${error.message}` : "Audio cleanup failed.",
        );
        storeCustomizationGroup(variantIds, next);
      }
    },
    [setErrorMessage, storeCustomizationGroup],
  );

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
    onStoreGroup: storeProcessedCustomizationGroup,
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
  const hasUnsavedCustomAudio = customizedVariantCount > 0;
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

      setErrorMessage(null);
      const blob = file.slice(0, file.size, file.type || DEFAULT_FILE_MIME_TYPE);
      void storeProcessedCustomizationGroup(variants, {
        blob,
        fileName: file.name,
        kind: "upload",
        mimeType: file.type || DEFAULT_FILE_MIME_TYPE,
      });
    },
    [setErrorMessage, storeProcessedCustomizationGroup],
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

      const fileName = getResourcePackFileName();
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
  }, [canCreateResourcePack, customizations, dataset, mutedVariantIds, selectedMobs]);

  const editorHandlers = useMemo<VariantEditorHandlers>(
    () => ({
      onFileSelected: handleFileSelected,
      onPickFile: handlePickFile,
      onResetGroupedSound: resetGroupedSound,
      onTogglePreview: togglePreview,
      onToggleRecording: toggleRecording,
    }),
    [handleFileSelected, handlePickFile, resetGroupedSound, togglePreview, toggleRecording],
  );
  useWarnBeforeUnload(hasUnsavedCustomAudio);
  const showScrollToTop = useScrollToTopVisibility();
  const showMobCardNavigation = selectedMobs.length > 1;
  const showScrollNavigation = showScrollToTop || showMobCardNavigation;

  const handleScrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleScrollToMobCard = useCallback(
    (direction: MobCardNavigationDirection) => {
      const cardElements = selectedMobs
        .map((mob) => cardRefs.current[mob.id])
        .filter((element): element is HTMLElement => Boolean(element));

      if (cardElements.length === 0) {
        return;
      }

      const anchorOffset = Math.min(window.innerHeight * MOB_CARD_NAVIGATION_ANCHOR_RATIO, MOB_CARD_NAVIGATION_ANCHOR_MAX_PX);
      const currentCardIndex = cardElements.reduce((currentIndex, element, index) => {
        return element.getBoundingClientRect().top <= anchorOffset ? index : currentIndex;
      }, -1);
      const targetCardIndex =
        direction === "next" ? Math.min(currentCardIndex + 1, cardElements.length - 1) : Math.max(currentCardIndex - 1, 0);

      cardElements[targetCardIndex]?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [selectedMobs],
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
          <span aria-hidden="true" className="export-button__icon">
            <ActionIcon kind="plus" />
          </span>
          <span>{isExporting ? "Building Pack..." : "Create Resource Pack"}</span>
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

      <footer className="footer">
        <a
          aria-label="Open ActualPug YouTube channel"
          className="footer-vibe-link"
          href="https://www.youtube.com/@actualpug"
          rel="noopener noreferrer"
          target="_blank"
        >
          Vibe coded with {"\u2665"} by ActualPug
        </a>
      </footer>

      <p className="sr-only">Modified sounds: {customizedVariantCount}</p>

      {showScrollNavigation ? (
        <nav aria-label="Scroll navigation" className="scroll-navigation-controls">
          {showMobCardNavigation ? (
            <button
              aria-label="Scroll to previous mob card"
              className="scroll-navigation-button"
              onClick={() => handleScrollToMobCard("previous")}
              type="button"
            >
              <ScrollNavigationIcon kind="previous" />
            </button>
          ) : null}
          {showMobCardNavigation ? (
            <button
              aria-label="Scroll to next mob card"
              className="scroll-navigation-button"
              onClick={() => handleScrollToMobCard("next")}
              type="button"
            >
              <ScrollNavigationIcon kind="next" />
            </button>
          ) : null}
          <button aria-label="Scroll back to top" className="scroll-navigation-button" onClick={handleScrollToTop} type="button">
            <ScrollNavigationIcon kind="top" />
          </button>
        </nav>
      ) : null}

      <RemoveMobModal mob={mobPendingRemoval} onCancel={() => setMobPendingRemoval(null)} onConfirm={confirmRemoveMob} />
    </div>
  );
}

function ScrollNavigationIcon({ kind }: { kind: "previous" | "next" | "top" }) {
  if (kind === "top") {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path d="M12 18V6" />
        <path d="m6.75 11.25 5.25-5.25 5.25 5.25" />
      </svg>
    );
  }

  if (kind === "previous") {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path d="m7 14 5-5 5 5" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="m7 10 5 5 5-5" />
    </svg>
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
          <div className="mob-card-heading">
            <h3>{mob.displayName}</h3>
          </div>
        </div>
        <button className="ghost-button danger-button mob-card-remove-button" onClick={() => onRemove(mob)} type="button">
          <span aria-hidden="true" className="mob-card-remove-button__icon">
            <ActionIcon kind="trash" />
          </span>
          <span>Remove</span>
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
  const shouldShowEventTitle = isMobExpanded;

  return (
    <section aria-label={eventLabel(eventDefinition.id)} className="event-card">
      {shouldShowEventTitle ? (
        <header className="event-header">
          <div className="event-copy">
            <div className="event-title">
              <strong>{eventLabel(eventDefinition.id)}</strong>
            </div>
            {eventDefinition.subtitle ? <p className="event-subtitle">{eventDefinition.subtitle}</p> : null}
          </div>
        </header>
      ) : null}

      <div className="variant-list">
        {groupedVariants.map((group) => (
          <VariantGroupRow
            customizations={customizations}
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

function ActionIcon({
  kind,
}: {
  kind: "play" | "stop" | "record" | "upload" | "apply" | "mute" | "unmute" | "reset" | "info" | "target" | "trash" | "plus";
}) {
  switch (kind) {
    case "play":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
          <path d="M7 5.5L14 10L7 14.5V5.5Z" fill="currentColor" stroke="none" />
        </svg>
      );

    case "stop":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
          <rect x="6" y="6" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />
        </svg>
      );

    case "record":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
          <rect x="7.5" y="2.5" width="5" height="8" rx="2.5" />
          <path d="M4.5 9.5C4.5 12.538 6.962 15 10 15C13.038 15 15.5 12.538 15.5 9.5" />
          <path d="M10 15V17.5" />
          <path d="M7.5 17.5H12.5" />
        </svg>
      );

    case "upload":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
          <path d="M10 13V5" />
          <path d="M6.8 8.2L10 5L13.2 8.2" />
          <path d="M5 14.5H15" />
        </svg>
      );

    case "apply":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
          <path d="M6 10.5L8.5 13L14 7.5" />
          <path d="M10 3.5L11.2 6L14 6.3L12 8.2L12.5 11L10 9.7L7.5 11L8 8.2L6 6.3L8.8 6L10 3.5Z" />
        </svg>
      );

    case "mute":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
          <path d="M4.5 11.5H7.5L11.5 14.5V5.5L7.5 8.5H4.5V11.5Z" />
          <path d="M14 7L17 13" />
          <path d="M17 7L14 13" />
        </svg>
      );

    case "unmute":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
          <path d="M4.5 11.5H7.5L11.5 14.5V5.5L7.5 8.5H4.5V11.5Z" />
          <path d="M14 8C14.9 8.6 15.5 9.7 15.5 11C15.5 12.3 14.9 13.4 14 14" />
          <path d="M15.8 6.2C17.1 7.3 18 9.1 18 11C18 12.9 17.1 14.7 15.8 15.8" />
        </svg>
      );

    case "reset":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
          <path d="M5.5 9A4.5 4.5 0 1 1 7 13.2" />
          <path d="M5.5 5.5V9H9" />
        </svg>
      );

    case "info":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="7" />
          <path d="M10 8V13" />
          <path d="M10 6.25H10.01" />
        </svg>
      );

    case "target":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="7" />
          <circle cx="10" cy="10" r="4" />
          <circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );

    case "trash":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
          <path d="M5.5 6.5H14.5" />
          <path d="M7.5 6.5V5C7.5 4.45 7.95 4 8.5 4H11.5C12.05 4 12.5 4.45 12.5 5V6.5" />
          <path d="M7 8.5V14" />
          <path d="M10 8.5V14" />
          <path d="M13 8.5V14" />
          <path d="M6 16H14L14.8 6.5H5.2L6 16Z" />
        </svg>
      );

    case "plus":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
          <path d="M10 4.5V15.5" />
          <path d="M4.5 10H15.5" />
        </svg>
      );
  }
}

function getSoundFileLabel(path: string) {
  return path.split("/").pop() ?? path;
}

function VariantGroupRow({
  customizations,
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
  const sampleVariant = group.variants[0];
  const isRecording = recordingGroupId === group.id;
  const isPlayingOriginal = playingPreview?.groupId === group.id && playingPreview.source === "original";
  const isPlayingCustom = playingPreview?.groupId === group.id && playingPreview.source === "custom";
  const isPlayingAny = isPlayingOriginal || isPlayingCustom;
  const replacementSourceFile = customization ? customization.fileName : getSoundFileLabel(sampleVariant.assetPath);
  const recordButtonLabel = isRecording ? "Stop" : customization?.kind === "recording" ? "Re-record" : "Record";

  return (
    <div className={cx("variant-card", "variant-row", isMuted && "is-muted", isPlayingAny && "is-playing")}>
      <section className="variant-card__preview">
        <div className="variant-card__header">
          <div className="variant-copy">
            <div className="variant-card__headline">
              <strong>{group.label}</strong>
            </div>
          </div>
        </div>

        <div className="variant-card__waveforms">
          <div className="variant-card__track variant-waveform-row">
            <div className="variant-card__track-control">
              <button
                aria-label={`${isPlayingOriginal ? "Stop" : "Play"} original preview for ${group.label}`}
                className={cx("variant-track-play", isPlayingOriginal && "is-playing")}
                disabled={!sampleVariant.url}
                onClick={() => {
                  void handlers.onTogglePreview(group.id, "original", sampleVariant.url);
                }}
                type="button"
              >
                <ActionIcon kind={isPlayingOriginal ? "stop" : "play"} />
              </button>
              <span
                className="variant-track-label"
                data-track-title={getSoundFileLabel(sampleVariant.assetPath)}
                title={getSoundFileLabel(sampleVariant.assetPath)}
              >
                Original
              </span>
            </div>
            <div className="variant-card__track-main">
              <VariantWaveform
                isPlaying={isPlayingOriginal}
                label={`${group.label} original`}
                progress={isPlayingOriginal ? previewProgress : 0}
                url={sampleVariant.url}
              />
            </div>
          </div>

          {customization ? (
            <div className="variant-card__track variant-card__track--custom variant-waveform-row">
              <div className="variant-card__track-control">
                <button
                  aria-label={`${isPlayingCustom ? "Stop" : "Play"} custom preview for ${group.label}`}
                  className={cx("variant-track-play", isPlayingCustom && "is-playing")}
                  disabled={!customization.url}
                  onClick={() => {
                    void handlers.onTogglePreview(group.id, "custom", customization.url);
                  }}
                  type="button"
                >
                  <ActionIcon kind={isPlayingCustom ? "stop" : "play"} />
                </button>
                <span
                  className="variant-track-label variant-track-label--custom"
                  data-track-title={replacementSourceFile}
                  title={replacementSourceFile}
                >
                  Custom
                </span>
              </div>
              <div className="variant-card__track-main">
                <VariantWaveform
                  isPlaying={isPlayingCustom}
                  label={`${group.label} custom`}
                  progress={isPlayingCustom ? previewProgress : 0}
                  url={customization.url}
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="variant-card__replace">
        <div className="variant-card__section-copy">
          <h4>Replace Sound</h4>
        </div>

        <div className="variant-card__replace-actions">
          <button
            className={cx("variant-option-button", "variant-option-button--record", isRecording && "is-recording")}
            onClick={() => {
              void handlers.onToggleRecording(group.id, group.variants, mob, group.label);
            }}
            type="button"
          >
            <span aria-hidden="true" className="variant-option-button__icon">
              <ActionIcon kind={isRecording ? "stop" : "record"} />
            </span>
            <span className="variant-option-button__body">{recordButtonLabel}</span>
          </button>

          <button
            className="variant-option-button variant-option-button--upload"
            onClick={() => handlers.onPickFile(group.id)}
            type="button"
          >
            <span aria-hidden="true" className="variant-option-button__icon">
              <ActionIcon kind="upload" />
            </span>
            <span className="variant-option-button__body">Upload</span>
          </button>
        </div>

        {customization ? (
          <button
            className="variant-reset-button"
            onClick={() => handlers.onResetGroupedSound(group.variants)}
            type="button"
          >
            <span aria-hidden="true" className="variant-reset-button__icon">
              <ActionIcon kind="reset" />
            </span>
            <span>Reset Changes</span>
          </button>
        ) : null}
      </section>

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
  const imagePath = getMobImagePath(mob);

  if (imagePath && !usesStaticModelPreview(mob.localId)) {
    return (
      <img
        alt=""
        className={cx(
          "mob-preview",
          `mob-preview--${size}`,
          "mob-preview-image",
          isGifMobImagePath(imagePath) && "mob-preview-image--flipped",
        )}
        decoding="async"
        loading="lazy"
        src={publicUrl(imagePath)}
      />
    );
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

function useWarnBeforeUnload(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = UNSAVED_CUSTOM_AUDIO_WARNING;
      return UNSAVED_CUSTOM_AUDIO_WARNING;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [enabled]);
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

function useScrollToTopVisibility() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const updateVisibility = () => {
      const revealOffset = Math.max(window.innerHeight * 1.5, SCROLL_TO_TOP_REVEAL_OFFSET_PX);
      setIsVisible(window.scrollY > revealOffset);
    };

    updateVisibility();

    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility);

    return () => {
      window.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("resize", updateVisibility);
    };
  }, []);

  return isVisible;
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
  onStoreGroup: (variants: MobSoundVariant[], next: StoredCustomizationSeed) => Promise<void> | void;
  setErrorMessage: (message: string | null) => void;
}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingTargetRef = useRef<{ baseFileName: string; variants: MobSoundVariant[] } | null>(null);
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
          baseFileName: `${mob.localId}_${label.replace(/[^a-z0-9]+/gi, "_")}`,
          variants,
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

        recorder.onstop = async () => {
          const target = recordingTargetRef.current;
          setRecordingGroupId(null);

          if (!target || recorderChunksRef.current.length === 0) {
            return;
          }

          const blob = new Blob(recorderChunksRef.current, {
            type: recorder.mimeType || preferredMimeType || DEFAULT_RECORDING_MIME_TYPE,
          });

          try {
            const mimeType = blob.type || recorder.mimeType || preferredMimeType || DEFAULT_RECORDING_MIME_TYPE;
            await onStoreGroup(target.variants, {
              blob,
              fileName: withFileExtension(target.baseFileName, extensionForMimeType(mimeType)),
              kind: "recording",
              mimeType,
            });
          } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "Microphone recording failed.");
          }
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

async function prepareCustomizationSeed(seed: StoredCustomizationSeed, variants: MobSoundVariant[]): Promise<StoredCustomizationSeed> {
  const processed = await enhanceCustomAudioBlob(seed.blob, {
    referenceUrl: getReferenceVariantPreviewUrl(variants),
  });
  const mimeType = processed.blob.type || seed.mimeType;

  return {
    ...seed,
    blob: processed.blob,
    fileName: withFileExtension(seed.fileName, extensionForMimeType(mimeType)),
    mimeType,
  };
}

function getReferenceVariantPreviewUrl(variants: MobSoundVariant[]) {
  return variants.find((variant) => variant.url)?.url;
}

function extensionForMimeType(mimeType: string) {
  const normalizedMimeType = mimeType.toLowerCase();

  if (normalizedMimeType.includes("ogg")) {
    return "ogg";
  }

  if (normalizedMimeType.includes("wav")) {
    return "wav";
  }

  if (normalizedMimeType.includes("webm")) {
    return "webm";
  }

  if (normalizedMimeType.includes("mp4") || normalizedMimeType.includes("m4a") || normalizedMimeType.includes("aac")) {
    return "m4a";
  }

  if (normalizedMimeType.includes("mpeg") || normalizedMimeType.includes("mp3")) {
    return "mp3";
  }

  return "dat";
}

function withFileExtension(fileName: string, extension: string) {
  const baseName = fileName.replace(/\.[^./\\]+$/, "");
  return `${baseName}.${extension}`;
}
