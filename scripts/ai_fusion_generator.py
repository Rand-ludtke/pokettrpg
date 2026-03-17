"""
ai_fusion_generator.py — On-demand fusion sprite generator
==========================================================

CLI wrapper expected by the FusionGenService (fusion-gen.js).
Uses the parts-based fusion engine for fast, deterministic splicing.

Usage (called by fusion-gen.js):
  python ai_fusion_generator.py --base 6 --donor 25 --backend diffusers --output /path/to/6.25.png
"""

import argparse
import json
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

from sprite_matrix import SpriteMatrix
from fusion_engine import fuse_classic


# ── Dex number → sprite file lookup ─────────────────────────

_SHOWDOWN_DEX = None

def _load_showdown_dex() -> dict:
    global _SHOWDOWN_DEX
    if _SHOWDOWN_DEX is not None:
        return _SHOWDOWN_DEX
    for p in [
        PROJECT_DIR / "tauri-app" / "public" / "vendor" / "showdown" / "data" / "pokedex.json",
        PROJECT_DIR / "app" / "public" / "vendor" / "showdown" / "data" / "pokedex.json",
        Path("/home/randl/pokettrpg/tauri-app/public/vendor/showdown/data/pokedex.json"),
    ]:
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                _SHOWDOWN_DEX = json.load(f)
            return _SHOWDOWN_DEX
    _SHOWDOWN_DEX = {}
    return _SHOWDOWN_DEX


def dex_to_sprite_id(dex_num: int) -> str | None:
    """Convert a national dex number to the Showdown sprite ID."""
    dex = _load_showdown_dex()
    for key, data in dex.items():
        if data.get("num") == dex_num:
            return key.lower()
    return None


def find_base_sprite(dex_num: int, base_dirs: list[Path]) -> Path | None:
    """Find the gen5 base sprite PNG for a dex number."""
    sprite_id = dex_to_sprite_id(dex_num)
    if not sprite_id:
        return None
    for d in base_dirs:
        if not d.is_dir():
            continue
        # Try exact match first
        p = d / f"{sprite_id}.png"
        if p.exists():
            return p
        # Try numeric filename (some dirs use dex numbers)
        p = d / f"{dex_num}.png"
        if p.exists():
            return p
    return None


def main():
    parser = argparse.ArgumentParser(description="On-demand fusion sprite generator")
    parser.add_argument("--base", required=True, help="Head/base dex number")
    parser.add_argument("--donor", required=True, help="Body/donor dex number")
    parser.add_argument("--backend", default="diffusers", help="Generation backend (ignored, always splice)")
    parser.add_argument("--output", required=True, help="Output PNG path")
    parser.add_argument("--base-sprites", default="", help="Base sprites directory override")
    args = parser.parse_args()

    head_num = int(args.base)
    body_num = int(args.donor)
    output_path = Path(args.output)

    # Build list of directories to search for base sprites
    project_root = SCRIPT_DIR.parent
    base_dirs = []
    if args.base_sprites:
        base_dirs.append(Path(args.base_sprites))
    # Env var override
    env_base = os.environ.get("FUSION_GEN_BASE_SPRITES", "")
    if env_base:
        base_dirs.append(Path(env_base))
    # Standard locations
    base_dirs.extend([
        project_root / "tauri-app" / "public" / "vendor" / "showdown" / "sprites" / "gen5",
        project_root / "tauri-app" / "public" / "sprites" / "gen5",
        project_root / "app" / "public" / "vendor" / "showdown" / "sprites" / "gen5",
        # On the server (Pi), the sprites may be under the fusion dir
        Path("/home/randl/pokettrpg/.fusion-sprites-local/sprites/gen5"),
        Path("/home/randl/pokettrpg/tauri-app/public/vendor/showdown/sprites/gen5"),
    ])

    head_sprite_path = find_base_sprite(head_num, base_dirs)
    body_sprite_path = find_base_sprite(body_num, base_dirs)

    if not head_sprite_path:
        print(f"Error: No base sprite found for dex#{head_num}", file=sys.stderr)
        sys.exit(1)
    if not body_sprite_path:
        print(f"Error: No base sprite found for dex#{body_num}", file=sys.stderr)
        sys.exit(1)

    # Load sprites
    head_sprite = SpriteMatrix.from_file(head_sprite_path)
    body_sprite = SpriteMatrix.from_file(body_sprite_path)

    # Generate fusion using classic method (head from donor, body colors from base)
    result = fuse_classic(head_sprite, body_sprite, head_num, body_num)

    # Ensure output directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Save at 1x scale (96x96) for consistency with other fusion sprites
    result.save(str(output_path), scale=1)
    print(f"Generated fusion: {head_num}.{body_num} -> {output_path}")


if __name__ == "__main__":
    main()
