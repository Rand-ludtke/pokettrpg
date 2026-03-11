#!/usr/bin/env python3
"""
Sync and normalize Infinite Fusion sprite assets.

What this script does:
1) Fetches pokemon_id -> nat_id mapping from Infinite Fusion Dex.
2) Renames local sprite filenames that still use local dex IDs to national dex IDs
    using a safety rule: IDs that are already valid national IDs are never remapped.
3) Optionally downloads missing custom/generated sprites from ifd-spaces CDN.

Default mode is dry-run (no filesystem changes).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

BASE_URL = "https://infinitefusiondex.com"
CDN_BASE = "https://ifd-spaces.sfo2.cdn.digitaloceanspaces.com"

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}

FUSION_STEM_RE = re.compile(r"^(-?\d+)\.(-?\d+)(.*)$")
BASE_STEM_RE = re.compile(r"^(-?\d+)(.*)$")
BASE_NUMERIC_STEM_RE = re.compile(r"^(-?\d+)$")


@dataclass
class RenameAction:
    source: Path
    target: Path
    reason: str


@dataclass
class DownloadResult:
    sprite_id: str
    source_kind: str
    output_path: Path


@dataclass
class SyncReport:
    mapping_count: int
    renames_planned: int
    renames_applied: int
    rename_conflicts: int
    rename_skipped: int
    downloads_planned: int
    downloads_applied: int
    download_misses: int
    refresh_planned: int = 0
    refresh_applied: int = 0
    refresh_misses: int = 0
    backend_reindex_ok: Optional[bool] = None
    backend_reindex_detail: Optional[str] = None


class SyncError(RuntimeError):
    pass


def http_get_text(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "pokettrpg-sync/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def http_download(url: str, output_path: Path, timeout: int = 30) -> bool:
    req = urllib.request.Request(url, headers={"User-Agent": "pokettrpg-sync/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return False
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(resp.read())
            return True
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return False
        raise


def http_post_json(url: str, payload: dict, timeout: int = 30) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": "pokettrpg-sync/1.0",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        text = resp.read().decode("utf-8", errors="replace")
        if not text.strip():
            return {}
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
        return {"raw": parsed}


def reindex_backend(backend_url: str) -> Tuple[bool, str]:
    base = backend_url.rstrip("/")
    endpoint = f"{base}/api/fusion/reindex"
    try:
        payload = http_post_json(endpoint, {})
    except Exception as exc:
        return False, f"reindex failed: {exc}"

    if payload.get("ok") is True:
        total = payload.get("totalFusions")
        if isinstance(total, int):
            return True, f"ok (totalFusions={total})"
        return True, "ok"
    return False, f"unexpected response: {payload}"


def parse_build_id(home_html: str) -> Optional[str]:
    # Pull buildId from Next.js payload.
    m = re.search(r'"buildId"\s*:\s*"([^"]+)"', home_html)
    return m.group(1) if m else None


def fetch_dropdown_data() -> dict:
    html = http_get_text(BASE_URL)
    build_id = parse_build_id(html)

    if build_id:
        url = f"{BASE_URL}/api/initial/dropdown-data?v={urllib.parse.quote(build_id)}"
    else:
        url = f"{BASE_URL}/api/initial/dropdown-data"

    payload = http_get_text(url)
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise SyncError("Unexpected dropdown payload shape.")
    return data


def extract_id_mapping(dropdown: dict) -> Dict[int, int]:
    raw = dropdown.get("pokemon")
    if raw is None:
        raise SyncError("dropdown payload missing 'pokemon'.")

    records: Iterable[dict]
    if isinstance(raw, dict):
        records = raw.values()
    elif isinstance(raw, list):
        records = raw
    else:
        raise SyncError("Unexpected 'pokemon' structure in dropdown payload.")

    mapping: Dict[int, int] = {}
    for rec in records:
        if not isinstance(rec, dict):
            continue
        pid = rec.get("pokemon_id")
        nat = rec.get("nat_id")
        try:
            if pid is None or nat is None:
                continue
            pid_i = int(pid)
            nat_i = int(nat)
        except (TypeError, ValueError):
            continue
        mapping[pid_i] = nat_i

    if not mapping:
        raise SyncError("No pokemon_id -> nat_id rows found in dropdown payload.")
    return mapping


def file_sha1(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def iter_image_files(root: Path) -> Iterable[Path]:
    if not root.exists() or not root.is_dir():
        return
    for dirpath, _, filenames in os.walk(root):
        base = Path(dirpath)
        for filename in filenames:
            p = base / filename
            if p.suffix.lower() in IMAGE_EXTS:
                yield p


def iter_relevant_dirs(sprites_root: Path) -> List[Path]:
    dirs: List[Path] = []

    # Canonical base and custom folders.
    dirs.append(sprites_root / "Other" / "BaseSprites")
    dirs.append(sprites_root / "CustomBattlers")
    dirs.append(sprites_root / "generated")
    dirs.append(sprites_root / "custom")

    # Bucketed fusion folders: head-XXXX-XXXX
    if sprites_root.exists():
        for child in sprites_root.iterdir():
            if child.is_dir() and child.name.startswith("head-"):
                dirs.append(child)

    return [d for d in dirs if d.exists()]


def remap_component_id(component_id: int, mapping: Dict[int, int], nat_ids: Set[int]) -> int:
    # Safety rule: if an ID is already a valid national ID, never remap it.
    if component_id in nat_ids:
        return component_id
    mapped = mapping.get(component_id, component_id)
    if mapped in nat_ids:
        return mapped
    return component_id


def remap_fusion_stem(stem: str, mapping: Dict[int, int], nat_ids: Set[int]) -> Optional[str]:
    m = FUSION_STEM_RE.match(stem)
    if not m:
        return None

    head = int(m.group(1))
    body = int(m.group(2))
    suffix = m.group(3)

    new_head = remap_component_id(head, mapping, nat_ids)
    new_body = remap_component_id(body, mapping, nat_ids)

    if new_head == head and new_body == body:
        return None

    return f"{new_head}.{new_body}{suffix}"


def remap_base_stem(stem: str, mapping: Dict[int, int], nat_ids: Set[int]) -> Optional[str]:
    # Base remap is intentionally strict: only pure numeric stems are renamed.
    m = BASE_NUMERIC_STEM_RE.match(stem)
    if not m:
        return None

    base_id = int(m.group(1))
    new_id = remap_component_id(base_id, mapping, nat_ids)
    if new_id == base_id:
        return None
    return f"{new_id}"


def plan_renames(sprites_root: Path, mapping: Dict[int, int]) -> List[RenameAction]:
    actions: List[RenameAction] = []
    nat_ids: Set[int] = set(mapping.values())

    # BaseSprites: single-ID filenames.
    base_dir = sprites_root / "Other" / "BaseSprites"
    for path in iter_image_files(base_dir):
        new_stem = remap_base_stem(path.stem, mapping, nat_ids)
        if not new_stem:
            continue
        target = path.with_name(new_stem + path.suffix)
        if target == path:
            continue
        actions.append(RenameAction(path, target, "base-id remap"))

    # Fusion-like files everywhere else under sprite root.
    for d in iter_relevant_dirs(sprites_root):
        if d == base_dir:
            continue
        for path in iter_image_files(d):
            new_stem = remap_fusion_stem(path.stem, mapping, nat_ids)
            if not new_stem:
                continue
            target = path.with_name(new_stem + path.suffix)
            if target == path:
                continue
            actions.append(RenameAction(path, target, "fusion-id remap"))

    return actions


def apply_renames(actions: Sequence[RenameAction], apply: bool) -> Tuple[int, int, int]:
    applied = 0
    conflicts = 0
    skipped = 0

    for a in actions:
        if a.target.exists():
            if not apply:
                # In dry-run, avoid hashing large files just to classify duplicates.
                conflicts += 1
                continue
            # If identical files, treat as skip. Avoid deleting anything automatically.
            try:
                if file_sha1(a.source) == file_sha1(a.target):
                    skipped += 1
                    continue
            except OSError:
                pass
            conflicts += 1
            continue

        if apply:
            a.target.parent.mkdir(parents=True, exist_ok=True)
            a.source.rename(a.target)
        applied += 1

    return applied, conflicts, skipped


def collect_existing_stems(sprites_root: Path) -> Set[str]:
    stems: Set[str] = set()
    for d in iter_relevant_dirs(sprites_root):
        for p in iter_image_files(d):
            stems.add(p.stem)
    return stems


def collect_candidate_ids(sprites_root: Path, mapping: Dict[int, int]) -> Set[str]:
    candidates: Set[str] = set()

    # Base candidates by national dex IDs.
    for nat in mapping.values():
        candidates.add(str(nat))

    # Existing fusion stems are candidate refresh/download IDs.
    for d in iter_relevant_dirs(sprites_root):
        for p in iter_image_files(d):
            stem = p.stem
            if FUSION_STEM_RE.match(stem):
                candidates.add(stem)

    return candidates


def stem_exists_quick(sprites_root: Path, stem: str) -> bool:
    probes: List[Path] = [
        sprites_root / "generated",
        sprites_root / "custom",
        sprites_root / "Other" / "BaseSprites",
        sprites_root / "CustomBattlers",
    ]
    for root in probes:
        if not root.exists():
            continue
        for ext in IMAGE_EXTS:
            if (root / f"{stem}{ext}").exists():
                return True
    return False


def try_download_sprite(sprite_id: str, out_dir: Path, apply: bool) -> Optional[DownloadResult]:
    custom_url = f"{CDN_BASE}/custom/{sprite_id}.png"
    generated_url = f"{CDN_BASE}/generated/{sprite_id}.png"

    custom_out = out_dir / "custom" / f"{sprite_id}.png"
    generated_out = out_dir / "generated" / f"{sprite_id}.png"

    if apply:
        if http_download(custom_url, custom_out):
            return DownloadResult(sprite_id=sprite_id, source_kind="custom", output_path=custom_out)
        if http_download(generated_url, generated_out):
            return DownloadResult(sprite_id=sprite_id, source_kind="generated", output_path=generated_out)
        return None

    # Dry-run: probe quickly with HEAD-like behavior by GET and immediate drop.
    # urllib does not reliably support HEAD everywhere, so use URL open and discard.
    for kind, url, out_path in (
        ("custom", custom_url, custom_out),
        ("generated", generated_url, generated_out),
    ):
        req = urllib.request.Request(url, headers={"User-Agent": "pokettrpg-sync/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status == 200:
                    return DownloadResult(sprite_id=sprite_id, source_kind=kind, output_path=out_path)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                continue
            raise
        except urllib.error.URLError:
            continue
    return None


def refresh_base_sprite_ids(
    sprites_root: Path,
    sprite_ids: Sequence[str],
    apply: bool,
) -> Tuple[int, int, int]:
    base_dir = sprites_root / "Other" / "BaseSprites"
    planned = 0
    applied = 0
    misses = 0

    for raw_id in sprite_ids:
        sprite_id = raw_id.strip()
        if not sprite_id:
            continue

        custom_url = f"{CDN_BASE}/custom/{sprite_id}.png"
        generated_url = f"{CDN_BASE}/generated/{sprite_id}.png"
        out_path = base_dir / f"{sprite_id}.png"

        found = False
        for kind, url in (("custom", custom_url), ("generated", generated_url)):
            if apply:
                if http_download(url, out_path):
                    found = True
                    break
            else:
                req = urllib.request.Request(url, headers={"User-Agent": "pokettrpg-sync/1.0"})
                try:
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        if resp.status == 200:
                            found = True
                            break
                except urllib.error.HTTPError as exc:
                    if exc.code == 404:
                        continue
                    raise
                except urllib.error.URLError:
                    continue

        if found:
            planned += 1
            if apply:
                applied += 1
        else:
            misses += 1

    return planned, applied, misses


def sync_missing_downloads(
    sprites_root: Path,
    mapping: Dict[int, int],
    apply: bool,
    max_downloads: int,
    scope: str,
) -> Tuple[int, int, int]:
    if scope == "all":
        existing = collect_existing_stems(sprites_root)
        candidates = collect_candidate_ids(sprites_root, mapping)
        missing = sorted(c for c in candidates if c not in existing)
    else:
        candidates = sorted({str(n) for n in mapping.values()})
        missing = [c for c in candidates if not stem_exists_quick(sprites_root, c)]

    planned = 0
    applied = 0
    misses = 0
    attempts = 0

    for sprite_id in missing:
        if max_downloads > 0 and attempts >= max_downloads:
            break
        attempts += 1

        res = try_download_sprite(sprite_id, sprites_root, apply)
        if res is None:
            misses += 1
            continue

        planned += 1
        if apply:
            applied += 1

    return planned, applied, misses


def write_report(path: Path, report: SyncReport, renames: Sequence[RenameAction]) -> None:
    payload = {
        "mapping_count": report.mapping_count,
        "renames_planned": report.renames_planned,
        "renames_applied": report.renames_applied,
        "rename_conflicts": report.rename_conflicts,
        "rename_skipped": report.rename_skipped,
        "downloads_planned": report.downloads_planned,
        "downloads_applied": report.downloads_applied,
        "download_misses": report.download_misses,
        "refresh_planned": report.refresh_planned,
        "refresh_applied": report.refresh_applied,
        "refresh_misses": report.refresh_misses,
        "backend_reindex_ok": report.backend_reindex_ok,
        "backend_reindex_detail": report.backend_reindex_detail,
        "sample_renames": [
            {
                "source": str(r.source),
                "target": str(r.target),
                "reason": r.reason,
            }
            for r in list(renames)[:200]
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Sync and normalize Infinite Fusion sprites")
    p.add_argument(
        "--workspace-root",
        default=".",
        help="Workspace root containing .fusion-sprites-local",
    )
    p.add_argument(
        "--sprites-dir",
        default=".fusion-sprites-local",
        help="Sprite root directory relative to workspace root",
    )
    p.add_argument(
        "--apply",
        action="store_true",
        help="Apply changes (default is dry-run)",
    )
    p.add_argument(
        "--skip-remap",
        action="store_true",
        help="Skip local filename remapping",
    )
    p.add_argument(
        "--download-missing",
        action="store_true",
        help="Download missing IDs from custom/generated CDN paths",
    )
    p.add_argument(
        "--max-downloads",
        type=int,
        default=0,
        help="Limit attempted downloads (0 = no limit)",
    )
    p.add_argument(
        "--download-scope",
        choices=["nat", "all"],
        default="nat",
        help="nat: only national dex IDs; all: include fusion IDs discovered in local files",
    )
    p.add_argument(
        "--report",
        default="output/ifdex-sync-report.json",
        help="Path for JSON summary report",
    )
    p.add_argument(
        "--backend-url",
        default=os.environ.get("FUSION_BACKEND_URL", "http://127.0.0.1:3000"),
        help="Backend base URL for sync hooks (default: http://127.0.0.1:3000)",
    )
    p.add_argument(
        "--reindex-backend",
        action="store_true",
        help="Call backend /api/fusion/reindex after local sync",
    )
    p.add_argument(
        "--refresh-base-ids",
        default="",
        help="Comma-separated base sprite IDs to force-refresh into Other/BaseSprites (e.g. 361,362,428,428a-i)",
    )
    return p.parse_args(argv)


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)

    workspace_root = Path(args.workspace_root).resolve()
    sprites_root = (workspace_root / args.sprites_dir).resolve()
    if not sprites_root.exists():
        print(f"ERROR: sprite root not found: {sprites_root}", file=sys.stderr)
        return 2

    try:
        dropdown = fetch_dropdown_data()
        mapping = extract_id_mapping(dropdown)
    except Exception as exc:
        print(f"ERROR: failed to fetch mapping: {exc}", file=sys.stderr)
        return 3

    renames: List[RenameAction] = []
    renames_applied = 0
    rename_conflicts = 0
    rename_skipped = 0

    if not args.skip_remap:
        renames = plan_renames(sprites_root, mapping)
        renames_applied, rename_conflicts, rename_skipped = apply_renames(renames, args.apply)

    downloads_planned = 0
    downloads_applied = 0
    download_misses = 0
    if args.download_missing:
        downloads_planned, downloads_applied, download_misses = sync_missing_downloads(
            sprites_root=sprites_root,
            mapping=mapping,
            apply=args.apply,
            max_downloads=args.max_downloads,
            scope=args.download_scope,
        )

    refresh_ids = [s.strip() for s in str(args.refresh_base_ids or "").split(",") if s.strip()]
    refresh_planned = 0
    refresh_applied = 0
    refresh_misses = 0
    if refresh_ids:
        refresh_planned, refresh_applied, refresh_misses = refresh_base_sprite_ids(
            sprites_root=sprites_root,
            sprite_ids=refresh_ids,
            apply=args.apply,
        )

    backend_reindex_ok: Optional[bool] = None
    backend_reindex_detail: Optional[str] = None
    if args.reindex_backend:
        backend_reindex_ok, backend_reindex_detail = reindex_backend(args.backend_url)

    report = SyncReport(
        mapping_count=len(mapping),
        renames_planned=len(renames),
        renames_applied=renames_applied,
        rename_conflicts=rename_conflicts,
        rename_skipped=rename_skipped,
        downloads_planned=downloads_planned,
        downloads_applied=downloads_applied,
        download_misses=download_misses,
        refresh_planned=refresh_planned,
        refresh_applied=refresh_applied,
        refresh_misses=refresh_misses,
        backend_reindex_ok=backend_reindex_ok,
        backend_reindex_detail=backend_reindex_detail,
    )

    report_path = (workspace_root / args.report).resolve()
    write_report(report_path, report, renames)

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] mapping rows: {report.mapping_count}")
    print(f"[{mode}] renames planned: {report.renames_planned}")
    print(f"[{mode}] renames applied: {report.renames_applied}")
    print(f"[{mode}] rename conflicts: {report.rename_conflicts}")
    print(f"[{mode}] rename skipped-identical: {report.rename_skipped}")
    if args.download_missing:
        print(f"[{mode}] downloads found: {report.downloads_planned}")
        print(f"[{mode}] downloads applied: {report.downloads_applied}")
        print(f"[{mode}] download misses: {report.download_misses}")
    if refresh_ids:
        print(f"[{mode}] refresh requested: {len(refresh_ids)}")
        print(f"[{mode}] refresh found: {report.refresh_planned}")
        print(f"[{mode}] refresh applied: {report.refresh_applied}")
        print(f"[{mode}] refresh misses: {report.refresh_misses}")
    if args.reindex_backend:
        print(f"[{mode}] backend reindex ok: {report.backend_reindex_ok}")
        print(f"[{mode}] backend reindex detail: {report.backend_reindex_detail}")
    print(f"[{mode}] report: {report_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
