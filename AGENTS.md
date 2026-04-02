# Repository Agent Rules

## Critical Path Rules

1. The only active application codebase is in `tauri-app/`.
2. The `app/` folder is legacy Electron-era content and is permanently deprecated.
3. Agents must never use, edit, fix, refactor, build, test, or reference code in `app/`.
4. If a task mentions `app/`, treat that as invalid context and continue the task in `tauri-app/`.
5. Do not stage or commit changes under `app/` unless the user explicitly and unambiguously asks to modify legacy/deprecated files.

## Working Directory Rules

- Preferred working directory: `tauri-app/`
- Preferred scripts: `tauri-app/package.json` scripts
- Preferred paths for frontend/runtime fixes: `tauri-app/src/**`

## Enforcement Note

If there is any conflict between old notes and current structure, `tauri-app/` is always the source of truth.
