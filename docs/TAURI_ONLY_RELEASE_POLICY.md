# TAURI-ONLY Release And Build Policy

## STOP: Do Not Use app(do not touch)

The folder app(do not touch) is not part of the active release workflow.

Rules:
- Do not build from app(do not touch).
- Do not edit app(do not touch) for features, fixes, or release prep.
- Do not run release commands against app(do not touch).

All active desktop app development and release work must happen in tauri-app.

## Source Of Truth

Use these locations:
- Desktop app: tauri-app
- Backend API/services: pokemonttrpg-backend
- Sync tooling/scripts: scripts

If a change is needed for release, update tauri-app (and backend/scripts if required), then release.

## Required Pre-Release Checklist

1. Confirm intended code changes are committed.
2. Confirm no new work was done in app(do not touch).
3. Build backend if backend code changed:
   - npm --prefix pokemonttrpg-backend run build
4. Build Tauri app:
   - cd tauri-app
   - npm install
   - npm run tauri:build
5. Run root release automation:
   - ./release.ps1 <version>
6. Verify release assets were uploaded and tagged.

## Notes For Recent Sprite/Sync Changes

Recent work added:
- Daily Infinite Fusion Dex sync scheduler in backend startup
- Backend fusion routes for reindex and wrong-sprite reporting/fixing
- sync_ifdex_sprites.py enhancements for backend reindex integration

These changes live in:
- pokemonttrpg-backend/src/server
- scripts/sync_ifdex_sprites.py

They do not require editing app(do not touch).

## If You See app(do not touch) In A Plan

Treat that as incorrect. Redirect the work to tauri-app immediately.
