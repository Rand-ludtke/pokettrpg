"""
ai_fusion_generator.py — On-demand fusion sprite generator
==========================================================

CLI wrapper expected by the FusionGenService (fusion-gen.js).
Generates fusion sprites with SDXL-Turbo via Hugging Face diffusers.

Usage (called by fusion-gen.js):
    python ai_fusion_generator.py --base 6 --donor 25 --backend diffusers --output /path/to/6.25.png
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Optional, Tuple, cast

from PIL import Image

try:
    from PIL.Image import Resampling
    _NEAREST = Resampling.NEAREST
except Exception:
    _NEAREST = 0

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent

_txt2img_pipe = None
_img2img_pipe = None


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


def dex_to_species_name(dex_num: int) -> str:
    dex = _load_showdown_dex()
    for key, data in dex.items():
        if data.get("num") == dex_num:
            return str(data.get("name") or key)
    return f"Dex {dex_num}"


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


def _device_config() -> Tuple[str, "object"]:
    import torch

    if torch.cuda.is_available():
        return "cuda", torch.float16
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps", torch.float16
    return "cpu", torch.float32


def _get_txt2img_pipe(model_id: str):
    global _txt2img_pipe

    if _txt2img_pipe is not None:
        return _txt2img_pipe

    import torch
    from diffusers.pipelines.auto_pipeline import AutoPipelineForText2Image

    device, dtype = _device_config()
    kwargs = {"torch_dtype": dtype}
    if device != "cpu" and dtype == torch.float16:
        kwargs["variant"] = "fp16"

    _txt2img_pipe = AutoPipelineForText2Image.from_pretrained(model_id, **kwargs)
    _txt2img_pipe.to(device)
    _txt2img_pipe.set_progress_bar_config(disable=True)
    return _txt2img_pipe


def _get_img2img_pipe(model_id: str):
    global _img2img_pipe

    if _img2img_pipe is not None:
        return _img2img_pipe

    import torch
    from diffusers.pipelines.auto_pipeline import AutoPipelineForImage2Image

    device, dtype = _device_config()
    kwargs = {"torch_dtype": dtype}
    if device != "cpu" and dtype == torch.float16:
        kwargs["variant"] = "fp16"

    _img2img_pipe = AutoPipelineForImage2Image.from_pretrained(model_id, **kwargs)
    _img2img_pipe.to(device)
    _img2img_pipe.set_progress_bar_config(disable=True)
    return _img2img_pipe


def _compose_init_image(head_sprite_path: Path, body_sprite_path: Path) -> Image.Image:
    """Build a 512x512 overlapped conditioning image for img2img.

    Overlapping both sprites encourages SDXL to produce a single fused creature
    instead of two separate characters.
    """
    head = Image.open(head_sprite_path).convert("RGBA").resize((320, 320), _NEAREST)
    body = Image.open(body_sprite_path).convert("RGBA").resize((320, 320), _NEAREST)

    # Make donor partially transparent so features blend instead of duplicating.
    body_alpha = body.split()[3].point(lambda a: int(a * 0.55))
    body.putalpha(body_alpha)

    canvas = Image.new("RGBA", (512, 512), (255, 255, 255, 255))
    canvas.paste(head, (96, 96), head)
    canvas.paste(body, (96, 96), body)
    return canvas.convert("RGB")


def _white_to_alpha(img: Image.Image, threshold: int = 248) -> Image.Image:
    rgba = img.convert("RGBA")
    px = rgba.load()
    if px is None:
        return rgba
    width, height = rgba.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = cast(Tuple[int, int, int, int], px[x, y])
            if r >= threshold and g >= threshold and b >= threshold:
                px[x, y] = (r, g, b, 0)
    return rgba


def _resize_to_sprite_canvas(img: Image.Image, size: int = 96) -> Image.Image:
    rgba = img.convert("RGBA")
    alpha = rgba.split()[3]
    bbox = alpha.getbbox()
    if bbox:
        rgba = rgba.crop(bbox)

    w, h = rgba.size
    if w <= 0 or h <= 0:
        return Image.new("RGBA", (size, size), (0, 0, 0, 0))

    scale = min(size / w, size / h)
    new_w = max(1, int(w * scale))
    new_h = max(1, int(h * scale))
    resized = rgba.resize((new_w, new_h), _NEAREST)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - new_w) // 2
    y = size - new_h
    canvas.paste(resized, (x, y), resized)
    return canvas


def _build_prompt(head_name: str, body_name: str) -> str:
    return (
        f"A single Pokemon fusion sprite combining {head_name} and {body_name}, "
        "pixel art, 96x96, Gen 5 Pokemon Black and White battle sprite style, "
        "front-facing, centered creature, transparent background, clean outline, "
        "limited palette, no text, no watermark"
    )


def _generate_diffusers_image(
    model_id: str,
    head_name: str,
    body_name: str,
    head_sprite_path: Optional[Path],
    body_sprite_path: Optional[Path],
    steps: int,
    strength: float,
    seed: Optional[int],
) -> Image.Image:
    import torch

    prompt = _build_prompt(head_name, body_name)
    negative_prompt = "text, watermark, logo, multiple creatures, realistic photo"
    device, _ = _device_config()
    generator = None
    if seed is not None:
        generator = torch.Generator(device=device).manual_seed(seed)

    use_img2img = head_sprite_path is not None and body_sprite_path is not None
    if use_img2img:
        assert head_sprite_path is not None and body_sprite_path is not None
        pipe = _get_img2img_pipe(model_id)
        init_image = _compose_init_image(head_sprite_path, body_sprite_path)
        effective_steps = max(2, int(max(steps, 2) / max(strength, 0.1)))
        return pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            image=init_image,
            strength=strength,
            num_inference_steps=effective_steps,
            guidance_scale=0.0,
            generator=generator,
        ).images[0]

    pipe = _get_txt2img_pipe(model_id)
    return pipe(
        prompt=prompt,
        negative_prompt=negative_prompt,
        num_inference_steps=max(2, steps),
        guidance_scale=0.0,
        generator=generator,
    ).images[0]


def main():
    parser = argparse.ArgumentParser(description="On-demand fusion sprite generator")
    parser.add_argument("--base", required=True, help="Head/base dex number")
    parser.add_argument("--donor", required=True, help="Body/donor dex number")
    parser.add_argument("--backend", default="diffusers", help="Generation backend (must be diffusers/SDXL)")
    parser.add_argument("--output", required=True, help="Output PNG path")
    parser.add_argument("--base-sprites", default="", help="Base sprites directory override")
    args = parser.parse_args()

    head_num = int(args.base)
    body_num = int(args.donor)
    output_path = Path(args.output)

    backend = str(args.backend or "").strip().lower()
    if backend not in {"diffusers", "sdxl", "sdxl-turbo", "sdxl_turbo"}:
        print(
            f"Error: Unsupported backend '{args.backend}'. This generator only supports SDXL diffusers.",
            file=sys.stderr,
        )
        sys.exit(2)

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

    head_name = dex_to_species_name(head_num)
    body_name = dex_to_species_name(body_num)

    model_id = os.environ.get("FUSION_DIFFUSERS_MODEL", "stabilityai/sdxl-turbo")
    steps = int(os.environ.get("FUSION_DIFFUSERS_STEPS", "4"))
    strength = float(os.environ.get("FUSION_DIFFUSERS_STRENGTH", "0.72"))
    seed_raw = os.environ.get("FUSION_DIFFUSERS_SEED", "").strip()
    seed = int(seed_raw) if seed_raw else None

    try:
        generated = _generate_diffusers_image(
            model_id=model_id,
            head_name=head_name,
            body_name=body_name,
            head_sprite_path=head_sprite_path,
            body_sprite_path=body_sprite_path,
            steps=steps,
            strength=strength,
            seed=seed,
        )
    except Exception as err:
        print(
            "Error: SDXL diffusers generation failed. "
            "Ensure diffusers/torch/transformers/accelerate/safetensors are installed.\n"
            f"Details: {err}",
            file=sys.stderr,
        )
        sys.exit(1)

    result = _resize_to_sprite_canvas(_white_to_alpha(generated), size=96)

    # Ensure output directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Save at 1x scale (96x96) for consistency with fusion sprite consumers.
    result.save(str(output_path), format="PNG")
    print(
        f"Generated SDXL fusion: {head_num}.{body_num} ({head_name}+{body_name}) -> {output_path}"
    )


if __name__ == "__main__":
    main()
