/**
 * Fusion Generation Service — Raspberry Pi 5 + AI HAT2
 *
 * Manages on-demand and background fusion sprite generation.
 *
 * Architecture:
 *   - Python subprocess runs the splice/AI generation scripts
 *   - This service manages a job queue (background + on-demand)
 *   - On-demand requests pause background work and jump the queue
 *   - When a new Pokémon is added to the custom dex, the service
 *     enqueues all fusion pairs for that species
 *   - Results are saved as PNGs to the fusion sprites directory
 *
 * Generation modes:
 *   All fusion modes use SDXL-Turbo diffusers via ai_fusion_generator.py.
 *   "ai-gen" generates a new base sprite from a text description.
 *
 * Environment variables:
 *   FUSION_SPRITES_DIR     — output directory for fusion sprites
 *   FUSION_GEN_PYTHON      — path to Python binary (default: python3)
 *   FUSION_GEN_SCRIPTS     — path to scripts directory (ai_fusion_generator.py)
 *   FUSION_GEN_BASE_SPRITES — path to base gen5 sprites
 *   FUSION_LORA_PATH       — path to trained LoRA .safetensors (optional)
 *   FUSION_GEN_MODE        — "ai" (default, all modes use diffusers)
 *   FUSION_GEN_WORKERS     — parallel workers (default: 2)
 */

import { EventEmitter } from "events";
import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

// ─── Types ───────────────────────────────────────────────────

export type GenerationMode = "splice" | "ai" | "splice+ai" | "ai-gen";

export type FusionJobPriority = "on-demand" | "background";

export interface FusionJob {
  id: string;
  headNum: number;
  bodyNum: number;
  priority: FusionJobPriority;
  mode: GenerationMode;
  status: "queued" | "running" | "done" | "error";
  /** Optional text description for ai-gen mode (new Pokémon) */
  description?: string;
  /** Optional reference sprite paths for ai refinement */
  references?: string[];
  /** Optional user instructions for custom fusion tweaks */
  instructions?: string;
  /** Generate variant sprites alongside the primary (e.g. ["a","b","c"]) */
  variants?: string[];
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  outputPath?: string;
  error?: string;
}

export interface FusionGenConfig {
  spritesDir: string;
  scriptsDir: string;
  baseSpritesDir: string;
  pythonBin: string;
  loraPath?: string;
  mode: GenerationMode;
  workers: number;
  /** Known dex numbers (positive + negative + 0) */
  allDexNums: number[];
}

export interface FusionGenStats {
  totalGenerated: number;
  totalErrors: number;
  backgroundRemaining: number;
  currentJob: FusionJob | null;
  queueLength: number;
  isRunning: boolean;
}

// ─── Service ─────────────────────────────────────────────────

export class FusionGenService extends EventEmitter {
  private config: FusionGenConfig;
  private queue: FusionJob[] = [];
  private currentJob: FusionJob | null = null;
  private currentProcess: ChildProcess | null = null;
  private running = false;
  private stats = { totalGenerated: 0, totalErrors: 0 };

  constructor(config: FusionGenConfig) {
    super();
    this.config = config;
    // Ensure output dir exists
    if (!fs.existsSync(config.spritesDir)) {
      fs.mkdirSync(config.spritesDir, { recursive: true });
    }
  }

  // ─── Public API ──────────────────────────────────────────

  /** Start the background processing loop */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log("[FusionGen] Service started");
    this.processNext();
  }

  /** Stop processing (finishes current job) */
  stop(): void {
    this.running = false;
    console.log("[FusionGen] Service stopping (will finish current job)");
  }

  /** Replace known dex-number universe used for enqueueNewSpecies() expansion. */
  setAllDexNums(nums: number[]): void {
    const next = Array.from(new Set((nums || []).filter((n) => Number.isFinite(n) && n !== 0).map((n) => Math.trunc(n))));
    this.config.allDexNums = next;
    console.log(`[FusionGen] allDexNums loaded: ${next.length}`);
  }

  /** Request an on-demand fusion — pauses background, jumps the queue */
  requestFusion(
    headNum: number,
    bodyNum: number,
    options?: {
      mode?: GenerationMode;
      references?: string[];
      instructions?: string;
      variants?: string[];
    }
  ): FusionJob {
    const outputPath = this.spriteOutputPath(headNum, bodyNum);

    // If it already exists, return immediately
    if (fs.existsSync(outputPath)) {
      return {
        id: `${headNum}.${bodyNum}`,
        headNum,
        bodyNum,
        priority: "on-demand",
        mode: options?.mode ?? this.config.mode,
        status: "done",
        outputPath,
        createdAt: Date.now(),
        completedAt: Date.now(),
      };
    }

    // Check if already in queue
    const existing = this.queue.find(
      (j) => j.headNum === headNum && j.bodyNum === bodyNum
    );
    if (existing) {
      // Promote to on-demand (move to front)
      existing.priority = "on-demand";
      this.queue = this.queue.filter((j) => j !== existing);
      this.queue.unshift(existing);
      return existing;
    }

    const job: FusionJob = {
      id: `${headNum}.${bodyNum}`,
      headNum,
      bodyNum,
      priority: "on-demand",
      mode: options?.mode ?? this.config.mode,
      status: "queued",
      references: options?.references,
      instructions: options?.instructions,
      variants: options?.variants,
      createdAt: Date.now(),
    };

    // Insert at front of queue (before background jobs)
    this.queue.unshift(job);
    this.emit("job:queued", job);

    // If nothing is running, start processing
    if (!this.currentJob) {
      this.processNext();
    }

    return job;
  }

  /**
   * Generate a new base sprite from a text description (for new custom Pokémon).
   * Uses the LoRA in txt2img mode.
   */
  requestNewSprite(
    dexNum: number,
    description: string,
    options?: { references?: string[] }
  ): FusionJob {
    const outputPath = path.join(this.config.baseSpritesDir, `${dexNum}.png`);

    const job: FusionJob = {
      id: `gen-base-${dexNum}`,
      headNum: dexNum,
      bodyNum: dexNum,
      priority: "on-demand",
      mode: "ai-gen",
      status: "queued",
      description,
      references: options?.references,
      createdAt: Date.now(),
    };

    this.queue.unshift(job);
    this.emit("job:queued", job);

    if (!this.currentJob) this.processNext();
    return job;
  }

  /**
   * Enqueue ALL fusion pairs for a new Pokémon species.
   * Called when a new species is added to the custom dex.
   */
  enqueueNewSpecies(dexNum: number, hasSprite: boolean, description?: string): void {
    console.log(`[FusionGen] New species dex#${dexNum} — hasSprite=${hasSprite}`);

    if (!hasSprite && !description) {
      console.log(`[FusionGen] No sprite and no description — skipping fusion generation`);
      return;
    }

    // If no sprite but has description, generate the base sprite first
    if (!hasSprite && description) {
      this.requestNewSprite(dexNum, description);
    }

    // Enqueue all fusion pairs at background priority
    const allNums = this.config.allDexNums;
    let queued = 0;

    for (const other of allNums) {
      // headNum=new, bodyNum=other (and vice versa)
      for (const [h, b] of [[dexNum, other], [other, dexNum]]) {
        const outPath = this.spriteOutputPath(h, b);
        if (fs.existsSync(outPath)) continue;

        // Don't duplicate if already queued
        if (this.queue.some((j) => j.headNum === h && j.bodyNum === b)) continue;

        this.queue.push({
          id: `${h}.${b}`,
          headNum: h,
          bodyNum: b,
          priority: "background",
          mode: this.config.mode,
          status: "queued",
          createdAt: Date.now(),
        });
        queued++;
      }
    }

    console.log(`[FusionGen] Enqueued ${queued} background fusion jobs for dex#${dexNum}`);
    this.emit("species:enqueued", { dexNum, jobCount: queued });

    if (!this.currentJob && this.running) this.processNext();
  }

  /**
   * Re-generate a fusion with custom instructions (user requests a tweak).
   * Uses 3 reference sprites + text instructions.
   */
  requestCustomFusion(
    headNum: number,
    bodyNum: number,
    instructions: string,
    references?: string[],
  ): FusionJob {
    return this.requestFusion(headNum, bodyNum, {
      mode: "ai",
      references,
      instructions,
    });
  }

  /** Get current queue stats */
  getStats(): FusionGenStats {
    return {
      totalGenerated: this.stats.totalGenerated,
      totalErrors: this.stats.totalErrors,
      backgroundRemaining: this.queue.filter((j) => j.priority === "background").length,
      currentJob: this.currentJob,
      queueLength: this.queue.length,
      isRunning: this.running,
    };
  }

  /** Check if a fusion sprite already exists */
  hasFusion(headNum: number, bodyNum: number): boolean {
    return fs.existsSync(this.spriteOutputPath(headNum, bodyNum));
  }

  /** Check which variant sprites exist for a pair */
  existingVariants(headNum: number, bodyNum: number): string[] {
    const found: string[] = [];
    for (const v of ["a", "b", "c"]) {
      const vPath = path.join(this.config.spritesDir, `${headNum}.${bodyNum}${v}.png`);
      if (fs.existsSync(vPath)) found.push(v);
    }
    return found;
  }

  // ─── Internal Processing ─────────────────────────────────

  private spriteOutputPath(headNum: number, bodyNum: number): string {
    return path.join(this.config.spritesDir, `${headNum}.${bodyNum}.png`);
  }

  private async processNext(): Promise<void> {
    if (!this.running) return;
    if (this.queue.length === 0) {
      this.currentJob = null;
      return;
    }

    const job = this.queue.shift()!;
    this.currentJob = job;
    job.status = "running";
    job.startedAt = Date.now();
    this.emit("job:start", job);

    try {
      await this.runJob(job);
      job.status = "done";
      job.completedAt = Date.now();
      job.outputPath = job.mode === "ai-gen"
        ? path.join(this.config.baseSpritesDir, `${job.headNum}.png`)
        : this.spriteOutputPath(job.headNum, job.bodyNum);
      this.stats.totalGenerated++;
      this.emit("job:done", job);
    } catch (err: any) {
      job.status = "error";
      job.error = err.message || String(err);
      job.completedAt = Date.now();
      this.stats.totalErrors++;
      this.emit("job:error", job);
      console.error(`[FusionGen] Error on ${job.id}: ${job.error}`);
    }

    this.currentJob = null;

    // Continue processing
    if (this.running && this.queue.length > 0) {
      // Small delay to avoid CPU thrashing on Pi
      setTimeout(() => this.processNext(), 100);
    }
  }

  private runJob(job: FusionJob): Promise<void> {
    return new Promise((resolve, reject) => {
      let pythonArgs: string[];
      const script = path.join(this.config.scriptsDir, "ai_fusion_generator.py");

      if (job.mode === "ai-gen") {
        // Generate base sprite from description
        const outPath = path.join(this.config.baseSpritesDir, `${job.headNum}.png`);
        pythonArgs = [
          script,
          "--base", String(job.headNum),
          "--donor", String(job.headNum),
          "--backend", "diffusers",
          "--output", outPath,
        ];
      } else {
        // All fusion modes use SDXL-Turbo diffusers via ai_fusion_generator.py
        const outPath = this.spriteOutputPath(job.headNum, job.bodyNum);
        pythonArgs = [
          script,
          "--base", String(job.headNum),
          "--donor", String(job.bodyNum),
          "--backend", "diffusers",
          "--output", outPath,
        ];
      }

      const proc = spawn(this.config.pythonBin, pythonArgs, {
        cwd: this.config.scriptsDir,
        env: {
          ...process.env,
          PYTHONPATH: this.config.scriptsDir,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.currentProcess = proc;
      let stderr = "";

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        this.currentProcess = null;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Exited with code ${code}: ${stderr.slice(0, 500)}`));
        }
      });

      proc.on("error", (err) => {
        this.currentProcess = null;
        reject(err);
      });
    });
  }
}

// ─── Express Routes ────────────────────────────────────────

import type { Express, Request, Response } from "express";

export function registerFusionGenRoutes(app: Express, service: FusionGenService) {
  /**
   * POST /fusion/generate
   * Request on-demand generation of a fusion sprite.
   * Body: { headNum, bodyNum, mode?, references?, instructions?, variants? }
   */
  app.post("/fusion/generate", (req: Request, res: Response) => {
    const { headNum, bodyNum, mode, references, instructions, variants, guidancePrompt, prompt } = req.body;
    if (!Number.isFinite(headNum) || !Number.isFinite(bodyNum)) {
      return res.status(400).json({ error: "headNum and bodyNum required" });
    }

    const baseInstructions = String(instructions || '').trim();
    const guidance = String(guidancePrompt || prompt || '').trim();
    const mergedInstructions = guidance
      ? (baseInstructions ? `${baseInstructions}\n\nAdditional guidance: ${guidance}` : guidance)
      : baseInstructions;

    const job = mergedInstructions
      ? service.requestCustomFusion(headNum, bodyNum, mergedInstructions, references)
      : service.requestFusion(headNum, bodyNum, { mode, references, variants });

    res.json({
      jobId: job.id,
      status: job.status,
      outputPath: job.outputPath,
    });
  });

  /**
   * POST /fusion/generate-base
   * Generate a new base sprite from a text description.
   * Body: { dexNum, description, references? }
   */
  app.post("/fusion/generate-base", (req: Request, res: Response) => {
    const { dexNum, description, references } = req.body;
    if (!Number.isFinite(dexNum) || !description) {
      return res.status(400).json({ error: "dexNum and description required" });
    }

    const job = service.requestNewSprite(dexNum, description, { references });
    res.json({ jobId: job.id, status: job.status });
  });

  /**
   * POST /fusion/new-species
   * Notify the service that a new Pokémon was added to the custom dex.
   * Starts background generation of ALL fusions for that species.
   * Body: { dexNum, hasSprite, description? }
   */
  app.post("/fusion/new-species", (req: Request, res: Response) => {
    const { dexNum, hasSprite, description } = req.body;
    if (!Number.isFinite(dexNum)) {
      return res.status(400).json({ error: "dexNum required" });
    }

    service.enqueueNewSpecies(dexNum, hasSprite ?? false, description);
    res.json({
      message: `Fusion generation enqueued for dex#${dexNum}`,
      stats: service.getStats(),
    });
  });

  /**
   * GET /fusion/gen-status
   * Get the current generation queue status.
   */
  app.get("/fusion/gen-status", (_req: Request, res: Response) => {
    res.json(service.getStats());
  });

  /**
   * GET /fusion/gen-check/:head/:body
   * Check if a specific fusion exists or is being generated.
   * Also reports which variant sprites (a, b, c) exist.
   */
  app.get("/fusion/gen-check/:head/:body", (req: Request, res: Response) => {
    const headNum = Number(req.params.head);
    const bodyNum = Number(req.params.body);
    if (!Number.isFinite(headNum) || !Number.isFinite(bodyNum)) {
      return res.status(400).json({ error: "invalid head/body" });
    }

    const exists = service.hasFusion(headNum, bodyNum);
    const variants = service.existingVariants(headNum, bodyNum);
    res.json({ headNum, bodyNum, exists, variants });
  });
}
