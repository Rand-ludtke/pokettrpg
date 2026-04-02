# Copilot Workspace Instructions

## Active App Location

The active and only supported application lives in `tauri-app/`.

## Deprecated Folder (Hard Rule)

`app/` is an old Electron-era folder and is deprecated.

- Never edit files under `app/`.
- Never run builds/tests/dev commands from `app/`.
- Never propose fixes in `app/`.
- Never use `app/` as architecture/source-of-truth context.

If a request, log, or path references `app/`, treat it as legacy noise and resolve the work in `tauri-app/`.

## Safe Defaults

- Use `tauri-app/` as cwd for app tasks.
- Use `tauri-app/src/**` for implementation changes.
- Use `tauri-app/package.json` scripts for build/dev/preview.
