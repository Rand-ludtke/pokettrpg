# macOS Release / Download Guide

Use this guide to get PokéTTRPG on macOS from a release build.

## 1) Download

1. Open the GitHub Releases page for this project.
2. Download the macOS `.dmg` asset for the version you want.
3. Open the `.dmg` and drag `pokettrpg.app` to `Applications`.

## 2) First launch (unsigned app)

Because this app is not Apple-code-signed, Gatekeeper blocks first launch.

### Preferred

- In `Applications`, right-click `pokettrpg.app` → `Open` → `Open`.

### If still blocked

Run in Terminal:

```bash
xattr -cr /Applications/pokettrpg.app
```

Then launch the app again.

## 3) If macOS says “app is damaged”

Run:

```bash
xattr -cr /Applications/pokettrpg.app
```

## 4) Update flow

For each new version:

1. Delete or replace the old app in `Applications`.
2. Install the new `.dmg` build.
3. If blocked again, repeat `xattr -cr`.

## 5) Full install doc

For detailed troubleshooting, use the full install document at:

- `docs/MACOS_INSTALL.md` (repo root)
