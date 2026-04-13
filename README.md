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

The GitHub Pages workflow builds with `VITE_BASE_PATH=/mob-dub/` so the app can be hosted at `https://actualpugbot.github.io/mob-dub/`.

## Data Source

The app syncs its mob sound data from:

```text
../mc-datahub/workspace/datasets/<version>/mob-sounds.json
```

By default `npm run sync:data` copies the most recently processed version from `mc-datahub/workspace/state.json` into `public/data/mob-sounds.json`.
Mob thumbnails are loaded from local files in `public/images/mobs`.
Most of those images are maintained in the public `mob-voice-over` asset repository:

```text
../mob-voice-over/public/assets/mobs
```

Mob GIFs are synced from the current mob pages on `minecraft.wiki` when an infobox GIF exists. Refresh those with:

```bash
npm run sync:wiki-images
```

That script records what it found in `public/data/wiki-mob-gifs.json`.
After updating local mob images, rerun `npm run sync:data` so mobs with local `<mobId>.gif` files prefer the GIF over the PNG.

To sync a specific version:

```bash
node scripts/sync-mob-data.mjs 26.1.1
```

## Export Modes

- `Broad compatibility`: writes `pack_format`, `supported_formats`, `min_format`, and `max_format` so a voice-only pack can target a wider format range.
- `Current release only`: writes a strict pack target for the current `mc-datahub` resource pack format.
