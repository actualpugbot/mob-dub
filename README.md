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
Mob thumbnails are vendored locally in `public/images/mobs` so the app does not depend on `mc-datahub` textures at build time.
`npm run sync:data` now validates that each mob in the dataset already has a matching local image in `public/images/mobs`, using either the default `<mob-id>.png` file or a configured override such as a GIF.

The current image source lives in:

```text
../mob-voice-over/public/assets/mobs
```

Copy the PNG mob thumbnails from there into `public/images/mobs` whenever the local image set needs to be refreshed or expanded.

To sync a specific version:

```bash
node scripts/sync-mob-data.mjs 26.1.1
```

## Export Modes

- `Broad compatibility`: writes `pack_format`, `supported_formats`, `min_format`, and `max_format` so a voice-only pack can target a wider format range.
- `Current release only`: writes a strict pack target for the current `mc-datahub` resource pack format.
