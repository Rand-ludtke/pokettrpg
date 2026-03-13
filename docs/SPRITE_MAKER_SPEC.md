# Sprite Maker - Feature Specification

> Custom sprite creation, editing, AI generation, and region annotation tool
> for the PokéTTRPG Custom Mon system.

## Overview

The Sprite Maker is a new component integrated into the **Dex tab / Custom Dex Builder** area that provides a complete pipeline for creating and preparing custom Pokémon sprites:

1. **Upload & Background Removal** — Import any image, auto-remove background
2. **Pixel Painter** — Full pixel art editor for hand-drawing or editing sprites
3. **AI Sprite Generation** — Generate sprites from text prompts or modify existing ones
4. **Region Annotator** — Paint head/body/accent regions for the fusion engine

---

## 1. Upload & Background Removal

### What it does
- Accept image upload (PNG, JPG, GIF, WebP)
- Display preview at native resolution and at 96×96 (target sprite size)
- One-click background removal
- Auto-crop and center the subject
- Scale to 96×96 with nearest-neighbor interpolation (pixel art) or bilinear (photos)

### Implementation
- **Client-side BG removal**: Use [rembg ONNX in WebAssembly](https://github.com/nicepkg/rembg-node) or a lightweight U²-Net model via ONNX Runtime Web
- **Fallback**: We already have BEN2 (Background Erase Net) in `F:\Github\DreamO\tools\BEN2.py` that runs on GPU — could offer a "Server-side removal (better quality)" option when connected to the Pi or local backend
- **Canvas operations**: Use HTML5 Canvas for crop/resize/preview

### UI
```
┌─────────────────────────────────────┐
│  📁 Upload Image    📋 Paste        │
│                                     │
│  ┌─────────────┐  ┌──────────────┐  │
│  │             │  │              │  │
│  │  Original   │→ │  BG Removed  │  │
│  │  Preview    │  │  96×96       │  │
│  │             │  │              │  │
│  └─────────────┘  └──────────────┘  │
│                                     │
│  [Remove BG]  [Auto-Crop]  [Scale]  │
│  Scaling: ○ Nearest  ○ Bilinear     │
│                                     │
│         [→ Edit in Pixel Painter]   │
│         [→ Save as Sprite]          │
└─────────────────────────────────────┘
```

---

## 2. Pixel Painter

### What it does
- 96×96 canvas (standard sprite size) with zoom (1x–12x)
- Draw pixels one at a time, or with brush sizes 1–5
- Full color picker + palette presets (Game Boy, NES, Gen5 palette, custom)
- Tools: Pencil, Eraser, Flood Fill, Line, Rectangle, Ellipse, Eyedropper
- Layer support (at minimum: background layer + sprite layer)
- Undo/Redo (Ctrl+Z / Ctrl+Y)
- Grid overlay toggle
- Mirror mode (horizontal symmetry for faster sprite creation)
- Import existing sprite to edit
- Export as PNG (96×96 or scaled)

### Can also be used to
- Create sprites from scratch
- Touch up AI-generated sprites
- Edit uploaded sprites after background removal
- Modify existing Pokémon sprites for custom variants

### Implementation
- HTML5 Canvas with pixel-level manipulation
- React component `<PixelPainter>` wrapping canvas logic
- Similar architecture to the existing annotation tool's canvas painting (annotator_full.html) but extended with more tools
- State: `Uint8ClampedArray` of RGBA data (96×96×4 = 36,864 bytes)

### UI
```
┌──────────────────────────────────────────────────────┐
│ Tools: ✏️ Pencil  🪣 Fill  📏 Line  ⬜ Rect  ⭕ Circle │
│        🔍 Eyedrop  ↔️ Mirror   ↩️ Undo  ↪️ Redo       │
│ Brush: [1] [2] [3]    Grid: [✓]    Zoom: [4x ▼]     │
├──────────────────────────────────────────────────────┤
│                                                      │
│   ┌────────────────────────────┐  ┌─────┐            │
│   │                            │  │Color│            │
│   │                            │  │Pckr │            │
│   │     96×96 Canvas           │  ├─────┤            │
│   │     (zoomed to 4x)         │  │Pltte│            │
│   │                            │  │     │            │
│   │                            │  │ 🟥🟧 │            │
│   │                            │  │ 🟨🟩 │            │
│   └────────────────────────────┘  │ 🟦🟪 │            │
│                                   └─────┘            │
│   Preview: [sprite at 1x] [sprite at 2x]            │
│                                                      │
│   [💾 Save Sprite]  [📤 Export PNG]  [→ AI Enhance]   │
└──────────────────────────────────────────────────────┘
```

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| B | Pencil/Brush |
| E | Eraser |
| G | Flood Fill |
| I | Eyedropper |
| L | Line tool |
| M | Toggle mirror |
| [ / ] | Brush size -/+ |
| Ctrl+Z | Undo |
| Ctrl+Y | Redo |
| Ctrl+G | Toggle grid |

---

## 3. AI Sprite Generation

### What it does
- Generate pixel art sprites from text prompts
- Options for style: "Gen 5 style", "Sugimori art", "Pixel art 96×96"
- Modify/enhance existing sprites with AI (img2img)
- Similar to pixelcut.ai but tailored for Pokémon sprites

### AI Backend Options

#### Option A: Local DreamO Pipeline (Best Quality)
- Already set up at `F:\Github\DreamO` with `fusion_venv`
- FLUX.1-dev + Nunchaku 4-bit quantization (fits in 8GB VRAM)
- Can do text-to-image AND image-conditioned generation
- Use as a local API server (FastAPI) that the app calls
- **Pros**: Full control, best quality, no cost
- **Cons**: Requires GPU, only works on dev machine

#### Option B: HuggingFace Inference API
- Use `ByteDance/DreamO` Gradio space (already tested with `gradio_client`)
- Free tier available, works from any machine
- **Pros**: No GPU needed, works anywhere
- **Cons**: Rate limits, queue times, less control

#### Option C: Nano Banana Pro (User mentioned this worked well)
- Investigate API integration
- Good for quick generation

### Workflow
```
User Input                     AI Pipeline                    Output
─────────                      ──────────                     ──────
"Fire/Water lizard,            → Prompt enhancement           → Generated
 blue scales, flame tail"        (add style tokens)             96×96
                               → FLUX/DreamO generate           sprite
    OR                         → Post-process:                   PNG
                                 - Remove background
Existing sprite                  - Downscale to 96×96
 + "add wings"                   - Quantize to pixel art
                               → Preview gallery
                                 (4 variants)
```

### UI
```
┌──────────────────────────────────────────────────────┐
│  🤖 AI Sprite Generator                              │
│                                                      │
│  Prompt: [Fire/Water salamander with blue scales   ] │
│                                                      │
│  Style: ○ Gen5 Pixel Art  ○ Sugimori  ○ Custom       │
│  Base Image: [None ▼] or [Upload reference]          │
│  Variations: [4]                                     │
│                                                      │
│  [✨ Generate]                                        │
│                                                      │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                    │
│  │ v1  │ │ v2  │ │ v3  │ │ v4  │                    │
│  │     │ │     │ │     │ │     │                    │
│  │ 96² │ │ 96² │ │ 96² │ │ 96² │                    │
│  └──┬──┘ └─────┘ └─────┘ └─────┘                    │
│     │                                                │
│  [→ Edit in Pixel Painter]  [→ Use as Sprite]        │
│  [→ Generate More Like This]                         │
└──────────────────────────────────────────────────────┘
```

---

## 4. Region Annotator

### What it does
After a sprite is finalized, the user paints **semantic regions** that the fusion engine uses to know which parts to swap/blend:

| Region | Color | Bit | Description |
|--------|-------|-----|-------------|
| **Head** | 🔴 Red | 1 | The head/face area — in fusions, the head species contributes this region. Includes face, eyes, ears, horns, antennae, crests — anything that makes the "face" of the Pokémon recognizable. |
| **Body** | 🔵 Blue | 2 | The main torso/body — in fusions, the body species contributes this region. Includes torso, limbs, wings, tails — the structural form of the Pokémon. |
| **Accent** | 🟢 Green | 4 | Key identifying features and markings — distinctive patterns, stripes, spots, special features (Pikachu's cheek circles, Charizard's belly flame). These are preserved from whichever species contributes them, adding personality to fusions. |
| **Outline** | ⚪ Gray | 8 | The dark outline/border pixels. Typically auto-detected. Outlines are recolored during fusion to match the resulting color scheme. |

### Why regions matter for fusions
When fusing Pokémon A (head) + Pokémon B (body):
- **A's head region** provides the face/head shape
- **B's body region** provides the body/torso shape  
- **Accents** from both species are blended/layered
- **Outlines** are recolored to unify the fusion

Without region annotations, the fusion engine has to guess where the head ends and body begins (the `sprite_regions.py` algorithm), which works ~70% of the time. Hand-painted regions give perfect results.

### Implementation
- Reuse the painting engine from the Pixel Painter (same canvas, different mode)
- Instead of RGB colors, paint with region bitmasks
- Support overlap (a pixel can be both head AND accent)
- Auto-fill from `sprite_regions.py` algorithm as a starting point
- Export as RLE-encoded bitmask array (same format as `annotator_full.html`)

### UI
Same as pixel painter but with region-specific tools:
```
┌──────────────────────────────────────────────────────┐
│  🗺️ Region Annotator                                 │
│                                                      │
│  Paint: [🔴 Head] [🔵 Body] [🟢 Accent] [⚪ Outline]  │
│         [🧹 Eraser]   Overlap: [✓]                   │
│  Brush: [1] [2] [3]   Fill: [🪣]                     │
│                                                      │
│  ┌─────────────────────────┐  Legend:                │
│  │                         │  🔴 Head — face, eyes,  │
│  │   Sprite with colored   │     horns, crest        │
│  │   region overlay        │  🔵 Body — torso, limbs │
│  │                         │     wings, tail         │
│  │                         │  🟢 Accent — markings,  │
│  │                         │     patterns, special   │
│  │                         │     features            │
│  └─────────────────────────┘  ⚪ Outline — edge      │
│                                  pixels (auto-detect)│
│  [🔮 Auto-Detect Regions]  [💾 Save]                  │
│                                                      │
│  Coverage: Head 23% | Body 45% | Accent 8% | Out 12%│
└──────────────────────────────────────────────────────┘
```

---

## Integration with Custom Dex Builder

The Sprite Maker lives inside the **Dex tab** as a modal/panel that opens when the user clicks on any sprite slot in the Custom Dex Builder:

```
CustomDexBuilder
  └── Sprite Slots (front, back, shiny, etc.)
       └── Click slot → Sprite Maker Modal
            ├── Tab 1: Upload (with BG removal)
            ├── Tab 2: Pixel Painter
            ├── Tab 3: AI Generate
            └── Tab 4: Region Annotator
                        └── Save → sprite + regions stored together
```

### Data Flow
```
Upload/Draw/AI → 96×96 PNG (data URL) → Pixel Painter (optional edit)
                                       ↓
                                Region Annotator → bitmask array
                                       ↓
                          adapter.ts saveCustomSprite()
                          + saveCustomRegions()
                                       ↓
                              localStorage / sync
```

### Storage Format
```typescript
// Existing (adapter.ts)
saveCustomSprite(id: string, slot: SpriteSlot, dataUrl: string)

// New additions
saveCustomRegions(id: string, regions: RegionData)

interface RegionData {
  width: number;        // 96
  height: number;       // 96
  bitmask: number[];    // 96×96 array, each value 0-15 (bit flags)
  rle?: number[];       // RLE-compressed version for storage/sync
  version: number;      // schema version
}
```

---

## Technical Architecture

### New Components
| Component | File | Purpose |
|-----------|------|---------|
| `SpriteMaker` | `src/ui/SpriteMaker.tsx` | Container with tabs for all 4 modes |
| `SpriteUploader` | `src/ui/sprite-maker/SpriteUploader.tsx` | Upload + BG removal |
| `PixelPainter` | `src/ui/sprite-maker/PixelPainter.tsx` | Pixel art editor |
| `AISpriteGen` | `src/ui/sprite-maker/AISpriteGen.tsx` | AI generation interface |
| `RegionAnnotator` | `src/ui/sprite-maker/RegionAnnotator.tsx` | Region painting |
| `useCanvasEngine` | `src/hooks/useCanvasEngine.ts` | Shared canvas/painting logic |
| `useSpriteAI` | `src/hooks/useSpriteAI.ts` | AI generation API calls |

### Shared Canvas Engine
The Pixel Painter and Region Annotator share a common canvas engine:
- Zoom/pan with mouse wheel + drag
- Brush painting with configurable size
- Flood fill algorithm
- Undo/redo stack (store ImageData snapshots, max 50)
- Grid overlay rendering
- Pixel-perfect cursor rendering

### Dependencies (New)
- `onnxruntime-web` — for client-side background removal (U²-Net)
- No other new deps — all painting is native Canvas API

---

## Implementation Priority

### Phase 1 — Core (MVP)
1. PixelPainter component (canvas, basic tools, color picker)
2. SpriteUploader (file upload, preview, basic resize)
3. RegionAnnotator (reuse painter with region mode)
4. Integration with CustomDexBuilder sprite slots

### Phase 2 — Enhanced
5. Background removal (ONNX client-side)
6. Layer support in PixelPainter
7. Palette presets
8. Mirror mode

### Phase 3 — AI
9. Local DreamO API server
10. AI sprite generation UI
11. img2img sprite modification
12. Batch generation + variant picker

---

## Notes
- The existing `annotator_full.html` has proven canvas painting code (brush, flood fill, region bitmask) that can be ported to React
- All sprite data stays in localStorage for offline use, syncs when connected
- 96×96 is the standard sprite size throughout the app
- The region bitmask format (bit0=head, bit1=body, bit2=accent, bit3=outline) is already established in the fusion engine
