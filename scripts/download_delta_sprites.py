#!/usr/bin/env python3
"""
Import Insurgence sprites from the Insurgence wiki.

What this script fetches:
- Delta Pokemon sprites
- Insurgence Mega Pokemon sprites
- Custom Insurgence item sprites (Mega stones, Z crystals, etc.)

Targets are discovered from:
- data/insurgence/generated/pokedex.insurgence.json
- data/insurgence/generated/items.custom.insurgence.json

Outputs:
- app/public/vendor/showdown/sprites/gen5/*.png
- tauri-app/public/vendor/showdown/sprites/gen5/*.png
- app/public/vendor/showdown/sprites/insurgence-items/*.png
- tauri-app/public/vendor/showdown/sprites/insurgence-items/*.png
- data/insurgence/generated/sprite-import-report.json
"""

import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
POKEDEX_PATH = REPO_ROOT / "data" / "insurgence" / "generated" / "pokedex.insurgence.json"
ITEMS_PATH = REPO_ROOT / "data" / "insurgence" / "generated" / "items.custom.insurgence.json"
REPORT_PATH = REPO_ROOT / "data" / "insurgence" / "generated" / "sprite-import-report.json"

POKEMON_OUT_DIRS = [
    REPO_ROOT / "app" / "public" / "vendor" / "showdown" / "sprites" / "gen5",
    REPO_ROOT / "tauri-app" / "public" / "vendor" / "showdown" / "sprites" / "gen5",
]

ITEM_OUT_DIRS = [
    REPO_ROOT / "app" / "public" / "vendor" / "showdown" / "sprites" / "insurgence-items",
    REPO_ROOT / "tauri-app" / "public" / "vendor" / "showdown" / "sprites" / "insurgence-items",
]

API_URL = "https://wiki.p-insurgence.com/api.php"
USER_AGENT = "PokeTTRPG-InsurgenceSpriteImporter/1.0"
ALL_IMAGE_CACHE: Optional[List[str]] = None


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


def api_get_json(params: Dict[str, str], timeout: int = 20) -> Optional[dict]:
    query = urllib.parse.urlencode(params)
    url = f"{API_URL}?{query}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            return json.loads(resp.read().decode("utf-8", errors="ignore"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError):
        return None


def parse_page_images(page_title: str) -> List[str]:
    data = api_get_json(
        {
            "action": "parse",
            "page": page_title,
            "prop": "images",
            "format": "json",
            "formatversion": "2",
        }
    )
    if not data:
        return []
    parse = data.get("parse") or {}
    images = parse.get("images") or []
    return [img for img in images if isinstance(img, str)]


def file_image_url(file_title: str) -> Optional[str]:
    title = file_title if file_title.startswith("File:") else f"File:{file_title}"
    data = api_get_json(
        {
            "action": "query",
            "titles": title,
            "prop": "imageinfo",
            "iiprop": "url",
            "format": "json",
            "formatversion": "2",
        }
    )
    if not data:
        return None
    pages = ((data.get("query") or {}).get("pages") or [])
    if not pages:
        return None
    imageinfo = pages[0].get("imageinfo") or []
    if not imageinfo:
        return None
    return imageinfo[0].get("url")


def resolve_direct_file_candidates(file_titles: List[str]) -> Optional[Tuple[str, str]]:
    for title in file_titles:
        clean = title.strip()
        if not clean:
            continue
        if not re.search(r"\.(png|gif|webp)$", clean, flags=re.IGNORECASE):
            clean = f"{clean}.png"
        url = file_image_url(clean)
        if url:
            return clean, url
    return None


def load_all_image_titles() -> List[str]:
    global ALL_IMAGE_CACHE
    if ALL_IMAGE_CACHE is not None:
        return ALL_IMAGE_CACHE

    titles: List[str] = []
    cont: Dict[str, str] = {}
    while True:
        params = {
            "action": "query",
            "list": "allimages",
            "ailimit": "500",
            "format": "json",
            "formatversion": "2",
        }
        params.update(cont)
        data = api_get_json(params, timeout=30)
        if not data:
            break
        chunk = ((data.get("query") or {}).get("allimages") or [])
        for img in chunk:
            name = img.get("name")
            if isinstance(name, str):
                titles.append(name)
        cont_next = data.get("continue") or {}
        if not cont_next:
            break
        cont = {k: str(v) for k, v in cont_next.items()}
        time.sleep(0.05)

    ALL_IMAGE_CACHE = titles
    return titles


def find_best_from_image_catalog(display_name: str, entry: dict, all_titles: List[str]) -> Optional[str]:
    base_species = str(entry.get("baseSpecies") or "").strip()
    is_delta = "delta" in display_name.lower() or "delta" in base_species.lower()

    target_bits = [normalize_name(display_name), normalize_name(base_species)]
    target_bits = [b for b in target_bits if b]

    best_title: Optional[str] = None
    best_score = -999

    for title in all_titles:
        lower = title.lower()
        if not lower.endswith(".png"):
            continue
        norm = normalize_name(title)

        score = 0
        if "mega" in norm:
            score += 4
        if is_delta and "delta" in norm:
            score += 4

        for bit in target_bits:
            if bit and bit in norm:
                score += 6

        if base_species:
            base_no_delta = normalize_name(re.sub(r"^Delta\s+", "", base_species, flags=re.IGNORECASE))
            if base_no_delta and base_no_delta in norm:
                score += 3

        if any(noise in lower for noise in ["icon", "type", "bag", "tm", "badge", "trainer", "menu"]):
            score -= 8

        if score > best_score:
            best_score = score
            best_title = title

    if best_score < 8:
        return None
    return best_title


def score_file_for_entity(file_title: str, display_name: str, is_mega: bool, is_item: bool) -> int:
    lower = file_title.lower()
    stem = lower.rsplit(".", 1)[0]
    norm_stem = normalize_name(stem)
    norm_name = normalize_name(display_name)

    score = 0
    if lower.endswith(".png"):
        score += 3
    elif lower.endswith(".gif") or lower.endswith(".webp"):
        score += 1

    if norm_name and norm_name in norm_stem:
        score += 8

    if "delta" in norm_name and "delta" in norm_stem:
        score += 4
    if is_mega and ("mega" in norm_stem or "meg" in norm_stem):
        score += 3

    noisy_tokens = ["type", "icon", "bag", "tm", "badge", "menu", "map", "trainer", "spritebox"]
    if any(tok in lower for tok in noisy_tokens):
        score -= 5

    if is_item:
        if "stone" in lower or "ite" in lower or "crystal" in lower or "z" in lower:
            score += 2
    else:
        if "front" in lower:
            score += 2
        if "back" in lower:
            score -= 1

    return score


def pick_best_image(images: List[str], display_name: str, is_mega: bool, is_item: bool) -> Optional[str]:
    if not images:
        return None
    ranked: List[Tuple[int, str]] = []
    for img in images:
        ranked.append((score_file_for_entity(img, display_name, is_mega, is_item), img))
    ranked.sort(key=lambda pair: pair[0], reverse=True)
    best_score, best_image = ranked[0]
    if best_score < 2:
        return None
    return best_image


def page_title_candidates(display_name: str, is_item: bool) -> List[str]:
    if is_item:
        return [
            display_name,
            f"{display_name} (item)",
            f"{display_name} (Item)",
            "Mega Stone",
        ]

    return [
        f"{display_name} (Pokémon)",
        f"{display_name} (Pokemon)",
        display_name,
    ]


def download_binary(url: str, timeout: int = 25) -> Optional[bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            data = resp.read()
            if len(data) < 128:
                return None
            return data
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
        return None


def write_to_all(out_dirs: List[Path], file_name: str, data: bytes) -> None:
    for out_dir in out_dirs:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / file_name).write_bytes(data)


def try_base_sprite_fallback(out_name: str, display_name: str, entry: dict) -> Optional[str]:
    primary_dir = POKEMON_OUT_DIRS[0]
    base_species = str(entry.get("baseSpecies") or "").strip()

    candidates: List[str] = []
    if base_species:
        candidates.append(normalize_name(base_species))

    cleaned_name = display_name.replace("-Mega", "").replace("(Mega)", "").replace("(Crystal)", "")
    cleaned_name = re.sub(r"\s+", " ", cleaned_name).strip()
    if cleaned_name:
        candidates.append(normalize_name(cleaned_name))

    if "-" in display_name:
        candidates.append(normalize_name(display_name.split("-", 1)[0]))

    # Preserve order + dedupe
    seen = set()
    ordered: List[str] = []
    for c in candidates:
        if c and c not in seen:
            seen.add(c)
            ordered.append(c)

    for cand in ordered:
        src = primary_dir / f"{cand}.png"
        if src.exists():
            data = src.read_bytes()
            write_to_all(POKEMON_OUT_DIRS, out_name, data)
            return f"{cand}.png"

    return None


def resolve_image_for_entity(display_name: str, is_mega: bool, is_item: bool) -> Optional[Tuple[str, str]]:
    for page_title in page_title_candidates(display_name, is_item=is_item):
        images = parse_page_images(page_title)
        if not images:
            continue
        best = pick_best_image(images, display_name, is_mega=is_mega, is_item=is_item)
        if not best:
            continue
        url = file_image_url(best)
        if url:
            return best, url
        time.sleep(0.1)
    return None


def mega_file_title_candidates(display_name: str, entry: dict) -> List[str]:
    candidates: List[str] = []
    base_species = str(entry.get("baseSpecies") or "").strip()
    name = display_name.strip()

    compact = name.replace("-Mega", "").replace("(Mega)", "").strip()
    compact = re.sub(r"\s+", " ", compact)

    if name:
        candidates.append(name)
    if compact:
        candidates.append(f"Mega {compact}")
        candidates.append(f"{compact} Mega")
    if base_species:
        candidates.append(f"Mega {base_species}")
        candidates.append(f"{base_species} Mega")

        if "delta" in base_species.lower() and not base_species.lower().startswith("mega"):
            base_no_delta = re.sub(r"^Delta\s+", "", base_species, flags=re.IGNORECASE)
            candidates.append(f"Mega Delta {base_no_delta}")
            candidates.append(f"Delta {base_no_delta} Mega")

    expanded: List[str] = []
    for cand in candidates:
        expanded.append(cand)
        expanded.append(cand.replace(" (", " ").replace(")", ""))
        expanded.append(cand.replace("-", " "))

    out: List[str] = []
    seen = set()
    for cand in expanded:
        key = cand.strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(cand.strip())
    return out


def is_pokemon_target(key: str, entry: dict) -> bool:
    name = str(entry.get("name", ""))
    forme = str(entry.get("forme", ""))
    if "delta" in key.lower() or "delta" in name.lower():
        return True
    if forme.lower() == "mega":
        return True
    if "(mega" in name.lower() or " mega" in name.lower():
        return True
    return False


def main() -> int:
    if not POKEDEX_PATH.exists():
        print(f"ERROR: missing {POKEDEX_PATH}")
        return 1
    if not ITEMS_PATH.exists():
        print(f"ERROR: missing {ITEMS_PATH}")
        return 1

    with open(POKEDEX_PATH, "r", encoding="utf-8") as f:
        pokedex = json.load(f)
    with open(ITEMS_PATH, "r", encoding="utf-8") as f:
        items = json.load(f)

    pokemon_targets: List[Tuple[str, dict]] = [
        (k, v) for (k, v) in pokedex.items() if isinstance(v, dict) and is_pokemon_target(k, v)
    ]
    item_targets: List[Tuple[str, dict]] = [
        (k, v)
        for (k, v) in items.items()
        if isinstance(v, dict)
        and (
            bool(v.get("megaStone"))
            or "ite" in k.lower()
            or "z" in k.lower()
            or "crystal" in k.lower()
        )
    ]

    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pokemon": {"ok": [], "failed": []},
        "items": {"ok": [], "failed": []},
    }

    print(f"Pokemon targets: {len(pokemon_targets)}")
    print(f"Item targets: {len(item_targets)}")

    all_titles: Optional[List[str]] = None

    for idx, (key, entry) in enumerate(pokemon_targets, start=1):
        display_name = str(entry.get("name") or key)
        is_mega = str(entry.get("forme", "")).lower() == "mega" or "mega" in display_name.lower()
        sprite_id = normalize_name(key)
        out_name = f"{sprite_id}.png"

        if all((out_dir / out_name).exists() for out_dir in POKEMON_OUT_DIRS):
            report["pokemon"]["ok"].append({"key": key, "name": display_name, "image": "existing", "output": out_name})
            print(f"[{idx}/{len(pokemon_targets)}] SKIP pokemon {display_name} (exists)")
            continue

        resolved = resolve_image_for_entity(display_name, is_mega=is_mega, is_item=False)
        if not resolved and is_mega:
            resolved = resolve_direct_file_candidates(mega_file_title_candidates(display_name, entry))
        if not resolved and is_mega:
            if all_titles is None:
                print("Loading wiki image catalog for mega fallback...")
                all_titles = load_all_image_titles()
                print(f"Loaded {len(all_titles)} image titles from wiki")
            if all_titles:
                catalog_title = find_best_from_image_catalog(display_name, entry, all_titles)
                if catalog_title:
                    url = file_image_url(catalog_title)
                    if url:
                        resolved = (catalog_title, url)
        if not resolved:
            fallback_source = try_base_sprite_fallback(out_name, display_name, entry)
            if fallback_source:
                report["pokemon"]["ok"].append(
                    {
                        "key": key,
                        "name": display_name,
                        "image": f"fallback:{fallback_source}",
                        "output": out_name,
                    }
                )
                print(f"[{idx}/{len(pokemon_targets)}] FALLBACK pokemon {display_name} -> {out_name} (from {fallback_source})")
                time.sleep(0.08)
                continue
            report["pokemon"]["failed"].append({"key": key, "name": display_name, "reason": "no_image"})
            print(f"[{idx}/{len(pokemon_targets)}] FAIL pokemon {display_name}")
            time.sleep(0.08)
            continue

        file_title, image_url = resolved
        data = download_binary(image_url)
        if not data:
            report["pokemon"]["failed"].append({"key": key, "name": display_name, "reason": "download_failed", "image": file_title})
            print(f"[{idx}/{len(pokemon_targets)}] FAIL download {display_name} ({file_title})")
            time.sleep(0.08)
            continue

        write_to_all(POKEMON_OUT_DIRS, out_name, data)
        report["pokemon"]["ok"].append({"key": key, "name": display_name, "image": file_title, "output": out_name})
        print(f"[{idx}/{len(pokemon_targets)}] OK pokemon {display_name} -> {out_name}")
        time.sleep(0.08)

    for idx, (key, entry) in enumerate(item_targets, start=1):
        display_name = str(entry.get("name") or key)
        item_id = normalize_name(key)
        out_name = f"{item_id}.png"

        if all((out_dir / out_name).exists() for out_dir in ITEM_OUT_DIRS):
            report["items"]["ok"].append({"key": key, "name": display_name, "image": "existing", "output": out_name})
            print(f"[{idx}/{len(item_targets)}] SKIP item {display_name} (exists)")
            continue

        resolved = resolve_image_for_entity(display_name, is_mega=False, is_item=True)
        if not resolved:
            report["items"]["failed"].append({"key": key, "name": display_name, "reason": "no_image"})
            print(f"[{idx}/{len(item_targets)}] FAIL item {display_name}")
            time.sleep(0.08)
            continue

        file_title, image_url = resolved
        data = download_binary(image_url)
        if not data:
            report["items"]["failed"].append({"key": key, "name": display_name, "reason": "download_failed", "image": file_title})
            print(f"[{idx}/{len(item_targets)}] FAIL download item {display_name} ({file_title})")
            time.sleep(0.08)
            continue

        write_to_all(ITEM_OUT_DIRS, out_name, data)
        report["items"]["ok"].append({"key": key, "name": display_name, "image": file_title, "output": out_name})
        print(f"[{idx}/{len(item_targets)}] OK item {display_name} -> {out_name}")
        time.sleep(0.08)

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print("\nImport complete.")
    print(f"Pokemon OK: {len(report['pokemon']['ok'])} | failed: {len(report['pokemon']['failed'])}")
    print(f"Items   OK: {len(report['items']['ok'])} | failed: {len(report['items']['failed'])}")
    print(f"Report: {REPORT_PATH}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
