import fs from "fs";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import type { Express, Request, Response } from "express";

export type FusionSyncConfig = {
  spritesDir: string;
  spritesDirs?: string[];
  spritesUrlBase?: string;
  packZipPath?: string;
  indexCacheTtlMs?: number;
  reportsDir?: string;
};

type FusionVariantIndex = Map<string, string[]>; // key: head.body -> filenames

const DEFAULT_INDEX_TTL_MS = 5 * 60 * 1000;

function normalizeFusionKey(headId: number | string, bodyId: number | string) {
  return `${headId}.${bodyId}`;
}

function parseFusionFilename(filename: string): { headId: number; bodyId: number; variant?: string } | null {
  // Supports:
  // - 25.6.png             (base)
  // - 25.6_alt1.png        (underscore variant)
  // - 25.6a.png            (suffix letters)
  // - 25.6aa.png           (suffix letters)
  // - 25.6v1.png           (v1/v2 variant from generator)
  // - -1.-10v1.png         (negative dex IDs)
  // - -1.-10.png           (negative dex, no variant)
  const NEG = '-?\\d+';
  // underscore variant: head.body_variant.png
  const underscore = filename.match(new RegExp(`^(${NEG})\\.(${NEG})_([A-Za-z0-9]+)\\.png$`));
  if (underscore) {
    return {
      headId: Number(underscore[1]),
      bodyId: Number(underscore[2]),
      variant: underscore[3],
    };
  }
  // suffix variant (letters/digits like v1, v2, a, b, ai, etc.)
  const suffix = filename.match(new RegExp(`^(${NEG})\\.(${NEG})([A-Za-z][A-Za-z0-9]*)\\.png$`));
  if (suffix) {
    return {
      headId: Number(suffix[1]),
      bodyId: Number(suffix[2]),
      variant: suffix[3],
    };
  }
  // base: head.body.png (no variant)
  const base = filename.match(new RegExp(`^(${NEG})\\.(${NEG})\\.png$`));
  if (base) {
    return {
      headId: Number(base[1]),
      bodyId: Number(base[2]),
    };
  }
  return null;
}

function resolveSpriteDirs(spritesDir: string): string[] {
  const dirs: string[] = [];
  if (spritesDir && fs.existsSync(spritesDir)) {
    dirs.push(spritesDir);
    const customBattlers = path.join(spritesDir, "CustomBattlers");
    if (fs.existsSync(customBattlers)) dirs.push(customBattlers);
    // Walk bucket subdirectories (head-XXXX-XXXX)
    try {
      const entries = fs.readdirSync(spritesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && /^head-/.test(entry.name)) {
          dirs.push(path.join(spritesDir, entry.name));
        }
      }
    } catch {}
  }
  return Array.from(new Set(dirs));
}

function resolveSpriteDirsFromRoots(spriteRoots: string[]): string[] {
  const all: string[] = [];
  for (const root of spriteRoots) {
    all.push(...resolveSpriteDirs(root));
  }
  return Array.from(new Set(all));
}

/** Given a head dex number, compute the bucket directory name.
 *  Must match Python: start = ((head_dex - 1) // bucket_size) * bucket_size + 1 */
function getBucketDir(spritesDir: string, headDex: number, bucketSize = 100): string {
  // Python-style floor division for negative numbers
  const pyFloorDiv = (a: number, b: number) => Math.floor(a / b);
  const start = pyFloorDiv(headDex - 1, bucketSize) * bucketSize + 1;
  const end = start + bucketSize - 1;
  const pad = (n: number) => {
    const abs = Math.abs(n);
    const s = String(abs).padStart(4, '0');
    return n < 0 ? `-${s}` : s;
  };
  return path.join(spritesDir, `head-${pad(start)}-${pad(end)}`);
}

/** Find the actual file path for a sprite, checking bucket dirs then flat */
function findSpriteFile(spriteRoots: string[], filename: string, headDex?: number): string | null {
  for (const spritesDir of spriteRoots) {
    // Try bucket directory first if we know head dex
    if (headDex !== undefined) {
      const bucketDir = getBucketDir(spritesDir, headDex);
      const bucketPath = path.join(bucketDir, filename);
      if (fs.existsSync(bucketPath)) return bucketPath;
    }
    // Try flat top-level
    const flatPath = path.join(spritesDir, filename);
    if (fs.existsSync(flatPath)) return flatPath;
    // Try CustomBattlers
    const customPath = path.join(spritesDir, "CustomBattlers", filename);
    if (fs.existsSync(customPath)) return customPath;
  }
  return null;
}

function buildFusionIndex(spriteRoots: string[]): FusionVariantIndex {
  const index: FusionVariantIndex = new Map();
  const dirs = resolveSpriteDirsFromRoots(spriteRoots);
  if (!dirs.length) return index;

  for (const dir of dirs) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith(".png")) continue;
      const parsed = parseFusionFilename(entry.name);
      if (!parsed) continue;
      const key = normalizeFusionKey(parsed.headId, parsed.bodyId);
      const list = index.get(key) || [];
      list.push(entry.name);
      index.set(key, list);
    }
  }

  // sort variants deterministically: base first, then alts
  for (const [key, list] of index.entries()) {
    list.sort((a, b) => {
      const aParsed = parseFusionFilename(a);
      const bParsed = parseFusionFilename(b);
      const aIsBase = aParsed && !aParsed.variant;
      const bIsBase = bParsed && !bParsed.variant;
      if (aIsBase && !bIsBase) return -1;
      if (!aIsBase && bIsBase) return 1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    });
    index.set(key, list);
  }

  return index;
}

function parsePngDataUrl(dataUrl: string): Buffer | null {
  const match = String(dataUrl || "").match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  try {
    return Buffer.from(match[1], "base64");
  } catch {
    return null;
  }
}

function ensureDir(dirPath: string) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {}
}

function appendJsonLine(filePath: string, payload: unknown) {
  try {
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf-8");
  } catch {}
}

function nextFixFilename(existing: string[], headNum: number, bodyNum: number): string {
  let n = 1;
  while (true) {
    const candidate = `${headNum}.${bodyNum}fix${n}.png`;
    if (!existing.includes(candidate)) return candidate;
    n += 1;
  }
}

function isValidFusionFilenameForPair(filename: string, headNum: number, bodyNum: number): boolean {
  const parsed = parseFusionFilename(path.basename(filename));
  return !!parsed && parsed.headId === headNum && parsed.bodyId === bodyNum;
}

export function registerFusionRoutes(app: Express, config: FusionSyncConfig) {
  const spriteRoots = Array.from(
    new Set(
      [config.spritesDir, ...(config.spritesDirs || [])]
        .map((p) => String(p || "").trim())
        .filter((p) => !!p && fs.existsSync(p))
    )
  );
  const spriteDirs = resolveSpriteDirsFromRoots(spriteRoots);
  const packZipPath = config.packZipPath;
  let indexCache: FusionVariantIndex | null = null;
  let indexCacheTime = 0;
  const reportsDir = config.reportsDir || path.resolve(process.cwd(), "data", "sprite-reports");
  const wrongSpriteReportsPath = path.join(reportsDir, "wrong-sprite-reports.jsonl");

  function getIndex(): FusionVariantIndex {
    const ttl = config.indexCacheTtlMs ?? DEFAULT_INDEX_TTL_MS;
    const now = Date.now();
    if (!indexCache || now - indexCacheTime > ttl) {
      indexCache = buildFusionIndex(spriteRoots);
      indexCacheTime = now;
    }
    return indexCache;
  }

  app.get("/fusion/variants/:head/:body", (req: Request, res: Response) => {
    const headId = Number(req.params.head);
    const bodyId = Number(req.params.body);
    if (!Number.isFinite(headId) || !Number.isFinite(bodyId)) {
      return res.status(400).json({ error: "invalid head/body id" });
    }
    const index = getIndex();
    const key = normalizeFusionKey(headId, bodyId);
    const variants = index.get(key) || [];
    res.json({ headId, bodyId, variants });
  });

  app.get("/fusion/variants", (_req: Request, res: Response) => {
    const index = getIndex();
    res.json({ totalFusions: index.size });
  });

  app.post("/api/fusion/reindex", (_req: Request, res: Response) => {
    indexCache = null;
    indexCacheTime = 0;
    const index = getIndex();
    return res.json({ ok: true, totalFusions: index.size });
  });

  app.get("/fusion/sprites/:filename", (req: Request, res: Response) => {
    const filename = req.params.filename;
    const safeName = path.basename(filename);
    // Try to parse head dex for bucket lookup
    const parsed = parseFusionFilename(safeName);
    const headDex = parsed?.headId;
    const found = findSpriteFile(spriteRoots, safeName, headDex);
    if (found) return res.sendFile(found);
    return res.status(404).send("Not found");
  });

  /** Upload a custom fusion sprite (data URL → PNG file in bucket dir) */
  app.post("/api/fusion/upload-sprite", (req: Request, res: Response) => {
    try {
      const { headNum, bodyNum, dataUrl } = req.body ?? {};
      if (typeof headNum !== 'number' || typeof bodyNum !== 'number' || typeof dataUrl !== 'string') {
        return res.status(400).json({ error: 'Missing headNum, bodyNum, or dataUrl' });
      }
      const writeRoot = config.spritesDir;
      // Parse out the base64 data
      const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ error: 'dataUrl must be a data:image/png;base64,... string' });
      }
      const buffer = Buffer.from(match[1], 'base64');

      // Determine bucket directory
      const bucketDir = getBucketDir(writeRoot, headNum);
      if (!fs.existsSync(bucketDir)) {
        fs.mkdirSync(bucketDir, { recursive: true });
      }

      // Find next available variant suffix (custom1, custom2, etc.)
      const index = getIndex();
      const key = normalizeFusionKey(headNum, bodyNum);
      const existing = index.get(key) || [];
      let suffix = 'custom';
      let counter = 1;
      let filename = `${headNum}.${bodyNum}${suffix}.png`;
      while (existing.includes(filename) || fs.existsSync(path.join(bucketDir, filename))) {
        counter++;
        filename = `${headNum}.${bodyNum}${suffix}${counter}.png`;
      }

      const filePath = path.join(bucketDir, filename);
      fs.writeFileSync(filePath, buffer);

      // Invalidate index cache
      indexCache = null;
      indexCacheTime = 0;

      console.log(`[fusion-upload] Saved custom sprite: ${filePath}`);
      res.json({ ok: true, filename, path: filePath });
    } catch (err: any) {
      console.error('[fusion-upload] Error:', err);
      res.status(500).json({ error: err?.message || 'Internal error' });
    }
  });

  app.post("/api/fusion/report-wrong-sprite", (req: Request, res: Response) => {
    try {
      const headNum = Number(req.body?.headNum ?? req.body?.head_id);
      const bodyNum = Number(req.body?.bodyNum ?? req.body?.body_id);
      const currentSpriteFileRaw = String(req.body?.currentSpriteFile ?? req.body?.sprite_file ?? "").trim();
      const reason = String(req.body?.reason ?? "").trim();
      const details = String(req.body?.details ?? "").trim();
      const reporterId = String(req.body?.reporterId ?? req.body?.player_id ?? "unknown").trim();
      const applyAsRaw = String(req.body?.applyAs ?? "new-variant").trim().toLowerCase();
      const replacementDataUrl = String(req.body?.replacementDataUrl ?? req.body?.dataUrl ?? "").trim();

      if (!Number.isFinite(headNum) || !Number.isFinite(bodyNum)) {
        return res.status(400).json({ error: "invalid headNum/bodyNum" });
      }

      const safeCurrentSpriteFile = currentSpriteFileRaw ? path.basename(currentSpriteFileRaw) : "";
      if (safeCurrentSpriteFile && !isValidFusionFilenameForPair(safeCurrentSpriteFile, headNum, bodyNum)) {
        return res.status(400).json({ error: "currentSpriteFile does not match head/body pair" });
      }

      let appliedFilename = "";
      let appliedPath = "";
      let applyMode = "none";

      if (replacementDataUrl) {
        const png = parsePngDataUrl(replacementDataUrl);
        if (!png) {
          return res.status(400).json({ error: "replacementDataUrl must be a PNG data URL" });
        }

        const writeRoot = config.spritesDir;
        const bucketDir = getBucketDir(writeRoot, headNum);
        ensureDir(bucketDir);

        const index = getIndex();
        const key = normalizeFusionKey(headNum, bodyNum);
        const existing = index.get(key) || [];

        if (applyAsRaw === "replace-current" && safeCurrentSpriteFile) {
          appliedFilename = safeCurrentSpriteFile;
          applyMode = "replace-current";
        } else if (applyAsRaw === "replace-base") {
          appliedFilename = `${headNum}.${bodyNum}.png`;
          applyMode = "replace-base";
        } else {
          appliedFilename = nextFixFilename(existing, headNum, bodyNum);
          applyMode = "new-variant";
        }

        // Prefer exact existing path when replacing current; otherwise write to bucket.
        if (applyMode === "replace-current") {
          const found = findSpriteFile(spriteRoots, appliedFilename, headNum);
          appliedPath = found || path.join(bucketDir, appliedFilename);
        } else {
          appliedPath = path.join(bucketDir, appliedFilename);
        }

        fs.writeFileSync(appliedPath, png);
        indexCache = null;
        indexCacheTime = 0;
      }

      const report = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        ts: new Date().toISOString(),
        headNum,
        bodyNum,
        currentSpriteFile: safeCurrentSpriteFile || null,
        reason: reason || null,
        details: details || null,
        reporterId,
        replacementApplied: !!appliedFilename,
        applyMode,
        appliedFilename: appliedFilename || null,
        appliedPath: appliedPath || null,
      };

      appendJsonLine(wrongSpriteReportsPath, report);
      return res.json({ ok: true, report });
    } catch (err: any) {
      console.error("[fusion-report] Error:", err);
      return res.status(500).json({ error: err?.message || "Internal error" });
    }
  });

  if (packZipPath && fs.existsSync(packZipPath)) {
    app.get("/fusion/pack", (_req: Request, res: Response) => {
      res.download(packZipPath);
    });
  } else {
    app.get("/fusion/pack", (_req: Request, res: Response) => {
      res.status(404).json({ error: "fusion pack not configured" });
    });
  }

  return { getIndex };
}

export function attachFusionWebSocket(server: HttpServer, config: FusionSyncConfig) {
  const wss = new WebSocketServer({ server, path: "/fusion-sync" });
  const connections = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    connections.add(ws);

    ws.on("message", (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (!msg || typeof msg.type !== "string") return;

      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      if (msg.type === "identify") {
        ws.send(JSON.stringify({ type: "connected", server_version: "fusion-sync-v1" }));
        return;
      }

      if (msg.type === "get-fusion-variants") {
        const headId = Number(msg.head_id ?? msg.headId);
        const bodyId = Number(msg.body_id ?? msg.bodyId);
        if (!Number.isFinite(headId) || !Number.isFinite(bodyId)) return;
        const spriteRoots = Array.from(
          new Set(
            [config.spritesDir, ...(config.spritesDirs || [])]
              .map((p) => String(p || "").trim())
              .filter((p) => !!p && fs.existsSync(p))
          )
        );
        const index = buildFusionIndex(spriteRoots);
        const key = normalizeFusionKey(headId, bodyId);
        const variants = index.get(key) || [];
        ws.send(JSON.stringify({
          type: "fusion-variants",
          head_id: headId,
          body_id: bodyId,
          variants,
        }));
        return;
      }

      if (msg.type === "select-fusion-sprite") {
        const headId = Number(msg.head_id ?? msg.headId);
        const bodyId = Number(msg.body_id ?? msg.bodyId);
        const spriteFile = String(msg.sprite_file ?? msg.spriteFile ?? "");
        if (!Number.isFinite(headId) || !Number.isFinite(bodyId) || !spriteFile) return;

        const payload = JSON.stringify({
          type: "fusion-sprite-selected",
          head_id: headId,
          body_id: bodyId,
          sprite_file: spriteFile,
          player_id: msg.player_id ?? msg.playerId ?? "unknown",
        });

        for (const client of connections) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
          }
        }
      }
    });

    ws.on("close", () => {
      connections.delete(ws);
    });
  });

  return wss;
}
