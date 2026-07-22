# Mere Graph Studio brand assets

The Graph Studio mark is a routed signal path shaped into an `M`: one typed
workflow, three visible connection points, and a continuous route from authoring
to execution. Mint is the primary signal color, cyan indicates movement, and
violet identifies the authoring origin.

## Assets

- `web/public/brand/mark.svg` is the canonical standalone mark.
- `web/public/brand/lockup.svg` is the horizontal product lockup.
- `src-tauri/icons/app-icon.svg` is the desktop application-icon source.
- `web/public/graph-studio-og.png` is the generated social and README card.
- `scripts/brand/graph-studio-og.html` is the editable social-card source.

Run `pnpm brand:render` after editing the social-card source. Regenerate the
desktop platform icon matrix with:

```sh
pnpm tauri icon src-tauri/icons/app-icon.svg
```

The Tauri command also emits Android and iOS matrices. This desktop repository
ignores those byproducts; its release bundle consumes the PNG, ICNS, ICO, and
Windows Store assets in `src-tauri/icons/`.

## Palette

| Role | Color |
| --- | --- |
| Obsidian | `#070A0D` |
| Panel | `#0B1115` |
| Mint signal | `#72E8B6` |
| Cyan route | `#43C9E3` |
| Violet origin | `#A995FF` |
| Primary text | `#EDF4F1` |

These files are distributed under the repository's MIT License. Reuse is
welcome; please do not imply endorsement by mere.run or Sawfwair.
