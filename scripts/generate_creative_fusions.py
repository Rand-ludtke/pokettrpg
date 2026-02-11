"""
Creative Fusion Batch Generator
================================

Generates a curated batch of fusions using the annotated Pokemon
(those with hand-painted region data) to produce the best results.

Uses the parts-based fusion engine with all 6 methods to create
a showcase gallery of sprite fusions.

Run: python generate_creative_fusions.py
Output: ../dreamo_test_results/creative_fusions/
"""

import sys
import json
from pathlib import Path
from itertools import combinations

# Ensure the scripts directory is on the path
sys.path.insert(0, str(Path(__file__).parent))

from fusion_engine import (
    greyscale_color_swap, parts_fusion, FusionResult,
    reduce_palette_kmeans
)
from sprite_matrix import SpriteMatrix, GRID_SIZE
from sprite_regions import detect_regions, save_region_visualization
from pokemon_knowledge import (
    get_pokemon_traits, build_fusion_prompt, POKEMON_FEATURES
)

# ── Config ──────────────────────────────────────────────────────

SPRITE_DIR = Path(__file__).parent.parent / "training_output" / "base_sprites_all"
OUTPUT_DIR = Path(__file__).parent.parent / "dreamo_test_results" / "creative_fusions"
ANNOTATION_FILE = Path(__file__).parent.parent / "dreamo_test_results" / "region_tuning" / "user_annotations.json"

# These 16 Pokemon have hand-annotated region data → best fusion results
ANNOTATED_IDS = [1, 6, 9, 12, 18, 25, 59, 68, 76, 94, 101, 123, 130, 131, 143, 150]

# Pokemon names for the annotated set
POKEMON_NAMES = {
    1: "Bulbasaur", 6: "Charizard", 9: "Blastoise", 12: "Butterfree",
    18: "Pidgeot", 25: "Pikachu", 59: "Arcanine", 68: "Machamp",
    76: "Golem", 94: "Gengar", 101: "Electrode", 123: "Scyther",
    130: "Gyarados", 131: "Lapras", 143: "Snorlax", 150: "Mewtwo",
}

# Pokemon types for prompt generation
POKEMON_TYPES = {
    1: ["Grass", "Poison"], 6: ["Fire", "Flying"], 9: ["Water"],
    12: ["Bug", "Flying"], 18: ["Normal", "Flying"], 25: ["Electric"],
    59: ["Fire"], 68: ["Fighting"], 76: ["Rock", "Ground"],
    94: ["Ghost", "Poison"], 101: ["Electric"], 123: ["Bug", "Flying"],
    130: ["Water", "Flying"], 131: ["Water", "Ice"],
    143: ["Normal"], 150: ["Psychic"],
}

# ── Curated Creative Fusion Pairs ──────────────────────────────
# Each pair is chosen for maximum visual interest and type contrast

CREATIVE_PAIRS = [
    # Starter showdowns
    (6, 9,    "Charistoise",   "Fire dragon with water cannons — the ultimate elemental clash"),
    (6, 1,    "Charisaur",     "Flame dragon with a blooming flower bulb — fire meets nature"),
    (9, 1,    "Blastosaur",    "Armored turtle with vine whips and plant growth"),

    # Legendary fusions
    (150, 6,  "Mewzard",      "Psychic powerhouse with draconic wings and flame tail"),
    (150, 94, "Mewgar",       "Ghostly psychic entity — pure nightmare fuel"),
    (150, 130,"Mewrados",     "Psychic sea serpent — cosmic ocean terror"),

    # Type mashups
    (25, 94,  "Pikagar",      "Electric ghost rodent — shocking specter"),
    (25, 6,   "Pikazard",     "Electric fire dragon — thunderstorm incarnate"),
    (94, 6,   "Genzard",      "Shadow dragon wreathed in ghostly flames"),
    (130, 94, "Gyaragar",     "Spectral sea serpent — the deep's darkest nightmare"),

    # Iconic design clashes
    (59, 130, "Arcarados",    "Majestic fire beast with serpentine features"),
    (123, 68, "Scychamp",     "Four-armed mantis warrior — the ultimate fighter"),
    (131, 6,  "Laprazard",    "Graceful ice dragon with fire wings"),
    (143, 25, "Snorlachu",    "Electrified sleeping giant — don't wake it up"),

    # Unusual combinations
    (76, 12,  "Golemfree",    "Boulder butterfly — beautiful and terrifying"),
    (101, 94, "Electgar",     "Possessed Voltorb — ticking ghostly bomb"),
    (18, 130, "Pidgeados",    "Sky serpent — ruler of storms"),
    (68, 131, "Machapras",    "Muscular plesiosaur — aquatic powerhouse"),
]

FUSION_METHODS = ["classic", "reverse", "color_swap", "accent_transplant", "chimera", "blended"]


# ── Main ────────────────────────────────────────────────────────

def load_sprite(num: int) -> SpriteMatrix:
    """Load a sprite from the base_sprites_all directory."""
    path = SPRITE_DIR / f"{num}.png"
    if not path.exists():
        raise FileNotFoundError(f"Sprite not found: {path}")
    return SpriteMatrix.from_file(str(path))


def generate_fusion(base_num: int, donor_num: int, method: str) -> FusionResult:
    """Generate a single fusion using the specified method."""
    base = load_sprite(base_num)
    donor = load_sprite(donor_num)

    if method == "classic":
        result = parts_fusion(base, donor,
                              head_source="donor", body_source="base",
                              color_source="donor")
    elif method == "reverse":
        result = parts_fusion(base, donor,
                              head_source="base", body_source="donor",
                              color_source="base")
    elif method == "color_swap":
        sprite = greyscale_color_swap(base, donor)
        return FusionResult(sprite, method, base_num, donor_num,
                           {"description": "Base shape, donor colors"})
    elif method == "accent_transplant":
        result = parts_fusion(base, donor,
                              head_source="base", body_source="base",
                              color_source="base", accent_mode="transplant")
    elif method == "chimera":
        result = parts_fusion(base, donor,
                              head_source="donor", body_source="base",
                              color_source="blend")
    elif method == "blended":
        result = parts_fusion(base, donor,
                              head_source="donor", body_source="base",
                              color_source="donor", accent_mode="merge")
    else:
        raise ValueError(f"Unknown method: {method}")

    if isinstance(result, SpriteMatrix):
        return FusionResult(result, method, base_num, donor_num)
    return result


def generate_gallery_html(results: list[dict], output_dir: Path) -> str:
    """Generate an HTML gallery page with all fusion results."""
    html = """<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>PokéTTRPG Creative Fusion Gallery</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 20px; }
  h1 { text-align: center; color: #00ff88; margin: 20px 0; font-size: 2em; }
  h2 { color: #88bbff; margin: 15px 0 8px; }
  .pair { background: #16213e; border: 1px solid #334; border-radius: 12px; padding: 16px; margin: 16px 0; }
  .pair-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .pair-header h3 { color: #ffcc00; font-size: 1.3em; }
  .pair-header .desc { color: #aaa; font-style: italic; font-size: 0.9em; }
  .variants { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
  .card { background: #0f3460; border: 1px solid #445; border-radius: 8px; padding: 10px; text-align: center; }
  .card img { width: 96px; height: 96px; image-rendering: pixelated; border: 1px solid #333; background: #222; }
  .card .method { font-size: 0.8em; color: #88ff88; margin-top: 6px; text-transform: capitalize; }
  .card .prompt { font-size: 0.7em; color: #888; margin-top: 4px; max-height: 40px; overflow: hidden; }
  .source-sprites { display: flex; gap: 8px; align-items: center; }
  .source-sprites img { width: 48px; height: 48px; image-rendering: pixelated; background: #222; border: 1px solid #444; border-radius: 4px; }
  .source-sprites .plus { color: #ffcc00; font-size: 1.5em; font-weight: bold; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 16px; text-align: center; color: #aaa; font-size: 0.85em; }
  .stats .num { color: #00ff88; font-size: 1.4em; font-weight: bold; }
</style>
</head><body>
<h1>🧬 PokéTTRPG Creative Fusion Gallery</h1>
<div class="stats">
  <div><div class="num">PAIR_COUNT</div>Fusion Pairs</div>
  <div><div class="num">METHOD_COUNT</div>Methods Used</div>
  <div><div class="num">TOTAL_COUNT</div>Total Sprites</div>
</div>
"""
    pair_count = 0
    total_count = 0

    current_pair = None
    for r in results:
        pair_key = f"{r['base']}_{r['donor']}"
        if pair_key != current_pair:
            if current_pair is not None:
                html += "  </div>\n</div>\n"
            current_pair = pair_key
            pair_count += 1
            name = r.get("fusion_name", f"{r['base']}+{r['donor']}")
            desc = r.get("description", "")
            base_name = POKEMON_NAMES.get(r['base'], str(r['base']))
            donor_name = POKEMON_NAMES.get(r['donor'], str(r['donor']))
            html += f"""
<div class="pair">
  <div class="pair-header">
    <div class="source-sprites">
      <img src="../../../training_output/base_sprites_all/{r['base']}.png" alt="{base_name}" title="{base_name}">
      <span class="plus">+</span>
      <img src="../../../training_output/base_sprites_all/{r['donor']}.png" alt="{donor_name}" title="{donor_name}">
    </div>
    <div>
      <h3>{name}</h3>
      <div class="desc">{base_name} (body) + {donor_name} (head) — {desc}</div>
    </div>
  </div>
  <div class="variants">
"""
        total_count += 1
        filename = r["filename"]
        method = r["method"]
        prompt = r.get("prompt", "")[:100]
        html += f"""    <div class="card">
      <img src="{filename}" alt="{method}">
      <div class="method">{method.replace('_', ' ')}</div>
      <div class="prompt">{prompt}</div>
    </div>
"""

    if current_pair is not None:
        html += "  </div>\n</div>\n"

    html = html.replace("PAIR_COUNT", str(pair_count))
    html = html.replace("METHOD_COUNT", str(len(FUSION_METHODS)))
    html = html.replace("TOTAL_COUNT", str(total_count))

    html += "</body></html>"
    return html


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"🧬 Creative Fusion Generator")
    print(f"   Output: {OUTPUT_DIR}")
    print(f"   Pairs: {len(CREATIVE_PAIRS)}")
    print(f"   Methods: {len(FUSION_METHODS)}")
    print(f"   Total fusions: {len(CREATIVE_PAIRS) * len(FUSION_METHODS)}")
    print()

    # Check sprites exist
    missing = [n for n in ANNOTATED_IDS if not (SPRITE_DIR / f"{n}.png").exists()]
    if missing:
        print(f"⚠️  Missing sprites: {missing}")
        print(f"   Sprite dir: {SPRITE_DIR}")
        return

    results = []
    errors = []

    for base_num, donor_num, fusion_name, description in CREATIVE_PAIRS:
        print(f"  ⚡ {fusion_name}: {POKEMON_NAMES[base_num]} + {POKEMON_NAMES[donor_num]}")

        # Generate SD prompt for this pair
        base_traits = get_pokemon_traits(base_num, POKEMON_TYPES.get(base_num, []))
        donor_traits = get_pokemon_traits(donor_num, POKEMON_TYPES.get(donor_num, []))
        prompt = build_fusion_prompt(base_traits, donor_traits)

        for method in FUSION_METHODS:
            filename = f"{fusion_name}_{method}.png"
            filepath = OUTPUT_DIR / filename
            try:
                result = generate_fusion(base_num, donor_num, method)
                # Apply K-means palette reduction for cleaner sprites
                reduced = reduce_palette_kmeans(result.sprite, n_colors=16)
                reduced.to_file(str(filepath), scale=3)

                results.append({
                    "base": base_num,
                    "donor": donor_num,
                    "fusion_name": fusion_name,
                    "description": description,
                    "method": method,
                    "filename": filename,
                    "prompt": prompt,
                })
                print(f"     ✓ {method}")
            except Exception as e:
                errors.append(f"{fusion_name}/{method}: {e}")
                print(f"     ✗ {method}: {e}")

    # Generate gallery HTML
    gallery_html = generate_gallery_html(results, OUTPUT_DIR)
    gallery_path = OUTPUT_DIR / "gallery.html"
    gallery_path.write_text(gallery_html, encoding="utf-8")
    print(f"\n📊 Gallery: {gallery_path}")

    # Save metadata
    meta_path = OUTPUT_DIR / "fusion_metadata.json"
    meta_path.write_text(json.dumps(results, indent=2), encoding="utf-8")

    # Summary
    print(f"\n{'='*50}")
    print(f"✅ Generated: {len(results)} fusions")
    if errors:
        print(f"❌ Errors: {len(errors)}")
        for e in errors[:10]:
            print(f"   - {e}")
    print(f"📁 Output: {OUTPUT_DIR}")
    print(f"🌐 Gallery: {gallery_path}")

    # Print some sample prompts
    print(f"\n🎨 Sample SD 1.5 Prompts for AI Enhancement:")
    for pair in CREATIVE_PAIRS[:5]:
        base_t = get_pokemon_traits(pair[0], POKEMON_TYPES.get(pair[0], []))
        donor_t = get_pokemon_traits(pair[1], POKEMON_TYPES.get(pair[1], []))
        p = build_fusion_prompt(base_t, donor_t)
        print(f"\n  {pair[2]}:")
        print(f"    {p}")


if __name__ == "__main__":
    main()
