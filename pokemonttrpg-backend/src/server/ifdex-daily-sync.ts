import { spawn } from "child_process";
import fs from "fs";
import path from "path";

type DailySyncOptions = {
  backendPort: number;
};

function toBool(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function pickPythonBin(workspaceRoot: string): string {
  const explicit = process.env.FUSION_SYNC_PYTHON?.trim();
  if (explicit) return explicit;

  const winVenv = path.resolve(workspaceRoot, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(winVenv)) return winVenv;

  const unixVenv = path.resolve(workspaceRoot, ".venv", "bin", "python");
  if (fs.existsSync(unixVenv)) return unixVenv;

  return process.platform === "win32" ? "python" : "python3";
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const int = Math.trunc(n);
  return int > 0 ? int : fallback;
}

export function startIfdexDailySyncJob(options: DailySyncOptions): void {
  const enabled = toBool(process.env.FUSION_SYNC_ENABLED, true);
  if (!enabled) {
    console.log("[IFDexSync] Disabled by FUSION_SYNC_ENABLED.");
    return;
  }

  const workspaceRoot = process.env.FUSION_SYNC_WORKSPACE_ROOT
    ? path.resolve(process.env.FUSION_SYNC_WORKSPACE_ROOT)
    : path.resolve(process.cwd(), "..");

  const scriptPath = process.env.FUSION_SYNC_SCRIPT
    ? path.resolve(process.env.FUSION_SYNC_SCRIPT)
    : path.resolve(workspaceRoot, "scripts", "sync_ifdex_sprites.py");

  if (!fs.existsSync(scriptPath)) {
    console.warn(`[IFDexSync] Script not found: ${scriptPath}`);
    return;
  }

  const pythonBin = pickPythonBin(workspaceRoot);
  const intervalHours = parsePositiveInt(process.env.FUSION_SYNC_INTERVAL_HOURS, 24);
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const initialDelayMs = parsePositiveInt(process.env.FUSION_SYNC_INITIAL_DELAY_SECONDS, 30) * 1000;
  const maxDownloads = Number(process.env.FUSION_SYNC_MAX_DOWNLOADS || "0");
  const backendUrl = (process.env.FUSION_BACKEND_URL || `http://127.0.0.1:${options.backendPort}`).trim();
  const skipRemap = toBool(process.env.FUSION_SYNC_SKIP_REMAP, false);
  const downloadMissing = toBool(process.env.FUSION_SYNC_DOWNLOAD_MISSING, true);
  const downloadScope = (process.env.FUSION_SYNC_DOWNLOAD_SCOPE || "nat").trim().toLowerCase();
  const mappingSource = (process.env.FUSION_SYNC_MAPPING_SOURCE || "markdown").trim().toLowerCase();

  let running = false;

  const runOnce = () => {
    if (running) {
      console.log("[IFDexSync] Previous run still active; skipping this cycle.");
      return;
    }
    running = true;

    const args: string[] = [
      scriptPath,
      "--workspace-root",
      workspaceRoot,
      "--apply",
      "--mapping-source",
      mappingSource,
      "--backend-url",
      backendUrl,
      "--reindex-backend",
    ];

    if (skipRemap) {
      args.push("--skip-remap");
    }

    if (downloadMissing) {
      args.push("--download-missing", "--download-scope", downloadScope === "all" ? "all" : "nat");
    }

    if (Number.isFinite(maxDownloads) && maxDownloads > 0) {
      args.push("--max-downloads", String(Math.trunc(maxDownloads)));
    }

    const startedAt = Date.now();
    console.log(`[IFDexSync] Starting sync job (${new Date(startedAt).toISOString()})`);

    const child = spawn(pythonBin, args, {
      cwd: workspaceRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(`[IFDexSync] ${String(chunk)}`);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(`[IFDexSync] ${String(chunk)}`);
    });

    child.on("error", (err) => {
      console.error("[IFDexSync] Failed to start sync job:", err);
      running = false;
    });

    child.on("close", (code) => {
      const tookSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`[IFDexSync] Sync job completed in ${tookSec}s.`);
      } else {
        console.error(`[IFDexSync] Sync job exited with code ${code} after ${tookSec}s.`);
      }
      running = false;
    });
  };

  setTimeout(runOnce, initialDelayMs);
  setInterval(runOnce, intervalMs);

  console.log(
    `[IFDexSync] Scheduled every ${intervalHours}h (initial delay ${Math.round(initialDelayMs / 1000)}s). Script: ${scriptPath}. skipRemap=${skipRemap} downloadMissing=${downloadMissing} downloadScope=${downloadScope} mappingSource=${mappingSource}`
  );
}
