"""
Import Pokemon Sage data from the CAPX fandom wiki and merge it into Tauri data files.

What this script does:
- Pulls the Sage Pokedex index (229 species)
- Fetches each species page wikitext
- Extracts species, stats, abilities, learnsets, held items, and artwork file names
- Generates missing custom moves/abilities/items (stubs for unknown entries)
- Optionally applies merged data into:
  - tauri-app/public/vendor/showdown/data/{pokedex,moves,abilities,items,learnsets}.json
- Optionally downloads one sprite per species into:
  - tauri-app/public/vendor/showdown/sprites/gen5/<speciesid>.png
- Optionally writes backend runtime override files:
  - pokemonttrpg-backend/data/pokedex.ts
  - pokemonttrpg-backend/data/moves.ts

Usage examples:
  python scripts/import_sage_fandom.py --apply --download-sprites --backend-overrides
  python scripts/import_sage_fandom.py --limit 25
"""

from __future__ import annotations

import argparse
import json
import re
import time
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None


BASE_URL = "https://capx.fandom.com/wiki/Pok%C3%A9dex"
API_URL = "https://capx.fandom.com/api.php"
HEADERS = {"User-Agent": "pokettrpg-sage-import/1.0"}

PROJECT_DIR = Path(__file__).resolve().parents[1]
OUT_RAW = PROJECT_DIR / "data" / "sage" / "raw"
OUT_PAGES = OUT_RAW / "pages"
OUT_GEN = PROJECT_DIR / "data" / "sage" / "generated"
TAURI_DATA = PROJECT_DIR / "tauri-app" / "public" / "vendor" / "showdown" / "data"
TAURI_GEN5 = PROJECT_DIR / "tauri-app" / "public" / "vendor" / "showdown" / "sprites" / "gen5"
BACKEND_DATA = PROJECT_DIR / "pokemonttrpg-backend" / "data"


session = requests.Session()
session.headers.update(HEADERS)


@dataclass
class SpeciesParse:
    species_id: str
    species: dict[str, Any]
    learnset: dict[str, Any]
    move_defs: dict[str, dict[str, Any]]
    abilities: set[str]
    items: set[str]
    image_file: str
    evo_links: list[dict[str, Any]]


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def normalize_id(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def parse_int(value: str, default: int = 0) -> int:
    if value is None:
        return default
    text = str(value).replace(",", "").strip()
    m = re.search(r"-?\d+", text)
    return int(m.group(0)) if m else default


def parse_power(value: str) -> int:
    text = clean(value).replace("&mdash;", "").replace("—", "")
    if not text or text.lower() == "varies":
        return 0
    return parse_int(text, 0)


def parse_accuracy(value: str) -> int | bool:
    text = clean(value).replace("&mdash;", "").replace("—", "")
    if not text:
        return True
    if text.lower() == "varies":
        return True
    m = re.search(r"\d+", text)
    return int(m.group(0)) if m else True


def parse_pp(value: str) -> int:
    return max(1, parse_int(value, 5))


def strip_wiki_markup(text: str) -> str:
    out = text or ""
    out = re.sub(r"<br\s*/?>", " ", out, flags=re.IGNORECASE)
    out = re.sub(r"<[^>]+>", "", out)
    out = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", out)
    out = re.sub(r"\[\[([^\]]+)\]\]", r"\1", out)
    out = re.sub(r"\{\{[^{}]*\}\}", "", out)
    out = out.replace("&mdash;", "").replace("—", "")
    return clean(out)


def extract_image_filename(raw_value: str) -> str:
    raw = (raw_value or "").strip()
    if not raw:
        return ""
    plain = strip_wiki_markup(raw)
    if re.search(r"\.(png|jpg|jpeg|webp|gif)$", plain, flags=re.IGNORECASE):
        return plain
    m = re.search(r"([A-Za-z0-9 _-]+\.(?:png|jpg|jpeg|webp|gif))", raw, flags=re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return plain


def get_page_wikitext(page_title: str) -> str:
    params = {
        "action": "parse",
        "page": page_title,
        "prop": "wikitext",
        "format": "json",
        "formatversion": "2",
    }
    res = session.get(API_URL, params=params, timeout=45)
    res.raise_for_status()
    payload = res.json()
    return payload.get("parse", {}).get("wikitext", "")


def extract_template_block(wikitext: str, template_name: str) -> str:
    needle = "{{" + template_name.lower()
    source = wikitext
    idx = source.lower().find(needle)
    if idx < 0:
        return ""

    i = idx
    depth = 0
    n = len(source)
    while i < n - 1:
        pair = source[i : i + 2]
        if pair == "{{":
            depth += 1
            i += 2
            continue
        if pair == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return source[idx:i]
            continue
        i += 1
    return ""


def parse_template_kv(block: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in block.splitlines():
        line = line.rstrip()
        if not line.lstrip().startswith("|"):
            continue
        body = line.lstrip()[1:]
        if "=" not in body:
            continue
        key, value = body.split("=", 1)
        out[clean(key).lower()] = clean(value)
    return out


def extract_section(wikitext: str, heading: str) -> str:
    m = re.search(rf"==\s*{re.escape(heading)}\s*==(.+?)(?:\n==[^=]|\Z)", wikitext, flags=re.IGNORECASE | re.DOTALL)
    return m.group(1) if m else ""


def clean_evo_text(raw: str) -> str:
    text = raw or ""
    text = text.replace(" > ", " greater than ").replace(" < ", " less than ").replace(" = ", " equal to ")
    text = re.sub(r"\{\{item\|([^}|]+)[^}]*\}\}", r"\1", text, flags=re.IGNORECASE)
    text = re.sub(r"\{\{m\|([^}|]+)[^}]*\}\}", r"\1", text, flags=re.IGNORECASE)
    text = re.sub(r"\{\{color\|[^|}]*\|([^}]+)\}\}", r"\1", text, flags=re.IGNORECASE)
    text = strip_wiki_markup(text)
    text = text.replace("  ", " ").strip()
    return clean(text)


def parse_evo_meta(raw_text: str) -> dict[str, Any]:
    txt = clean_evo_text(raw_text)
    low = txt.lower()
    meta: dict[str, Any] = {}

    level = parse_int(txt, 0)
    move_match = re.search(r"(?:while\s+)?knowing\s+([A-Za-z0-9'\- ]+)", txt, flags=re.IGNORECASE)
    trade = "trade" in low
    use_item = bool(re.search(r"\b(use|using)\b", low))

    if move_match:
        meta["evoType"] = "levelMove"
        meta["evoMove"] = clean(move_match.group(1))
        if level > 0:
            meta["evoLevel"] = level
    elif trade:
        meta["evoType"] = "trade"
    elif use_item:
        meta["evoType"] = "useItem"
    elif level > 0 or "level" in low:
        if level > 0:
            meta["evoLevel"] = level
        meta["evoType"] = "levelExtra"

    cond_chunks: list[str] = []
    for pat in [r"\(([^)]*(?:atk|attack|defense|def)[^)]*)\)", r"\(([^)]*(?:day|night|rain|sun|snow|friendship|happiness)[^)]*)\)"]:
        m = re.search(pat, txt, flags=re.IGNORECASE)
        if m:
            cond_chunks.append(clean(m.group(1)))
    if "while knowing" in low:
        cond_chunks.append("while knowing a specific move")
    if cond_chunks:
        meta["evoCondition"] = "; ".join(dict.fromkeys(cond_chunks))

    return meta


def parse_evolution_links(species_name: str, wikitext: str) -> tuple[list[str], list[dict[str, Any]]]:
    evos: list[str] = []
    links: list[dict[str, Any]] = []

    # Prose form: "It evolves into [[X]] ..."
    prose_re = re.compile(r"evolves?\s+(?:starting\s+at\s+)?(?:level\s*\d+\s+)?into\s+([^\n.]+)", flags=re.IGNORECASE)
    for m in prose_re.finditer(wikitext):
        phrase = m.group(1)
        names = re.findall(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]", phrase)
        sentence = m.group(0)
        if not names:
            continue
        meta = parse_evo_meta(sentence)
        for raw_name in names:
            evo_name = strip_wiki_markup(raw_name)
            if not evo_name:
                continue
            if evo_name not in evos:
                evos.append(evo_name)
            links.append({"source": species_name, "target": evo_name, **meta})

    # Evolution section / Evobox form with branch-specific conditions
    evo_section = extract_section(wikitext, "Evolution")
    if evo_section:
        kv: dict[str, str] = {}
        for line in evo_section.splitlines():
            line = line.strip()
            if not line.startswith("|") or "=" not in line:
                continue
            k, v = line[1:].split("=", 1)
            kv[clean(k).lower()] = clean(v)

        base_name = strip_wiki_markup(kv.get("name1", ""))
        if base_name and normalize_id(base_name) != normalize_id(species_name):
            kv = {}

        for key, target_raw in kv.items():
            if not key.startswith("name2"):
                continue
            target_name = strip_wiki_markup(target_raw)
            if not target_name:
                continue
            if target_name not in evos:
                evos.append(target_name)
            suffix = key[len("name2"):]
            evo_raw = kv.get(f"evo1{suffix}") or kv.get(f"evo{suffix}") or ""
            meta = parse_evo_meta(evo_raw)
            links.append({"source": species_name, "target": target_name, **meta})

    # Deduplicate links by (source,target)
    dedup: dict[tuple[str, str], dict[str, Any]] = {}
    for link in links:
        pair = (normalize_id(link.get("source", "")), normalize_id(link.get("target", "")))
        if not all(pair):
            continue
        cur = dict(dedup.get(pair, {}))
        cur.update({k: v for k, v in link.items() if v not in (None, "")})
        dedup[pair] = cur

    return evos, list(dedup.values())


def parse_index(wikitext: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    pattern = re.compile(r"\{\{DexListEntry\|([^}]+)\}\}", flags=re.IGNORECASE)
    for m in pattern.finditer(wikitext):
        parts = [clean(p) for p in m.group(1).split("|") if clean(p)]
        if len(parts) < 3:
            continue
        dex_text, name = parts[0], parts[1]
        num_match = re.search(r"(\d{1,3})", dex_text)
        if not num_match:
            continue
        dex_num = int(num_match.group(1))
        types = parts[2:4]
        detail_url = f"https://capx.fandom.com/wiki/{quote(name.replace(' ', '_'))}"
        rows.append(
            {
                "dex": dex_num,
                "name": name,
                "types": types,
                "detailUrl": detail_url,
            }
        )
    dedup: dict[tuple[int, str], dict[str, Any]] = {}
    for row in rows:
        dedup[(row["dex"], row["name"].lower())] = row
    return sorted(dedup.values(), key=lambda r: (r["dex"], r["name"]))


def add_learnset_source(learnset: dict[str, list[str]], move_id: str, source: str) -> None:
    if not move_id:
        return
    bucket = learnset.setdefault(move_id, [])
    if source not in bucket:
        bucket.append(source)


def build_move_entry(
    move_name: str,
    move_type: str,
    category: str,
    power: str,
    accuracy: str,
    pp: str,
) -> tuple[str, dict[str, Any]]:
    name = strip_wiki_markup(move_name)
    move_id = normalize_id(name)
    entry = {
        "name": name,
        "type": strip_wiki_markup(move_type) or "Normal",
        "category": strip_wiki_markup(category) or "Status",
        "basePower": parse_power(power),
        "accuracy": parse_accuracy(accuracy),
        "pp": parse_pp(pp),
        "priority": 0,
        "flags": {"protect": 1, "mirror": 1, "metronome": 1},
        "secondary": None,
        "target": "normal",
        "shortDesc": "Pokemon Sage custom move.",
        "isNonstandard": "Custom",
    }
    return move_id, entry


def parse_species_page(entry: dict[str, Any], wikitext: str, dex_offset: int) -> SpeciesParse:
    name = clean(entry.get("name", ""))
    index_dex = int(entry.get("dex") or 0)
    species_id = normalize_id(name)

    info = parse_template_kv(extract_template_block(wikitext, "Pokemon Infobox"))
    stats = parse_template_kv(extract_template_block(wikitext, "Stats"))

    type1 = strip_wiki_markup(info.get("type1", "")) or (entry.get("types") or ["Normal"])[0]
    type2 = strip_wiki_markup(info.get("type2", ""))
    types = [t for t in [type1, type2] if t]
    if not types:
        types = ["Normal"]

    ability1 = strip_wiki_markup(info.get("ability1", ""))
    ability2 = strip_wiki_markup(info.get("ability2", ""))
    hidden = strip_wiki_markup(info.get("hiddenability", ""))
    abilities_obj: dict[str, str] = {}
    ability_names: list[str] = []
    for idx, abil in enumerate([ability1, ability2]):
        if abil:
            abilities_obj[str(idx)] = abil
            ability_names.append(abil)
    if hidden:
        abilities_obj["H"] = hidden
        ability_names.append(hidden)

    hp = parse_int(stats.get("hp", "0"))
    atk = parse_int(stats.get("attack", "0"))
    defe = parse_int(stats.get("defense", "0"))
    spa = parse_int(stats.get("spatk", "0"))
    spd = parse_int(stats.get("spdef", "0"))
    spe = parse_int(stats.get("speed", "0"))
    if min(hp, atk, defe, spa, spd, spe) <= 0:
        raise ValueError(f"{name}: missing base stats in page")

    species: dict[str, Any] = {
        "num": dex_offset + index_dex,
        "name": name,
        "types": types,
        "baseStats": {"hp": hp, "atk": atk, "def": defe, "spa": spa, "spd": spd, "spe": spe},
        "abilities": abilities_obj or {"0": "No Ability"},
        "heightm": float(info.get("height-m", "0") or 0),
        "weightkg": float(info.get("weight-kg", "0") or 0),
        "color": strip_wiki_markup(info.get("color", "")) or "Gray",
        "gen": 9,
        "tier": "Illegal",
        "isNonstandard": "Custom",
    }

    egg1 = strip_wiki_markup(info.get("egggroup1", ""))
    egg2 = strip_wiki_markup(info.get("egggroup2", ""))
    egg_groups = [g for g in [egg1, egg2] if g]
    if egg_groups:
        species["eggGroups"] = egg_groups

    evos, evo_links = parse_evolution_links(name, wikitext)
    if evos:
        species["evos"] = evos

    learnset: dict[str, list[str]] = {}
    move_defs: dict[str, dict[str, Any]] = {}

    level_re = re.compile(
        r"\{\{MoveLevel\|([^|{}]+)\|([^|{}]+)\|([^|{}]+)\|(Physical|Special|Status)\|([^|{}]+)\|([^|{}]+)\|([^|{}]+)",
        flags=re.IGNORECASE,
    )
    for m in level_re.finditer(wikitext):
        lvl, move, mtype, cat, power, acc, pp = m.groups()
        move_id, move_entry = build_move_entry(move, mtype, cat, power, acc, pp)
        if move_id:
            move_defs.setdefault(move_id, move_entry)
            level_num = parse_int(lvl, 1) if lvl.strip().lower() != "start" else 1
            add_learnset_source(learnset, move_id, f"9L{max(1, level_num)}")

    tm_re = re.compile(
        r"\{\{MoveTM\|[^|{}]+\|([^|{}]+)\|([^|{}]+)\|(Physical|Special|Status)\|([^|{}]+)\|([^|{}]+)\|([^|{}]+)",
        flags=re.IGNORECASE,
    )
    for m in tm_re.finditer(wikitext):
        move, mtype, cat, power, acc, pp = m.groups()
        move_id, move_entry = build_move_entry(move, mtype, cat, power, acc, pp)
        if move_id:
            move_defs.setdefault(move_id, move_entry)
            add_learnset_source(learnset, move_id, "9M")

    tutor_re = re.compile(
        r"\{\{MoveTutor\|([^|{}]+)\|([^|{}]+)\|(Physical|Special|Status)\|([^|{}]+)\|([^|{}]+)\|([^|{}]+)",
        flags=re.IGNORECASE,
    )
    for m in tutor_re.finditer(wikitext):
        move, mtype, cat, power, acc, pp = m.groups()
        move_id, move_entry = build_move_entry(move, mtype, cat, power, acc, pp)
        if move_id:
            move_defs.setdefault(move_id, move_entry)
            add_learnset_source(learnset, move_id, "9T")

    breed_line_re = re.compile(
        r"\{\{MoveBreed\|.*\|([^|{}]+)\|([^|{}]+)\|(Physical|Special|Status)\|([^|{}]+)\|([^|{}]+)\|([^|{}]+)",
        flags=re.IGNORECASE,
    )
    for line in wikitext.splitlines():
        if "{{MoveBreed|" not in line:
            continue
        m = breed_line_re.search(line)
        if not m:
            continue
        move, mtype, cat, power, acc, pp = m.groups()
        move_id, move_entry = build_move_entry(move, mtype, cat, power, acc, pp)
        if move_id:
            move_defs.setdefault(move_id, move_entry)
            add_learnset_source(learnset, move_id, "9E")

    item_names = {
        strip_wiki_markup(x)
        for x in re.findall(r"\{\{Item\|([^}|]+)", wikitext, flags=re.IGNORECASE)
    }
    item_names = {x for x in item_names if x}

    image_file = extract_image_filename(info.get("image", ""))

    return SpeciesParse(
        species_id=species_id,
        species=species,
        learnset={"learnset": learnset},
        move_defs=move_defs,
        abilities=set(ability_names),
        items=item_names,
        image_file=image_file,
        evo_links=evo_links,
    )


def fetch_image_url(file_name: str) -> str:
    title = f"File:{file_name}"
    params = {
        "action": "query",
        "titles": title,
        "prop": "imageinfo",
        "iiprop": "url",
        "format": "json",
    }
    res = session.get(API_URL, params=params, timeout=45)
    res.raise_for_status()
    payload = res.json()
    pages = payload.get("query", {}).get("pages", {})
    for page in pages.values():
        infos = page.get("imageinfo") or []
        if infos and infos[0].get("url"):
            return infos[0]["url"]
    return ""


def save_sprite(file_url: str, out_path: Path) -> None:
    if Image is None:
        raise RuntimeError("Pillow is required for sprite download")
    res = session.get(file_url, timeout=60)
    res.raise_for_status()
    img = Image.open(BytesIO(res.content)).convert("RGBA")
    max_dim = 96
    w, h = img.size
    if w <= 0 or h <= 0:
        raise RuntimeError("invalid image size")
    scale = min(max_dim / w, max_dim / h)
    new_size = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
    img = img.resize(new_size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    x = (96 - img.width) // 2
    y = (96 - img.height) // 2
    canvas.paste(img, (x, y), img)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"), ensure_ascii=False)


def write_pretty_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Pokemon Sage data from CAPX fandom")
    parser.add_argument("--limit", type=int, default=0, help="Limit species count for partial runs")
    parser.add_argument("--apply", action="store_true", help="Merge generated data into tauri-app vendor showdown JSON files")
    parser.add_argument("--download-sprites", action="store_true", help="Download and save one front sprite per species into gen5 sprite folder")
    parser.add_argument("--sprite-overwrite", action="store_true", help="Overwrite existing sprite files")
    parser.add_argument("--backend-overrides", action="store_true", help="Write backend runtime override files (data/pokedex.ts + data/moves.ts)")
    parser.add_argument("--offset", type=int, default=30000, help="Dex number offset used for Sage species")
    parser.add_argument("--use-cached-pages", action="store_true", help="Use data/sage/raw pages/index when available instead of fetching")
    args = parser.parse_args()

    OUT_RAW.mkdir(parents=True, exist_ok=True)
    OUT_PAGES.mkdir(parents=True, exist_ok=True)
    OUT_GEN.mkdir(parents=True, exist_ok=True)

    index_path = OUT_RAW / "sage_pokedex_index.json"
    if args.use_cached_pages and index_path.exists():
        print("[1/7] Loading cached Sage index...")
        index_entries = list((read_json(index_path).get("entries") or []))
    else:
        print("[1/7] Fetching Sage index...")
        index_entries = parse_index(get_page_wikitext("Pokédex"))
        write_pretty_json(
            index_path,
            {"source": BASE_URL, "count": len(index_entries), "entries": index_entries},
        )
    if args.limit > 0:
        index_entries = index_entries[: args.limit]
    print(f"      Index entries to process: {len(index_entries)}")

    print("[2/7] Loading base showdown data...")
    base_pokedex = read_json(TAURI_DATA / "pokedex.json")
    base_moves = read_json(TAURI_DATA / "moves.json")
    base_abilities = read_json(TAURI_DATA / "abilities.json")
    base_items = read_json(TAURI_DATA / "items.json")
    base_learnsets = read_json(TAURI_DATA / "learnsets.json")

    sage_pokedex: dict[str, Any] = {}
    sage_learnsets: dict[str, Any] = {}
    extracted_moves: dict[str, dict[str, Any]] = {}
    extracted_abilities: set[str] = set()
    extracted_items: set[str] = set()
    sprite_files: dict[str, str] = {}
    failures: list[str] = []
    parsed_evo_links: list[dict[str, Any]] = []

    print("[3/7] Parsing species pages...")
    for idx, row in enumerate(index_entries, start=1):
        name = row.get("name", "")
        try:
            safe_name = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
            page_path = OUT_PAGES / f"{int(row['dex']):03d}_{safe_name}.txt"
            if args.use_cached_pages and page_path.exists():
                page_wikitext = page_path.read_text(encoding="utf-8")
            else:
                page_wikitext = get_page_wikitext(name)
                page_path.write_text(page_wikitext, encoding="utf-8")

            parsed = parse_species_page(row, page_wikitext, args.offset)
            sage_pokedex[parsed.species_id] = parsed.species
            sage_learnsets[parsed.species_id] = parsed.learnset
            parsed_evo_links.extend(parsed.evo_links)
            extracted_abilities.update(parsed.abilities)
            extracted_items.update(parsed.items)
            for move_id, move_data in parsed.move_defs.items():
                extracted_moves.setdefault(move_id, move_data)
            if parsed.image_file:
                sprite_files[parsed.species_id] = parsed.image_file

            if idx % 25 == 0 or idx == len(index_entries):
                print(f"      Parsed {idx}/{len(index_entries)}")
            time.sleep(0.03)
        except Exception as exc:  # pragma: no cover
            failures.append(f"{name}: {exc}")
            print(f"      [warn] {name}: {exc}")

    # Fill prevo links based on evos
    for species in list(sage_pokedex.values()):
        src_name = species.get("name", "")
        for evo_name in species.get("evos", []) or []:
            evo_id = normalize_id(evo_name)
            target = sage_pokedex.get(evo_id)
            if target and "prevo" not in target:
                target["prevo"] = src_name

    # Apply parsed evolution metadata onto target species entries
    for link in parsed_evo_links:
        src_name = clean(str(link.get("source", "")))
        target_name = clean(str(link.get("target", "")))
        if not src_name or not target_name:
            continue
        src = sage_pokedex.get(normalize_id(src_name))
        target = sage_pokedex.get(normalize_id(target_name))
        if not src or not target:
            continue

        src_evos = list(src.get("evos") or [])
        if target_name not in src_evos:
            src_evos.append(target_name)
            src["evos"] = src_evos

        if "prevo" not in target:
            target["prevo"] = src.get("name") or src_name

        for field in ("evoType", "evoLevel", "evoCondition", "evoMove", "evoItem"):
            value = link.get(field)
            if value in (None, ""):
                continue
            if field not in target:
                target[field] = value

    # Custom-only deltas
    custom_moves: dict[str, Any] = {}
    move_counter = 0
    for move_id, move_data in extracted_moves.items():
        if move_id in base_moves:
            continue
        move_counter += 1
        move_data = dict(move_data)
        move_data["num"] = -(20000 + move_counter)
        custom_moves[move_id] = move_data

    custom_abilities: dict[str, Any] = {}
    for abil in sorted(extracted_abilities):
        abil_id = normalize_id(abil)
        if not abil_id or abil_id in base_abilities:
            continue
        custom_abilities[abil_id] = {
            "name": abil,
            "shortDesc": "Pokemon Sage custom ability.",
            "desc": "Pokemon Sage custom ability.",
        }

    custom_items: dict[str, Any] = {}
    for item in sorted(extracted_items):
        item_id = normalize_id(item)
        if not item_id or item_id in base_items:
            continue
        custom_items[item_id] = {
            "name": item,
            "shortDesc": "Pokemon Sage custom item.",
            "desc": "Pokemon Sage custom item.",
        }

    print("[4/7] Writing generated Sage artifacts...")
    write_pretty_json(OUT_GEN / "pokedex.sage.json", sage_pokedex)
    write_pretty_json(OUT_GEN / "learnsets.sage.json", sage_learnsets)
    write_pretty_json(OUT_GEN / "moves.custom.sage.json", custom_moves)
    write_pretty_json(OUT_GEN / "abilities.custom.sage.json", custom_abilities)
    write_pretty_json(OUT_GEN / "items.custom.sage.json", custom_items)
    write_pretty_json(OUT_GEN / "sprites.manifest.json", sprite_files)
    write_pretty_json(
        OUT_GEN / "summary.json",
        {
            "species": len(sage_pokedex),
            "customMoves": len(custom_moves),
            "customAbilities": len(custom_abilities),
            "customItems": len(custom_items),
            "failures": failures,
        },
    )

    merged_pokedex = dict(base_pokedex)
    merged_pokedex.update(sage_pokedex)
    merged_moves = dict(base_moves)
    merged_moves.update(custom_moves)
    merged_abilities = dict(base_abilities)
    merged_abilities.update(custom_abilities)
    merged_items = dict(base_items)
    merged_items.update(custom_items)
    merged_learnsets = dict(base_learnsets)
    merged_learnsets.update(sage_learnsets)

    print("[5/7] Validation...")
    missing_moves: list[str] = []
    missing_abilities: list[str] = []
    for sid, data in sage_pokedex.items():
        for abil in (data.get("abilities") or {}).values():
            if normalize_id(str(abil)) not in merged_abilities:
                missing_abilities.append(f"{data.get('name')}: {abil}")
    for sid, ls in sage_learnsets.items():
        for move_id in (ls.get("learnset") or {}).keys():
            if move_id not in merged_moves:
                missing_moves.append(f"{sid}:{move_id}")
    validation = {
        "missingMoves": sorted(set(missing_moves)),
        "missingAbilities": sorted(set(missing_abilities)),
        "missingMovesCount": len(set(missing_moves)),
        "missingAbilitiesCount": len(set(missing_abilities)),
    }
    write_pretty_json(OUT_GEN / "validation.json", validation)
    if validation["missingMovesCount"] or validation["missingAbilitiesCount"]:
        print(
            f"      [warn] Missing refs: moves={validation['missingMovesCount']} abilities={validation['missingAbilitiesCount']}"
        )
    else:
        print("      Validation passed (no missing move/ability references).")

    if args.apply:
        print("[6/7] Applying merged data to tauri-app vendor showdown JSON...")
        write_json(TAURI_DATA / "pokedex.json", merged_pokedex)
        write_json(TAURI_DATA / "moves.json", merged_moves)
        write_json(TAURI_DATA / "abilities.json", merged_abilities)
        write_json(TAURI_DATA / "items.json", merged_items)
        write_json(TAURI_DATA / "learnsets.json", merged_learnsets)
        print("      Applied merged data files.")
    else:
        print("[6/7] Skipped apply (use --apply to write tauri data files).")

    if args.download_sprites:
        print("[7/7] Downloading Sage sprites...")
        if Image is None:
            print("      [warn] Pillow not installed. Skipping sprite downloads.")
        else:
            ok = 0
            fail = 0
            for sid, image_name in sprite_files.items():
                out_path = TAURI_GEN5 / f"{sid}.png"
                if out_path.exists() and not args.sprite_overwrite:
                    ok += 1
                    continue
                try:
                    url = fetch_image_url(image_name)
                    if not url:
                        raise RuntimeError(f"no file URL for {image_name}")
                    save_sprite(url, out_path)
                    ok += 1
                except Exception as exc:  # pragma: no cover
                    fail += 1
                    print(f"      [warn] sprite {sid}: {exc}")
                time.sleep(0.03)
            print(f"      Sprite download complete: ok={ok}, failed={fail}")
    else:
        print("[7/7] Skipped sprite downloads (use --download-sprites).")

    if args.backend_overrides:
        print("      Writing backend override files...")
        BACKEND_DATA.mkdir(parents=True, exist_ok=True)
        pokedex_ts = "export default " + json.dumps(sage_pokedex, ensure_ascii=False, separators=(",", ":")) + ";\n"
        moves_ts = "export default " + json.dumps(custom_moves, ensure_ascii=False, separators=(",", ":")) + ";\n"
        abilities_ts = "export default " + json.dumps(custom_abilities, ensure_ascii=False, separators=(",", ":")) + ";\n"
        items_ts = "export default " + json.dumps(custom_items, ensure_ascii=False, separators=(",", ":")) + ";\n"
        (BACKEND_DATA / "pokedex.ts").write_text(pokedex_ts, encoding="utf-8")
        (BACKEND_DATA / "moves.ts").write_text(moves_ts, encoding="utf-8")
        (BACKEND_DATA / "sage-abilities.ts").write_text(abilities_ts, encoding="utf-8")
        (BACKEND_DATA / "sage-items.ts").write_text(items_ts, encoding="utf-8")
        print("      Backend overrides written.")

    print("")
    print("Done.")
    print(f"  Parsed species: {len(sage_pokedex)}")
    print(f"  New custom moves: {len(custom_moves)}")
    print(f"  New custom abilities: {len(custom_abilities)}")
    print(f"  New custom items: {len(custom_items)}")
    print(f"  Failures: {len(failures)}")


if __name__ == "__main__":
    main()
