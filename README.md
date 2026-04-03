# Mob Dub

`mob-dub` is a browser app for browsing every mob in the latest processed `mc-datahub` dataset, previewing all of each mob's vanilla sound variants, replacing individual variants with microphone takes or uploaded audio, and exporting the result as a Minecraft Java resource pack.

## Commands

```bash
npm install
npm run sync:data
npm run dev
```

Production build:

```bash
npm run build
```

## Data Source

The app syncs its mob sound data from:

```text
../mc-datahub/workspace/datasets/<version>/mob-sounds.json
```

By default `npm run sync:data` copies the most recently processed version from `mc-datahub/workspace/state.json` into `public/data/mob-sounds.json`.
It also copies one representative vanilla entity texture per mob into `public/images/mobs` so the app can show thumbnails beside each mob title.

To sync a specific version:

```bash
node scripts/sync-mob-data.mjs 26.1.1
```

## Export Modes

- `Broad compatibility`: writes `pack_format`, `supported_formats`, `min_format`, and `max_format` so a voice-only pack can target a wider format range.
- `Current release only`: writes a strict pack target for the current `mc-datahub` resource pack format.
