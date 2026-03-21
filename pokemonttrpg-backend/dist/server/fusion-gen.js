"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FusionGenService = void 0;
exports.registerFusionGenRoutes = registerFusionGenRoutes;
const events_1 = require("events");
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ─── Service ─────────────────────────────────────────────────
class FusionGenService extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.queue = [];
        this.currentJob = null;
        this.currentProcess = null;
        this.interruptedJobIds = new Set();
        this.warmupInProgress = false;
        this.warmupReady = false;
        this.lastWarmupAt = 0;
        this.lastWarmupError = null;
        this.warmupPromise = null;
        this.running = false;
        this.stats = { totalGenerated: 0, totalErrors: 0 };
        this.config = config;
        // Ensure output dir exists
        if (!fs_1.default.existsSync(config.spritesDir)) {
            fs_1.default.mkdirSync(config.spritesDir, { recursive: true });
        }
    }
    // ─── Public API ──────────────────────────────────────────
    /** Start the background processing loop */
    start() {
        if (this.running)
            return;
        this.running = true;
        console.log("[FusionGen] Service started");
        this.ensureWarmup("startup").catch((err) => {
            console.warn(`[FusionGen] Startup warmup failed: ${err?.message || err}`);
        });
        this.processNext();
    }
    /** Stop processing (finishes current job) */
    stop() {
        this.running = false;
        console.log("[FusionGen] Service stopping (will finish current job)");
    }
    /** Replace known dex-number universe used for enqueueNewSpecies() expansion. */
    setAllDexNums(nums) {
        const next = Array.from(new Set((nums || []).filter((n) => Number.isFinite(n) && n !== 0).map((n) => Math.trunc(n))));
        this.config.allDexNums = next;
        console.log(`[FusionGen] allDexNums loaded: ${next.length}`);
    }
    /** Request an on-demand fusion — pauses background, jumps the queue */
    requestFusion(headNum, bodyNum, options) {
        void this.ensureWarmup("on-demand");
        const outputPath = this.spriteOutputPath(headNum, bodyNum);
        // If regenerate requested, remove existing sprite so a fresh one is generated
        if (options?.regenerate && fs_1.default.existsSync(outputPath)) {
            try { fs_1.default.unlinkSync(outputPath); } catch {}
            console.log(`[FusionGen] Regenerate: removed existing ${outputPath}`);
        }
        // If it already exists, return immediately
        if (fs_1.default.existsSync(outputPath)) {
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
        const existing = this.queue.find((j) => j.headNum === headNum && j.bodyNum === bodyNum);
        if (existing) {
            // Promote to on-demand (move to front)
            existing.priority = "on-demand";
            this.queue = this.queue.filter((j) => j !== existing);
            this.queue.unshift(existing);
            return existing;
        }
        const job = {
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
        // If a background job is currently running, interrupt it so on-demand work starts quickly.
        if (this.currentJob?.priority === "background" && this.currentProcess) {
            const interruptedId = this.currentJob.id;
            this.interruptedJobIds.add(interruptedId);
            console.log(`[FusionGen] Preempting background job ${interruptedId} for on-demand ${job.id}`);
            try {
                this.currentProcess.kill("SIGTERM");
            }
            catch { }
        }
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
    requestNewSprite(dexNum, description, options) {
        const outputPath = path_1.default.join(this.config.baseSpritesDir, `${dexNum}.png`);
        const job = {
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
        if (!this.currentJob)
            this.processNext();
        return job;
    }
    /**
     * Enqueue ALL fusion pairs for a new Pokémon species.
     * Called when a new species is added to the custom dex.
     */
    enqueueNewSpecies(dexNum, hasSprite, description) {
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
                if (fs_1.default.existsSync(outPath))
                    continue;
                // Don't duplicate if already queued
                if (this.queue.some((j) => j.headNum === h && j.bodyNum === b))
                    continue;
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
        if (!this.currentJob && this.running)
            this.processNext();
    }
    /**
     * Re-generate a fusion with custom instructions (user requests a tweak).
     * Uses 3 reference sprites + text instructions.
     */
    requestCustomFusion(headNum, bodyNum, instructions, references, options) {
        return this.requestFusion(headNum, bodyNum, {
            mode: "ai",
            references,
            instructions,
            regenerate: options?.regenerate,
        });
    }
    /** Get current queue stats */
    getStats() {
        return {
            totalGenerated: this.stats.totalGenerated,
            totalErrors: this.stats.totalErrors,
            backgroundRemaining: this.queue.filter((j) => j.priority === "background").length,
            currentJob: this.currentJob,
            queueLength: this.queue.length,
            isRunning: this.running,
            warmup: this.getWarmupState(),
        };
    }
    getWarmupState() {
        return {
            inProgress: this.warmupInProgress,
            ready: this.warmupReady,
            lastWarmupAt: this.lastWarmupAt || null,
            lastWarmupError: this.lastWarmupError,
        };
    }
    async ensureWarmup(reason = "manual", force = false) {
        if (!force && this.warmupReady)
            return true;
        if (this.warmupPromise)
            return this.warmupPromise;
        this.warmupInProgress = true;
        this.lastWarmupError = null;
        const script = path_1.default.join(this.config.scriptsDir, "ai_fusion_generator.py");
        const pythonArgs = [
            script,
            "--backend", "diffusers",
            "--warmup",
        ];
        console.log(`[FusionGen] Warmup starting (${reason})`);
        this.warmupPromise = new Promise((resolve) => {
            const proc = (0, child_process_1.spawn)(this.config.pythonBin, pythonArgs, {
                cwd: this.config.scriptsDir,
                env: {
                    ...process.env,
                    PYTHONPATH: this.config.scriptsDir,
                },
                stdio: ["ignore", "ignore", "pipe"],
            });
            let stderr = "";
            proc.stderr?.on("data", (data) => {
                stderr += data.toString();
            });
            proc.on("close", (code) => {
                this.warmupInProgress = false;
                this.warmupPromise = null;
                if (code === 0) {
                    this.warmupReady = true;
                    this.lastWarmupAt = Date.now();
                    console.log("[FusionGen] Warmup completed");
                    resolve(true);
                    return;
                }
                this.warmupReady = false;
                this.lastWarmupError = `Exited with code ${code}: ${stderr.slice(0, 500)}`;
                console.warn(`[FusionGen] Warmup failed: ${this.lastWarmupError}`);
                resolve(false);
            });
            proc.on("error", (err) => {
                this.warmupInProgress = false;
                this.warmupPromise = null;
                this.warmupReady = false;
                this.lastWarmupError = err?.message || String(err);
                console.warn(`[FusionGen] Warmup error: ${this.lastWarmupError}`);
                resolve(false);
            });
        });
        return this.warmupPromise;
    }
    /** Check if a fusion sprite already exists */
    hasFusion(headNum, bodyNum) {
        return fs_1.default.existsSync(this.spriteOutputPath(headNum, bodyNum));
    }
    /** Check which variant sprites exist for a pair */
    existingVariants(headNum, bodyNum) {
        const found = [];
        for (const v of ["a", "b", "c"]) {
            const vPath = path_1.default.join(this.config.spritesDir, `${headNum}.${bodyNum}${v}.png`);
            if (fs_1.default.existsSync(vPath))
                found.push(v);
        }
        return found;
    }
    // ─── Internal Processing ─────────────────────────────────
    spriteOutputPath(headNum, bodyNum) {
        return path_1.default.join(this.config.spritesDir, `${headNum}.${bodyNum}.png`);
    }
    async processNext() {
        if (!this.running)
            return;
        if (this.queue.length === 0) {
            this.currentJob = null;
            return;
        }
        const job = this.queue.shift();
        this.currentJob = job;
        job.status = "running";
        job.startedAt = Date.now();
        this.emit("job:start", job);
        try {
            await this.runJob(job);
            job.status = "done";
            job.completedAt = Date.now();
            job.outputPath = job.mode === "ai-gen"
                ? path_1.default.join(this.config.baseSpritesDir, `${job.headNum}.png`)
                : this.spriteOutputPath(job.headNum, job.bodyNum);
            this.stats.totalGenerated++;
            this.emit("job:done", job);
        }
        catch (err) {
            if (this.interruptedJobIds.has(job.id)) {
                this.interruptedJobIds.delete(job.id);
                job.status = "queued";
                job.startedAt = undefined;
                job.completedAt = undefined;
                job.error = undefined;
                // Requeue interrupted background work behind on-demand requests.
                this.queue.push(job);
                this.emit("job:queued", job);
                console.log(`[FusionGen] Re-queued interrupted background job ${job.id}`);
            }
            else {
                job.status = "error";
                job.error = err.message || String(err);
                job.completedAt = Date.now();
                this.stats.totalErrors++;
                this.emit("job:error", job);
                console.error(`[FusionGen] Error on ${job.id}: ${job.error}`);
            }
        }
        this.currentJob = null;
        // Continue processing
        if (this.running && this.queue.length > 0) {
            // Small delay to avoid CPU thrashing on Pi
            setTimeout(() => this.processNext(), 100);
        }
    }
    runJob(job) {
        return new Promise((resolve, reject) => {
            let pythonArgs;
            const script = path_1.default.join(this.config.scriptsDir, "ai_fusion_generator.py");
            if (job.mode === "ai-gen") {
                // Generate base sprite from description
                const outPath = path_1.default.join(this.config.baseSpritesDir, `${job.headNum}.png`);
                pythonArgs = [
                    script,
                    "--base", String(job.headNum),
                    "--donor", String(job.headNum),
                    "--backend", "diffusers",
                    "--output", outPath,
                ];
            }
            else {
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
            const proc = (0, child_process_1.spawn)(this.config.pythonBin, pythonArgs, {
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
                }
                else {
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
exports.FusionGenService = FusionGenService;
function registerFusionGenRoutes(app, service) {
    /**
     * POST /fusion/generate
     * Request on-demand generation of a fusion sprite.
     * Body: { headNum, bodyNum, mode?, references?, instructions?, variants? }
     */
    app.post("/fusion/generate", (req, res) => {
        const { headNum, bodyNum, mode, references, instructions, variants, guidancePrompt, prompt, regenerate } = req.body;
        if (!Number.isFinite(headNum) || !Number.isFinite(bodyNum)) {
            return res.status(400).json({ error: "headNum and bodyNum required" });
        }
        const baseInstructions = String(instructions || '').trim();
        const guidance = String(guidancePrompt || prompt || '').trim();
        const mergedInstructions = guidance
            ? (baseInstructions ? `${baseInstructions}\n\nAdditional guidance: ${guidance}` : guidance)
            : baseInstructions;
        const job = mergedInstructions
            ? service.requestCustomFusion(headNum, bodyNum, mergedInstructions, references, { regenerate: !!regenerate })
            : service.requestFusion(headNum, bodyNum, { mode, references, variants, regenerate: !!regenerate });
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
    app.post("/fusion/generate-base", (req, res) => {
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
    app.post("/fusion/new-species", (req, res) => {
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
    app.get("/fusion/gen-status", (_req, res) => {
        res.json(service.getStats());
    });
    /**
     * GET /fusion/gen-check/:head/:body
     * Check if a specific fusion exists or is being generated.
     * Also reports which variant sprites (a, b, c) exist.
     */
    app.get("/fusion/gen-check/:head/:body", (req, res) => {
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
//# sourceMappingURL=fusion-gen.js.map