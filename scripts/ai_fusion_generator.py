"""
AI-Powered Fusion Sprite Generator for PokéTTRPG
==================================================

Uses AI image generation to create NEW clean fusion sprites instead of
cut-and-paste pixel manipulation.

Supports three backends:
  1. CLOUD (Replicate API) — Best quality, ~$0.15/image
  2. LOCAL (Qwen-Image GGUF via stable-diffusion.cpp) — Free, runs on CPU/GPU
  3. DIFFUSERS (HuggingFace diffusers pipeline) — Free, needs GPU (or slow CPU)

For Raspberry Pi AI HAT+ 2 (Hailo-10H, 40 TOPS, 8GB):
  The Hailo NPU doesn't natively support diffusion model architectures yet.
  Use LOCAL mode with stable-diffusion.cpp on the Pi5 CPU — sprite-sized (96×96)
  images are small enough that generation is feasible even without GPU.
  Qwen-Image Q2_K GGUF (7.3GB) fits in the HAT+'s 8GB onboard RAM.

Pipeline:
  1. Load two Pokemon reference sprites (base + donor)
  2. Send to AI model with a fusion prompt
  3. Post-process the output:
     a. Remove background → transparent PNG
     b. Downscale to 96×96 with nearest-neighbor
     c. Reduce palette to 16 colors via K-means
     d. Save as game-ready sprite

Requirements:
  Cloud:  pip install replicate Pillow numpy scikit-learn
  Local:  Download stable-diffusion.cpp + Qwen-Image GGUF
  Diffusers: pip install diffusers transformers torch Pillow numpy scikit-learn

Usage:
  # Cloud (Replicate API)
  export REPLICATE_API_TOKEN=r8_...
  python ai_fusion_generator.py --base Pikachu --donor Charizard

  # Local (Qwen-Image GGUF via stable-diffusion.cpp)
  python ai_fusion_generator.py --base Pikachu --donor Charizard --backend local

  # HuggingFace Diffusers (needs GPU)
  python ai_fusion_generator.py --base Pikachu --donor Charizard --backend diffusers
"""

import argparse
import base64
import io
import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image
from sklearn.cluster import KMeans


# ── Configuration ─────────────────────────────────────────────

SPRITE_DIR = Path(__file__).parent.parent / "training_output" / "base_sprites_all"
SHOWDOWN_DIR = Path(__file__).parent.parent / "tauri-app" / "public" / "vendor" / "showdown" / "sprites" / "gen5"
NAMES_FILE = Path(__file__).parent / "pokemon_names.json"
OUTPUT_DIR = Path(__file__).parent.parent / "dreamo_test_results" / "ai_fusions"

GRID_SIZE = 96  # Target sprite dimensions

# Supported AI models on Replicate
MODELS = {
    "nano-banana-pro": "google/nano-banana-pro",
    "gpt-image":       "openai/gpt-image-1.5",
    "imagen-4":        "google/imagen-4",
    "ideogram":        "ideogram-ai/ideogram-v3-turbo",
    "flux-kontext":    "black-forest-labs/flux-kontext-pro",
}

DEFAULT_MODEL = "nano-banana-pro"


# ── Pokemon Data ──────────────────────────────────────────────

def load_pokemon_names() -> dict:
    """Load pokemon_names.json → {num_str: name}"""
    with open(NAMES_FILE) as f:
        return json.load(f)

def name_to_id(name: str) -> str:
    """Convert display name to Showdown sprite ID."""
    return name.lower().replace(" ", "").replace("'", "").replace(".", "").replace("-", "")

def find_sprite_path(identifier: str) -> Optional[Path]:
    """Find sprite by name, ID, or dex number."""
    # Try as dex number
    num_path = SPRITE_DIR / f"{identifier}.png"
    if num_path.exists():
        return num_path

    # Try as showdown name in gen5 sprites
    sid = name_to_id(identifier)
    showdown_path = SHOWDOWN_DIR / f"{sid}.png"
    if showdown_path.exists():
        return showdown_path

    # Try searching pokemon_names.json
    names = load_pokemon_names()
    for num, name in names.items():
        if name.lower() == identifier.lower() or name_to_id(name) == sid:
            p = SPRITE_DIR / f"{num}.png"
            if p.exists():
                return p
            break

    return None

def image_to_base64(img: Image.Image, fmt: str = "PNG") -> str:
    """Convert PIL Image to base64 data URI."""
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/{fmt.lower()};base64,{b64}"

def image_to_tempfile(img: Image.Image, name: str = "sprite") -> str:
    """Save to temp file, return path (needed for Replicate file inputs)."""
    tmp_dir = OUTPUT_DIR / "_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    path = tmp_dir / f"{name}.png"
    img.save(path, "PNG")
    return str(path)


# ── AI Generation ─────────────────────────────────────────────

def build_fusion_prompt(base_name: str, donor_name: str, style: str = "pixel_art") -> str:
    """Build a detailed prompt for AI fusion sprite generation."""
    if style == "pixel_art":
        return (
            f"Create a single Pokemon fusion sprite combining {base_name} and {donor_name}. "
            f"The creature should have {base_name}'s body structure and {donor_name}'s features, "
            f"colors, and special elements blended naturally into one cohesive design. "
            f"Style: 96x96 pixel art sprite, Gen 5 Pokemon Black/White style, "
            f"front-facing battle pose, transparent background, clean outlines, "
            f"limited color palette (16 colors max), no text, no watermark. "
            f"The sprite should look like an official Pokemon sprite, not a mashup."
        )
    elif style == "concept":
        return (
            f"Design a new Pokemon that is a fusion of {base_name} and {donor_name}. "
            f"Combine their most iconic features into one cohesive creature: "
            f"blend body shapes, color schemes, and signature elements naturally. "
            f"Digital art, clean lines, transparent background, front-facing pose, "
            f"centered on canvas, no text or labels."
        )
    else:
        return (
            f"A Pokemon fusion of {base_name} and {donor_name}, "
            f"pixel art sprite, 96x96, transparent background, "
            f"Gen 5 style, battle pose, clean."
        )


def generate_with_replicate(
    prompt: str,
    reference_images: list[Path],
    model_key: str = DEFAULT_MODEL,
    resolution: str = "1K",
    aspect_ratio: str = "1:1",
) -> Optional[Image.Image]:
    """Generate an image using Replicate API."""
    try:
        import replicate
    except ImportError:
        print("ERROR: Install replicate: pip install replicate")
        return None

    token = os.environ.get("REPLICATE_API_TOKEN")
    if not token:
        print("ERROR: Set REPLICATE_API_TOKEN environment variable")
        print("  Get one free at https://replicate.com/account/api-tokens")
        return None

    model_id = MODELS.get(model_key, model_key)
    print(f"  Using model: {model_id}")

    # Build inputs based on model
    inputs = {
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "output_format": "png",
        "safety_filter_level": "block_only_high",
    }

    if model_key == "nano-banana-pro":
        inputs["resolution"] = resolution
        # Add reference images as file inputs
        if reference_images:
            file_inputs = []
            for ref_path in reference_images:
                file_inputs.append(open(str(ref_path), "rb"))
            inputs["image_input"] = file_inputs

    elif model_key == "gpt-image":
        inputs["size"] = "1024x1024"
        inputs["quality"] = "high"
        if reference_images:
            inputs["image"] = open(str(reference_images[0]), "rb")

    elif model_key == "imagen-4":
        inputs["aspect_ratio"] = "1:1"

    elif model_key == "ideogram":
        inputs["aspect_ratio"] = "1:1"
        inputs["style_type"] = "Design"

    try:
        print(f"  Sending request to {model_id}...")
        output = replicate.run(model_id, input=inputs)

        # Close any open file handles
        for v in inputs.values():
            if hasattr(v, 'close'):
                v.close()
            elif isinstance(v, list):
                for item in v:
                    if hasattr(item, 'close'):
                        item.close()

        # Handle output format (varies by model)
        if isinstance(output, str):
            # URL string
            import urllib.request
            with urllib.request.urlopen(output) as resp:
                img_data = resp.read()
            return Image.open(io.BytesIO(img_data))
        elif isinstance(output, list) and output:
            url = str(output[0])
            import urllib.request
            with urllib.request.urlopen(url) as resp:
                img_data = resp.read()
            return Image.open(io.BytesIO(img_data))
        elif hasattr(output, 'read'):
            return Image.open(output)
        else:
            print(f"  Unexpected output type: {type(output)}")
            return None

    except Exception as e:
        print(f"  ERROR: {e}")
        return None


# ── Local Generation (stable-diffusion.cpp + Qwen-Image GGUF) ──

# Default paths for local model files
LOCAL_MODEL_DIR = Path(__file__).parent.parent / "models" / "qwen-image"
SD_CPP_BINARY = Path(__file__).parent.parent / "vendor" / "stable-diffusion.cpp" / "sd"

# GGUF models ranked by size/quality (smallest → largest)
LOCAL_MODELS = {
    "qwen-q2":  "Qwen-Image-2512-Q2_K.gguf",      # 7.3 GB — fits RPi HAT+ 2
    "qwen-q4":  "Qwen-Image-2512-Q4_0.gguf",       # 11.9 GB
    "qwen-q5":  "Qwen-Image-2512-Q5_K_M.gguf",     # 15 GB
    "qwen-q8":  "Qwen-Image-2512-Q8_0.gguf",       # 21.8 GB
}

DEFAULT_LOCAL_MODEL = "qwen-q4"


def check_local_setup() -> dict:
    """Check if local generation dependencies are available."""
    status = {
        "sd_cpp": SD_CPP_BINARY.exists() or bool(which_sd_cpp()),
        "model": False,
        "model_path": None,
    }

    for key, filename in LOCAL_MODELS.items():
        model_path = LOCAL_MODEL_DIR / filename
        if model_path.exists():
            status["model"] = True
            status["model_path"] = model_path
            status["model_key"] = key
            break

    return status


def which_sd_cpp() -> Optional[str]:
    """Find stable-diffusion.cpp binary on PATH."""
    import shutil
    for name in ["sd", "sd.exe", "stable-diffusion", "stable-diffusion.exe"]:
        found = shutil.which(name)
        if found:
            return found
    return None


def generate_with_sd_cpp(
    prompt: str,
    model_path: Optional[Path] = None,
    width: int = 512,
    height: int = 512,
    steps: int = 20,
    cfg_scale: float = 4.0,
    seed: int = -1,
) -> Optional[Image.Image]:
    """Generate an image using stable-diffusion.cpp with a GGUF model.

    This is the primary local backend for running Qwen-Image on CPU/GPU
    without Python ML frameworks — suitable for Raspberry Pi.
    """
    import subprocess
    import tempfile

    # Find sd binary
    sd_bin = str(SD_CPP_BINARY) if SD_CPP_BINARY.exists() else which_sd_cpp()
    if not sd_bin:
        print("  ERROR: stable-diffusion.cpp binary not found")
        print("  Install: https://github.com/leejet/stable-diffusion.cpp")
        print(f"  Expected at: {SD_CPP_BINARY}")
        return None

    # Find model
    if model_path is None:
        for key, filename in LOCAL_MODELS.items():
            p = LOCAL_MODEL_DIR / filename
            if p.exists():
                model_path = p
                break
    if model_path is None or not model_path.exists():
        print(f"  ERROR: No GGUF model found in {LOCAL_MODEL_DIR}")
        print("  Download from: https://huggingface.co/unsloth/Qwen-Image-2512-GGUF")
        print(f"  Place in: {LOCAL_MODEL_DIR}/")
        return None

    # Output to temp file
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        out_path = tmp.name

    cmd = [
        sd_bin,
        "--mode", "txt2img",
        "-m", str(model_path),
        "-p", prompt,
        "-o", out_path,
        "-W", str(width),
        "-H", str(height),
        "--steps", str(steps),
        "--cfg-scale", str(cfg_scale),
    ]
    if seed >= 0:
        cmd.extend(["--seed", str(seed)])

    print(f"  Running stable-diffusion.cpp...")
    print(f"  Model: {model_path.name}")
    print(f"  Resolution: {width}x{height}, Steps: {steps}")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True, text=True,
            timeout=600,  # 10 min timeout for RPi
        )
        if result.returncode != 0:
            print(f"  sd.cpp failed: {result.stderr[:500]}")
            return None

        if os.path.exists(out_path):
            img = Image.open(out_path)
            os.unlink(out_path)
            return img
        else:
            print(f"  No output file produced")
            return None

    except subprocess.TimeoutExpired:
        print("  TIMEOUT: Generation took > 10 minutes")
        return None
    except FileNotFoundError:
        print(f"  ERROR: Binary not found: {sd_bin}")
        return None


def generate_with_diffusers(
    prompt: str,
    negative_prompt: str = "",
    width: int = 512,
    height: int = 512,
    steps: int = 30,
    cfg_scale: float = 4.0,
    model_name: str = "Qwen/Qwen-Image-2512",
    seed: int = -1,
) -> Optional[Image.Image]:
    """Generate an image using HuggingFace diffusers pipeline.

    Requires: pip install diffusers transformers torch
    Needs GPU for reasonable speed with the 20B Qwen-Image model.
    For CPU-only, consider using sd.cpp backend instead.
    """
    try:
        import torch
        from diffusers import DiffusionPipeline
    except ImportError:
        print("  ERROR: Install diffusers: pip install diffusers transformers torch")
        return None

    print(f"  Loading diffusers pipeline: {model_name}")
    print(f"  This may take a while on first run (downloading ~40GB)...")

    try:
        if torch.cuda.is_available():
            torch_dtype = torch.bfloat16
            device = "cuda"
        else:
            torch_dtype = torch.float32
            device = "cpu"
            print("  WARNING: Running on CPU — expect VERY slow generation")

        pipe = DiffusionPipeline.from_pretrained(
            model_name, torch_dtype=torch_dtype
        ).to(device)

        generator = None
        if seed >= 0:
            generator = torch.Generator(device=device).manual_seed(seed)

        neg = negative_prompt or (
            "blurry, low quality, deformed, text, watermark, "
            "multiple creatures, split image, comparison"
        )

        image = pipe(
            prompt=prompt,
            negative_prompt=neg,
            width=width,
            height=height,
            num_inference_steps=steps,
            true_cfg_scale=cfg_scale,
            generator=generator,
        ).images[0]

        return image

    except Exception as e:
        print(f"  ERROR: {e}")
        return None


# ── Post-Processing Pipeline ─────────────────────────────────

def remove_background(img: Image.Image) -> Image.Image:
    """Remove background, keeping only the Pokemon sprite.

    Uses simple color-based removal for solid backgrounds,
    or alpha channel if already transparent.
    """
    img = img.convert("RGBA")
    pixels = np.array(img)

    # If already mostly transparent, return as-is
    alpha = pixels[:, :, 3]
    if np.mean(alpha < 128) > 0.3:
        return img

    # Sample corner pixels to detect background color
    h, w = pixels.shape[:2]
    corners = [
        pixels[0, 0, :3], pixels[0, w-1, :3],
        pixels[h-1, 0, :3], pixels[h-1, w-1, :3],
        pixels[0, w//2, :3], pixels[h-1, w//2, :3],
    ]
    bg_color = np.median(corners, axis=0).astype(int)

    # Remove pixels close to background color
    diff = np.abs(pixels[:, :, :3].astype(int) - bg_color)
    bg_mask = np.all(diff < 30, axis=2)

    # Flood fill from edges to handle only actual background
    from scipy import ndimage
    # Mark edges as seed
    edge_mask = np.zeros_like(bg_mask)
    edge_mask[0, :] = bg_mask[0, :]
    edge_mask[-1, :] = bg_mask[-1, :]
    edge_mask[:, 0] = bg_mask[:, 0]
    edge_mask[:, -1] = bg_mask[:, -1]

    # Flood fill
    labeled, _ = ndimage.label(bg_mask)
    edge_labels = set(labeled[edge_mask].flatten()) - {0}
    final_bg = np.isin(labeled, list(edge_labels))

    pixels[final_bg, 3] = 0
    return Image.fromarray(pixels)


def remove_background_simple(img: Image.Image, threshold: int = 30) -> Image.Image:
    """Simple background removal without scipy dependency."""
    img = img.convert("RGBA")
    pixels = np.array(img)

    alpha = pixels[:, :, 3]
    if np.mean(alpha < 128) > 0.3:
        return img

    h, w = pixels.shape[:2]
    corners = [
        pixels[0, 0, :3], pixels[0, w-1, :3],
        pixels[h-1, 0, :3], pixels[h-1, w-1, :3],
    ]
    bg_color = np.median(corners, axis=0).astype(int)

    diff = np.abs(pixels[:, :, :3].astype(int) - bg_color)
    bg_mask = np.all(diff < threshold, axis=2)

    # Simple flood fill from edges using BFS
    visited = np.zeros((h, w), dtype=bool)
    queue = []

    # Seed from edges
    for x in range(w):
        if bg_mask[0, x]: queue.append((0, x))
        if bg_mask[h-1, x]: queue.append((h-1, x))
    for y in range(h):
        if bg_mask[y, 0]: queue.append((y, 0))
        if bg_mask[y, w-1]: queue.append((y, w-1))

    while queue:
        cy, cx = queue.pop()
        if visited[cy, cx]:
            continue
        visited[cy, cx] = True
        pixels[cy, cx, 3] = 0
        for dy, dx in [(-1,0),(1,0),(0,-1),(0,1)]:
            ny, nx = cy+dy, cx+dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and bg_mask[ny, nx]:
                queue.append((ny, nx))

    return Image.fromarray(pixels)


def crop_to_content(img: Image.Image, padding: int = 2) -> Image.Image:
    """Crop to non-transparent content with padding."""
    img = img.convert("RGBA")
    alpha = np.array(img)[:, :, 3]
    rows = np.any(alpha > 0, axis=1)
    cols = np.any(alpha > 0, axis=0)

    if not rows.any():
        return img

    top, bottom = np.where(rows)[0][[0, -1]]
    left, right = np.where(cols)[0][[0, -1]]

    top = max(0, top - padding)
    left = max(0, left - padding)
    bottom = min(img.height - 1, bottom + padding)
    right = min(img.width - 1, right + padding)

    return img.crop((left, top, right + 1, bottom + 1))


def resize_to_sprite(img: Image.Image, size: int = GRID_SIZE) -> Image.Image:
    """Resize to target sprite dimensions, maintaining aspect ratio, centered."""
    img = crop_to_content(img)
    w, h = img.size

    # Scale to fit within size×size
    scale = min(size / w, size / h)
    new_w = max(1, int(w * scale))
    new_h = max(1, int(h * scale))

    # Use NEAREST for pixel art, LANCZOS for concept art being pixelated
    resized = img.resize((new_w, new_h), Image.NEAREST if max(w, h) <= 256 else Image.LANCZOS)

    # Center on transparent canvas
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset_x = (size - new_w) // 2
    offset_y = size - new_h  # Bottom-align (like Pokemon sprites)
    canvas.paste(resized, (offset_x, offset_y), resized)

    return canvas


def reduce_palette(img: Image.Image, n_colors: int = 16) -> Image.Image:
    """Reduce image to n_colors using K-means clustering."""
    img = img.convert("RGBA")
    pixels = np.array(img)
    h, w = pixels.shape[:2]

    # Only cluster non-transparent pixels
    alpha = pixels[:, :, 3]
    opaque_mask = alpha > 30
    opaque_pixels = pixels[opaque_mask][:, :3]

    if len(opaque_pixels) < n_colors:
        return img

    kmeans = KMeans(n_clusters=n_colors, random_state=42, n_init=3, max_iter=100)
    labels = kmeans.fit_predict(opaque_pixels)
    centers = kmeans.cluster_centers_.astype(np.uint8)

    # Replace pixels with cluster centers
    result = pixels.copy()
    rgb_flat = result[:, :, :3].reshape(-1, 3)
    alpha_flat = result[:, :, 3].reshape(-1)

    opaque_indices = np.where(alpha_flat > 30)[0]
    for i, idx in enumerate(opaque_indices):
        rgb_flat[idx] = centers[labels[i]]

    result[:, :, :3] = rgb_flat.reshape(h, w, 3)

    # Snap alpha to 0 or 255
    result[:, :, 3] = np.where(alpha > 30, 255, 0)

    return Image.fromarray(result)


def postprocess_sprite(img: Image.Image, n_colors: int = 16) -> Image.Image:
    """Full post-processing pipeline: bg removal → crop → resize → palette reduce."""
    print("  Post-processing: removing background...")
    img = remove_background_simple(img)

    print("  Post-processing: cropping to content...")
    img = crop_to_content(img)

    print("  Post-processing: resizing to 96×96...")
    img = resize_to_sprite(img, GRID_SIZE)

    print(f"  Post-processing: reducing palette to {n_colors} colors...")
    img = reduce_palette(img, n_colors)

    return img


# ── Main Pipeline ─────────────────────────────────────────────

def generate_fusion(
    base: str,
    donor: str,
    model: str = DEFAULT_MODEL,
    backend: str = "cloud",
    style: str = "pixel_art",
    n_colors: int = 16,
    save_raw: bool = True,
) -> Optional[Path]:
    """Generate a single AI fusion sprite.

    Args:
        base: Base Pokemon name/number
        donor: Donor Pokemon name/number
        model: AI model key (see MODELS dict for cloud, LOCAL_MODELS for local)
        backend: "cloud" (Replicate API), "local" (sd.cpp + GGUF), "diffusers"
        style: Prompt style ("pixel_art", "concept", "minimal")
        n_colors: Palette size for post-processing
        save_raw: Also save the unprocessed AI output

    Returns:
        Path to the generated sprite, or None on failure
    """
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Resolve names
    names = load_pokemon_names()
    base_name = base
    donor_name = donor
    for num, name in names.items():
        if name.lower() == base.lower() or num == str(base):
            base_name = name
        if name.lower() == donor.lower() or num == str(donor):
            donor_name = name

    fusion_id = f"{name_to_id(base_name)}_{name_to_id(donor_name)}"
    print(f"\n{'='*60}")
    print(f"Generating fusion: {base_name} + {donor_name}")
    print(f"  Backend: {backend} | Model: {model} | Style: {style}")

    # Find reference sprites
    ref_images = []
    base_path = find_sprite_path(base)
    donor_path = find_sprite_path(donor)

    if base_path:
        ref_images.append(base_path)
        print(f"  Base sprite: {base_path}")
    else:
        print(f"  WARNING: No sprite found for {base}")

    if donor_path:
        ref_images.append(donor_path)
        print(f"  Donor sprite: {donor_path}")
    else:
        print(f"  WARNING: No sprite found for {donor}")

    # Generate prompt
    prompt = build_fusion_prompt(base_name, donor_name, style)
    print(f"  Prompt: {prompt[:100]}...")

    # Call AI model using selected backend
    t0 = time.time()
    raw_img = None

    if backend == "cloud":
        raw_img = generate_with_replicate(prompt, ref_images, model)
    elif backend == "local":
        # Find local GGUF model
        local_model = model if model in LOCAL_MODELS else DEFAULT_LOCAL_MODEL
        model_path = LOCAL_MODEL_DIR / LOCAL_MODELS.get(local_model, "")
        if not model_path.exists():
            model_path = None  # Let generate_with_sd_cpp find it
        raw_img = generate_with_sd_cpp(
            prompt, model_path=model_path,
            width=512, height=512, steps=20,
        )
    elif backend == "diffusers":
        raw_img = generate_with_diffusers(
            prompt, width=512, height=512, steps=30,
        )
    else:
        print(f"  ERROR: Unknown backend '{backend}'")
        print("  Valid backends: cloud, local, diffusers")
        return None

    elapsed = time.time() - t0

    if raw_img is None:
        print(f"  FAILED after {elapsed:.1f}s")
        return None

    print(f"  Generated in {elapsed:.1f}s, size: {raw_img.size}")

    # Save raw output
    if save_raw:
        raw_dir = OUTPUT_DIR / "raw"
        raw_dir.mkdir(exist_ok=True)
        raw_path = raw_dir / f"{fusion_id}_{backend}_{model}.png"
        raw_img.save(raw_path)
        print(f"  Raw saved: {raw_path}")

    # Post-process
    sprite = postprocess_sprite(raw_img, n_colors)

    # Save final sprite
    out_path = OUTPUT_DIR / f"{fusion_id}_{backend}_{model}.png"
    sprite.save(out_path, "PNG")
    print(f"  Final sprite: {out_path}")

    return out_path


def batch_generate(pairs_file: str, model: str = DEFAULT_MODEL, backend: str = "cloud", style: str = "pixel_art"):
    """Generate fusions from a JSON file of pairs."""
    with open(pairs_file) as f:
        pairs = json.load(f)

    results = []
    for i, pair in enumerate(pairs):
        base = pair.get("base", pair[0] if isinstance(pair, list) else "")
        donor = pair.get("donor", pair[1] if isinstance(pair, list) else "")
        if not base or not donor:
            print(f"Skipping invalid pair: {pair}")
            continue

        print(f"\n[{i+1}/{len(pairs)}]")
        result = generate_fusion(base, donor, model, backend=backend, style=style)
        results.append({
            "base": base,
            "donor": donor,
            "output": str(result) if result else None,
            "success": result is not None,
        })

    # Save results manifest
    manifest_path = OUTPUT_DIR / "batch_results.json"
    with open(manifest_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nBatch complete: {sum(r['success'] for r in results)}/{len(results)} succeeded")
    print(f"Results manifest: {manifest_path}")

    # Generate HTML gallery
    generate_gallery(results)


def generate_gallery(results: list):
    """Generate an HTML gallery of fusion results."""
    html_path = OUTPUT_DIR / "gallery.html"

    cards_html = []
    for r in results:
        if not r["success"]:
            continue
        out_path = Path(r["output"])
        raw_path = OUTPUT_DIR / "raw" / out_path.name
        card = f"""
        <div class="card">
          <div class="fusion-name">{r['base']} + {r['donor']}</div>
          <div class="images">
            {'<img src="raw/' + out_path.name + '" class="raw" title="AI output">' if raw_path.exists() else ''}
            <img src="{out_path.name}" class="sprite" title="96x96 sprite">
          </div>
        </div>
        """
        cards_html.append(card)

    html = f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>AI Fusion Gallery</title>
<style>
body {{ background: #1a1a2e; color: #eee; font-family: system-ui; padding: 20px; }}
h1 {{ text-align: center; }}
.grid {{ display: flex; flex-wrap: wrap; gap: 16px; justify-content: center; }}
.card {{ background: #16213e; border-radius: 12px; padding: 12px; text-align: center; width: 280px; }}
.fusion-name {{ font-weight: bold; margin-bottom: 8px; font-size: 1.1em; }}
.images {{ display: flex; gap: 8px; justify-content: center; align-items: flex-end; }}
.raw {{ max-width: 160px; max-height: 160px; border-radius: 8px; }}
.sprite {{ width: 96px; height: 96px; image-rendering: pixelated; background: repeating-conic-gradient(#333 0% 25%, #444 0% 50%) 0 0 / 16px 16px; border-radius: 4px; }}
</style>
</head><body>
<h1>AI Pokemon Fusion Sprites</h1>
<p style="text-align:center; opacity:0.7;">{len(cards_html)} fusions generated</p>
<div class="grid">
{''.join(cards_html)}
</div>
</body></html>"""

    with open(html_path, "w") as f:
        f.write(html)
    print(f"Gallery: {html_path}")


# ── Default Fusion Pairs ──────────────────────────────────────

DEFAULT_PAIRS = [
    ["Charizard", "Blastoise"],
    ["Pikachu", "Eevee"],
    ["Mewtwo", "Mew"],
    ["Gengar", "Alakazam"],
    ["Gyarados", "Dragonite"],
    ["Scyther", "Pinsir"],
    ["Arcanine", "Ninetales"],
    ["Lapras", "Articuno"],
    ["Machamp", "Hitmonlee"],
    ["Snorlax", "Munchlax"],
    ["Lucario", "Zoroark"],
    ["Garchomp", "Salamence"],
    ["Umbreon", "Espeon"],
    ["Gardevoir", "Gallade"],
    ["Tyranitar", "Aggron"],
    ["Blaziken", "Infernape"],
    ["Bulbasaur", "Squirtle"],
    ["Jigglypuff", "Clefairy"],
]


# ── CLI ───────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="AI Pokemon Fusion Sprite Generator")
    parser.add_argument("--base", help="Base Pokemon name or dex number")
    parser.add_argument("--donor", help="Donor Pokemon name or dex number")
    parser.add_argument("--batch", help="JSON file with pairs [{base, donor}, ...]")
    parser.add_argument("--backend", default="cloud",
                        choices=["cloud", "local", "diffusers"],
                        help="Generation backend: cloud (Replicate API), local (sd.cpp + GGUF), diffusers")
    parser.add_argument("--model", default=DEFAULT_MODEL,
                        help=f"AI model key (default: {DEFAULT_MODEL}). "
                             f"Cloud: {', '.join(MODELS.keys())}. "
                             f"Local: {', '.join(LOCAL_MODELS.keys())}.")
    parser.add_argument("--style", default="pixel_art", choices=["pixel_art", "concept", "minimal"],
                        help="Prompt style")
    parser.add_argument("--colors", type=int, default=16, help="Palette size")
    parser.add_argument("--defaults", action="store_true", help="Run default fusion pairs")
    parser.add_argument("--test", action="store_true", help="Test with 3 pairs only")
    parser.add_argument("--check", action="store_true", help="Check local setup status")

    args = parser.parse_args()

    if args.check:
        print("Checking local generation setup...")
        status = check_local_setup()
        print(f"  stable-diffusion.cpp: {'FOUND' if status['sd_cpp'] else 'NOT FOUND'}")
        print(f"  GGUF model: {'FOUND' if status['model'] else 'NOT FOUND'}")
        if status.get("model_path"):
            print(f"    → {status['model_path']}")
        if not status["sd_cpp"]:
            print(f"\n  Install sd.cpp: https://github.com/leejet/stable-diffusion.cpp")
            print(f"  Expected at: {SD_CPP_BINARY}")
        if not status["model"]:
            print(f"\n  Download GGUF: https://huggingface.co/unsloth/Qwen-Image-2512-GGUF")
            print(f"  Place in: {LOCAL_MODEL_DIR}/")
            print(f"  Recommended for RPi: {LOCAL_MODELS['qwen-q2']} (7.3 GB)")
            print(f"  Recommended for PC:  {LOCAL_MODELS['qwen-q4']} (11.9 GB)")
        return

    if args.base and args.donor:
        generate_fusion(args.base, args.donor, args.model,
                        backend=args.backend, style=args.style, n_colors=args.colors)
    elif args.batch:
        batch_generate(args.batch, args.model, backend=args.backend, style=args.style)
    elif args.defaults or args.test:
        pairs = DEFAULT_PAIRS[:3] if args.test else DEFAULT_PAIRS
        pairs_file = OUTPUT_DIR / "_default_pairs.json"
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        with open(pairs_file, "w") as f:
            json.dump([{"base": p[0], "donor": p[1]} for p in pairs], f)
        batch_generate(str(pairs_file), args.model, backend=args.backend, style=args.style)
    else:
        parser.print_help()
        print("\n" + "="*60)
        print("BACKENDS:")
        print("  cloud     — Replicate API (best quality, ~$0.15/image)")
        print("  local     — stable-diffusion.cpp + Qwen-Image GGUF (free, CPU/GPU)")
        print("  diffusers — HuggingFace diffusers pipeline (free, needs GPU)")
        print()
        print("EXAMPLES:")
        print("  # Cloud (needs REPLICATE_API_TOKEN)")
        print("  python ai_fusion_generator.py --base Charizard --donor Blastoise")
        print()
        print("  # Local (needs sd.cpp + GGUF model)")
        print("  python ai_fusion_generator.py --base Pikachu --donor Eevee --backend local")
        print()
        print("  # Check local setup")
        print("  python ai_fusion_generator.py --check")
        print()
        print("  # Batch generate")
        print("  python ai_fusion_generator.py --test --backend cloud")
        print()
        print("RPi AI HAT+ 2 SETUP:")
        print("  1. Download: Qwen-Image-2512-Q2_K.gguf (7.3 GB, fits 8GB HAT+ RAM)")
        print("  2. Build stable-diffusion.cpp for aarch64")
        print("  3. Run: python ai_fusion_generator.py --backend local --model qwen-q2")


if __name__ == "__main__":
    main()
