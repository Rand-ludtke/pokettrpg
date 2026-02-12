"""
Test fusion sprite generation using the local fusion engine.
Generates test fusions for several iconic Pokemon pairs and saves them
to the tauri-app's sprite directory for in-app use.
"""

import sys
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from sprite_matrix import SpriteMatrix, GRID_SIZE
from fusion_engine import (
    fuse_classic, fuse_reverse, fuse_color_swap,
    fuse_accent_transplant, fuse_chimera, fuse_blended, fuse_all
)
from PIL import Image
import numpy as np

# Paths
SPRITES_DIR = Path(__file__).parent.parent / "tauri-app" / "public" / "vendor" / "showdown" / "sprites" / "gen5"
OUTPUT_DIR = Path(__file__).parent.parent / "tauri-app" / "public" / "spliced-sprites"
GALLERY_DIR = Path(__file__).parent.parent / "fusion_test_gallery"

# Test pairs: (base_name, donor_name, base_dex, donor_dex)
TEST_PAIRS = [
    ("pikachu",    "charizard",   25,   6),
    ("eevee",      "gengar",     133,  94),
    ("bulbasaur",  "squirtle",     1,   7),
    ("mewtwo",     "lucario",   150, 448),
    ("jigglypuff", "machamp",    39,  68),
    ("snorlax",    "alakazam",  143,  65),
    ("dragonite",  "arcanine",  149,  59),
    ("gardevoir",  "blaziken",  282, 257),
]


def load_sprite(name: str) -> SpriteMatrix:
    """Load a Gen5 sprite from the Showdown sprites directory."""
    path = SPRITES_DIR / f"{name}.png"
    if not path.exists():
        raise FileNotFoundError(f"Sprite not found: {path}")
    return SpriteMatrix.from_file(str(path))


def save_sprite_png(result, path: Path, scale: int = 1):
    """Save a FusionResult as a 96x96 PNG (or scaled)."""
    rgba = result.sprite.get_rgba_array()
    img = Image.fromarray(rgba.astype(np.uint8))
    if scale > 1:
        img = img.resize((GRID_SIZE * scale, GRID_SIZE * scale), Image.NEAREST)
    img.save(str(path))


def make_gallery_html(pairs_results: list, gallery_dir: Path):
    """Generate an HTML gallery page showing all test fusions."""
    html = ["""<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>PokéTTRPG Fusion Test Gallery</title>
<style>
body { background: #1a1a2e; color: #eee; font-family: 'Segoe UI', sans-serif; padding: 20px; }
h1 { color: #4ade80; text-align: center; }
h2 { color: #60a5fa; border-bottom: 1px solid #333; padding-bottom: 6px; }
.pair { margin: 20px 0; padding: 16px; background: #16213e; border-radius: 12px; }
.sprites { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.sprite-card { text-align: center; background: #0f3460; padding: 8px; border-radius: 8px; }
.sprite-card img { image-rendering: pixelated; width: 192px; height: 192px; }
.sprite-card .label { font-size: 12px; color: #94a3b8; margin-top: 4px; }
.source img { image-rendering: pixelated; width: 96px; height: 96px; border: 1px solid #555; border-radius: 4px; }
.source { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.source span { font-size: 14px; }
.summary { background: #1e293b; padding: 12px; border-radius: 8px; margin-top: 20px; text-align: center; }
</style></head><body>
<h1>🔀 PokéTTRPG Fusion Test Gallery</h1>
<p style="text-align:center;color:#94a3b8;">Generated using local parts-based fusion engine</p>
"""]

    total = 0
    for base_name, donor_name, base_dex, donor_dex, results in pairs_results:
        html.append(f'<div class="pair">')
        html.append(f'<h2>#{base_dex} {base_name.title()} + #{donor_dex} {donor_name.title()}</h2>')
        html.append(f'<div class="source">')
        html.append(f'<img src="../tauri-app/public/vendor/showdown/sprites/gen5/{base_name}.png" alt="{base_name}">')
        html.append(f'<span>+</span>')
        html.append(f'<img src="../tauri-app/public/vendor/showdown/sprites/gen5/{donor_name}.png" alt="{donor_name}">')
        html.append(f'</div>')
        html.append(f'<div class="sprites">')
        for r in results:
            fname = f"{base_dex}.{donor_dex}_{r.method}.png"
            html.append(f'<div class="sprite-card">')
            html.append(f'<img src="{fname}" alt="{r.method}">')
            html.append(f'<div class="label">{r.method}</div>')
            html.append(f'</div>')
            total += 1
        html.append(f'</div></div>')

    html.append(f'<div class="summary">Generated {total} fusion sprites from {len(pairs_results)} pairs</div>')
    html.append('</body></html>')

    (gallery_dir / "gallery.html").write_text('\n'.join(html), encoding='utf-8')


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    GALLERY_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("  PokéTTRPG Local Fusion Engine Test")
    print("=" * 60)
    print(f"Sprites dir:  {SPRITES_DIR}")
    print(f"Output dir:   {OUTPUT_DIR}")
    print(f"Gallery dir:  {GALLERY_DIR}")
    print()

    all_pairs_results = []
    total_generated = 0
    total_errors = 0

    for base_name, donor_name, base_dex, donor_dex in TEST_PAIRS:
        print(f"━━━ #{base_dex} {base_name.title()} + #{donor_dex} {donor_name.title()} ━━━")

        try:
            base = load_sprite(base_name)
            donor = load_sprite(donor_name)
        except FileNotFoundError as e:
            print(f"  SKIP: {e}")
            total_errors += 1
            continue

        results = fuse_all(base, donor, base_dex, donor_dex)

        for r in results:
            # Save to gallery (3x scale for viewing)
            gallery_path = GALLERY_DIR / f"{base_dex}.{donor_dex}_{r.method}.png"
            save_sprite_png(r, gallery_path, scale=3)

            # Save the "classic" fusion to spliced-sprites for in-app use (1x)
            if r.method == "classic":
                game_path = OUTPUT_DIR / f"{base_dex}.{donor_dex}.png"
                save_sprite_png(r, game_path, scale=1)
                print(f"  ✓ {r.method:20s} → {game_path.name} (game sprite)")
            else:
                print(f"  ✓ {r.method:20s} → {gallery_path.name}")

            total_generated += 1

        # Also generate reverse fusion (donor head + base body → donor.base.png)
        try:
            reverse_results = fuse_all(donor, base, donor_dex, base_dex)
            for r in reverse_results:
                gallery_path = GALLERY_DIR / f"{donor_dex}.{base_dex}_{r.method}.png"
                save_sprite_png(r, gallery_path, scale=3)
                if r.method == "classic":
                    game_path = OUTPUT_DIR / f"{donor_dex}.{base_dex}.png"
                    save_sprite_png(r, game_path, scale=1)
                    print(f"  ✓ reverse-{r.method:14s} → {game_path.name} (game sprite)")
                total_generated += 1
        except Exception as e:
            print(f"  Reverse failed: {e}")

        all_pairs_results.append((base_name, donor_name, base_dex, donor_dex, results))
        print()

    # Generate gallery HTML
    make_gallery_html(all_pairs_results, GALLERY_DIR)

    print("=" * 60)
    print(f"  Done! Generated {total_generated} sprites, {total_errors} errors")
    print(f"  Gallery: {GALLERY_DIR / 'gallery.html'}")
    print(f"  Game sprites: {OUTPUT_DIR}")
    print("=" * 60)


if __name__ == "__main__":
    main()
