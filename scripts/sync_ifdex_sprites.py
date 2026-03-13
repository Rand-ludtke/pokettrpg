#!/usr/bin/env python3
"""
Sync and normalize Infinite Fusion sprite assets.

What this script does:
1) Builds Infinite Fusion Dex -> local dex mapping.
2) Renames local sprite filenames from IF dex IDs to local dex IDs.
3) Optionally downloads missing base sprites from Infinite Fusion CDN using IF dex IDs
   and saves them with corrected local dex filenames.
4) Optionally downloads missing fusion/custom/generated assets from the CDN.

Default mode is dry-run (no filesystem changes).
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

BASE_URL = "https://infinitefusiondex.com"
CDN_BASE = "https://ifd-spaces.sfo2.cdn.digitaloceanspaces.com"
REMAP_STATE_FILE = ".ifdex-remap-state.json"

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}

FILTER_API_URL = f"{BASE_URL}/api/filter/"
FILTER_PAGE_SIZE = 50
DOWNLOAD_WORKERS = 48
PROBE_WORKERS = 64

# ---------------------------------------------------------------------------
#  Thread-local requests.Session with connection pooling
# ---------------------------------------------------------------------------
_thread_local = threading.local()


def _get_session() -> requests.Session:
    """Return a per-thread Session with aggressive connection pooling."""
    s = getattr(_thread_local, "session", None)
    if s is None:
        s = requests.Session()
        adapter = HTTPAdapter(
            pool_connections=20,
            pool_maxsize=20,
            max_retries=Retry(total=1, backoff_factor=0.1, status_forcelist=[502, 503]),
        )
        s.mount("https://", adapter)
        s.mount("http://", adapter)
        s.headers.update({"User-Agent": "pokettrpg-sync/1.0"})
        _thread_local.session = s
    return s

TRIPLE_STEM_RE = re.compile(r"^(-?\d+)\.(-?\d+)\.(-?\d+)(.*)$")
FUSION_STEM_RE = re.compile(r"^(-?\d+)\.(-?\d+)(.*)$")
BASE_STEM_RE = re.compile(r"^(-?\d+)(.*)$")
BASE_NUMERIC_STEM_RE = re.compile(r"^(-?\d+)$")
NAT_DEX_LINE_RE = re.compile(r"^#\s*(\d+)\s*$")
IF_POKEMON_LINE_RE = re.compile(r"^Pokemon:\s*(\d+)\s*$")


FORM_ALIAS_MAP = {
    "ultra necrozma": "necrozma",
    "lycanroc midday": "lycanroc",
    "lycanroc midnight": "lycanroc",
    "meloetta aria": "meloetta",
    "meloetta pirouette": "meloetta",
    "minior meteor": "minior",
    "minior core": "minior",
}


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


def normalize_name(raw: str) -> str:
    s = (raw or "").strip().lower()
    s = s.replace("♀", " f ").replace("♂", " m ")
    s = s.replace("'", "").replace(".", " ")
    s = s.replace("-", " ").replace("/", " ")
    s = re.sub(r"[^a-z0-9()\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def strip_parenthetical(raw: str) -> str:
    return re.sub(r"\s*\([^)]*\)", "", raw).strip()


def iter_name_candidates(name: str) -> Iterable[str]:
    full = normalize_name(name)
    base = normalize_name(strip_parenthetical(name))

    if full:
        yield full
    if base and base != full:
        yield base

    # Parenthetical forms often include labels that should map to the base species.
    full_no_parens = normalize_name(re.sub(r"[()]", " ", name))
    if full_no_parens and full_no_parens not in {full, base}:
        yield full_no_parens

    alias = FORM_ALIAS_MAP.get(full_no_parens)
    if alias:
        alias_norm = normalize_name(alias)
        if alias_norm and alias_norm not in {full, base, full_no_parens}:
            yield alias_norm


def extract_leading_name(line: str) -> str:
    # National dex rows are tab-separated; the first field is the species display name.
    token = line.strip().split("\t")[0].strip()
    return token


def parse_national_dex_markdown(path: Path) -> Dict[str, int]:
    if not path.exists():
        raise SyncError(f"national dex file not found: {path}")

    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    out: Dict[str, int] = {}

    i = 0
    while i < len(lines):
        m = NAT_DEX_LINE_RE.match(lines[i].strip())
        if not m:
            i += 1
            continue

        nat_id = int(m.group(1))
        j = i + 1
        name = ""
        while j < len(lines):
            candidate = lines[j].strip()
            if not candidate:
                j += 1
                continue
            if NAT_DEX_LINE_RE.match(candidate):
                break
            name = extract_leading_name(candidate)
            break

        if name:
            key = normalize_name(name)
            if key and key not in out:
                out[key] = nat_id

        i = j if j > i else i + 1

    if not out:
        raise SyncError("failed to parse any national dex entries from markdown")
    return out


def parse_ifdex_markdown(path: Path) -> Dict[int, str]:
    if not path.exists():
        raise SyncError(f"infinite fusion dex file not found: {path}")

    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    out: Dict[int, str] = {}

    i = 0
    while i < len(lines):
        m = IF_POKEMON_LINE_RE.match(lines[i].strip())
        if not m:
            i += 1
            continue

        if_id = int(m.group(1))
        j = i + 1
        name = ""
        while j < len(lines):
            candidate = lines[j].strip()
            if not candidate:
                j += 1
                continue
            if candidate.startswith("("):
                j += 1
                continue
            name = candidate
            break

        if name:
            out[if_id] = name

        i = j if j > i else i + 1

    if not out:
        raise SyncError("failed to parse any infinite fusion dex entries from markdown")
    return out


def build_mapping_from_markdown(ifdex_path: Path, national_dex_path: Path) -> Dict[int, int]:
    nat_name_to_id = parse_national_dex_markdown(national_dex_path)
    ifdex_entries = parse_ifdex_markdown(ifdex_path)

    mapping: Dict[int, int] = {}
    missing: List[Tuple[int, str]] = []

    for if_id, if_name in sorted(ifdex_entries.items()):
        nat_id: Optional[int] = None
        for candidate in iter_name_candidates(if_name):
            nat_id = nat_name_to_id.get(candidate)
            if nat_id is not None:
                break
        if nat_id is None:
            missing.append((if_id, if_name))
            continue
        mapping[if_id] = nat_id

    if missing:
        sample = ", ".join(f"{i}:{n}" for i, n in missing[:12])
        raise SyncError(
            f"markdown mapping incomplete ({len(mapping)}/{len(ifdex_entries)} matched); "
            f"sample missing entries: {sample}"
        )

    return mapping


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


def alpha_suffix(index: int) -> str:
    if index < 0:
        raise ValueError("suffix index must be non-negative")

    chars: List[str] = []
    value = index
    while True:
        value, remainder = divmod(value, 26)
        chars.append(chr(ord("a") + remainder))
        if value == 0:
            break
        value -= 1
    return "".join(reversed(chars))


def append_alpha_suffix(path: Path, index: int) -> Path:
    suffix = alpha_suffix(index)
    return path.with_name(f"{path.stem}{suffix}{path.suffix}")


def reserve_available_path(
    desired_path: Path,
    reserved_paths: Set[Path],
    releasable_paths: Optional[Set[Path]] = None,
) -> Path:
    releasable = releasable_paths or set()
    candidate = desired_path
    suffix_index = 0

    while True:
        if candidate not in reserved_paths and (not candidate.exists() or candidate in releasable):
            return candidate
        candidate = append_alpha_suffix(desired_path, suffix_index)
        suffix_index += 1


def make_temp_rename_path(source: Path, index: int, reserved_paths: Set[Path]) -> Path:
    temp_name = f"__ifdex_tmp__{index:06d}__{source.stem}{source.suffix}"
    candidate = source.with_name(temp_name)
    extra = 0
    while candidate in reserved_paths or candidate.exists():
        extra += 1
        candidate = source.with_name(f"__ifdex_tmp__{index:06d}_{extra:02d}__{source.stem}{source.suffix}")
    return candidate


def iter_image_files(root: Path) -> Iterable[Path]:
    if not root.exists() or not root.is_dir():
        return
    for dirpath, _, filenames in os.walk(root):
        base = Path(dirpath)
        for filename in filenames:
            p = base / filename
            if p.suffix.lower() in IMAGE_EXTS:
                yield p


def iter_relevant_dirs(sprites_root: Path, include_legacy_dirs: bool = True) -> List[Path]:
    dirs: List[Path] = []

    # Canonical base and custom folders.
    dirs.append(sprites_root / "Other" / "BaseSprites")
    dirs.append(sprites_root / "Other" / "Triples")
    dirs.append(sprites_root / "CustomBattlers")

    if not include_legacy_dirs:
        return [d for d in dirs if d.exists()]

    dirs.append(sprites_root / "generated")
    dirs.append(sprites_root / "custom")

    # Bucketed fusion folders: head-XXXX-XXXX
    if sprites_root.exists():
        for child in sprites_root.iterdir():
            if child.is_dir() and child.name.startswith("head-"):
                dirs.append(child)

    return [d for d in dirs if d.exists()]


def remap_component_id(component_id: int, mapping: Dict[int, int]) -> int:
    return mapping.get(component_id, component_id)


def remap_fusion_stem(stem: str, mapping: Dict[int, int]) -> Optional[str]:
    m = FUSION_STEM_RE.match(stem)
    if not m:
        return None

    head = int(m.group(1))
    body = int(m.group(2))
    suffix = m.group(3)

    new_head = remap_component_id(head, mapping)
    new_body = remap_component_id(body, mapping)

    if new_head == head and new_body == body:
        return None

    return f"{new_head}.{new_body}{suffix}"


def remap_triple_stem(stem: str, mapping: Dict[int, int]) -> Optional[str]:
    m = TRIPLE_STEM_RE.match(stem)
    if not m:
        return None

    first = int(m.group(1))
    second = int(m.group(2))
    third = int(m.group(3))
    suffix = m.group(4)

    new_first = remap_component_id(first, mapping)
    new_second = remap_component_id(second, mapping)
    new_third = remap_component_id(third, mapping)

    if new_first == first and new_second == second and new_third == third:
        return None

    return f"{new_first}.{new_second}.{new_third}{suffix}"


def remap_base_stem(stem: str, mapping: Dict[int, int]) -> Optional[str]:
    # Base sprite stems may include suffixes like 428a-i; preserve the suffix.
    m = BASE_STEM_RE.match(stem)
    if not m:
        return None

    base_id = int(m.group(1))
    suffix = m.group(2)
    new_id = remap_component_id(base_id, mapping)
    if new_id == base_id:
        return None
    return f"{new_id}{suffix}"


def plan_renames(
    sprites_root: Path,
    mapping: Dict[int, int],
    include_legacy_dirs: bool = True,
) -> List[RenameAction]:
    actions: List[RenameAction] = []

    # BaseSprites: single-ID filenames.
    base_dir = sprites_root / "Other" / "BaseSprites"
    for path in iter_image_files(base_dir):
        new_stem = remap_base_stem(path.stem, mapping)
        if not new_stem:
            continue
        target = path.with_name(new_stem + path.suffix)
        if target == path:
            continue
        actions.append(RenameAction(path, target, "base-id remap"))

    triple_dir = sprites_root / "Other" / "Triples"
    for path in iter_image_files(triple_dir):
        new_stem = remap_triple_stem(path.stem, mapping)
        if not new_stem:
            continue
        target = path.with_name(new_stem + path.suffix)
        if target == path:
            continue
        actions.append(RenameAction(path, target, "triple-id remap"))

    # Fusion-like files everywhere else under sprite root.
    for d in iter_relevant_dirs(sprites_root, include_legacy_dirs=include_legacy_dirs):
        if d == base_dir or d == triple_dir:
            continue
        for path in iter_image_files(d):
            new_stem = remap_fusion_stem(path.stem, mapping)
            if not new_stem:
                continue
            target = path.with_name(new_stem + path.suffix)
            if target == path:
                continue
            actions.append(RenameAction(path, target, "fusion-id remap"))

    return actions


def apply_renames(actions: Sequence[RenameAction], apply: bool) -> Tuple[int, int, int]:
    moving_sources = {a.source for a in actions}
    reserved_targets: Set[Path] = set()
    resolved_actions: List[RenameAction] = []
    applied = 0
    conflicts = 0
    skipped = 0

    for a in actions:
        if a.target.exists() and a.target not in moving_sources:
            try:
                if file_sha1(a.source) == file_sha1(a.target):
                    skipped += 1
                    continue
            except OSError:
                conflicts += 1
                continue

        resolved_target = reserve_available_path(a.target, reserved_targets, releasable_paths=moving_sources)
        reserved_targets.add(resolved_target)
        resolved_actions.append(RenameAction(a.source, resolved_target, a.reason))

    if not apply:
        applied = len(resolved_actions)
        return applied, conflicts, skipped

    temp_reserved = set(reserved_targets)
    temp_actions: List[RenameAction] = []
    for index, a in enumerate(resolved_actions):
        temp_path = make_temp_rename_path(a.source, index, temp_reserved)
        temp_reserved.add(temp_path)
        temp_actions.append(RenameAction(a.source, temp_path, a.reason))

    for a in temp_actions:
        try:
            a.source.rename(a.target)
        except OSError:
            conflicts += 1

    staged_by_target = {temp.target: final.target for temp, final in zip(temp_actions, resolved_actions)}

    for staged_source, final_target in staged_by_target.items():
        if not staged_source.exists():
            continue

        if final_target.exists():
            try:
                if file_sha1(staged_source) == file_sha1(final_target):
                    skipped += 1
                    continue
            except OSError:
                pass
            conflicts += 1
            continue

        final_target.parent.mkdir(parents=True, exist_ok=True)
        staged_source.rename(final_target)
        applied += 1

    return applied, conflicts, skipped


def collect_existing_stems(sprites_root: Path, include_legacy_dirs: bool = True) -> Set[str]:
    stems: Set[str] = set()
    for d in iter_relevant_dirs(sprites_root, include_legacy_dirs=include_legacy_dirs):
        for p in iter_image_files(d):
            stems.add(p.stem)
    return stems


def collect_candidate_ids(
    sprites_root: Path,
    mapping: Dict[int, int],
    include_legacy_dirs: bool = True,
) -> Set[str]:
    candidates: Set[str] = set()

    # Base candidates by national dex IDs.
    for nat in mapping.values():
        candidates.add(str(nat))

    # Existing fusion stems are candidate refresh/download IDs.
    for d in iter_relevant_dirs(sprites_root, include_legacy_dirs=include_legacy_dirs):
        for p in iter_image_files(d):
            stem = p.stem
            if TRIPLE_STEM_RE.match(stem):
                candidates.add(stem)
                continue
            if FUSION_STEM_RE.match(stem):
                candidates.add(stem)

    return candidates


def stem_exists_quick(sprites_root: Path, stem: str) -> bool:
    probes: List[Path] = [
        sprites_root / "generated",
        sprites_root / "custom",
        sprites_root / "Other" / "BaseSprites",
        sprites_root / "Other" / "Triples",
        sprites_root / "CustomBattlers",
    ]
    for root in probes:
        if not root.exists():
            continue
        for ext in IMAGE_EXTS:
            if (root / f"{stem}{ext}").exists():
                return True
    return False


def build_inverse_mapping(mapping: Dict[int, int]) -> Dict[int, int]:
    inverse: Dict[int, int] = {}
    for if_id, local_id in mapping.items():
        inverse.setdefault(local_id, if_id)
    return inverse


def remap_source_stem_to_target_stem(stem: str, mapping: Dict[int, int]) -> str:
    remapped = remap_base_stem(stem, mapping)
    return remapped or stem


def target_path_for_sprite_stem(sprites_root: Path, stem: str) -> Path:
    if TRIPLE_STEM_RE.match(stem):
        return sprites_root / "Other" / "Triples" / f"{stem}.png"
    if FUSION_STEM_RE.match(stem):
        return sprites_root / "CustomBattlers" / f"{stem}.png"
    return sprites_root / "Other" / "BaseSprites" / f"{stem}.png"


def reserve_download_output_path(output_path: Path) -> Path:
    return reserve_available_path(output_path, reserved_paths=set())


def try_download_to_path(source_sprite_id: str, output_path: Path, apply: bool) -> Optional[DownloadResult]:
    output_path = reserve_download_output_path(output_path)
    custom_url = f"{CDN_BASE}/custom/{source_sprite_id}.png"
    generated_url = f"{CDN_BASE}/generated/{source_sprite_id}.png"

    if apply:
        if http_download(custom_url, output_path):
            return DownloadResult(sprite_id=source_sprite_id, source_kind="custom", output_path=output_path)
        if http_download(generated_url, output_path):
            return DownloadResult(sprite_id=source_sprite_id, source_kind="generated", output_path=output_path)
        return None

    for kind, url in (("custom", custom_url), ("generated", generated_url)):
        req = urllib.request.Request(url, headers={"User-Agent": "pokettrpg-sync/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status == 200:
                    return DownloadResult(sprite_id=source_sprite_id, source_kind=kind, output_path=output_path)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                continue
            raise
        except urllib.error.URLError:
            continue
    return None


def try_download_sprite(sprite_id: str, out_dir: Path, apply: bool) -> Optional[DownloadResult]:
    custom_out = out_dir / "custom" / f"{sprite_id}.png"
    return try_download_to_path(sprite_id, custom_out, apply) or try_download_to_path(
        sprite_id, out_dir / "generated" / f"{sprite_id}.png", apply
    )


def sync_missing_base_sprites(
    sprites_root: Path,
    mapping: Dict[int, int],
    apply: bool,
    max_downloads: int,
    include_legacy_dirs: bool,
) -> Tuple[int, int, int]:
    base_dir = sprites_root / "Other" / "BaseSprites"
    existing = collect_existing_stems(sprites_root, include_legacy_dirs=include_legacy_dirs)

    planned = 0
    applied = 0
    misses = 0
    attempts = 0

    for if_id, local_id in sorted(mapping.items()):
        target_stem = str(local_id)
        if target_stem in existing or stem_exists_quick(sprites_root, target_stem):
            continue
        if max_downloads > 0 and attempts >= max_downloads:
            break
        attempts += 1

        output_path = base_dir / f"{target_stem}.png"
        res = try_download_to_path(str(if_id), output_path, apply)
        if res is None:
            misses += 1
            continue

        planned += 1
        if apply:
            applied += 1

    return planned, applied, misses


def refresh_base_sprite_ids(
    sprites_root: Path,
    sprite_ids: Sequence[str],
    mapping: Dict[int, int],
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

        target_stem = remap_source_stem_to_target_stem(sprite_id, mapping)
        out_path = base_dir / f"{target_stem}.png"
        found = try_download_to_path(sprite_id, out_path, apply)

        if found is not None:
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
    include_legacy_dirs: bool,
) -> Tuple[int, int, int]:
    if scope == "nat":
        return sync_missing_base_sprites(
            sprites_root=sprites_root,
            mapping=mapping,
            apply=apply,
            max_downloads=max_downloads,
            include_legacy_dirs=include_legacy_dirs,
        )

    inverse_mapping = build_inverse_mapping(mapping)
    existing = collect_existing_stems(sprites_root, include_legacy_dirs=include_legacy_dirs)
    candidates = collect_candidate_ids(sprites_root, mapping, include_legacy_dirs=include_legacy_dirs)
    missing = sorted(c for c in candidates if c not in existing)

    planned = 0
    applied = 0
    misses = 0
    attempts = 0

    for sprite_id in missing:
        if max_downloads > 0 and attempts >= max_downloads:
            break
        attempts += 1

        source_sprite_id = sprite_id
        triple_match = TRIPLE_STEM_RE.match(sprite_id)
        if triple_match:
            first = int(triple_match.group(1))
            second = int(triple_match.group(2))
            third = int(triple_match.group(3))
            suffix = triple_match.group(4)
            source_first = inverse_mapping.get(first, first)
            source_second = inverse_mapping.get(second, second)
            source_third = inverse_mapping.get(third, third)
            source_sprite_id = f"{source_first}.{source_second}.{source_third}{suffix}"
            target_out = target_path_for_sprite_stem(sprites_root, sprite_id)
        else:
            fusion_match = FUSION_STEM_RE.match(sprite_id)
            if fusion_match:
                head = int(fusion_match.group(1))
                body = int(fusion_match.group(2))
                suffix = fusion_match.group(3)
                source_head = inverse_mapping.get(head, head)
                source_body = inverse_mapping.get(body, body)
                source_sprite_id = f"{source_head}.{source_body}{suffix}"
                target_out = target_path_for_sprite_stem(sprites_root, sprite_id)
            else:
                target_out = target_path_for_sprite_stem(sprites_root, sprite_id)

        res = try_download_to_path(source_sprite_id, target_out, apply)
        if res is None:
            misses += 1
            continue

        planned += 1
        if apply:
            applied += 1

    return planned, applied, misses


# ---------------------------------------------------------------------------
#  API-driven sprite variant discovery
# ---------------------------------------------------------------------------

@dataclass
class SpriteVariant:
    """One downloadable sprite from the IF Dex."""
    if_id: str          # e.g. "1", "1.4", "1.4.7"
    extension: str      # e.g. "", "a", "ai"
    creature_type: str  # BASE, FUSION, TRIPLE, etc.
    has_custom: bool

    @property
    def cdn_stem(self) -> str:
        return f"{self.if_id}{self.extension}"


def fetch_all_sprite_variants(mapping: Dict[int, int], progress: bool = True) -> List[SpriteVariant]:
    """Use the filter API for featured base sprites, then probe CDN for all remaining base sprites.

    The filter API only returns ~50 featured base sprites with custom art.
    For the full set of ~572 base pokemon, we fall back to CDN probing.
    """
    variants: List[SpriteVariant] = []
    api_ids: Set[int] = set()

    # Phase 1: Get featured base sprites from filter API (includes exact alt lists)
    page = 1
    url = f"{FILTER_API_URL}?page={page}"
    req = urllib.request.Request(url, headers={"User-Agent": "pokettrpg-sync/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
    except (urllib.error.URLError, OSError) as exc:
        print(f"  WARNING: API request failed: {exc}", file=sys.stderr)
        data = {"fusions": []}

    fusions = data.get("fusions", [])
    for entry in fusions:
        pokemon_id = entry.get("pokemon_id")
        if pokemon_id is None:
            continue
        api_ids.add(pokemon_id)
        creature_type = entry.get("creature_type", "BASE")
        has_custom = entry.get("has_custom_art", False)
        if_id = str(pokemon_id)

        alts = entry.get("alts", [])
        if alts:
            for alt in alts:
                ext = alt.get("extension", "")
                variants.append(SpriteVariant(
                    if_id=if_id,
                    extension=ext,
                    creature_type=creature_type,
                    has_custom=has_custom,
                ))
        else:
            variants.append(SpriteVariant(
                if_id=if_id, extension="", creature_type=creature_type, has_custom=has_custom,
            ))

    if progress:
        print(f"  API returned {len(fusions)} featured base sprites ({len(variants)} variants)")

    # Phase 2: For all base IDs NOT in the API response, add bare variant (no alt info)
    for if_id in sorted(mapping.keys()):
        if if_id in api_ids:
            continue
        # We only know the base variant exists; CDN probing later will find alts
        variants.append(SpriteVariant(
            if_id=str(if_id), extension="", creature_type="BASE", has_custom=False,
        ))

    if progress:
        print(f"  Total base sprites (API + mapping): {len(variants)} variants for {len(mapping)} pokemon")

    return variants


def compute_local_stem(variant: SpriteVariant, mapping: Dict[int, int]) -> str:
    """Map an IF Dex sprite variant to its local filesystem stem."""
    parts = variant.if_id.split(".")
    remapped = [str(mapping.get(int(p), int(p))) for p in parts]
    base = ".".join(remapped)
    return f"{base}{variant.extension}"


def _download_one(
    cdn_stem: str,
    output_path: Path,
    apply: bool,
    source_hint: Optional[str] = None,
) -> Optional[DownloadResult]:
    """Try custom/ then generated/ on the CDN for a single sprite. Thread-safe.

    Uses per-thread requests.Session for connection pooling.
    If source_hint is given ('custom' or 'generated'), tries that first.
    """
    session = _get_session()
    kinds = ("custom", "generated")
    if source_hint in kinds:
        # Try hinted source first, then fallback
        kinds = (source_hint,) + tuple(k for k in kinds if k != source_hint)
    for kind in kinds:
        url = f"{CDN_BASE}/{kind}/{cdn_stem}.png"
        try:
            resp = session.get(url, timeout=15, stream=True)
            if resp.status_code == 200:
                if apply:
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    output_path.write_bytes(resp.content)
                else:
                    resp.close()
                return DownloadResult(
                    sprite_id=cdn_stem,
                    source_kind=kind,
                    output_path=output_path,
                )
            resp.close()
        except requests.RequestException:
            continue
    return None


MAX_PROBE_SUFFIX_INDEX = 77   # a..z (0-25), aa..bz (26-77) = 78 suffixes
MAX_CONSECUTIVE_MISSES = 3    # stop probing a given ID after N consecutive 404s


def _probe_cdn_exists(cdn_stem: str) -> bool:
    """HEAD-check whether a sprite exists on the CDN (custom or generated)."""
    return _probe_cdn_source(cdn_stem) is not None


def _probe_cdn_source(cdn_stem: str) -> Optional[str]:
    """HEAD-check CDN and return the source kind ('custom' or 'generated'), or None.

    Uses per-thread requests.Session for connection pooling (reuses TCP/TLS).
    """
    session = _get_session()
    for kind in ("custom", "generated"):
        url = f"{CDN_BASE}/{kind}/{cdn_stem}.png"
        try:
            resp = session.head(url, timeout=10, allow_redirects=True)
            if resp.status_code == 200:
                return kind
        except requests.RequestException:
            continue
    return None


def _probe_id_variants(
    base_cdn_prefix: str,
    base_local_prefix: str,
    existing: Set[str],
    sprites_root: Path,
) -> List[Tuple[str, Path, str]]:
    """Probe a single ID for all suffix variants, with early termination.

    Returns list of (cdn_stem, output_path, source_kind) tuples.
    Probes "", "a", "b", ... stopping after MAX_CONSECUTIVE_MISSES consecutive
    misses (skipping suffixes already in `existing`).
    """
    found: List[Tuple[str, Path, str]] = []
    consecutive_misses = 0

    for idx in range(MAX_PROBE_SUFFIX_INDEX + 2):  # +2 for "" at idx 0
        suffix = "" if idx == 0 else alpha_suffix(idx - 1)
        local_stem = f"{base_local_prefix}{suffix}"
        if local_stem in existing:
            consecutive_misses = 0  # reset on "already have it"
            continue

        cdn_stem = f"{base_cdn_prefix}{suffix}"
        source = _probe_cdn_source(cdn_stem)
        if source is not None:
            output_path = target_path_for_sprite_stem(sprites_root, local_stem)
            found.append((cdn_stem, output_path, source))
            consecutive_misses = 0
        else:
            consecutive_misses += 1
            if consecutive_misses >= MAX_CONSECUTIVE_MISSES:
                break

    return found


def discover_fusion_variants_from_cdn(
    sprites_root: Path,
    mapping: Dict[int, int],
    existing: Set[str],
    workers: int = PROBE_WORKERS,
) -> List[Tuple[str, Path, str]]:
    """Probe the CDN for fusion sprite variants beyond what we have locally.

    Returns list of (cdn_stem, output_path, source_kind) tuples.
    Three-phase approach for speed:
    1) Pre-filter: reject pairs that don't exist on CDN at all.
    2) Quick alt check: HEAD-check suffix "a" for each active pair.
       ~95% of pairs have no alts, so this eliminates most full probes.
    3) Full probe: Only pairs with confirmed alts get the full suffix scan.
    """
    inverse = build_inverse_mapping(mapping)

    # Collect unique base pairs (without suffix) from existing stems
    # Only consider pairs within the IF Dex range (positive IDs in the mapping)
    valid_local_ids = set(mapping.values())
    fusion_pairs: Set[Tuple[int, int]] = set()
    for stem in existing:
        m = FUSION_STEM_RE.match(stem)
        if m:
            head, body = int(m.group(1)), int(m.group(2))
            if head in valid_local_ids and body in valid_local_ids:
                fusion_pairs.add((head, body))

    print(f"  Fusion pairs to check: {len(fusion_pairs)}")
    if not fusion_pairs:
        return []

    # Build probe tasks: one per fusion pair
    pair_tasks: List[Tuple[str, str]] = []  # (cdn_prefix, local_prefix)
    for head, body in sorted(fusion_pairs):
        src_head = inverse.get(head, head)
        src_body = inverse.get(body, body)
        pair_tasks.append((f"{src_head}.{src_body}", f"{head}.{body}"))

    # --- Phase 1: Pre-filter — reject pairs not on CDN at all ---
    # Skip pairs we already have locally (they're definitely "active")
    needs_cdn_check: List[Tuple[str, str]] = []
    already_local: List[Tuple[str, str]] = []
    for task in pair_tasks:
        _, local_prefix = task
        if local_prefix in existing:
            already_local.append(task)
        else:
            needs_cdn_check.append(task)

    active_tasks: List[Tuple[str, str]] = list(already_local)

    if needs_cdn_check:
        print(f"  Phase 1: CDN-checking {len(needs_cdn_check)} pairs without local sprites...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            def check_cdn(task: Tuple[str, str]) -> Optional[Tuple[str, str]]:
                cdn_prefix, _ = task
                return task if _probe_cdn_exists(cdn_prefix) else None
            futures = {pool.submit(check_cdn, t): t for t in needs_cdn_check}
            done = 0
            for future in concurrent.futures.as_completed(futures):
                done += 1
                result = future.result()
                if result is not None:
                    active_tasks.append(result)
                if done % 2000 == 0:
                    print(f"    cdn-check: {done}/{len(needs_cdn_check)} done, {len(active_tasks)} total active")

    print(f"  Active pairs: {len(active_tasks)}/{len(pair_tasks)}")

    if not active_tasks:
        return []

    # --- Phase 2: Quick alt check — probe suffix "a" to find pairs with alts ---
    # Most pairs (~95%) only have the base variant. Check "a" to quickly filter.
    print(f"  Phase 2: Quick alt check ({len(active_tasks)} pairs, checking suffix 'a')...")

    def check_has_alts(task: Tuple[str, str]) -> Optional[Tuple[str, str]]:
        cdn_prefix, local_prefix = task
        local_a = f"{local_prefix}a"
        if local_a in existing:
            return task  # Already have "a" locally, might have more alts
        return task if _probe_cdn_exists(f"{cdn_prefix}a") else None

    pairs_with_alts: List[Tuple[str, str]] = []
    # Also collect direct "a" finds for pairs not already having them
    direct_finds: List[Tuple[str, Path]] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(check_has_alts, t): t for t in active_tasks}
        done = 0
        for future in concurrent.futures.as_completed(futures):
            done += 1
            result = future.result()
            if result is not None:
                pairs_with_alts.append(result)
            if done % 2000 == 0:
                print(f"    alt-check: {done}/{len(active_tasks)} done, {len(pairs_with_alts)} have alts")

    print(f"  Pairs with alt variants: {len(pairs_with_alts)}/{len(active_tasks)}")

    if not pairs_with_alts:
        return []

    # --- Phase 3: Full suffix probe on pairs confirmed to have alts ---
    print(f"  Phase 3: Full probe on {len(pairs_with_alts)} pairs with confirmed alts...")
    found_tasks: List[Tuple[str, Path, str]] = []

    def probe_pair(task: Tuple[str, str]) -> List[Tuple[str, Path, str]]:
        cdn_prefix, local_prefix = task
        return _probe_id_variants(cdn_prefix, local_prefix, existing, sprites_root)

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(probe_pair, t): t for t in pairs_with_alts}
        done = 0
        for future in concurrent.futures.as_completed(futures):
            done += 1
            found_tasks.extend(future.result())
            if done % 200 == 0:
                print(f"    probed {done}/{len(pairs_with_alts)} pairs, found {len(found_tasks)} new")

    print(f"  CDN probe found {len(found_tasks)} missing fusion variants")
    return found_tasks


def sync_from_api(
    sprites_root: Path,
    mapping: Dict[int, int],
    apply: bool,
    max_downloads: int,
    workers: int = DOWNLOAD_WORKERS,
    probe_workers: int = PROBE_WORKERS,
    skip_fusion_probe: bool = False,
) -> Tuple[int, int, int]:
    """Discover all sprites via the IF Dex API and download missing ones concurrently."""
    t0 = time.monotonic()
    print("Fetching sprite catalog from IF Dex API...")
    variants = fetch_all_sprite_variants(mapping, progress=True)
    print(f"Total sprite variants in catalog: {len(variants)}")

    # Build set of existing local stems
    existing: Set[str] = set()
    for d in iter_relevant_dirs(sprites_root, include_legacy_dirs=True):
        for p in iter_image_files(d):
            existing.add(p.stem)

    # --- Phase 1: Base sprites from API catalog (featured ones have exact alt lists) ---
    download_tasks: List[Tuple[str, Path, Optional[str]]] = []  # (cdn_stem, local_output_path, source_hint)
    for v in variants:
        local_stem = compute_local_stem(v, mapping)
        if local_stem in existing:
            continue
        cdn_stem = v.cdn_stem
        output_path = target_path_for_sprite_stem(sprites_root, local_stem)
        download_tasks.append((cdn_stem, output_path, None))

    print(f"Missing base sprites from API catalog: {len(download_tasks)}")

    # --- Phase 1b: Probe CDN for base sprite alt variants not covered by API ---
    # The API only has alt lists for ~50 featured pokemon. For the rest, probe CDN
    # for extensions "", "a", "b", ... with early termination per ID.
    api_featured_ids = {int(v.if_id) for v in variants if v.has_custom}
    base_probe_ids: List[Tuple[str, str]] = []  # (cdn_prefix, local_prefix)
    for if_id in sorted(mapping.keys()):
        if if_id in api_featured_ids:
            continue
        local_id = mapping[if_id]
        base_probe_ids.append((str(if_id), str(local_id)))

    if base_probe_ids:
        print(f"  Probing CDN for variants of {len(base_probe_ids)} non-featured base sprites (workers={probe_workers})...")

        def probe_base(task: Tuple[str, str]) -> List[Tuple[str, Path, str]]:
            cdn_prefix, local_prefix = task
            return _probe_id_variants(cdn_prefix, local_prefix, existing, sprites_root)

        with concurrent.futures.ThreadPoolExecutor(max_workers=probe_workers) as pool:
            futures = {pool.submit(probe_base, t): t for t in base_probe_ids}
            done = 0
            for future in concurrent.futures.as_completed(futures):
                done += 1
                download_tasks.extend(future.result())
                if done % 100 == 0:
                    print(f"    probed {done}/{len(base_probe_ids)} base IDs, {len(download_tasks)} total found")

        print(f"  After base CDN probe: {len(download_tasks)} total missing")

    # --- Phase 2: Fusion variants via CDN probing ---
    if not skip_fusion_probe:
        fusion_tasks = discover_fusion_variants_from_cdn(
            sprites_root, mapping, existing, workers=probe_workers,
        )
        download_tasks.extend(fusion_tasks)
    else:
        print("  Skipping fusion CDN probe (--skip-fusion-probe)")
    print(f"Total sprites to download: {len(download_tasks)}")

    if max_downloads > 0:
        download_tasks = download_tasks[:max_downloads]

    if not download_tasks:
        return 0, 0, 0

    planned = 0
    applied_count = 0
    misses = 0

    def do_download(task: Tuple[str, Path, Optional[str]]) -> Optional[DownloadResult]:
        cdn_stem, out_path, source_hint = task
        return _download_one(cdn_stem, out_path, apply, source_hint=source_hint)

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(do_download, t): t for t in download_tasks}
        done = 0
        for future in concurrent.futures.as_completed(futures):
            done += 1
            result = future.result()
            if result is not None:
                planned += 1
                if apply:
                    applied_count += 1
            else:
                misses += 1
            if done % 200 == 0:
                print(f"  progress: {done}/{len(download_tasks)} checked, {planned} found, {misses} misses")

    elapsed = time.monotonic() - t0
    print(f"  done: {planned} found, {applied_count} downloaded, {misses} not on CDN ({elapsed:.1f}s total)")
    return planned, applied_count, misses


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


def write_remap_state(path: Path, payload: dict) -> None:
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
        "--force-remap",
        action="store_true",
        help="Force remap even if the sprite folder already has a remap-complete marker",
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
        help="nat: sync missing base sprites into Other/BaseSprites; all: also probe fusion/custom/generated assets",
    )
    p.add_argument(
        "--canonical-only",
        action="store_true",
        help="Restrict sync work to Other/BaseSprites, Other/Triples, and CustomBattlers",
    )
    p.add_argument(
        "--report",
        default="output/ifdex-sync-report.json",
        help="Path for JSON summary report",
    )
    p.add_argument(
        "--mapping-source",
        choices=["markdown", "api"],
        default="markdown",
        help="Source for IF->national mapping (default: markdown dex files)",
    )
    p.add_argument(
        "--ifdex-md",
        default="infinite fusion dex.md",
        help="Path to Infinite Fusion dex markdown relative to workspace root",
    )
    p.add_argument(
        "--national-dex-md",
        default="national dex.md",
        help="Path to National dex markdown relative to workspace root",
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
        help="Comma-separated source IF dex base sprite IDs to force-refresh into Other/BaseSprites (e.g. 361,362,428,428a-i)",
    )
    p.add_argument(
        "--discover-api",
        action="store_true",
        help="Use the IF Dex filter API to discover ALL available sprites and download missing ones (replaces --download-missing)",
    )
    p.add_argument(
        "--download-workers",
        type=int,
        default=DOWNLOAD_WORKERS,
        help=f"Number of concurrent download threads (default: {DOWNLOAD_WORKERS})",
    )
    p.add_argument(
        "--probe-workers",
        type=int,
        default=PROBE_WORKERS,
        help=f"Number of concurrent CDN probe threads (default: {PROBE_WORKERS})",
    )
    p.add_argument(
        "--skip-fusion-probe",
        action="store_true",
        help="Skip slow CDN probing for fusion sprite variants (only discover base sprites via API + CDN)",
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
        if args.mapping_source == "markdown":
            ifdex_md = (workspace_root / args.ifdex_md).resolve()
            national_md = (workspace_root / args.national_dex_md).resolve()
            mapping = build_mapping_from_markdown(ifdex_md, national_md)
        else:
            dropdown = fetch_dropdown_data()
            mapping = extract_id_mapping(dropdown)
    except Exception as exc:
        print(f"ERROR: failed to build mapping: {exc}", file=sys.stderr)
        return 3

    renames: List[RenameAction] = []
    renames_applied = 0
    rename_conflicts = 0
    rename_skipped = 0
    include_legacy_dirs = not args.canonical_only
    remap_state_path = sprites_root / REMAP_STATE_FILE
    remap_state_present = remap_state_path.exists() and not args.force_remap

    if not args.skip_remap and not remap_state_present:
        renames = plan_renames(sprites_root, mapping, include_legacy_dirs=include_legacy_dirs)
        renames_applied, rename_conflicts, rename_skipped = apply_renames(renames, args.apply)

    downloads_planned = 0
    downloads_applied = 0
    download_misses = 0
    if args.discover_api:
        downloads_planned, downloads_applied, download_misses = sync_from_api(
            sprites_root=sprites_root,
            mapping=mapping,
            apply=args.apply,
            max_downloads=args.max_downloads,
            workers=args.download_workers,
            probe_workers=args.probe_workers,
            skip_fusion_probe=args.skip_fusion_probe,
        )
    elif args.download_missing:
        downloads_planned, downloads_applied, download_misses = sync_missing_downloads(
            sprites_root=sprites_root,
            mapping=mapping,
            apply=args.apply,
            max_downloads=args.max_downloads,
            scope=args.download_scope,
            include_legacy_dirs=include_legacy_dirs,
        )

    refresh_ids = [s.strip() for s in str(args.refresh_base_ids or "").split(",") if s.strip()]
    refresh_planned = 0
    refresh_applied = 0
    refresh_misses = 0
    if refresh_ids:
        refresh_planned, refresh_applied, refresh_misses = refresh_base_sprite_ids(
            sprites_root=sprites_root,
            sprite_ids=refresh_ids,
            mapping=mapping,
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

    if args.apply and not args.skip_remap and rename_conflicts == 0:
        write_remap_state(
            remap_state_path,
            {
                "mappingSource": args.mapping_source,
                "mappingCount": len(mapping),
                "canonicalOnly": args.canonical_only,
                "renamesApplied": renames_applied,
                "report": str(report_path),
            },
        )

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] mapping source: {args.mapping_source}")
    print(f"[{mode}] mapping rows: {report.mapping_count}")
    if remap_state_present:
        print(f"[{mode}] remap skipped: existing marker at {remap_state_path}")
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
