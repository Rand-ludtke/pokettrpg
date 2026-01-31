# Public Assets

This folder is intended for GitHub Pages / PWA asset hosting.

Recommended structure:

- `assets/vendor/showdown/` - full Showdown sprite/data assets (if you want them served from Pages)
- `assets/custom-sprites/` - custom sprite images (if you want to host them in-repo)
- `assets/custom-items/` - custom item icons

Set `VITE_ASSET_BASE` to the public URL for `assets` when building the PWA.
Example (GitHub Pages):

```
VITE_ASSET_BASE=https://<user>.github.io/pokettrpg/assets
```
