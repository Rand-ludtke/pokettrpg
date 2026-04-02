"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeNeedsSwitch = computeNeedsSwitch;
exports.startServer = startServer;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const uuid_1 = require("uuid");
const engine_1 = __importDefault(require("../engine"));
const sync_ps_engine_1 = __importDefault(require("../sync-ps-engine"));
const abilities_1 = require("../data/abilities");
const items_1 = require("../data/items");
const showdown_converter_1 = require("../data/converters/showdown-converter");
const showdown_species_moves_1 = require("../data/converters/showdown-species-moves");
const fusion_sync_1 = require("./fusion-sync");
const fusion_gen_1 = require("./fusion-gen");
const ifdex_daily_sync_1 = require("./ifdex-daily-sync");
// Configuration: Use Pokemon Showdown engine (true) or custom engine (false)
const USE_PS_ENGINE = process.env.USE_PS_ENGINE !== "false"; // Default to PS engine
// Simple JSON persistence directories (for Raspberry Pi prototype)
const DATA_DIR = path_1.default.resolve(process.cwd(), "data");
const REPLAYS_DIR = path_1.default.join(DATA_DIR, "replays");
const CUSTOM_DEX_FILE = path_1.default.join(DATA_DIR, "customdex.json");
const CUSTOM_SPRITES_FILE = path_1.default.join(DATA_DIR, "customsprites.json");
const TRAINER_SPRITES_DIR = path_1.default.join(DATA_DIR, "trainer-sprites");
if (!fs_1.default.existsSync(DATA_DIR))
    fs_1.default.mkdirSync(DATA_DIR);
if (!fs_1.default.existsSync(REPLAYS_DIR))
    fs_1.default.mkdirSync(REPLAYS_DIR);
if (!fs_1.default.existsSync(TRAINER_SPRITES_DIR))
    fs_1.default.mkdirSync(TRAINER_SPRITES_DIR, { recursive: true });
/** Parse a playerFormat string and return how many allies the owner needs.
 *  Boss formats (Xv1): owner + (X-1) allies
 *  Team formats (2v2-teams): owner + 1 ally on side 1, target + 1 ally on side 2 → total allies = 2
 *  Team formats (3v3-teams): owner + 2 allies on side 1, target + 2 allies on side 2 → total allies = 4
 *  FFA (4ffa): 4 players total → owner + 3 others → total allies = 2 (target + 2 allies)
 */
function getRequiredAllyCount(playerFormat) {
    if (!playerFormat)
        return 0;
    // Boss formats: 2v1, 3v1, 5v1
    const bossMatch = playerFormat.match(/^(\d+)v(\d+)$/);
    if (bossMatch && parseInt(bossMatch[2], 10) === 1 && parseInt(bossMatch[1], 10) > 1) {
        return parseInt(bossMatch[1], 10) - 1;
    }
    // Team formats: 2v2-teams, 3v3-teams
    if (playerFormat === '2v2-teams')
        return 2; // owner + target + 2 allies = 4 players
    if (playerFormat === '3v3-teams')
        return 4; // owner + target + 4 allies = 6 players
    // Free-for-all
    if (playerFormat === '4ffa')
        return 2; // owner + target + 2 allies = 4 players
    return 0;
}
/** Check whether all required slots are filled and accepted for a challenge. */
function isChallengeReady(challenge) {
    if (!challenge.owner.accepted || !challenge.owner.playerPayload)
        return false;
    if (!challenge.target || !challenge.target.accepted || !challenge.target.playerPayload)
        return false;
    const requiredAllies = getRequiredAllyCount(challenge.rules?.playerFormat);
    if (challenge.allies.length < requiredAllies)
        return false;
    for (const ally of challenge.allies) {
        if (!ally.accepted || !ally.playerPayload)
            return false;
    }
    return true;
}
/** Check whether a challenge still needs more players. */
function challengeNeedsMorePlayers(challenge) {
    if (!challenge.target)
        return true;
    const requiredAllies = getRequiredAllyCount(challenge.rules?.playerFormat);
    return challenge.allies.length < requiredAllies;
}
const DEFAULT_LOBBY_ID = "global-lobby";
const DEFAULT_LOBBY_NAME = "Global Lobby";
function createDefaultMapState() {
    return {
        width: 960,
        height: 640,
        gridSize: 32,
        gridColor: "#5a5a5a",
        gridOpacity: 0.35,
        showGrid: true,
        showLabels: true,
        lockTokens: false,
        background: "",
        tokens: [],
    };
}
function createRoomRecord(id, name, roomType = "battle") {
    return {
        id,
        name,
        roomType,
        mapState: roomType === "map" ? createDefaultMapState() : undefined,
        players: [],
        spectators: [],
        engine: undefined,
        battleStarted: false,
        startProtocolSent: false,
        turnBuffer: {},
        replay: [],
        phase: "normal",
        teamPreviewPlayers: undefined,
        teamPreviewOrders: undefined,
        teamPreviewRules: undefined,
        forceSwitchNeeded: new Set(),
        forceSwitchTimer: undefined,
        forceSwitchDeadline: undefined,
        turnTimer: undefined,
        turnDeadline: undefined,
        challenges: new Map(),
        lastPromptByPlayer: {},
    };
}
function ensureMapToken(room, user) {
    if (room.roomType !== "map" || !room.mapState)
        return;
    const exists = room.mapState.tokens.find(t => t.ownerId === user.id);
    if (exists)
        return;
    const base = room.mapState.tokens.length;
    const size = 32;
    const spacing = room.mapState.gridSize || 32;
    const x = 32 + (base % 6) * (spacing + 4);
    const y = 32 + Math.floor(base / 6) * (spacing + 4);
    room.mapState.tokens.push({
        id: user.id,
        name: user.username,
        x,
        y,
        size,
        ownerId: user.id,
    });
}
function challengeSummary(ch) {
    return {
        id: ch.id,
        roomId: ch.roomId,
        status: ch.status,
        createdAt: ch.createdAt,
        open: challengeNeedsMorePlayers(ch),
        format: ch.format,
        rules: ch.rules,
        owner: {
            id: ch.owner.playerId,
            username: ch.owner.username,
            accepted: ch.owner.accepted,
            ready: Boolean(ch.owner.playerPayload),
        },
        target: ch.target
            ? {
                id: ch.target.playerId,
                username: ch.target.username,
                accepted: ch.target.accepted,
                ready: Boolean(ch.target.playerPayload),
            }
            : null,
        allies: ch.allies.map(a => ({
            id: a.playerId,
            username: a.username,
            accepted: a.accepted,
            ready: Boolean(a.playerPayload),
        })),
        requiredAllies: getRequiredAllyCount(ch.rules?.playerFormat),
    };
}
function challengeSummaries(room) {
    return Array.from(room.challenges.values()).map(challengeSummary);
}
function findPlayerBySocket(room, socketId) {
    return room.players.find((p) => p.socketId === socketId);
}
function findSpectatorBySocket(room, socketId) {
    return room.spectators.find((s) => s.socketId === socketId);
}
function removeClientFromRoom(room, socketId) {
    const playersBefore = room.players.length;
    room.players = room.players.filter((p) => p.socketId !== socketId);
    const spectatorsBefore = room.spectators.length;
    room.spectators = room.spectators.filter((s) => s.socketId !== socketId);
    return playersBefore !== room.players.length || spectatorsBefore !== room.spectators.length;
}
const app = (0, express_1.default)();
// Respect reverse-proxy headers from Caddy (X-Forwarded-Proto, etc.)
app.set("trust proxy", true);
// Enable CORS for all API routes
app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (_req.method === "OPTIONS") {
        return res.sendStatus(200);
    }
    next();
});
// NOTE: In some deployed environments (notably long-lived worker processes),
// express.json() can stall indefinitely on non-empty JSON request bodies.
// Use a small custom JSON parser to keep fusion POST endpoints responsive.
app.use((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
        return next();
    }
    const ctype = String(req.headers["content-type"] || "").toLowerCase();
    if (!ctype.includes("application/json")) {
        return next();
    }
    let raw = "";
    let tooLarge = false;
    const maxBytes = 25 * 1024 * 1024; // 25mb
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
        if (tooLarge)
            return;
        raw += chunk;
        if (Buffer.byteLength(raw, "utf8") > maxBytes) {
            tooLarge = true;
            res.status(413).json({ error: "request body too large" });
            req.destroy();
        }
    });
    req.on("end", () => {
        if (tooLarge)
            return;
        if (!raw.trim()) {
            req.body = {};
            return next();
        }
        try {
            req.body = JSON.parse(raw);
            return next();
        }
        catch {
            return res.status(400).json({ error: "invalid JSON body" });
        }
    });
    req.on("error", () => {
        if (!res.headersSent)
            res.status(400).json({ error: "invalid request body" });
    });
});
app.get("/", (_req, res) => {
    res.status(200).json({
        ok: true,
        service: "pokemonttrpg-backend",
        message: "Backend is running. Use /api/health for status.",
    });
});
app.get("/api/health", (_req, res) => {
    res.status(200).json({
        ok: true,
        service: "pokemonttrpg-backend",
        version: "1.5.3-fix1",
        uptimeSec: Math.floor(process.uptime()),
        ts: Date.now(),
    });
});
app.get("/api/trainer-sprites/:filename", (req, res) => {
    const safeName = path_1.default.basename(String(req.params.filename || ""));
    if (!safeName)
        return res.status(400).json({ error: "missing filename" });
    const target = path_1.default.join(TRAINER_SPRITES_DIR, safeName);
    if (!fs_1.default.existsSync(target))
        return res.status(404).json({ error: "not found" });
    return res.sendFile(target);
});
app.post("/api/trainer-sprites/upload", (req, res) => {
    try {
        const dataUrl = String(req.body?.dataUrl || "").trim();
        if (!dataUrl)
            return res.status(400).json({ error: "missing dataUrl" });
        const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
        if (!m)
            return res.status(400).json({ error: "invalid dataUrl" });
        const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
        const buf = Buffer.from(m[2], "base64");
        const prefixRaw = String(req.body?.prefix || "trainer").replace(/[^a-z0-9_-]/gi, "").toLowerCase();
        const prefix = prefixRaw || "trainer";
        const name = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const outPath = path_1.default.join(TRAINER_SPRITES_DIR, name);
        fs_1.default.writeFileSync(outPath, buf);
        const host = req.get("host") || "localhost:3000";
        const origin = `${req.protocol}://${host}`;
        const url = `${origin}/api/trainer-sprites/${name}`;
        return res.json({ ok: true, filename: name, url });
    }
    catch (err) {
        return res.status(500).json({ error: err?.message || "upload failed" });
    }
});
// --- Fusion sprites (Infinite Fusion) ---
function firstExistingPath(candidates) {
    for (const candidate of candidates) {
        try {
            if (candidate && fs_1.default.existsSync(candidate))
                return candidate;
        }
        catch { }
    }
    return "";
}
function parsePathList(raw) {
    if (!raw)
        return [];
    return raw
        .split(path_1.default.delimiter)
        .map((segment) => segment.trim())
        .filter((segment) => !!segment)
        .map((segment) => path_1.default.resolve(segment));
}
const DEFAULT_FUSION_SPRITES_CANDIDATES = [
    path_1.default.resolve(".fusion-sprites-local"),
    path_1.default.resolve("../.fusion-sprites-local"),
    path_1.default.resolve("Full Sprite pack 1-121 (December 2025)"),
    path_1.default.resolve("../Full Sprite pack 1-121 (December 2025)"),
    path_1.default.resolve("tauri-app/public/spliced-sprites"),
    path_1.default.resolve("../tauri-app/public/spliced-sprites"),
];
const DEFAULT_VENDOR_SPRITES_CANDIDATES = [
    path_1.default.resolve("tauri-app/public/vendor/showdown/sprites"),
    path_1.default.resolve("../tauri-app/public/vendor/showdown/sprites"),
    path_1.default.resolve("public/vendor/showdown/sprites"),
];
const DEFAULT_FULL_PACK_BASE_SPRITES_CANDIDATES = [
    path_1.default.resolve("Full Sprite pack 1-121 (December 2025)/Other/BaseSprites"),
    path_1.default.resolve("../Full Sprite pack 1-121 (December 2025)/Other/BaseSprites"),
];
const FUSION_SPRITES_DIR = process.env.FUSION_SPRITES_DIR
    ? path_1.default.resolve(process.env.FUSION_SPRITES_DIR)
    : firstExistingPath(DEFAULT_FUSION_SPRITES_CANDIDATES);
const FUSION_SPRITES_EXTRA_DIRS = parsePathList(process.env.FUSION_SPRITES_EXTRA_DIRS);
const VENDOR_SPRITES_DIR = firstExistingPath(DEFAULT_VENDOR_SPRITES_CANDIDATES);
const FULL_PACK_BASE_SPRITES_DIR = firstExistingPath(DEFAULT_FULL_PACK_BASE_SPRITES_CANDIDATES);
const FUSION_OTHER_BASE_SPRITES_DIR = firstExistingPath([
    path_1.default.resolve(FUSION_SPRITES_DIR || ".fusion-sprites-local", "Other/BaseSprites"),
    path_1.default.resolve(".fusion-sprites-local/Other/BaseSprites"),
    path_1.default.resolve("../.fusion-sprites-local/Other/BaseSprites"),
    path_1.default.resolve("sprites/Other/BaseSprites"),
    path_1.default.resolve("../sprites/Other/BaseSprites"),
]);
const UNIFIED_SPRITES_ROOT = process.env.UNIFIED_SPRITES_ROOT
    ? path_1.default.resolve(process.env.UNIFIED_SPRITES_ROOT)
    : path_1.default.resolve(FUSION_SPRITES_DIR || ".fusion-sprites-local", "sprites");
const FUSION_PACK_ZIP = process.env.FUSION_PACK_ZIP
    ? path_1.default.resolve(process.env.FUSION_PACK_ZIP)
    : "";
const FUSION_REPORTS_DIR = process.env.FUSION_REPORTS_DIR
    ? path_1.default.resolve(process.env.FUSION_REPORTS_DIR)
    : path_1.default.resolve(process.cwd(), "data", "sprite-reports");
function ensureParentDir(filePath) {
    try {
        fs_1.default.mkdirSync(path_1.default.dirname(filePath), { recursive: true });
    }
    catch { }
}
function readIndexFolders(indexPath) {
    const out = {};
    try {
        if (!indexPath || !fs_1.default.existsSync(indexPath))
            return out;
        const raw = JSON.parse(fs_1.default.readFileSync(indexPath, "utf-8"));
        const folders = raw?.folders && typeof raw.folders === "object" ? raw.folders : {};
        for (const [folder, values] of Object.entries(folders)) {
            if (!out[folder])
                out[folder] = new Set();
            for (const value of Array.isArray(values) ? values : []) {
                const id = String(value || "").trim();
                if (id)
                    out[folder].add(id);
            }
        }
    }
    catch { }
    return out;
}
function addSpritesFromDir(target, dirPath) {
    try {
        if (!dirPath || !fs_1.default.existsSync(dirPath))
            return;
        const files = fs_1.default.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of files) {
            if (!entry.isFile())
                continue;
            const parsed = path_1.default.parse(entry.name);
            const ext = parsed.ext.toLowerCase();
            if (ext !== ".png" && ext !== ".gif")
                continue;
            if (!parsed.name)
                continue;
            target.add(parsed.name);
        }
    }
    catch { }
}
function addSpritesFromDirRecursive(target, dirPath, maxDepth = 3) {
    function walk(current, depth) {
        if (depth > maxDepth)
            return;
        try {
            if (!current || !fs_1.default.existsSync(current))
                return;
            const entries = fs_1.default.readdirSync(current, { withFileTypes: true });
            for (const entry of entries) {
                const next = path_1.default.join(current, entry.name);
                if (entry.isDirectory()) {
                    walk(next, depth + 1);
                    continue;
                }
                if (!entry.isFile())
                    continue;
                const parsed = path_1.default.parse(entry.name);
                const ext = parsed.ext.toLowerCase();
                if (ext !== ".png" && ext !== ".gif")
                    continue;
                if (!parsed.name)
                    continue;
                target.add(parsed.name);
            }
        }
        catch { }
    }
    walk(dirPath, 0);
}
function buildMergedSpriteIndex() {
    const merged = readIndexFolders(path_1.default.join(VENDOR_SPRITES_DIR || "", "index.json"));
    const folders = new Set(Object.keys(merged));
    const knownFolders = [
        "gen5",
        "gen5-shiny",
        "gen5-back",
        "gen5-back-shiny",
        "ani",
        "ani-shiny",
        "ani-back",
        "ani-back-shiny",
        "home",
        "home-shiny",
        "gen6",
        "gen6-back",
        "gen4",
        "gen4-shiny",
        "gen4-back",
        "gen4-back-shiny",
        "gen3",
        "gen3-shiny",
        "gen3-back",
        "gen3-back-shiny",
        "gen2",
        "gen2-shiny",
        "gen2-back",
        "gen2-back-shiny",
        "gen1",
        "gen1-back",
    ];
    for (const folder of knownFolders)
        folders.add(folder);
    for (const folder of folders) {
        if (!merged[folder])
            merged[folder] = new Set();
        addSpritesFromDir(merged[folder], path_1.default.join(UNIFIED_SPRITES_ROOT, folder));
        if (VENDOR_SPRITES_DIR) {
            addSpritesFromDir(merged[folder], path_1.default.join(VENDOR_SPRITES_DIR, folder));
        }
    }
    // BaseSprites packs carry numeric+suffix variants (e.g. 1a, 1b) that are needed by the picker.
    if (!merged["gen5"])
        merged["gen5"] = new Set();
    if (FUSION_OTHER_BASE_SPRITES_DIR) {
        addSpritesFromDir(merged["gen5"], FUSION_OTHER_BASE_SPRITES_DIR);
    }
    if (FULL_PACK_BASE_SPRITES_DIR) {
        addSpritesFromDir(merged["gen5"], FULL_PACK_BASE_SPRITES_DIR);
    }
    if (FUSION_SPRITES_DIR) {
        addSpritesFromDirRecursive(merged["gen5"], path_1.default.join(FUSION_SPRITES_DIR, "Other"), 4);
        addSpritesFromDirRecursive(merged["gen5"], path_1.default.join(FUSION_SPRITES_DIR, "sprites", "Other"), 4);
        addSpritesFromDirRecursive(merged["gen5"], path_1.default.join(FUSION_SPRITES_DIR, "sprites", "gen5"), 2);
        addSpritesFromDirRecursive(merged["gen5"], path_1.default.join(FUSION_SPRITES_DIR, "gen5"), 2);
    }
    // Add delta name aliases (e.g. "deltavenusaur") so the index advertises them.
    // The actual files are numeric (40003.png) but clients look up by name.
    for (const deltaName of Object.keys(gDeltaNameToNum)) {
        merged["gen5"].add(deltaName);
    }
    const payloadFolders = {};
    for (const [folder, values] of Object.entries(merged)) {
        payloadFolders[folder] = Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    }
    return { folders: payloadFolders };
}
// Build a map of delta sprite names → numeric dex IDs at startup (e.g. "deltavenusaur" → "40003").
// This lets the backend serve delta sprites by name even though the actual files are numbered.
const gDeltaNameToNum = (() => {
    const map = {};
    const candidates = [
        path_1.default.resolve("data/insurgence/generated/pokedex.insurgence.json"),
        path_1.default.resolve("../data/insurgence/generated/pokedex.insurgence.json"),
        path_1.default.resolve("tauri-app/public/data/insurgence/generated/pokedex.insurgence.json"),
        path_1.default.resolve("../tauri-app/public/data/insurgence/generated/pokedex.insurgence.json"),
    ];
    for (const candidate of candidates) {
        try {
            if (!fs_1.default.existsSync(candidate))
                continue;
            const dex = JSON.parse(fs_1.default.readFileSync(candidate, "utf-8"));
            for (const [key, entry] of Object.entries(dex)) {
                const num = entry?.num;
                if (typeof num === "number" && num >= 40001 && key.startsWith("delta")) {
                    map[key.toLowerCase()] = String(num);
                }
            }
            if (Object.keys(map).length > 0)
                break;
        }
        catch { }
    }
    return map;
})();
function tryCacheSpriteToUnified(folder, filename) {
    const target = path_1.default.join(UNIFIED_SPRITES_ROOT, folder, filename);
    if (fs_1.default.existsSync(target))
        return target;
    const sourceCandidates = [];
    if (folder === "gen5" || folder === "gen5-shiny" || folder === "gen5-back" || folder === "gen5-back-shiny") {
        if (FUSION_OTHER_BASE_SPRITES_DIR) {
            sourceCandidates.push(path_1.default.join(FUSION_OTHER_BASE_SPRITES_DIR, filename));
        }
        if (FULL_PACK_BASE_SPRITES_DIR) {
            sourceCandidates.push(path_1.default.join(FULL_PACK_BASE_SPRITES_DIR, filename));
        }
        if (folder === "gen5") {
            if (FUSION_SPRITES_DIR) {
                sourceCandidates.push(path_1.default.join(FUSION_SPRITES_DIR, "sprites", "gen5", filename));
                sourceCandidates.push(path_1.default.join(FUSION_SPRITES_DIR, "gen5", filename));
                sourceCandidates.push(path_1.default.join(FUSION_SPRITES_DIR, "Other", filename));
                sourceCandidates.push(path_1.default.join(FUSION_SPRITES_DIR, "sprites", "Other", filename));
            }
        }
        // Delta name → numeric file fallback (e.g. "deltavenusaur.png" → "40003.png")
        const parsed = path_1.default.parse(filename);
        const baseName = parsed.name.toLowerCase();
        const numericId = gDeltaNameToNum[baseName];
        if (numericId) {
            const numericFilename = `${numericId}${parsed.ext}`;
            if (FUSION_OTHER_BASE_SPRITES_DIR) {
                sourceCandidates.push(path_1.default.join(FUSION_OTHER_BASE_SPRITES_DIR, numericFilename));
            }
            if (FULL_PACK_BASE_SPRITES_DIR) {
                sourceCandidates.push(path_1.default.join(FULL_PACK_BASE_SPRITES_DIR, numericFilename));
            }
        }
    }
    // If a dedicated back sprite doesn't exist, use front sprite as fallback.
    // This covers both numeric IDs (e.g. "20059.png") and named sprites (e.g. "goldica.png").
    if (folder === "gen5-back" || folder === "gen5-back-shiny") {
        const siblingFolder = folder === "gen5-back-shiny" ? "gen5-shiny" : "gen5";
        sourceCandidates.push(path_1.default.join(UNIFIED_SPRITES_ROOT, siblingFolder, filename));
        if (VENDOR_SPRITES_DIR) {
            sourceCandidates.push(path_1.default.join(VENDOR_SPRITES_DIR, siblingFolder, filename));
        }
        if (FUSION_OTHER_BASE_SPRITES_DIR) {
            sourceCandidates.push(path_1.default.join(FUSION_OTHER_BASE_SPRITES_DIR, filename));
        }
        if (FULL_PACK_BASE_SPRITES_DIR) {
            sourceCandidates.push(path_1.default.join(FULL_PACK_BASE_SPRITES_DIR, filename));
        }
    }
    if (VENDOR_SPRITES_DIR) {
        sourceCandidates.push(path_1.default.join(VENDOR_SPRITES_DIR, folder, filename));
    }
    for (const source of sourceCandidates) {
        if (!source || !fs_1.default.existsSync(source))
            continue;
        try {
            ensureParentDir(target);
            fs_1.default.copyFileSync(source, target);
            return target;
        }
        catch { }
    }
    return "";
}
app.get("/sprites/index.json", (_req, res) => {
    const unifiedIndex = path_1.default.join(UNIFIED_SPRITES_ROOT, "index.json");
    // Serve cached index if it's less than 30 minutes old; otherwise rebuild.
    if (fs_1.default.existsSync(unifiedIndex)) {
        try {
            const stat = fs_1.default.statSync(unifiedIndex);
            if (Date.now() - stat.mtimeMs < 30 * 60 * 1000)
                return res.sendFile(unifiedIndex);
        }
        catch { }
    }
    try {
        const payload = buildMergedSpriteIndex();
        const hasAny = Object.values(payload.folders).some((list) => list.length > 0);
        if (!hasAny) {
            // Keep clients functional while sprites are still syncing.
            payload.folders = { gen5: [] };
        }
        ensureParentDir(unifiedIndex);
        fs_1.default.writeFileSync(unifiedIndex, JSON.stringify(payload));
        return res.sendFile(unifiedIndex);
    }
    catch {
        return res.json({ folders: { gen5: [] } });
    }
});
app.get("/sprites/:folder/:filename", (req, res) => {
    const folder = path_1.default.basename(String(req.params.folder || ""));
    const filename = path_1.default.basename(String(req.params.filename || ""));
    if (!folder || !filename)
        return res.status(400).json({ error: "missing sprite path" });
    if (!/^[a-z0-9-]+$/i.test(folder))
        return res.status(400).json({ error: "invalid folder" });
    if (!/^[a-z0-9._-]+\.(png|gif)$/i.test(filename))
        return res.status(400).json({ error: "invalid filename" });
    const unifiedPath = path_1.default.join(UNIFIED_SPRITES_ROOT, folder, filename);
    if (fs_1.default.existsSync(unifiedPath))
        return res.sendFile(unifiedPath);
    const cached = tryCacheSpriteToUnified(folder, filename);
    if (cached && fs_1.default.existsSync(cached))
        return res.sendFile(cached);
    return res.status(404).json({ error: "sprite not found" });
});
// Fusion sprite serving
let fusionGenService = null;
let fusionRemoteProxyEnabled = false;
const FUSION_GEN_REMOTE_BASE = (process.env.FUSION_GEN_REMOTE_BASE || "").trim().replace(/\/+$/, "");
if (FUSION_SPRITES_DIR && fs_1.default.existsSync(FUSION_SPRITES_DIR)) {
    // Fusion generation service (Pi 5 + AI HAT2)
    const FUSION_GEN_SCRIPTS = process.env.FUSION_GEN_SCRIPTS
        ? path_1.default.resolve(process.env.FUSION_GEN_SCRIPTS)
        : "";
    const FUSION_GEN_BASE = process.env.FUSION_GEN_BASE_SPRITES
        ? path_1.default.resolve(process.env.FUSION_GEN_BASE_SPRITES)
        : "";
    const FUSION_GEN_MODE = (process.env.FUSION_GEN_MODE || "ai");
    const FUSION_GEN_WORKERS = parseInt(process.env.FUSION_GEN_WORKERS || "2", 10);
    const FUSION_LORA = process.env.FUSION_LORA_PATH
        ? path_1.default.resolve(process.env.FUSION_LORA_PATH)
        : undefined;
    const fetchFn = globalThis.fetch;
    const remoteMode = !!FUSION_GEN_REMOTE_BASE && !!fetchFn;
    if (!remoteMode) {
        (0, fusion_sync_1.registerFusionRoutes)(app, {
            spritesDir: FUSION_SPRITES_DIR,
            spritesDirs: FUSION_SPRITES_EXTRA_DIRS,
            packZipPath: FUSION_PACK_ZIP || undefined,
            reportsDir: FUSION_REPORTS_DIR,
        });
        console.log(`[Fusion] Sprites directory enabled: ${FUSION_SPRITES_DIR}`);
        if (FUSION_SPRITES_EXTRA_DIRS.length) {
            console.log(`[Fusion] Extra sprite roots: ${FUSION_SPRITES_EXTRA_DIRS.join(", ")}`);
        }
    }
    else {
        console.log(`[Fusion] Remote worker mode; proxying fusion sprite/variant endpoints to ${FUSION_GEN_REMOTE_BASE}`);
    }
    if (FUSION_GEN_REMOTE_BASE && fetchFn) {
        const workerFetch = fetchFn;
        async function proxyToFusionWorker(req, res, upstreamPath) {
            try {
                const upstream = await workerFetch(`${FUSION_GEN_REMOTE_BASE}${upstreamPath}`, {
                    method: req.method,
                    headers: { "Content-Type": "application/json" },
                    body: req.method === "GET" ? undefined : JSON.stringify(req.body ?? {}),
                });
                const text = await upstream.text();
                let payload = null;
                try {
                    payload = text ? JSON.parse(text) : null;
                }
                catch {
                    payload = { raw: text };
                }
                return res.status(upstream.status).json(payload ?? {});
            }
            catch (err) {
                return res.status(502).json({ error: err?.message || "fusion worker proxy failed" });
            }
        }
        async function proxyToFusionWorkerRaw(req, res, upstreamPath) {
            try {
                const upstream = await workerFetch(`${FUSION_GEN_REMOTE_BASE}${upstreamPath}`, {
                    method: req.method,
                    headers: req.method === "GET" ? undefined : { "Content-Type": "application/json" },
                    body: req.method === "GET" ? undefined : JSON.stringify(req.body ?? {}),
                });
                const ctype = upstream.headers.get("content-type");
                const cdisp = upstream.headers.get("content-disposition");
                const cache = upstream.headers.get("cache-control");
                if (ctype)
                    res.setHeader("Content-Type", ctype);
                if (cdisp)
                    res.setHeader("Content-Disposition", cdisp);
                if (cache)
                    res.setHeader("Cache-Control", cache);
                const body = Buffer.from(await upstream.arrayBuffer());
                return res.status(upstream.status).send(body);
            }
            catch (err) {
                return res.status(502).json({ error: err?.message || "fusion worker proxy failed" });
            }
        }
        // In remote mode, serve generated sprites/variants from worker as source-of-truth.
        app.get("/fusion/variants/:head/:body", (req, res) => proxyToFusionWorker(req, res, `/fusion/variants/${req.params.head}/${req.params.body}`));
        app.get("/fusion/variants", (req, res) => proxyToFusionWorker(req, res, "/fusion/variants"));
        app.get("/fusion/sprites/:filename", (req, res) => proxyToFusionWorkerRaw(req, res, `/fusion/sprites/${encodeURIComponent(req.params.filename)}`));
        app.get("/fusion/pack", (req, res) => proxyToFusionWorkerRaw(req, res, "/fusion/pack"));
        app.post("/api/fusion/reindex", (req, res) => proxyToFusionWorker(req, res, "/api/fusion/reindex"));
        app.post("/api/fusion/upload-sprite", (req, res) => proxyToFusionWorker(req, res, "/api/fusion/upload-sprite"));
        app.post("/api/fusion/report-wrong-sprite", (req, res) => proxyToFusionWorker(req, res, "/api/fusion/report-wrong-sprite"));
        app.post("/fusion/generate", (req, res) => proxyToFusionWorker(req, res, "/fusion/generate"));
        app.post("/fusion/generate-base", (req, res) => proxyToFusionWorker(req, res, "/fusion/generate-base"));
        app.post("/fusion/new-species", (req, res) => proxyToFusionWorker(req, res, "/fusion/new-species"));
        app.get("/fusion/gen-status", (req, res) => proxyToFusionWorker(req, res, "/fusion/gen-status"));
        app.get("/fusion/gen-check/:head/:body", (req, res) => proxyToFusionWorker(req, res, `/fusion/gen-check/${req.params.head}/${req.params.body}`));
        fusionRemoteProxyEnabled = true;
        console.log(`[FusionGen] Remote worker mode enabled: ${FUSION_GEN_REMOTE_BASE}`);
    }
    else if (FUSION_GEN_SCRIPTS && FUSION_GEN_BASE) {
        fusionGenService = new fusion_gen_1.FusionGenService({
            spritesDir: FUSION_SPRITES_DIR,
            scriptsDir: FUSION_GEN_SCRIPTS,
            baseSpritesDir: FUSION_GEN_BASE,
            pythonBin: process.env.FUSION_GEN_PYTHON || "python3",
            loraPath: FUSION_LORA,
            mode: FUSION_GEN_MODE,
            workers: FUSION_GEN_WORKERS,
            allDexNums: [], // Populated after dex loads
        });
        (0, fusion_gen_1.registerFusionGenRoutes)(app, fusionGenService);
        fusionGenService.start();
        console.log(`[FusionGen] Generation service started (mode=${FUSION_GEN_MODE})`);
    }
    else {
        console.log("[FusionGen] Not configured. Set FUSION_GEN_REMOTE_BASE (recommended) or FUSION_GEN_SCRIPTS + FUSION_GEN_BASE_SPRITES.");
    }
}
else {
    console.log("[Fusion] Sprites directory not configured. Set FUSION_SPRITES_DIR to enable.");
}
// Always-available capability endpoint so the frontend knows whether
// on-demand fusion generation is supported before attempting POSTs.
// In remote-proxy mode, forward the request to the worker so the
// frontend receives accurate warmup state from the actual generator.
app.get("/fusion/gen-available", async (_req, res) => {
    const available = !!fusionGenService || fusionRemoteProxyEnabled || !!FUSION_GEN_REMOTE_BASE;
    // Remote proxy mode: relay from worker for accurate warmup state.
    if (fusionRemoteProxyEnabled && FUSION_GEN_REMOTE_BASE && globalThis.fetch) {
        try {
            const workerRes = await globalThis.fetch(`${FUSION_GEN_REMOTE_BASE}/fusion/gen-available`, { signal: AbortSignal.timeout(4000) });
            if (workerRes.ok) {
                const data = await workerRes.json();
                return res.json({ ...data, available: true });
            }
        }
        catch { }
        // Worker unreachable — report unavailable warmup, but available=true so
        // the frontend still attempts generation (worker may come up soon).
        return res.json({ available, warmedUp: false, warming: false });
    }
    // Local FusionGenService mode.
    const localService = fusionGenService;
    if (localService?.ensureWarmup) {
        void localService.ensureWarmup("gen-available");
    }
    const warmup = localService?.getWarmupState ? localService.getWarmupState() : null;
    res.json({
        available,
        warmup,
        warmedUp: !!warmup?.ready,
        warming: !!warmup?.inProgress,
    });
});
function loadCustomDex() {
    try {
        if (fs_1.default.existsSync(CUSTOM_DEX_FILE)) {
            const json = JSON.parse(fs_1.default.readFileSync(CUSTOM_DEX_FILE, "utf-8"));
            // Ensure shape
            return { species: json.species ?? {}, moves: json.moves ?? {}, abilities: json.abilities ?? {} };
        }
    }
    catch { }
    return { species: {}, moves: {}, abilities: {} };
}
function saveCustomDex(dex) {
    const payload = { species: dex.species ?? {}, moves: dex.moves ?? {}, abilities: dex.abilities ?? {} };
    fs_1.default.writeFileSync(CUSTOM_DEX_FILE, JSON.stringify(payload, null, 2));
}
function loadCustomSprites() {
    try {
        if (fs_1.default.existsSync(CUSTOM_SPRITES_FILE)) {
            const json = JSON.parse(fs_1.default.readFileSync(CUSTOM_SPRITES_FILE, "utf-8"));
            return (json && typeof json === "object") ? json : {};
        }
    }
    catch { }
    return {};
}
function saveCustomSprites(sprites) {
    const payload = sprites ?? {};
    fs_1.default.writeFileSync(CUSTOM_SPRITES_FILE, JSON.stringify(payload, null, 2));
}
function diffDex(serverDex, clientDex) {
    const missingOnClient = { species: {}, moves: {}, abilities: {} };
    const missingOnServer = { species: {}, moves: {}, abilities: {} };
    // Server -> Client (what client lacks)
    for (const [id, s] of Object.entries(serverDex.species ?? {})) {
        if (!clientDex.species || !clientDex.species[id])
            missingOnClient.species[id] = s;
    }
    for (const [id, m] of Object.entries(serverDex.moves ?? {})) {
        if (!clientDex.moves || !clientDex.moves[id])
            missingOnClient.moves[id] = m;
    }
    for (const [id, a] of Object.entries(serverDex.abilities ?? {})) {
        if (!clientDex.abilities || !clientDex.abilities[id])
            missingOnClient.abilities[id] = a;
    }
    // Client -> Server (what server lacks)
    for (const [id, s] of Object.entries(clientDex.species ?? {})) {
        if (!serverDex.species || !serverDex.species[id])
            missingOnServer.species[id] = s;
    }
    for (const [id, m] of Object.entries(clientDex.moves ?? {})) {
        if (!serverDex.moves || !serverDex.moves[id])
            missingOnServer.moves[id] = m;
    }
    for (const [id, a] of Object.entries(clientDex.abilities ?? {})) {
        if (!serverDex.abilities || !serverDex.abilities[id])
            missingOnServer.abilities[id] = a;
    }
    return { missingOnClient, missingOnServer };
}
function diffSprites(serverSprites, clientSprites) {
    const missingOnClient = {};
    const missingOnServer = {};
    for (const [id, slots] of Object.entries(serverSprites || {})) {
        for (const [slot, dataUrl] of Object.entries(slots || {})) {
            if (!dataUrl)
                continue;
            const existing = clientSprites?.[id]?.[slot];
            if (!existing) {
                missingOnClient[id] = { ...(missingOnClient[id] || {}), [slot]: dataUrl };
            }
        }
    }
    for (const [id, slots] of Object.entries(clientSprites || {})) {
        for (const [slot, dataUrl] of Object.entries(slots || {})) {
            if (!dataUrl)
                continue;
            const existing = serverSprites?.[id]?.[slot];
            if (!existing) {
                missingOnServer[id] = { ...(missingOnServer[id] || {}), [slot]: dataUrl };
            }
        }
    }
    return { missingOnClient, missingOnServer };
}
app.get("/api/rooms", (_req, res) => {
    const list = Array.from(rooms.values()).map((r) => ({
        id: r.id,
        name: r.name,
        players: r.players.map((p) => p.username),
        spectCount: r.spectators.length,
        started: r.battleStarted,
        challengeCount: r.challenges.size,
    }));
    res.json(list);
});
// Custom Dex APIs
// 1) Read server-side store
app.get("/api/customdex", (_req, res) => {
    const dex = loadCustomDex();
    res.json(dex);
});
// 2) Sync: client posts its dex; server returns what client is missing (from server),
//    and what server is missing (from client). Client may then call /upload to add to server.
app.post("/api/customdex/sync", (req, res) => {
    const clientDex = (req.body ?? {});
    const serverDex = loadCustomDex();
    const serverSprites = loadCustomSprites();
    const clientSprites = clientDex.sprites || {};
    const { missingOnClient, missingOnServer } = diffDex(serverDex, clientDex);
    const spriteDiff = diffSprites(serverSprites, clientSprites);
    res.json({
        missingOnClient: { ...missingOnClient, sprites: spriteDiff.missingOnClient },
        missingOnServer: { ...missingOnServer, sprites: spriteDiff.missingOnServer },
    });
});
// 3) Upload: merge new entries from client into server store (no overwrite by default)
app.post("/api/customdex/upload", (req, res) => {
    const incoming = (req.body ?? {});
    const serverDex = loadCustomDex();
    const serverSprites = loadCustomSprites();
    let addedSpecies = 0;
    let addedMoves = 0;
    let addedAbilities = 0;
    let addedSprites = 0;
    serverDex.species = serverDex.species || {};
    serverDex.moves = serverDex.moves || {};
    serverDex.abilities = serverDex.abilities || {};
    for (const [id, s] of Object.entries(incoming.species ?? {})) {
        if (!serverDex.species[id]) {
            serverDex.species[id] = s;
            addedSpecies++;
        }
    }
    for (const [id, m] of Object.entries(incoming.moves ?? {})) {
        if (!serverDex.moves[id]) {
            serverDex.moves[id] = m;
            addedMoves++;
        }
    }
    for (const [id, a] of Object.entries(incoming.abilities ?? {})) {
        if (!serverDex.abilities[id]) {
            serverDex.abilities[id] = a;
            addedAbilities++;
        }
    }
    for (const [id, slots] of Object.entries(incoming.sprites || {})) {
        const slotMap = slots;
        for (const [slot, dataUrl] of Object.entries(slotMap || {})) {
            if (!dataUrl)
                continue;
            const existing = serverSprites?.[id]?.[slot];
            if (!existing) {
                serverSprites[id] = { ...(serverSprites[id] || {}), [slot]: dataUrl };
                addedSprites++;
            }
        }
    }
    saveCustomDex(serverDex);
    saveCustomSprites(serverSprites);
    // Trigger fusion generation for newly added species
    if (fusionGenService && addedSpecies > 0) {
        for (const [id, s] of Object.entries(incoming.species ?? {})) {
            const specEntry = s;
            const dexNum = specEntry?.num;
            if (typeof dexNum === "number" && dexNum !== 0) {
                const hasSprite = !!(serverSprites[id]?.front);
                const description = specEntry?.description || specEntry?.name || id;
                fusionGenService.enqueueNewSpecies(dexNum, hasSprite, description);
            }
        }
    }
    res.json({ ok: true, added: { species: addedSpecies, moves: addedMoves, abilities: addedAbilities, sprites: addedSprites } });
});
app.get("/api/rooms/:id", (req, res) => {
    const room = rooms.get(req.params.id);
    if (!room)
        return res.status(404).json({ error: "room not found" });
    res.json({
        id: room.id,
        name: room.name,
        players: room.players.map((p) => ({ id: p.id, username: p.username })),
        spectCount: room.spectators.length,
        started: room.battleStarted,
        challengeCount: room.challenges.size,
    });
});
app.get("/api/replay/:id", (req, res) => {
    const file = path_1.default.join(REPLAYS_DIR, `${req.params.id}.json`);
    if (!fs_1.default.existsSync(file))
        return res.status(404).send("Replay not found");
    res.download(file);
});
app.get("/api/replays", (_req, res) => {
    const files = fs_1.default.readdirSync(REPLAYS_DIR).filter(f => f.endsWith('.json'));
    const list = files.map(f => ({ id: f.replace(/\.json$/, ''), size: fs_1.default.statSync(path_1.default.join(REPLAYS_DIR, f)).size }));
    res.json(list);
});
app.get("/api/replays/:id/meta", (req, res) => {
    const file = path_1.default.join(REPLAYS_DIR, `${req.params.id}.json`);
    if (!fs_1.default.existsSync(file))
        return res.status(404).json({ error: "not found" });
    const json = JSON.parse(fs_1.default.readFileSync(file, "utf-8"));
    res.json({ id: json.id, room: json.room, createdAt: json.createdAt, turns: json.replay?.length ?? 0 });
});
// Compact spectator snapshot: mirrors spectate_start payload
app.get("/api/rooms/:id/snapshot", (req, res) => {
    const room = rooms.get(req.params.id);
    if (!room || !room.engine)
        return res.status(404).json({ error: "room not found or battle not started" });
    const needsSwitch = room.forceSwitchNeeded ? Array.from(room.forceSwitchNeeded) : [];
    const state = room.engine.getState();
    res.json({ state, replay: room.replay, phase: room.phase ?? "normal", needsSwitch, deadline: room.forceSwitchDeadline ?? null, rooms: { trick: state.field.room, magic: state.field.magicRoom, wonder: state.field.wonderRoom } });
});
// ─── Bug / Feature Reports ─────────────────────────────────
const BUG_REPORTS_FILE = path_1.default.join(DATA_DIR, "bug-reports.json");
function loadBugReports() {
    try {
        return fs_1.default.existsSync(BUG_REPORTS_FILE) ? JSON.parse(fs_1.default.readFileSync(BUG_REPORTS_FILE, "utf-8")) : [];
    }
    catch {
        return [];
    }
}
function saveBugReports(reports) {
    fs_1.default.writeFileSync(BUG_REPORTS_FILE, JSON.stringify(reports, null, 2));
}
app.post("/api/bug-report", (req, res) => {
    try {
        const { type, title, description, severity, logs, userAgent, appVersion, timestamp, tab } = req.body;
        if (!title || !type)
            return res.status(400).json({ error: "title and type required" });
        const report = {
            id: (0, uuid_1.v4)(),
            type: type || "bug",
            title: String(title).slice(0, 200),
            description: String(description || "").slice(0, 5000),
            severity: severity || "medium",
            logs: Array.isArray(logs) ? logs.slice(-50) : [],
            userAgent: String(userAgent || "").slice(0, 500),
            appVersion: String(appVersion || ""),
            timestamp: timestamp || Date.now(),
            tab: String(tab || ""),
            receivedAt: Date.now(),
            ip: req.ip || req.socket.remoteAddress || "",
        };
        const reports = loadBugReports();
        reports.unshift(report);
        // keep last 500 reports
        if (reports.length > 500)
            reports.length = 500;
        saveBugReports(reports);
        console.log(`[BugReport] New ${report.type}: "${report.title}" (${report.severity}) from ${report.appVersion}`);
        res.json({ ok: true, id: report.id });
    }
    catch (err) {
        console.error("[BugReport] Error:", err);
        res.status(500).json({ error: "internal error" });
    }
});
app.get("/api/bug-reports", (_req, res) => {
    const reports = loadBugReports();
    res.json(reports);
});
app.get("/api/bug-reports/:id", (req, res) => {
    const reports = loadBugReports();
    const report = reports.find((r) => r.id === req.params.id);
    if (!report)
        return res.status(404).json({ error: "not found" });
    res.json(report);
});
const server = http_1.default.createServer(app);
const RECONNECT_GRACE_MS = 15000; // 15 seconds to reconnect before losing battle slot
const io = new socket_io_1.Server(server, {
    cors: { origin: "*" },
    pingInterval: 10000,
    pingTimeout: 5000,
    perMessageDeflate: {
        threshold: 256, // only compress payloads above 256 bytes
    },
});
if (FUSION_SPRITES_DIR && fs_1.default.existsSync(FUSION_SPRITES_DIR)) {
    (0, fusion_sync_1.attachFusionWebSocket)(server, {
        spritesDir: FUSION_SPRITES_DIR,
        packZipPath: FUSION_PACK_ZIP || undefined,
    });
    console.log("[Fusion] WebSocket endpoint enabled at /fusion-sync");
}
process.on("uncaughtException", (err) => {
    console.error("[Server] Uncaught exception:", err?.stack || err);
});
process.on("unhandledRejection", (err) => {
    console.error("[Server] Unhandled rejection:", err);
});
function emitChallengeCreated(room, challenge) {
    io.to(room.id).emit("challengeCreated", { roomId: room.id, challenge: challengeSummary(challenge) });
}
function emitChallengeUpdated(room, challenge) {
    io.to(room.id).emit("challengeUpdated", { roomId: room.id, challenge: challengeSummary(challenge) });
}
function emitChallengeRemoved(room, challengeId, reason) {
    io.to(room.id).emit("challengeRemoved", { roomId: room.id, challengeId, reason });
}
function coerceTrainerSprite(value) {
    let raw;
    if (typeof value === "string") {
        raw = value.trim();
    }
    else if (typeof value === "number" && Number.isFinite(value)) {
        raw = String(Math.trunc(value));
    }
    if (!raw)
        return undefined;
    if (/^https?:\/\//i.test(raw) || raw.startsWith("/"))
        return raw;
    if (/^data:image\//i.test(raw))
        return raw;
    // Normalize: lowercase, remove spaces/special chars
    const normalized = raw.toLowerCase().replace(/[\s_-]+/g, "").replace(/[^a-z0-9]/gi, "");
    // Filter out invalid/placeholder values
    const invalid = ["pending", "random", "default", "unknown", "none", ""];
    if (invalid.includes(normalized))
        return undefined;
    return raw;
}
function sanitizePlayerPayload(player, participant) {
    const clone = JSON.parse(JSON.stringify(player));
    const cloneAny = clone;
    const trainerSprite = coerceTrainerSprite(cloneAny.trainerSprite ?? cloneAny.avatar ?? participant.trainerSprite);
    clone.id = participant.playerId;
    clone.name = clone.name || participant.username;
    if (typeof clone.activeIndex !== "number")
        clone.activeIndex = 0;
    // Always set/clear trainerSprite and avatar to ensure invalid values are removed
    cloneAny.trainerSprite = trainerSprite || undefined;
    cloneAny.avatar = trainerSprite || undefined;
    return clone;
}
function startTeamPreview(room, players, rules) {
    room.phase = "team-preview";
    room.teamPreviewPlayers = players;
    room.teamPreviewOrders = {};
    room.teamPreviewRules = rules;
    room.teamPreviewRealPlayerIds = undefined;
    room.teamPreviewPlayerTeams = undefined;
    // Determine active count from format for team preview
    const format = rules?.format || 'singles';
    let activeCount = rules?.activeCount || 1;
    if (format === 'doubles' && activeCount < 2)
        activeCount = 2;
    if (format === 'triples' && activeCount < 3)
        activeCount = 3;
    if (format === 'ffa')
        activeCount = 1; // FFA has 1 active per player
    // Determine gameType
    let gameType = 'singles';
    if (format === 'doubles')
        gameType = 'doubles';
    else if (format === 'triples')
        gameType = 'triples';
    else if (format === 'ffa')
        gameType = 'freeforall';
    // Emit teamPreviewStarted FIRST so client can mount the battle tab before receiving prompts
    io.to(room.id).emit("teamPreviewStarted", { roomId: room.id });
    const buildTeamPreviewParticipants = () => {
        const bySide = { p1: [], p2: [] };
        if (room.bossMode) {
            const mergedPlayer = players.find(p => p.id === room.bossMode.mergedPlayerId);
            const soloPlayerIdx = players.findIndex(p => p.id !== room.bossMode.mergedPlayerId);
            const soloPlayer = soloPlayerIdx >= 0 ? players[soloPlayerIdx] : null;
            const soloSide = soloPlayerIdx >= 0 ? `p${soloPlayerIdx + 1}` : (room.bossMode.mergedSide === 'p1' ? 'p2' : 'p1');
            if (soloPlayer) {
                bySide[soloSide] = [{
                        playerId: soloPlayer.id,
                        name: soloPlayer.name || soloPlayer.id,
                        trainerSprite: soloPlayer.trainerSprite || soloPlayer.avatar,
                        team: soloPlayer.team || [],
                        previewActiveCount: activeCount,
                    }];
            }
            if (mergedPlayer) {
                bySide[room.bossMode.mergedSide] = room.bossMode.playerSlots.map((slotInfo) => {
                    const ownedPokemonIds = new Set();
                    for (const [pokId, ownerId] of room.bossMode.pokemonOwnership) {
                        if (ownerId === slotInfo.playerId)
                            ownedPokemonIds.add(pokId);
                    }
                    const ownedTeam = (mergedPlayer.team || []).filter((p) => ownedPokemonIds.has(p.id));
                    const roomPlayer = room.players.find(p => p.id === slotInfo.playerId);
                    return {
                        playerId: slotInfo.playerId,
                        name: roomPlayer?.username || slotInfo.playerId,
                        trainerSprite: roomPlayer?.trainerSprite,
                        team: ownedTeam,
                        previewActiveCount: 1,
                    };
                });
            }
            return bySide;
        }
        if (room.teamBattleMode) {
            for (const sideConfig of room.teamBattleMode.sides) {
                const mergedPlayer = players.find(p => p.id === sideConfig.mergedPlayerId);
                if (!mergedPlayer)
                    continue;
                bySide[sideConfig.sideId] = sideConfig.playerSlots.map((slotInfo) => {
                    const ownedPokemonIds = new Set();
                    for (const [pokId, ownerId] of sideConfig.pokemonOwnership) {
                        if (ownerId === slotInfo.playerId)
                            ownedPokemonIds.add(pokId);
                    }
                    const ownedTeam = (mergedPlayer.team || []).filter((p) => ownedPokemonIds.has(p.id));
                    const roomPlayer = room.players.find(p => p.id === slotInfo.playerId);
                    return {
                        playerId: slotInfo.playerId,
                        name: roomPlayer?.username || slotInfo.playerId,
                        trainerSprite: roomPlayer?.trainerSprite,
                        team: ownedTeam,
                        previewActiveCount: 1,
                    };
                });
            }
            return bySide;
        }
        for (let i = 0; i < players.length; i++) {
            const player = players[i];
            const sideId = `p${i + 1}`;
            bySide[sideId] = [{
                    playerId: player.id,
                    name: player.name || player.id,
                    trainerSprite: player.trainerSprite || player.avatar,
                    team: player.team || [],
                    previewActiveCount: activeCount,
                }];
        }
        return bySide;
    };
    const teamPreviewParticipants = buildTeamPreviewParticipants();
    // Helper: build team preview state payload for a given player's perspective
    const buildStatePayload = (perspectivePlayerId, perspectiveSide, perspectiveTeam, previewActiveCount, previewTeamSize) => ({
        gameType,
        previewActiveCount,
        teamPreviewParticipants,
        rules: { activeCount: previewActiveCount, teamSize: previewTeamSize },
        players: players.map((p, pIdx) => ({
            id: p.id,
            name: p.name || p.id,
            trainerSprite: p.trainerSprite,
            avatar: p.avatar ?? p.trainerSprite,
            activeIndex: 0,
            team: p.team.map((mon) => ({
                id: mon.id, pokemonId: mon.id,
                name: mon.nickname || mon.name || mon.species,
                species: mon.species || mon.name,
                nickname: mon.nickname, level: mon.level || 50,
                types: mon.types, gender: mon.gender, shiny: mon.shiny, item: mon.item,
                sprite: mon.sprite, backSprite: mon.backSprite,
                spriteChoiceId: mon.spriteChoiceId, spriteChoiceLabel: mon.spriteChoiceLabel,
                cosmeticForm: mon.cosmeticForm, fusion: mon.fusion, hatId: mon.hatId,
            })),
        })),
    });
    // Helper: emit a team preview prompt to a single player
    const emitTeamPreviewToPlayer = (playerId, side, team, maxTeamSize, previewActiveCount) => {
        const rpSock = room.players.filter(p => p.id === playerId).map(p => p.socketId).find(sid => io.sockets.sockets.has(sid));
        if (!rpSock)
            return;
        const sock = io.sockets.sockets.get(rpSock);
        if (!sock)
            return;
        sock.emit("promptAction", {
            roomId: room.id,
            requestType: "teampreview",
            playerId,
            side,
            ourSide: side,
            prompt: {
                teamPreview: true,
                maxTeamSize,
                previewActiveCount,
                teamPreviewParticipants,
                side: {
                    id: side,
                    name: room.players.find(p => p.id === playerId)?.username || playerId,
                    pokemon: team.map((p, idx) => ({
                        id: p.id, pokemonId: p.id,
                        ident: `${side}: ${p.name || p.species}`,
                        details: `${p.species}, L${p.level || 50}`,
                        condition: `${p.currentHP || p.stats?.hp || 100}/${p.stats?.hp || 100}`,
                        active: idx === 0,
                        stats: p.stats, moves: p.moves,
                        baseAbility: p.ability, item: p.item,
                        pokeball: p.pokeball || "pokeball",
                    })),
                },
            },
            state: buildStatePayload(playerId, side, team, previewActiveCount, maxTeamSize),
        });
    };
    // Collect the real player IDs that need to submit team preview
    const realPlayerIds = [];
    const playerTeams = {};
    // Boss mode: split merged side's team preview to individual allies
    if (room.bossMode) {
        const mergedPlayerIdx = players.findIndex(p => p.id === room.bossMode.mergedPlayerId);
        const mergedPlayer = mergedPlayerIdx >= 0 ? players[mergedPlayerIdx] : null;
        const mergedSideId = room.bossMode.mergedSide; // e.g. "p2"
        // Send team preview to non-merged players (the boss) normally
        for (let i = 0; i < players.length; i++) {
            const player = players[i];
            if (player.id === room.bossMode.mergedPlayerId)
                continue; // Handle merged side below
            const side = `p${i + 1}`;
            const maxTeamSize = rules?.maxTeamSize || Math.min(6, player.team.length);
            emitTeamPreviewToPlayer(player.id, side, player.team, maxTeamSize, activeCount);
            realPlayerIds.push(player.id);
            playerTeams[player.id] = player;
        }
        // Split the merged side's team to individual allies
        if (mergedPlayer) {
            for (const slotInfo of room.bossMode.playerSlots) {
                const realPlayerId = slotInfo.playerId;
                // Filter to only this player's Pokemon from the merged team
                const ownedPokemonIds = new Set();
                for (const [pokId, ownerId] of room.bossMode.pokemonOwnership) {
                    if (ownerId === realPlayerId)
                        ownedPokemonIds.add(pokId);
                }
                const ownedTeam = mergedPlayer.team.filter((p) => ownedPokemonIds.has(p.id));
                const maxTeamSize = rules?.maxTeamSize || Math.min(6, ownedTeam.length);
                emitTeamPreviewToPlayer(realPlayerId, mergedSideId, ownedTeam, maxTeamSize, 1);
                realPlayerIds.push(realPlayerId);
                // Store a virtual player for this ally with just their owned Pokemon
                playerTeams[realPlayerId] = { ...mergedPlayer, id: realPlayerId, team: ownedTeam };
            }
        }
        console.log(`[Server] Boss mode team preview: real players = [${realPlayerIds.join(', ')}]`);
    }
    // Team battle mode: split both sides' team previews to individual allies
    else if (room.teamBattleMode) {
        for (let i = 0; i < players.length; i++) {
            const player = players[i];
            const sideConfig = room.teamBattleMode.sides.find(s => s.mergedPlayerId === player.id);
            if (!sideConfig) {
                // Not a merged side (shouldn't happen in team battle, but handle gracefully)
                const side = `p${i + 1}`;
                const maxTeamSize = rules?.maxTeamSize || Math.min(6, player.team.length);
                emitTeamPreviewToPlayer(player.id, side, player.team, maxTeamSize, activeCount);
                realPlayerIds.push(player.id);
                playerTeams[player.id] = player;
                continue;
            }
            // Split to individual players on this side
            for (const slotInfo of sideConfig.playerSlots) {
                const realPlayerId = slotInfo.playerId;
                const ownedPokemonIds = new Set();
                for (const [pokId, ownerId] of sideConfig.pokemonOwnership) {
                    if (ownerId === realPlayerId)
                        ownedPokemonIds.add(pokId);
                }
                const ownedTeam = player.team.filter((p) => ownedPokemonIds.has(p.id));
                const maxTeamSize = rules?.maxTeamSize || Math.min(6, ownedTeam.length);
                emitTeamPreviewToPlayer(realPlayerId, sideConfig.sideId, ownedTeam, maxTeamSize, 1);
                realPlayerIds.push(realPlayerId);
                playerTeams[realPlayerId] = { ...player, id: realPlayerId, team: ownedTeam };
            }
        }
        console.log(`[Server] Team battle mode team preview: real players = [${realPlayerIds.join(', ')}]`);
    }
    // Normal mode: send to each engine player directly
    else {
        for (let i = 0; i < players.length; i++) {
            const player = players[i];
            const side = `p${i + 1}`;
            const maxTeamSize = rules?.maxTeamSize || Math.min(6, player.team.length);
            emitTeamPreviewToPlayer(player.id, side, player.team, maxTeamSize, activeCount);
            realPlayerIds.push(player.id);
            playerTeams[player.id] = player;
        }
    }
    room.teamPreviewRealPlayerIds = realPlayerIds;
    room.teamPreviewPlayerTeams = playerTeams;
}
function applyTeamOrder(player, order) {
    if (!order || !order.length)
        return player;
    const clone = JSON.parse(JSON.stringify(player));
    const newTeam = [];
    for (const slot of order) {
        const idx = slot - 1; // order is 1-based
        if (idx >= 0 && idx < clone.team.length) {
            newTeam.push(clone.team[idx]);
        }
    }
    // Add any remaining Pokemon not in the order
    for (let i = 0; i < clone.team.length; i++) {
        if (!order.includes(i + 1)) {
            newTeam.push(clone.team[i]);
        }
    }
    clone.team = newTeam;
    clone.activeIndex = 0;
    return clone;
}
function checkTeamPreviewComplete(room) {
    console.log(`[checkTeamPreviewComplete] phase=${room.phase}, hasPlayers=${!!room.teamPreviewPlayers}, hasOrders=${!!room.teamPreviewOrders}`);
    if (room.phase !== "team-preview" || !room.teamPreviewPlayers || !room.teamPreviewOrders)
        return;
    // Use real player IDs if available (boss/team modes), otherwise use engine player IDs
    const requiredIds = room.teamPreviewRealPlayerIds || room.teamPreviewPlayers.map(p => p.id);
    console.log(`[checkTeamPreviewComplete] Required players:`, requiredIds);
    console.log(`[checkTeamPreviewComplete] Orders submitted:`, Object.keys(room.teamPreviewOrders));
    const allSubmitted = requiredIds.every(id => room.teamPreviewOrders[id]);
    console.log(`[checkTeamPreviewComplete] allSubmitted=${allSubmitted}`);
    if (!allSubmitted)
        return;
    let orderedPlayers;
    // Boss mode: rebuild the merged team from individual ally reorders
    if (room.bossMode && room.teamPreviewPlayerTeams) {
        orderedPlayers = room.teamPreviewPlayers.map((player, idx) => {
            if (player.id === room.bossMode.mergedPlayerId) {
                // Rebuild merged team: apply each ally's reorder to their sub-team, then re-interleave
                const reorderedSubTeams = [];
                for (const slotInfo of room.bossMode.playerSlots) {
                    const realPlayerId = slotInfo.playerId;
                    const subPlayer = room.teamPreviewPlayerTeams[realPlayerId];
                    if (!subPlayer)
                        continue;
                    const order = room.teamPreviewOrders[realPlayerId];
                    const reordered = applyTeamOrder(subPlayer, order);
                    reorderedSubTeams.push(reordered.team);
                }
                // Re-interleave: [p1[0], p2[0], p1[1], p2[1], ...]
                const mergedTeam = [];
                const maxLen = Math.max(...reorderedSubTeams.map(t => t.length));
                for (let slot = 0; slot < maxLen; slot++) {
                    for (const subTeam of reorderedSubTeams) {
                        if (slot < subTeam.length)
                            mergedTeam.push(subTeam[slot]);
                    }
                }
                const clone = JSON.parse(JSON.stringify(player));
                clone.team = mergedTeam;
                clone.activeIndex = 0;
                return clone;
            }
            else {
                // Non-merged player (boss): apply their order directly
                const order = room.teamPreviewOrders[player.id];
                return applyTeamOrder(player, order);
            }
        });
    }
    // Team battle mode: rebuild both merged sides
    else if (room.teamBattleMode && room.teamPreviewPlayerTeams) {
        orderedPlayers = room.teamPreviewPlayers.map((player, idx) => {
            const sideConfig = room.teamBattleMode.sides.find(s => s.mergedPlayerId === player.id);
            if (sideConfig) {
                const reorderedSubTeams = [];
                for (const slotInfo of sideConfig.playerSlots) {
                    const realPlayerId = slotInfo.playerId;
                    const subPlayer = room.teamPreviewPlayerTeams[realPlayerId];
                    if (!subPlayer)
                        continue;
                    const order = room.teamPreviewOrders[realPlayerId];
                    const reordered = applyTeamOrder(subPlayer, order);
                    reorderedSubTeams.push(reordered.team);
                }
                const mergedTeam = [];
                const maxLen = Math.max(...reorderedSubTeams.map(t => t.length));
                for (let slot = 0; slot < maxLen; slot++) {
                    for (const subTeam of reorderedSubTeams) {
                        if (slot < subTeam.length)
                            mergedTeam.push(subTeam[slot]);
                    }
                }
                const clone = JSON.parse(JSON.stringify(player));
                clone.team = mergedTeam;
                clone.activeIndex = 0;
                return clone;
            }
            else {
                const order = room.teamPreviewOrders[player.id];
                return applyTeamOrder(player, order);
            }
        });
    }
    // Normal mode: apply orders directly
    else {
        orderedPlayers = room.teamPreviewPlayers.map(player => {
            const order = room.teamPreviewOrders[player.id];
            return applyTeamOrder(player, order);
        });
    }
    // Clear team preview state
    room.teamPreviewPlayers = undefined;
    room.teamPreviewOrders = undefined;
    room.teamPreviewRealPlayerIds = undefined;
    room.teamPreviewPlayerTeams = undefined;
    const rules = room.teamPreviewRules;
    room.teamPreviewRules = undefined;
    // Start the actual battle
    beginBattle(room, orderedPlayers, rules?.seed, rules);
}
function beginBattle(room, players, seed, rules) {
    try {
        // Check if team preview is enabled
        if (rules?.teamPreview && room.phase !== "team-preview") {
            startTeamPreview(room, players, rules);
            return;
        }
        const battleSeed = Number.isFinite(seed) ? seed : undefined;
        // Use Pokemon Showdown engine or custom engine based on configuration
        if (USE_PS_ENGINE) {
            console.log(`[Server] Using Pokemon Showdown battle engine with rules:`, JSON.stringify(rules));
            // For "true boss" mode, force singles format so boss only has 1 active Pokemon
            let engineRules = rules;
            if (rules?.trueBoss && rules?.playerFormat?.match(/^\d+v1$/)) {
                engineRules = { ...rules, playerFormat: '1v1', format: 'singles' };
                console.log(`[Server] True Boss mode: overriding format to singles (1v1)`);
            }
            // Determine PS format from rules.format (singles/doubles/triples/ffa) or boss playerFormat
            let psFormat;
            const fmt = engineRules?.format;
            if (fmt === 'doubles')
                psFormat = 'gen9doublescustomgame';
            else if (fmt === 'triples')
                psFormat = 'gen5triplescustomgame';
            else if (fmt === 'ffa')
                psFormat = 'gen9freeforallcustomgame';
            // Boss/team playerFormat will override inside the engine constructor
            room.engine = new sync_ps_engine_1.default({ seed: battleSeed, rules: engineRules, format: psFormat });
        }
        else {
            console.log(`[Server] Using custom battle engine`);
            room.engine = new engine_1.default({ seed: battleSeed });
        }
        room.turnBuffer = {};
        room.replay = [];
        clearForceSwitchTimer(room);
        const hydratedPlayers = players.map((player) => {
            const clone = JSON.parse(JSON.stringify(player));
            const roomPlayer = room.players.find((p) => p.id === player.id);
            const trainerSprite = coerceTrainerSprite(clone.trainerSprite ?? clone.avatar ?? roomPlayer?.trainerSprite);
            // Always set/clear trainerSprite and avatar to ensure invalid values are removed
            clone.trainerSprite = trainerSprite || undefined;
            clone.avatar = trainerSprite || undefined;
            return clone;
        });
        const state = room.engine.initializeBattle(hydratedPlayers, {
            seed: battleSeed,
            startConditions: rules?.startConditions,
            autoTeamPreview: true,
        });
        // Attach gametype to state for client protocol rendering
        if (room.engine instanceof sync_ps_engine_1.default) {
            // Derive gameType from the actual format the engine is using
            const engineFormat = room.engine.format;
            let gameType = 'singles';
            if (engineFormat?.includes('doubles'))
                gameType = 'doubles';
            else if (engineFormat?.includes('triples'))
                gameType = 'triples';
            else if (engineFormat?.includes('freeforall'))
                gameType = 'freeforall';
            state.gameType = gameType;
        }
        // Ensure clients treat this as turn 1 when prompting (no pre-start move UI)
        if (typeof state.turn === "number" && state.turn < 1) {
            state.turn = 1;
        }
        room.battleStarted = true;
        room.phase = "normal";
        room.forceSwitchNeeded = new Set();
        console.log(`[Server] Emitting battleStarted for room ${room.id}`);
        // Attach boss/team participant info so the client can render split trainer blocks
        if (room.bossMode) {
            const participantsByPlayer = {};
            const mergedSide = room.bossMode.mergedSide;
            participantsByPlayer[mergedSide] = room.bossMode.playerSlots.map((slotInfo) => {
                const roomPlayer = room.players.find(p => p.id === slotInfo.playerId);
                const pokemonIds = [];
                for (const [pokId, ownerId] of room.bossMode.pokemonOwnership) {
                    if (ownerId === slotInfo.playerId)
                        pokemonIds.push(pokId);
                }
                return {
                    playerId: slotInfo.playerId,
                    name: roomPlayer?.username || slotInfo.playerId,
                    trainerSprite: roomPlayer?.trainerSprite,
                    pokemonIds,
                };
            });
            state.bossParticipants = participantsByPlayer;
        }
        io.to(room.id).emit("battleStarted", { roomId: room.id, state });
        // Emit initial protocol events before prompting for moves.
        // Always emit a battleUpdate with the initial protocol so the client's PS Battle
        // instance receives |player|, |gametype|, |switch|, |start|, |turn| lines.
        room.startProtocolSent = true;
        const hasStart = Array.isArray(state.log) && state.log.some((l) => l.startsWith("|start"));
        const initialEvents = hasStart
            ? state.log.filter((l) => typeof l === 'string' && l.startsWith('|'))
            : buildInitialBattleProtocol(state);
        // Generate protocol lines for start conditions (weather/terrain/hazards/screens)
        // so the PS client on the frontend renders them properly.
        const startConditions = rules?.startConditions;
        if (startConditions) {
            const scLines = [];
            const weatherMap = { rain: 'RainDance', raindance: 'RainDance', sun: 'SunnyDay', sunnyday: 'SunnyDay', sand: 'Sandstorm', sandstorm: 'Sandstorm', snow: 'Snow', hail: 'Hail' };
            const terrainMap = { electric: 'Electric Terrain', electricterrain: 'Electric Terrain', grassy: 'Grassy Terrain', grassyterrain: 'Grassy Terrain', psychic: 'Psychic Terrain', psychicterrain: 'Psychic Terrain', misty: 'Misty Terrain', mistyterrain: 'Misty Terrain' };
            const wId = (startConditions.field?.weather?.id || '').toLowerCase();
            if (wId && wId !== 'none' && weatherMap[wId])
                scLines.push(`|-weather|${weatherMap[wId]}|[from] StartCondition`);
            const tId = (startConditions.field?.terrain?.id || '').toLowerCase();
            if (tId && tId !== 'none' && terrainMap[tId])
                scLines.push(`|-fieldstart|move: ${terrainMap[tId]}|[from] StartCondition`);
            if ((startConditions.field?.room?.id || '').toLowerCase() === 'trickroom')
                scLines.push(`|-fieldstart|move: Trick Room|[from] StartCondition`);
            if ((startConditions.field?.magicRoom?.id || '').toLowerCase() === 'magicroom')
                scLines.push(`|-fieldstart|move: Magic Room|[from] StartCondition`);
            if ((startConditions.field?.wonderRoom?.id || '').toLowerCase() === 'wonderroom')
                scLines.push(`|-fieldstart|move: Wonder Room|[from] StartCondition`);
            for (let i = 0; i < 2; i++) {
                const cfg = (Array.isArray(startConditions.sides) ? startConditions.sides[i] : undefined) ?? (i === 0 ? startConditions.side1 : startConditions.side2);
                if (!cfg)
                    continue;
                const side = `p${i + 1}`;
                const h = cfg.sideHazards || {};
                if (h.stealthRock)
                    scLines.push(`|-sidestart|${side}|move: Stealth Rock`);
                const spikes = Math.min(3, Math.max(0, h.spikesLayers || 0));
                for (let l = 0; l < spikes; l++)
                    scLines.push(`|-sidestart|${side}|Spikes`);
                const tspikes = Math.min(2, Math.max(0, h.toxicSpikesLayers || 0));
                for (let l = 0; l < tspikes; l++)
                    scLines.push(`|-sidestart|${side}|move: Toxic Spikes`);
                if (h.stickyWeb)
                    scLines.push(`|-sidestart|${side}|move: Sticky Web`);
                const sc = cfg.sideConditions || {};
                if (sc.reflectTurns > 0)
                    scLines.push(`|-sidestart|${side}|Reflect`);
                if (sc.lightScreenTurns > 0)
                    scLines.push(`|-sidestart|${side}|Light Screen`);
                if (sc.tailwindTurns > 0)
                    scLines.push(`|-sidestart|${side}|move: Tailwind`);
            }
            if (scLines.length > 0) {
                initialEvents.push(...scLines);
            }
        }
        if (initialEvents.length > 0) {
            const stateNoLog = { ...state, log: [] };
            io.to(room.id).emit("battleUpdate", {
                result: { state: stateNoLog, events: initialEvents, anim: [] },
                needsSwitch: Array.from(room.forceSwitchNeeded ?? []),
            });
        }
        // Emit move prompts to each player so they can choose their first action
        emitMovePrompts(room, state);
    }
    catch (err) {
        console.error(`[Server] beginBattle failed for room ${room.id}:`, err?.stack || err);
        room.engine = undefined;
        room.battleStarted = false;
        room.startProtocolSent = false;
        room.phase = "normal";
        room.turnBuffer = {};
        room.forceSwitchNeeded = new Set();
        io.to(room.id).emit("battleStartError", {
            roomId: room.id,
            message: err?.message || "Failed to start battle",
        });
    }
}
function buildInitialBattleProtocol(state) {
    if (!state?.players?.length)
        return [];
    const lines = [];
    // Game type
    const gameType = state.gameType || 'singles';
    lines.push(`|gametype|${gameType}`);
    lines.push('|gen|9');
    const tierByGameType = {
        singles: '[Gen 9] Custom Game',
        doubles: '[Gen 9] Doubles Custom Game',
        triples: '[Gen 9] Triples Custom Game',
    };
    lines.push(`|tier|${tierByGameType[gameType] || '[Gen 9] Custom Game'}`);
    // Player info (name + avatar)
    state.players.forEach((player, idx) => {
        const side = `p${idx + 1}`;
        const name = player.name || player.id;
        const avatar = player.trainerSprite || player.avatar || 'acetrainer';
        lines.push(`|player|${side}|${name}|${avatar}|`);
    });
    // Team sizes
    state.players.forEach((player, idx) => {
        const side = `p${idx + 1}`;
        lines.push(`|teamsize|${side}|${player.team?.length || 6}`);
    });
    lines.push("|start");
    state.players.forEach((player, idx) => {
        const side = `p${idx + 1}`;
        const slotLetters = ['a', 'b', 'c', 'd', 'e', 'f'];
        // Handle multi-active (doubles/triples)
        const activeIndices = player.activeIndices || [player.activeIndex || 0];
        for (let slotIdx = 0; slotIdx < activeIndices.length; slotIdx++) {
            const ai = activeIndices[slotIdx];
            if (ai < 0)
                continue;
            const activePoke = player.team?.[ai];
            if (!activePoke)
                continue;
            const nickname = activePoke.nickname || activePoke.name;
            const species = activePoke.species || activePoke.name;
            const level = activePoke.level || 100;
            const gender = activePoke.gender === "M" ? ", M" : (activePoke.gender === "F" ? ", F" : "");
            const shiny = activePoke.shiny ? ", shiny" : "";
            const hp = activePoke.currentHP ?? activePoke.maxHP ?? 100;
            const maxHP = activePoke.maxHP ?? 100;
            const details = `${species}, L${level}${gender}${shiny}`;
            const slot = slotLetters[slotIdx] || 'a';
            lines.push(`|switch|${side}${slot}: ${nickname}|${details}|${hp}/${maxHP}`);
        }
    });
    const turn = state.turn || 1;
    lines.push(`|turn|${turn}`);
    return lines;
}
// Deduplicate consecutive identical switch/drag lines (PS protocol sends private + public copies)
// Also deduplicate repeated switch events for the same slot within the same turn batch
function deduplicateSwitchLines(events) {
    const result = [];
    const seenSwitches = new Set();
    const seenSwitchTargets = new Map(); // slot -> pokemon name
    for (let i = 0; i < events.length; i++) {
        const line = events[i];
        // Skip |split| lines entirely - they're PS internal markers
        if (line.startsWith('|split|')) {
            continue;
        }
        // Check if this is a switch/drag line
        if (line.startsWith('|switch|') || line.startsWith('|drag|') || line.startsWith('|replace|')) {
            // Extract just the identity part (e.g., "p1a: Typhlosion") to compare
            const parts = line.split('|');
            const ident = parts[2] || ''; // e.g., "p1a: Typhlosion"
            // Extract slot (e.g., "p1a") and pokemon name from ident
            const identMatch = ident.match(/^(p[12][a-z]?):\s*(.+)$/);
            if (identMatch) {
                const slot = identMatch[1];
                const pokeName = identMatch[2].trim();
                // Skip if we've already seen a switch to this SAME Pokemon on this SAME slot
                // (This catches duplicate switch events like "Go! Charizard!" appearing twice)
                const prevPoke = seenSwitchTargets.get(slot);
                if (prevPoke && prevPoke.toLowerCase() === pokeName.toLowerCase()) {
                    console.log(`[deduplicateSwitchLines] Skipping duplicate switch: ${slot} -> ${pokeName}`);
                    continue;
                }
                seenSwitchTargets.set(slot, pokeName);
            }
            // Skip if we've already seen this exact switch line in this batch
            if (seenSwitches.has(ident)) {
                continue;
            }
            seenSwitches.add(ident);
        }
        result.push(line);
    }
    return result;
}
// Emit move prompts to all players in a battle
function emitMovePrompts(room, state) {
    if (!room.engine)
        return;
    const turn = state.turn || 1;
    if (!room.lastPromptByPlayer)
        room.lastPromptByPlayer = {};
    // Start turn timer when prompts are sent (if not already in a waiting state)
    if (Object.keys(room.turnBuffer).length === 0) {
        startTurnTimer(room);
        console.log(`[Server] Turn timer started for room ${room.id} turn ${turn} (${TURN_TIMEOUT_MS}ms)`);
    }
    const promptedPlayers = [];
    const skippedPlayers = [];
    for (const player of state.players) {
        // Boss mode: split the merged side's prompt to individual real players
        if (room.bossMode && player.id === room.bossMode.mergedPlayerId) {
            let psRequest = null;
            if (room.engine instanceof sync_ps_engine_1.default) {
                psRequest = room.engine.getRequest(player.id);
            }
            if (!psRequest) {
                skippedPlayers.push({ id: player.id, reason: "no PS request for merged side" });
                continue;
            }
            // Build details→ownerIds map on first encounter (initial PS array matches our merge order)
            if (!room.bossMode.detailsOwnerMap && psRequest.side?.pokemon?.length) {
                room.bossMode.detailsOwnerMap = new Map();
                const ownerByIdx = room.bossMode.pokemonOwnershipByIndex || [];
                for (let i = 0; i < psRequest.side.pokemon.length; i++) {
                    const details = psRequest.side.pokemon[i]?.details;
                    const owner = ownerByIdx[i];
                    if (details && owner) {
                        const arr = room.bossMode.detailsOwnerMap.get(details) || [];
                        arr.push(owner);
                        room.bossMode.detailsOwnerMap.set(details, arr);
                    }
                }
            }
            const activeSlots = psRequest.active || [];
            for (const slotInfo of room.bossMode.playerSlots) {
                const realPlayerId = slotInfo.playerId;
                const slotIdx = slotInfo.slot;
                const alreadyActed = !!room.turnBuffer[realPlayerId];
                const rpSock = room.players.filter(p => p.id === realPlayerId).map(p => p.socketId).find(sid => io.sockets.sockets.has(sid));
                if (!rpSock) {
                    skippedPlayers.push({ id: realPlayerId, reason: "no valid socket (boss ally)" });
                    continue;
                }
                const realSock = io.sockets.sockets.get(rpSock);
                if (!realSock)
                    continue;
                const sideIndex = state.players.indexOf(player);
                const sideId = `p${sideIndex + 1}`;
                const filteredSide = psRequest.side ? {
                    ...psRequest.side,
                    playerId: realPlayerId,
                    pokemon: (psRequest.side.pokemon || []).filter((p) => {
                        // allowAllySwap: show all allied Pokemon; otherwise only owned
                        if (room.bossMode.allowAllySwap)
                            return true;
                        const owners = room.bossMode.detailsOwnerMap?.get(p.details) || [];
                        return owners.includes(realPlayerId);
                    }),
                } : undefined;
                const promptType = alreadyActed ? "wait" : "move";
                const lastPrompt = room.lastPromptByPlayer[realPlayerId];
                if (lastPrompt && lastPrompt.turn === turn && lastPrompt.type === promptType)
                    continue;
                const slotMoves = activeSlots[slotIdx];
                const prompt = alreadyActed
                    ? { wait: true, side: filteredSide, rqid: psRequest.rqid || Date.now() }
                    : {
                        ...psRequest,
                        requestType: "move",
                        playerId: realPlayerId,
                        rqid: psRequest.rqid || Date.now(),
                        side: filteredSide,
                        active: slotMoves ? [slotMoves] : [],
                        bossSlot: slotIdx,
                    };
                realSock.emit("promptAction", { roomId: room.id, playerId: realPlayerId, prompt, state, ourSide: sideId });
                room.lastPromptByPlayer[realPlayerId] = { turn, type: promptType, rqid: prompt.rqid };
                promptedPlayers.push(realPlayerId);
            }
            continue; // Skip normal processing for merged player
        }
        // Team battle mode: split merged side's prompt to individual real players (both sides)
        if (room.teamBattleMode) {
            const sideConfig = room.teamBattleMode.sides.find(s => s.mergedPlayerId === player.id);
            if (sideConfig) {
                let psRequest = null;
                if (room.engine instanceof sync_ps_engine_1.default) {
                    psRequest = room.engine.getRequest(player.id);
                }
                if (!psRequest) {
                    skippedPlayers.push({ id: player.id, reason: "no PS request for team side" });
                    continue;
                }
                // Build details→ownerIds map on first encounter
                if (!sideConfig.detailsOwnerMap && psRequest.side?.pokemon?.length) {
                    sideConfig.detailsOwnerMap = new Map();
                    const ownerByIdx = sideConfig.pokemonOwnershipByIndex || [];
                    for (let i = 0; i < psRequest.side.pokemon.length; i++) {
                        const details = psRequest.side.pokemon[i]?.details;
                        const owner = ownerByIdx[i];
                        if (details && owner) {
                            const arr = sideConfig.detailsOwnerMap.get(details) || [];
                            arr.push(owner);
                            sideConfig.detailsOwnerMap.set(details, arr);
                        }
                    }
                }
                const activeSlots = psRequest.active || [];
                for (const slotInfo of sideConfig.playerSlots) {
                    const realPlayerId = slotInfo.playerId;
                    const slotIdx = slotInfo.slot;
                    const alreadyActed = !!room.turnBuffer[realPlayerId];
                    const rpSock = room.players.filter(p => p.id === realPlayerId).map(p => p.socketId).find(sid => io.sockets.sockets.has(sid));
                    if (!rpSock) {
                        skippedPlayers.push({ id: realPlayerId, reason: "no valid socket (team ally)" });
                        continue;
                    }
                    const realSock = io.sockets.sockets.get(rpSock);
                    if (!realSock)
                        continue;
                    const filteredSide = psRequest.side ? {
                        ...psRequest.side,
                        playerId: realPlayerId,
                        pokemon: (psRequest.side.pokemon || []).filter((p) => {
                            const owners = sideConfig.detailsOwnerMap?.get(p.details) || [];
                            return owners.includes(realPlayerId);
                        }),
                    } : undefined;
                    const promptType = alreadyActed ? "wait" : "move";
                    const lastPrompt = room.lastPromptByPlayer[realPlayerId];
                    if (lastPrompt && lastPrompt.turn === turn && lastPrompt.type === promptType)
                        continue;
                    const slotMoves = activeSlots[slotIdx];
                    const { forceSwitch: _fsSlot, ...psRequestMoveFields } = psRequest;
                    const prompt = alreadyActed
                        ? { wait: true, side: filteredSide, rqid: psRequest.rqid || Date.now() }
                        : { ...psRequestMoveFields, requestType: "move", playerId: realPlayerId, rqid: psRequest.rqid || Date.now(), side: filteredSide, active: slotMoves ? [slotMoves] : [], bossSlot: slotIdx };
                    realSock.emit("promptAction", { roomId: room.id, playerId: realPlayerId, prompt, state, ourSide: sideConfig.sideId });
                    room.lastPromptByPlayer[realPlayerId] = { turn, type: promptType, rqid: prompt.rqid };
                    promptedPlayers.push(realPlayerId);
                }
                continue; // Skip normal processing for merged player
            }
        }
        const candidateSockets = room.players.filter((p) => p.id === player.id).map((p) => p.socketId);
        const playerSocket = candidateSockets.find((id) => io.sockets.sockets.has(id));
        if (!playerSocket) {
            skippedPlayers.push({ id: player.id, reason: "no valid socket" });
            continue;
        }
        const sock = io.sockets.sockets.get(playerSocket);
        if (!sock) {
            skippedPlayers.push({ id: player.id, reason: "socket not found" });
            continue;
        }
        // Get the PS engine's native request FIRST - it's the authoritative source.
        // After a forced switch, PS knows the new active Pokemon even if our state mirror is stale.
        let psRequest = null;
        if (room.engine instanceof sync_ps_engine_1.default) {
            psRequest = room.engine.getRequest(player.id);
        }
        // Only skip if active is fainted AND PS doesn't have a valid request for this player.
        // PS request takes priority because our state mirror's activeIndex can be stale after switches.
        const active = player.team[player.activeIndex];
        if ((!active || active.currentHP <= 0) && !(psRequest && psRequest.side)) {
            skippedPlayers.push({ id: player.id, reason: "active fainted" });
            continue;
        }
        const alreadyActed = !!room.turnBuffer[player.id];
        promptedPlayers.push(player.id);
        const sideIndex = state.players.indexOf(player);
        const sideId = `p${sideIndex + 1}`;
        // If we have a PS request, use it directly - it has correct array ordering and PP
        if (psRequest && psRequest.side) {
            // PS request already has the correct format, just add our extra fields
            const baseSide = {
                ...psRequest.side,
                playerId: player.id,
            };
            const promptType = alreadyActed ? "wait" : "move";
            const lastPrompt = room.lastPromptByPlayer[player.id];
            if (lastPrompt && lastPrompt.turn === turn && lastPrompt.type === promptType) {
                continue;
            }
            const prompt = alreadyActed
                ? { wait: true, side: baseSide, rqid: psRequest.rqid || Date.now() }
                : {
                    ...psRequest,
                    requestType: psRequest.requestType || "move",
                    playerId: player.id,
                    rqid: psRequest.rqid || Date.now(),
                    // Ensure side has our player ID for reference
                    side: baseSide,
                };
            // Safety: strip forceSwitch from move prompts to avoid stale data
            if (prompt.forceSwitch && prompt.requestType === 'move') {
                delete prompt.forceSwitch;
            }
            sock.emit("promptAction", {
                roomId: room.id,
                playerId: player.id,
                prompt,
                state: state,
            });
            room.lastPromptByPlayer[player.id] = {
                turn,
                type: promptType,
                rqid: prompt.rqid,
            };
            continue;
        }
        // Fallback: Build request manually if PS request not available
        // Note: This won't have the correct pokemon ordering after switches
        const psActiveMoves = psRequest?.active?.[0]?.moves || [];
        // Also try to get PP data directly from PS engine as a backup
        let engineMovesPP = null;
        if (room.engine instanceof sync_ps_engine_1.default && psActiveMoves.length === 0) {
            engineMovesPP = room.engine.getActiveMovesPP(player.id);
            console.log(`[Server] Using engineMovesPP fallback for ${player.id}:`, engineMovesPP);
        }
        const sidePayload = {
            id: sideId,
            name: player.name || player.id,
            playerId: player.id,
            pokemon: player.team.map((p, idx) => ({
                id: p.id,
                pokemonId: p.id,
                ident: `${sideId}: ${p.name}`,
                details: `${p.species}, L${p.level}`,
                condition: p.currentHP <= 0 ? '0 fnt' : `${p.currentHP}/${p.stats?.hp || p.maxHP || 100}`,
                active: idx === player.activeIndex,
                stats: p.stats,
                moves: (p.moves || []).map((m) => typeof m === 'string' ? m : m.id || m.name),
                baseAbility: p.ability,
                item: p.item || '',
                pokeball: 'pokeball',
                ability: p.ability,
                fainted: p.currentHP <= 0,
            })),
        };
        const promptType = alreadyActed ? "wait" : "move";
        const lastPrompt = room.lastPromptByPlayer[player.id];
        if (lastPrompt && lastPrompt.turn === turn && lastPrompt.type === promptType) {
            continue;
        }
        const prompt = alreadyActed
            ? { wait: true, side: sidePayload, rqid: Date.now() }
            : {
                requestType: "move",
                side: sidePayload,
                playerId: player.id,
                rqid: Date.now(),
                active: [{
                        moves: (active.moves || []).map((move, idx) => {
                            const moveId = typeof move === "string" ? move : move.id || move.name || `move${idx}`;
                            const normalizedMoveId = moveId.toLowerCase().replace(/[^a-z0-9]/g, "");
                            // Try to find PP from multiple sources:
                            // 1. psActiveMoves from activeRequest
                            // 2. engineMovesPP from direct PS engine query
                            // 3. Fall back to defaults
                            const psMove = psActiveMoves.find((m) => m.id === normalizedMoveId || m.id === moveId);
                            const engineMove = engineMovesPP?.find((m) => m.id === normalizedMoveId || m.id === moveId);
                            const pp = psMove?.pp ?? engineMove?.pp ?? move.pp ?? 10;
                            const maxpp = psMove?.maxpp ?? engineMove?.maxpp ?? move.maxpp ?? pp;
                            return {
                                move: typeof move === "string" ? move : move.name || move.id || `Move ${idx + 1}`,
                                id: normalizedMoveId,
                                pp,
                                maxpp,
                                target: psMove?.target ?? engineMove?.target ?? move.target ?? "normal",
                                disabled: psMove?.disabled ?? engineMove?.disabled ?? move.disabled ?? false,
                            };
                        }),
                    }],
            };
        sock.emit("promptAction", {
            roomId: room.id,
            playerId: player.id,
            prompt,
            state: state,
        });
        room.lastPromptByPlayer[player.id] = {
            turn,
            type: promptType,
            rqid: prompt.rqid,
        };
    }
    console.log(`[Server] emitMovePrompts turn=${turn}: prompted=${JSON.stringify(promptedPlayers)} skipped=${JSON.stringify(skippedPlayers)}`);
}
// Emit force-switch prompts to players who need to switch due to fainted Pokemon
function emitForceSwitchPrompts(room, state, needsSwitch) {
    console.log(`[Server] emitForceSwitchPrompts called for ${needsSwitch.length} players:`, needsSwitch);
    for (const playerId of needsSwitch) {
        const playerSocket = room.players.find(p => p.id === playerId)?.socketId;
        if (!playerSocket) {
            console.log(`[Server] emitForceSwitchPrompts: No socket found for player ${playerId}`);
            continue;
        }
        const sock = io.sockets.sockets.get(playerSocket);
        if (!sock) {
            console.log(`[Server] emitForceSwitchPrompts: Socket not connected for player ${playerId}`);
            continue;
        }
        const player = state.players.find(p => p.id === playerId);
        if (!player) {
            console.log(`[Server] emitForceSwitchPrompts: Player not found in state for ${playerId}`);
            continue;
        }
        // Get the PS engine's native request - it has correctly ordered pokemon array
        let psRequest = null;
        if (room.engine instanceof sync_ps_engine_1.default) {
            psRequest = room.engine.getRequest(playerId);
            console.log(`[Server] emitForceSwitchPrompts: Got PS request for ${playerId}:`, JSON.stringify(psRequest?.forceSwitch));
        }
        const sideIndex = state.players.indexOf(player);
        const sideId = `p${sideIndex + 1}`;
        // If we have a PS request with forceSwitch, use it directly
        if (psRequest && psRequest.forceSwitch && psRequest.side) {
            const switchRequest = {
                ...psRequest,
                playerId: player.id,
                side: {
                    ...psRequest.side,
                    playerId: player.id,
                },
            };
            console.log(`[Server] emitForceSwitchPrompts: Emitting PS forceSwitch prompt to ${playerId}:`, {
                roomId: room.id,
                forceSwitch: switchRequest.forceSwitch,
                sidePokemon: switchRequest.side?.pokemon?.length,
            });
            sock.emit("promptAction", {
                roomId: room.id,
                playerId: player.id,
                prompt: switchRequest,
                state: state,
            });
            continue;
        }
        // Fallback: Build request manually if PS request not available
        const switchRequest = {
            forceSwitch: [true], // Single slot
            side: {
                id: sideId,
                name: player.name,
                playerId: player.id,
                pokemon: player.team.map((p, idx) => ({
                    id: p.id,
                    pokemonId: p.id,
                    ident: `${sideId}: ${p.name}`,
                    details: `${p.species}, L${p.level}`,
                    condition: p.currentHP <= 0 ? '0 fnt' : `${p.currentHP}/${p.stats?.hp || p.maxHP || 100}`,
                    active: idx === player.activeIndex,
                    stats: p.stats,
                    moves: (p.moves || []).map((m) => typeof m === 'string' ? m : m.id || m.name),
                    baseAbility: p.ability,
                    item: p.item || '',
                    pokeball: 'pokeball',
                    ability: p.ability,
                    fainted: p.currentHP <= 0,
                })),
            },
            playerId: player.id,
        };
        sock.emit("promptAction", {
            roomId: room.id,
            playerId: player.id,
            prompt: switchRequest,
            state: state,
        });
    }
}
function broadcastRoomSummary(room) {
    io.emit("roomUpdate", summary(room));
}
function launchChallenge(sourceRoom, challenge) {
    if (!challenge.target) {
        emitChallengeRemoved(sourceRoom, challenge.id, "no-opponent");
        sourceRoom.challenges.delete(challenge.id);
        return;
    }
    if (!challenge.owner.playerPayload || !challenge.target.playerPayload) {
        emitChallengeRemoved(sourceRoom, challenge.id, "missing-team");
        sourceRoom.challenges.delete(challenge.id);
        return;
    }
    // Validate all ally payloads for boss battles
    for (const ally of challenge.allies) {
        if (!ally.playerPayload) {
            emitChallengeRemoved(sourceRoom, challenge.id, "missing-team");
            sourceRoom.challenges.delete(challenge.id);
            return;
        }
    }
    const ownerSocket = io.sockets.sockets.get(challenge.owner.socketId);
    const targetSocket = io.sockets.sockets.get(challenge.target.socketId);
    if (!ownerSocket || !targetSocket) {
        emitChallengeRemoved(sourceRoom, challenge.id, "socket-disconnected");
        sourceRoom.challenges.delete(challenge.id);
        return;
    }
    // Check ally sockets
    const allySockets = [];
    for (const ally of challenge.allies) {
        const allySock = io.sockets.sockets.get(ally.socketId);
        if (!allySock) {
            emitChallengeRemoved(sourceRoom, challenge.id, "socket-disconnected");
            sourceRoom.challenges.delete(challenge.id);
            return;
        }
        allySockets.push(allySock);
    }
    const battleRoomId = (0, uuid_1.v4)().slice(0, 8);
    const nameTokens = [];
    if (challenge.format)
        nameTokens.push(challenge.format);
    const challengerNames = [challenge.owner.username, ...challenge.allies.map(a => a.username)].join(" & ");
    nameTokens.push(`${challengerNames} vs ${challenge.target.username}`);
    const battleRoomName = `Battle: ${nameTokens.join(" • ")}`;
    const battleRoom = createRoomRecord(battleRoomId, battleRoomName);
    rooms.set(battleRoomId, battleRoom);
    ownerSocket.join(battleRoomId);
    targetSocket.join(battleRoomId);
    const ownerTrainerSprite = coerceTrainerSprite(challenge.owner.playerPayload?.trainerSprite ?? challenge.owner.playerPayload?.avatar ?? challenge.owner.trainerSprite);
    const targetTrainerSprite = coerceTrainerSprite(challenge.target.playerPayload?.trainerSprite ?? challenge.target.playerPayload?.avatar ?? challenge.target.trainerSprite);
    battleRoom.players.push({ id: challenge.owner.playerId, username: challenge.owner.username, socketId: challenge.owner.socketId, trainerSprite: ownerTrainerSprite });
    battleRoom.players.push({ id: challenge.target.playerId, username: challenge.target.username, socketId: challenge.target.socketId, trainerSprite: targetTrainerSprite });
    // Join allies to the battle room as players
    for (let i = 0; i < challenge.allies.length; i++) {
        const ally = challenge.allies[i];
        allySockets[i].join(battleRoomId);
        const allyTrainerSprite = coerceTrainerSprite(ally.playerPayload?.trainerSprite ?? ally.playerPayload?.avatar ?? ally.trainerSprite);
        battleRoom.players.push({ id: ally.playerId, username: ally.username, socketId: ally.socketId, trainerSprite: allyTrainerSprite });
    }
    const isBossMode = challenge.allies.length > 0 && (challenge.rules?.playerFormat || '').match(/^\d+v1$/);
    const isTeamBattle = challenge.rules?.playerFormat === '2v2-teams' || challenge.rules?.playerFormat === '3v3-teams';
    const isFFA = challenge.rules?.playerFormat === '4ffa';
    let playersPayload;
    if (isFFA) {
        // Free-for-all: 4 separate players, each with their own side (p1, p2, p3, p4)
        const allPlayers = [challenge.owner, challenge.target, ...challenge.allies].filter(Boolean);
        playersPayload = allPlayers.map(p => sanitizePlayerPayload(p.playerPayload, p));
        console.log(`[Server] FFA battle launched: ${allPlayers.map(p => p.username).join(' vs ')}`);
    }
    else if (isTeamBattle) {
        // Team battle: merge each side's players into multi-choice sides (like boss mode but both sides)
        const teamSize = challenge.rules?.playerFormat === '3v3-teams' ? 3 : 2;
        // Side 1: owner + first (teamSize-1) allies; Side 2: target + remaining allies
        const side1Participants = [challenge.owner, ...challenge.allies.slice(0, teamSize - 1)];
        const side2Participants = [challenge.target, ...challenge.allies.slice(teamSize - 1)];
        const buildMergedSide = (participants, sideName) => {
            const payloads = participants.map(p => sanitizePlayerPayload(p.playerPayload, p));
            const mergedTeam = [];
            const ownership = new Map();
            const ownershipByIndex = [];
            const maxLen = Math.max(...payloads.map(p => p.team.length));
            for (let slot = 0; slot < maxLen; slot++) {
                for (const p of payloads) {
                    if (slot < p.team.length) {
                        mergedTeam.push(p.team[slot]);
                        ownership.set(p.team[slot].id, p.id);
                        ownershipByIndex.push(p.id);
                    }
                }
            }
            const merged = { ...payloads[0], name: participants.map(p => p.username).join(' & '), team: mergedTeam };
            const playerSlots = participants.map((p, idx) => ({ playerId: p.playerId, slot: idx }));
            return { merged, ownership, ownershipByIndex, playerSlots, leadPayload: payloads[0] };
        };
        const side1 = buildMergedSide(side1Participants, 'p1');
        const side2 = buildMergedSide(side2Participants, 'p2');
        // Store team-battle multi-control info on both sides
        battleRoom.teamBattleMode = {
            sides: [
                { sideId: 'p1', mergedPlayerId: side1.leadPayload.id, playerSlots: side1.playerSlots, pokemonOwnership: side1.ownership, pokemonOwnershipByIndex: side1.ownershipByIndex },
                { sideId: 'p2', mergedPlayerId: side2.leadPayload.id, playerSlots: side2.playerSlots, pokemonOwnership: side2.ownership, pokemonOwnershipByIndex: side2.ownershipByIndex },
            ],
        };
        playersPayload = [side1.merged, side2.merged];
        console.log(`[Server] Team battle launched: ${side1Participants.map(p => p.username).join(' & ')} vs ${side2Participants.map(p => p.username).join(' & ')}`);
    }
    else if (isBossMode) {
        // Boss battle: the challenge owner is always the solo p1 side.
        // Everyone else who joins shares the allied p2 side.
        const ownerPayload = sanitizePlayerPayload(challenge.owner.playerPayload, challenge.owner);
        const alliedPayloads = [
            sanitizePlayerPayload(challenge.target.playerPayload, challenge.target),
            ...challenge.allies.map(ally => sanitizePlayerPayload(ally.playerPayload, ally)),
        ];
        const maxTeamLen = Math.max(...alliedPayloads.map(p => p.team.length));
        const mergedTeam = [];
        const pokemonOwnership = new Map();
        const pokemonOwnershipByIndex = [];
        for (let slot = 0; slot < maxTeamLen; slot++) {
            for (const alliedPayload of alliedPayloads) {
                if (slot < alliedPayload.team.length) {
                    mergedTeam.push(alliedPayload.team[slot]);
                    pokemonOwnership.set(alliedPayload.team[slot].id, alliedPayload.id);
                    pokemonOwnershipByIndex.push(alliedPayload.id);
                }
            }
        }
        const alliedSideName = [challenge.target.username, ...challenge.allies.map(a => a.username)].join(" & ");
        const mergedChallengerPayload = {
            ...alliedPayloads[0],
            name: alliedSideName,
            team: mergedTeam,
        };
        const playerSlots = [
            { playerId: challenge.target.playerId, slot: 0 },
            ...challenge.allies.map((ally, idx) => ({ playerId: ally.playerId, slot: idx + 1 })),
        ];
        battleRoom.bossMode = {
            mergedSide: "p2",
            mergedPlayerId: alliedPayloads[0].id,
            playerSlots,
            pokemonOwnership,
            pokemonOwnershipByIndex,
            allowAllySwap: !!challenge.rules?.allowAllySwap,
        };
        playersPayload = [ownerPayload, mergedChallengerPayload];
        console.log(`[Server] Boss battle launched: ${challenge.owner.username} vs ${alliedSideName} (${mergedTeam.length} mons merged)`);
    }
    else {
        // Standard 1v1 battle
        playersPayload = [
            sanitizePlayerPayload(challenge.owner.playerPayload, challenge.owner),
            sanitizePlayerPayload(challenge.target.playerPayload, challenge.target),
        ];
    }
    beginBattle(battleRoom, playersPayload, challenge.rules?.seed, challenge.rules);
    sourceRoom.challenges.delete(challenge.id);
    emitChallengeRemoved(sourceRoom, challenge.id, "launched");
    broadcastRoomSummary(battleRoom);
    broadcastRoomSummary(sourceRoom);
}
// Optionally load external Showdown/Essentials datasets at runtime (not bundled)
async function tryLoadExternalData() {
    try {
        const abilities = (await Promise.resolve(`${path_1.default.resolve("external/showdown/abilities.js")}`).then(s => __importStar(require(s)))).default;
        if (abilities)
            (0, abilities_1.mergeAbilities)(abilities);
    }
    catch { }
    try {
        const items = (await Promise.resolve(`${path_1.default.resolve("external/showdown/items.js")}`).then(s => __importStar(require(s)))).default;
        if (items)
            (0, items_1.mergeItems)(items);
    }
    catch { }
    // If user placed Showdown-like TS/JS under data/, convert the subset we support
    try {
        const localAbilities = (await Promise.resolve(`${path_1.default.resolve("data/abilities.ts")}`).then(s => __importStar(require(s)))).default;
        if (localAbilities)
            (0, abilities_1.mergeAbilities)((0, showdown_converter_1.convertShowdownAbilities)(localAbilities));
    }
    catch { }
    try {
        const sageAbilities = (await Promise.resolve(`${path_1.default.resolve("data/sage-abilities.ts")}`).then(s => __importStar(require(s)))).default;
        if (sageAbilities)
            (0, abilities_1.mergeAbilities)((0, showdown_converter_1.convertShowdownAbilities)(sageAbilities));
    }
    catch { }
    try {
        const localItems = (await Promise.resolve(`${path_1.default.resolve("data/items.ts")}`).then(s => __importStar(require(s)))).default;
        if (localItems)
            (0, items_1.mergeItems)((0, showdown_converter_1.convertShowdownItems)(localItems));
    }
    catch { }
    try {
        const sageItems = (await Promise.resolve(`${path_1.default.resolve("data/sage-items.ts")}`).then(s => __importStar(require(s)))).default;
        if (sageItems)
            (0, items_1.mergeItems)((0, showdown_converter_1.convertShowdownItems)(sageItems));
    }
    catch { }
    try {
        const localSpecies = (await Promise.resolve(`${path_1.default.resolve("data/pokedex.ts")}`).then(s => __importStar(require(s)))).default;
        if (localSpecies)
            (0, showdown_species_moves_1.convertShowdownSpecies)(localSpecies);
    }
    catch { }
    try {
        const localMoves = (await Promise.resolve(`${path_1.default.resolve("data/moves.ts")}`).then(s => __importStar(require(s)))).default;
        if (localMoves) {
            // Expose moves if needed: for now just convert and keep a map here if you want to serve it.
            (0, showdown_species_moves_1.convertShowdownMoves)(localMoves);
        }
    }
    catch { }
}
function loadFusionDexNumsFromShowdownJson() {
    const candidates = [
        path_1.default.resolve("../tauri-app/public/vendor/showdown/data/pokedex.json"),
        path_1.default.resolve("tauri-app/public/vendor/showdown/data/pokedex.json"),
        path_1.default.resolve("public/vendor/showdown/data/pokedex.json"),
    ];
    for (const file of candidates) {
        try {
            if (!fs_1.default.existsSync(file))
                continue;
            const raw = JSON.parse(fs_1.default.readFileSync(file, "utf-8"));
            const nums = Array.from(new Set(Object.values(raw || {})
                .map((entry) => Number(entry?.num))
                .filter((n) => Number.isFinite(n) && n !== 0)
                .map((n) => Math.trunc(n))));
            if (nums.length)
                return nums;
        }
        catch { }
    }
    return [];
}
void (async () => {
    await tryLoadExternalData();
    if (fusionGenService) {
        const nums = loadFusionDexNumsFromShowdownJson();
        fusionGenService.setAllDexNums(nums);
    }
})();
const rooms = new Map();
rooms.set(DEFAULT_LOBBY_ID, createRoomRecord(DEFAULT_LOBBY_ID, DEFAULT_LOBBY_NAME));
const FORCE_SWITCH_TIMEOUT_MS = Number(process.env.FORCE_SWITCH_TIMEOUT_MS || 45000);
function computeNeedsSwitch(state, engine) {
    const out = [];
    for (const pl of state.players) {
        const active = pl.team[pl.activeIndex];
        // If the active Pokemon has HP > 0, no switch is needed.
        // The engine's activeRequest can retain a stale forceSwitch after commitDecisions
        // auto-resolved the faint switch, so trust state over engine request here.
        if (active && active.currentHP > 0) continue;
        // Active is fainted - check engine first, then state fallback
        if (engine && engine.needsForceSwitch(pl.id)) {
            out.push(pl.id);
            continue;
        }
        // Fallback: check our state mirror
        if (active && active.currentHP <= 0 && pl.team.some((m, idx) => idx !== pl.activeIndex && m.currentHP > 0)) {
            out.push(pl.id);
        }
    }
    return out;
}
function startForceSwitchTimer(room) {
    clearForceSwitchTimer(room);
    room.forceSwitchDeadline = Date.now() + FORCE_SWITCH_TIMEOUT_MS;
    room.forceSwitchTimer = setTimeout(() => {
        if (!room.engine || !room.forceSwitchNeeded || room.forceSwitchNeeded.size === 0)
            return;
        // Auto-switch remaining players to first healthy bench
        for (const pid of Array.from(room.forceSwitchNeeded)) {
            let benchIndex = -1;
            // Prefer PS request's side.pokemon for accurate faint/active status
            const psReq = room.engine.getRequest(pid);
            if (psReq?.side?.pokemon) {
                benchIndex = psReq.side.pokemon.findIndex((p) => !p.active && !String(p.condition || '').includes('fnt'));
                console.log(`[ForceSwitch] Auto-switch ${pid}: PS request found benchIndex=${benchIndex}`);
            }
            // Fallback to state mirror
            if (benchIndex < 0) {
                const state = room.engine.getState();
                const pl = state.players.find(p => p.id === pid);
                if (pl) {
                    benchIndex = pl.team.findIndex((m, idx) => idx !== pl.activeIndex && m.currentHP > 0);
                    console.log(`[ForceSwitch] Auto-switch ${pid}: state mirror benchIndex=${benchIndex}, activeIndex=${pl.activeIndex}`);
                }
            }
            if (benchIndex >= 0) {
                const res = room.engine.forceSwitch(pid, benchIndex);
                room.replay.push({ turn: res.state.turn, events: res.events, anim: res.anim, phase: "force-switch", auto: true });
                room.forceSwitchNeeded.delete(pid);
            }
            else {
                console.warn(`[ForceSwitch] Auto-switch ${pid}: no valid bench Pokemon found, skipping`);
                room.forceSwitchNeeded.delete(pid);
            }
        }
        io.to(room.id).emit("battleUpdate", { result: { state: room.engine.getState(), events: [], anim: [] }, needsSwitch: Array.from(room.forceSwitchNeeded ?? []) });
        if (room.forceSwitchNeeded.size === 0) {
            room.phase = "normal";
            io.to(room.id).emit("phase", { phase: room.phase });
            clearForceSwitchTimer(room);
            // Clear prompt dedup so the next emitMovePrompts isn't blocked
            room.lastPromptByPlayer = {};
            // Emit new move prompts so players can choose their next action
            const freshState = room.engine.getState();
            emitMovePrompts(room, freshState);
        }
        else {
            // Extend time for any still-required (optional). For simplicity, clear deadline and keep old until manual switches.
        }
    }, FORCE_SWITCH_TIMEOUT_MS);
}
function clearForceSwitchTimer(room) {
    if (room.forceSwitchTimer) {
        clearTimeout(room.forceSwitchTimer);
        room.forceSwitchTimer = undefined;
    }
    room.forceSwitchDeadline = undefined;
}
// Turn timeout - disabled auto-fill, just log a warning
// Set TURN_TIMEOUT_MS env var to customize (in milliseconds). Default is 60 seconds.
const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS || 60000); // 60 seconds default
function startTurnTimer(room) {
    clearTurnTimer(room);
    room.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
    room.turnTimer = setTimeout(() => {
        if (!room.engine || room.phase === "force-switch" || room.phase === "team-preview")
            return;
        const state = room.engine.getState();
        const expected = room.bossMode ? 1 + room.bossMode.playerSlots.length : state.players.length;
        const submitted = Object.keys(room.turnBuffer);
        if (submitted.length >= expected)
            return; // Already complete
        // Log detailed info about who hasn't submitted - but DO NOT auto-fill
        const allExpectedIds = room.bossMode
            ? [state.players.find(p => p.id !== room.bossMode.mergedPlayerId)?.id, ...room.bossMode.playerSlots.map(s => s.playerId)].filter(Boolean)
            : state.players.map(p => p.id);
        const missing = allExpectedIds.filter(id => !room.turnBuffer[id]);
        console.warn(`[Server] Turn ${state.turn} timeout - still waiting for ${missing.length} players: ${missing.join(', ')}`);
        console.warn(`[Server] Submitted: ${submitted.join(', ') || 'none'} | Missing: ${missing.join(', ')}`);
        // DO NOT auto-fill moves - just continue waiting
        startTurnTimer(room);
    }, TURN_TIMEOUT_MS);
}
function clearTurnTimer(room) {
    if (room.turnTimer) {
        clearTimeout(room.turnTimer);
        room.turnTimer = undefined;
    }
    room.turnDeadline = undefined;
}
// Helper to process turn when buffer is full - extracted from sendAction handler
function processTurnWithBuffer(room) {
    if (!room.engine)
        return;
    try {
        const state = room.engine.getState();
        const actions = Object.values(room.turnBuffer);
        room.turnBuffer = {};
        clearTurnTimer(room);
        // Filter to only battle actions (move/switch/multi-choice)
        const battleActions = actions.filter((a) => a.type === "move" || a.type === "switch" || a.type === "multi-choice");
        console.log('[Server] Processing turn with actions:', JSON.stringify(battleActions.map(a => ({ type: a.type, pokemonId: a.pokemonId, ...(a.type === 'move' ? { moveId: a.moveId, targetPokemonId: a.targetPokemonId } : {}) }))));
        let result = room.engine.processTurn(battleActions);
        // Deduplicate switch lines (PS sends private + public copies after |split| markers)
        if (Array.isArray(result.events)) {
            result = { ...result, events: deduplicateSwitchLines(result.events) };
        }
        // Filter duplicate start/switch batches after start protocol has already been sent
        if (room.startProtocolSent && Array.isArray(result.events) && result.events.some((l) => l.startsWith("|start"))) {
            const hasActionLine = result.events.some((l) => l.startsWith("|move|") ||
                l.startsWith("|cant|") ||
                l.startsWith("|-damage|") ||
                l.startsWith("|damage|") ||
                l.startsWith("|-heal|") ||
                l.startsWith("|heal|") ||
                l.startsWith("|faint|") ||
                l.startsWith("|-"));
            if (!hasActionLine) {
                result = { ...result, events: [], anim: [] };
            }
            else {
                const initPrefixes = [
                    "|start",
                    "|teampreview",
                    "|clearpoke",
                    "|poke|",
                    "|player|",
                    "|teamsize|",
                    "|gen|",
                    "|tier|",
                    "|gametype|",
                    "|t:|",
                    "|split|",
                ];
                const filteredEvents = result.events.filter((line) => {
                    if (line === "|")
                        return false;
                    return !initPrefixes.some((prefix) => line.startsWith(prefix));
                });
                result = { ...result, events: filteredEvents };
            }
        }
        if (!room.startProtocolSent && Array.isArray(result.events) && result.events.some((l) => l.startsWith("|start"))) {
            room.startProtocolSent = true;
        }
        room.replay.push({ turn: result.state.turn, events: result.events, anim: result.anim });
        const needsSwitch = computeNeedsSwitch(result.state, room.engine instanceof sync_ps_engine_1.default ? room.engine : undefined);
        console.log(`[Server] Turn ${result.state.turn} results: events=${result.events.length} needsSwitch=${needsSwitch.length} (${needsSwitch.join(', ')})`);
        if (needsSwitch.length > 0) {
            room.phase = "force-switch";
            room.forceSwitchNeeded = new Set(needsSwitch);
            io.to(room.id).emit("phase", { phase: room.phase, deadline: (room.forceSwitchDeadline = Date.now() + FORCE_SWITCH_TIMEOUT_MS) });
            startForceSwitchTimer(room);
            // Emit force-switch prompts to players who need to switch
            emitForceSwitchPrompts(room, result.state, needsSwitch);
        }
        if (Array.isArray(result?.events)) {
            const hasStart = result.events.some((l) => l === "|start" || l.startsWith("|start|"));
            const hasTurn = result.events.some((l) => l.startsWith("|turn|"));
            const sample = result.events.slice(0, 8);
            console.log(`[DIAG-PROTOCOL] [server] battleUpdate events=${result.events.length} start=${hasStart} turn=${hasTurn} sample=${JSON.stringify(sample)}`);
        }
        else {
            console.log(`[DIAG-PROTOCOL] [server] battleUpdate events=none`);
        }
        io.to(room.id).emit("battleUpdate", { result, needsSwitch, rooms: { trick: result.state.field.room, magic: result.state.field.magicRoom, wonder: result.state.field.wonderRoom } });
        // Simple end detection: if any player's active mon is fainted and no healthy mons remain
        const sideDefeated = result.state.players.find((pl) => pl.team.every(m => m.currentHP <= 0));
        if (sideDefeated) {
            const winner = result.state.players.find(pl => pl.id !== sideDefeated.id)?.id;
            const replayId = saveReplay(room);
            io.to(room.id).emit("battleEnd", { winner, replayId });
            clearForceSwitchTimer(room);
            clearTurnTimer(room);
        }
        else if (needsSwitch.length === 0) {
            // Clear prompt dedup for the new turn and emit move prompts
            room.lastPromptByPlayer = {};
            emitMovePrompts(room, result.state);
        }
    }
    catch (err) {
        console.error(`[Server] processTurnWithBuffer error for room ${room.id}:`, err?.stack || err);
        // Re-prompt players so they aren't stuck
        // Clear lastPromptByPlayer so the dedup check doesn't block the re-prompt
        room.lastPromptByPlayer = {};
        if (room.engine) {
            try {
                const freshState = room.engine.getState();
                emitMovePrompts(room, freshState);
            }
            catch { }
        }
    }
}
io.on("connection", (socket) => {
    let user = { id: socket.id, username: `Guest-${socket.id.slice(0, 4)}` };
    socket.on("identify", (data) => {
        // Accept a persistent user ID from the client so reconnections can reclaim player slots
        if (data?.userId && typeof data.userId === "string" && data.userId.trim()) {
            user.id = data.userId.trim();
        }
        if (data?.username)
            user.username = data.username;
        const nextTrainerSprite = coerceTrainerSprite(data?.trainerSprite ?? data?.avatar);
        if (nextTrainerSprite)
            user.trainerSprite = nextTrainerSprite;
        const touchedRooms = [];
        for (const room of rooms.values()) {
            let touched = false;
            const player = room.players.find((p) => p.socketId === socket.id);
            if (player) {
                player.username = user.username;
                if (user.trainerSprite)
                    player.trainerSprite = user.trainerSprite;
                touched = true;
            }
            const spectator = room.spectators.find((s) => s.socketId === socket.id);
            if (spectator) {
                spectator.username = user.username;
                if (user.trainerSprite)
                    spectator.trainerSprite = user.trainerSprite;
                touched = true;
            }
            if (touched)
                touchedRooms.push(room);
        }
        socket.emit("identified", { id: user.id, username: user.username, trainerSprite: user.trainerSprite, avatar: user.trainerSprite });
        for (const room of touchedRooms) {
            broadcastRoomSummary(room);
        }
    });
    socket.on("createRoom", (data) => {
        const requestedId = data?.id && typeof data.id === "string" ? data.id.trim() : "";
        const id = requestedId && !rooms.has(requestedId) ? requestedId : (0, uuid_1.v4)().slice(0, 8);
        const roomType = data?.roomType === "map" ? "map" : "battle";
        const room = createRoomRecord(id, data?.name || `Room ${id}`, roomType);
        if (roomType === "map") {
            room.mapOwnerId = user.id;
            ensureMapToken(room, user);
        }
        rooms.set(id, room);
        socket.join(id);
        socket.emit("roomCreated", { id, name: room.name, roomType: room.roomType });
        io.emit("roomUpdate", summary(room));
        if (room.roomType === "map") {
            socket.emit("mapState", { roomId: room.id, state: room.mapState });
            io.to(room.id).emit("mapState", { roomId: room.id, state: room.mapState });
        }
    });
    socket.on("joinRoom", (data) => {
        const room = rooms.get(data.roomId);
        if (!room)
            return socket.emit("error", { error: "room not found" });
        socket.join(room.id);
        // Restore from disconnected players if this user was in grace period
        if (room.disconnectedPlayers?.has(user.id)) {
            const entry = room.disconnectedPlayers.get(user.id);
            room.disconnectedPlayers.delete(user.id);
            console.log(`[Server] Restoring disconnected player ${user.id} (${entry.data.username}) to room ${room.id}`);
            room.players.push({
                ...entry.data,
                socketId: socket.id,
                username: user.username || entry.data.username,
                trainerSprite: user.trainerSprite || entry.data.trainerSprite,
            });
            io.emit("roomUpdate", summary(room));
            socket.emit("challengeSync", { roomId: room.id, challenges: challengeSummaries(room) });
            // If battle is in progress, send current state and re-prompt
            if (room.battleStarted && room.engine) {
                const state = room.engine.getState();
                socket.emit("battleStarted", { roomId: room.id, state });
                emitMovePrompts(room, state);
            }
            return;
        }
        if (data.role === "player") {
            // De-duplicate any stale entries for this user/socket
            room.spectators = room.spectators.filter((s) => s.id !== user.id && s.socketId !== socket.id);
            room.players = room.players.filter((p) => p.socketId !== socket.id || p.id === user.id);
            const existingIndex = room.players.findIndex((p) => p.id === user.id);
            if (existingIndex >= 0) {
                room.players[existingIndex] = {
                    ...room.players[existingIndex],
                    id: user.id,
                    username: user.username,
                    socketId: socket.id,
                    trainerSprite: user.trainerSprite,
                };
            }
            else {
                room.players.push({ id: user.id, username: user.username, socketId: socket.id, trainerSprite: user.trainerSprite });
            }
        }
        else {
            // De-duplicate any stale entries for this user/socket
            room.players = room.players.filter((p) => p.id !== user.id && p.socketId !== socket.id);
            room.spectators = room.spectators.filter((s) => s.socketId !== socket.id || s.id === user.id);
            const existingIndex = room.spectators.findIndex((s) => s.id === user.id);
            if (existingIndex >= 0) {
                room.spectators[existingIndex] = {
                    ...room.spectators[existingIndex],
                    id: user.id,
                    username: user.username,
                    socketId: socket.id,
                    trainerSprite: user.trainerSprite,
                };
            }
            else {
                room.spectators.push({ id: user.id, username: user.username, socketId: socket.id, trainerSprite: user.trainerSprite });
            }
            // Send spectator snapshot if battle started
            if (room.battleStarted && room.engine) {
                const state = room.engine.getState();
                socket.emit("spectate_start", { state, replay: room.replay, phase: room.phase ?? "normal", needsSwitch: Array.from(room.forceSwitchNeeded ?? []), deadline: room.forceSwitchDeadline ?? null, rooms: { trick: state.field.room, magic: state.field.magicRoom, wonder: state.field.wonderRoom } });
            }
        }
        if (room.roomType === "map" && room.mapState) {
            if (data.role === "player")
                ensureMapToken(room, user);
            socket.emit("mapState", { roomId: room.id, state: room.mapState });
            io.to(room.id).emit("mapState", { roomId: room.id, state: room.mapState });
        }
        io.emit("roomUpdate", summary(room));
        socket.emit("challengeSync", { roomId: room.id, challenges: challengeSummaries(room) });
    });
    socket.on("mapUpdate", (data) => {
        const room = rooms.get(data?.roomId);
        if (!room || room.roomType !== "map" || !room.mapState)
            return;
        if (room.mapOwnerId && room.mapOwnerId !== user.id)
            return;
        const incoming = data?.state || {};
        room.mapState = {
            ...room.mapState,
            ...incoming,
            tokens: Array.isArray(incoming.tokens) ? incoming.tokens : room.mapState.tokens,
        };
        io.to(room.id).emit("mapState", { roomId: room.id, state: room.mapState });
    });
    socket.on("mapTokenMove", (data) => {
        const room = rooms.get(data?.roomId);
        if (!room || room.roomType !== "map" || !room.mapState)
            return;
        const token = room.mapState.tokens.find(t => t.id === data.tokenId);
        if (!token)
            return;
        if (room.mapState.lockTokens && room.mapOwnerId !== user.id)
            return;
        if (token.ownerId && token.ownerId !== user.id && room.mapOwnerId !== user.id)
            return;
        const width = room.mapState.width || 960;
        const height = room.mapState.height || 640;
        token.x = Math.max(0, Math.min(width, Number(data.x) || 0));
        token.y = Math.max(0, Math.min(height, Number(data.y) || 0));
        io.to(room.id).emit("mapState", { roomId: room.id, state: room.mapState });
    });
    socket.on("startBattle", (data) => {
        const room = rooms.get(data.roomId);
        if (!room)
            return socket.emit("error", { error: "room not found" });
        if (room.battleStarted)
            return;
        const battleSeed = Number.isFinite(data.seed) ? data.seed : undefined;
        if (USE_PS_ENGINE) {
            room.engine = new sync_ps_engine_1.default({ seed: battleSeed, rules: data.rules });
        }
        else {
            room.engine = new engine_1.default({ seed: battleSeed });
        }
        const hydratedPlayers = data.players.map((player) => {
            const clone = JSON.parse(JSON.stringify(player));
            const roomPlayer = room.players.find((p) => p.id === player.id);
            const trainerSprite = coerceTrainerSprite(clone.trainerSprite ?? clone.avatar ?? roomPlayer?.trainerSprite);
            clone.trainerSprite = trainerSprite || undefined;
            clone.avatar = trainerSprite || undefined;
            return clone;
        });
        const state = room.engine.initializeBattle(hydratedPlayers, {
            seed: battleSeed,
            startConditions: data.rules?.startConditions,
            autoTeamPreview: true,
        });
        if (typeof state.turn === "number" && state.turn < 1) {
            state.turn = 1;
        }
        room.battleStarted = true;
        room.phase = "normal";
        room.forceSwitchNeeded = new Set();
        console.log(`[Server] Emitting battleStarted for room ${room.id} (startBattle socket)`);
        io.to(room.id).emit("battleStarted", { roomId: room.id, state });
        // Always emit initial protocol so the client's PS Battle receives all setup lines
        room.startProtocolSent = true;
        const hasStart = Array.isArray(state.log) && state.log.some((l) => l.startsWith("|start"));
        const initialEvents = hasStart
            ? state.log.filter((l) => typeof l === 'string' && l.startsWith('|'))
            : buildInitialBattleProtocol(state);
        if (initialEvents.length > 0) {
            const stateNoLog2 = { ...state, log: [] };
            io.to(room.id).emit("battleUpdate", {
                result: { state: stateNoLog2, events: initialEvents, anim: [] },
                needsSwitch: Array.from(room.forceSwitchNeeded ?? []),
            });
        }
        emitMovePrompts(room, state);
    });
    socket.on("sendAction", (data) => {
        const room = rooms.get(data.roomId);
        if (!room)
            return socket.emit("error", { error: "room not found" });
        // Handle cancel action - clear the player's buffered action
        if (data.action.type === "cancel") {
            if (room.turnBuffer[data.playerId]) {
                delete room.turnBuffer[data.playerId];
                console.log(`[Server] Action cancelled by ${data.playerId}`);
                socket.emit("actionCancelled", { playerId: data.playerId, roomId: data.roomId });
                // Re-send move prompt to this player
                if (room.engine) {
                    const state = room.engine.getState();
                    emitMovePrompts(room, state);
                }
            }
            return;
        }
        // Validate sender is a player in the room and matches playerId
        let sender = room.players.find((p) => p.socketId === socket.id);
        if (!sender || sender.id !== data.playerId) {
            const inRoom = socket.rooms.has(room.id);
            const statePlayer = room.engine?.getState().players.find((p) => p.id === data.playerId);
            // In boss mode, allies are real players not in state.players but in room.players
            const isBossAlly = room.bossMode?.playerSlots.some(s => s.playerId === data.playerId);
            // In team battle mode, check all sides
            const isTeamAlly = room.teamBattleMode?.sides.some(s => s.playerSlots.some(sl => sl.playerId === data.playerId));
            if (inRoom && (statePlayer || isBossAlly || isTeamAlly)) {
                console.warn(`[Server] Recovering missing room player for ${data.playerId} (socket ${socket.id})`);
                room.players = room.players.filter((p) => p.id !== data.playerId && p.socketId !== socket.id);
                const existingName = statePlayer?.name || data.playerId;
                room.players.push({ id: data.playerId, username: existingName, socketId: socket.id, trainerSprite: statePlayer?.trainerSprite });
                sender = room.players.find((p) => p.socketId === socket.id);
            }
            else {
                return socket.emit("error", { error: "not authorized for this action" });
            }
        }
        // Handle team preview phase
        if (room.phase === "team-preview") {
            const totalRequired = room.teamPreviewRealPlayerIds?.length || room.teamPreviewPlayers?.length || 2;
            if (data.action.type === "team" && Array.isArray(data.action.order)) {
                console.log(`[Server] Team preview order received from ${data.playerId}:`, data.action.order);
                if (!room.teamPreviewOrders)
                    room.teamPreviewOrders = {};
                room.teamPreviewOrders[data.playerId] = data.action.order;
                socket.emit("teamPreviewSubmitted", { playerId: data.playerId });
                io.to(room.id).emit("teamPreviewProgress", {
                    playerId: data.playerId,
                    submitted: Object.keys(room.teamPreviewOrders).length,
                    total: totalRequired
                });
                checkTeamPreviewComplete(room);
                return;
            }
            else if (data.action.type === "auto") {
                // Auto-submit with default order
                if (!room.teamPreviewOrders)
                    room.teamPreviewOrders = {};
                // Look up from per-player teams first (boss/team mode), then engine players
                const playerData = room.teamPreviewPlayerTeams?.[data.playerId] || room.teamPreviewPlayers?.find(p => p.id === data.playerId);
                const defaultOrder = playerData?.team.map((_, i) => i + 1) || [1, 2, 3, 4, 5, 6];
                room.teamPreviewOrders[data.playerId] = defaultOrder;
                socket.emit("teamPreviewSubmitted", { playerId: data.playerId });
                io.to(room.id).emit("teamPreviewProgress", {
                    playerId: data.playerId,
                    submitted: Object.keys(room.teamPreviewOrders).length,
                    total: totalRequired
                });
                checkTeamPreviewComplete(room);
                return;
            }
            return socket.emit("error", { error: "in team preview phase - must submit team order" });
        }
        if (!room.engine)
            return socket.emit("error", { error: "battle not started" });
        // If we're in force-switch phase, only accept switch actions from required players
        if (room.phase === "force-switch") {
            if (!room.forceSwitchNeeded?.has(data.playerId)) {
                return socket.emit("error", { error: "no switch required" });
            }
            if (data.action.type !== "switch") {
                return socket.emit("error", { error: "must switch due to faint" });
            }
            // Validate switch target(s) - multi-slot sends choices array, single-slot sends toIndex
            const forceSwitchState = room.engine.getState();
            const forceSwitchPlayer = forceSwitchState.players.find(p => p.id === data.playerId);
            const switchChoices = data.action.choices;
            const isMultiSlot = Array.isArray(switchChoices) && switchChoices.length >= 1;
            if (forceSwitchPlayer) {
                if (isMultiSlot) {
                    // Validate each choice in multi-slot forceSwitch
                    const usedIndices = new Set();
                    for (const c of switchChoices) {
                        if (c.type !== 'switch' || typeof c.toIndex !== 'number') {
                            return socket.emit("error", { error: "invalid multi-slot switch choice" });
                        }
                        const targetMon = forceSwitchPlayer.team[c.toIndex];
                        if (!targetMon || targetMon.currentHP <= 0) {
                            return socket.emit("error", { error: "cannot switch to a fainted Pokemon" });
                        }
                        if (usedIndices.has(c.toIndex)) {
                            return socket.emit("error", { error: "cannot switch two slots to the same Pokemon" });
                        }
                        usedIndices.add(c.toIndex);
                    }
                }
                else {
                    const targetMon = forceSwitchPlayer.team[data.action.toIndex];
                    if (!targetMon || targetMon.currentHP <= 0) {
                        return socket.emit("error", { error: "cannot switch to a fainted Pokemon" });
                    }
                    if (data.action.toIndex === forceSwitchPlayer.activeIndex) {
                        return socket.emit("error", { error: "cannot switch to the same Pokemon" });
                    }
                }
            }
            // Perform immediate forced switch via engine (supports multi-slot choices array)
            let res = room.engine.forceSwitch(data.playerId, data.action.toIndex, Array.isArray(switchChoices) ? switchChoices : undefined);
            // Deduplicate switch lines (PS sends private + public copies)
            if (Array.isArray(res.events)) {
                res = { ...res, events: deduplicateSwitchLines(res.events) };
            }
            room.replay.push({ turn: res.state.turn, events: res.events, anim: res.anim, phase: "force-switch" });
            room.forceSwitchNeeded.delete(data.playerId);
            {
                const s = room.engine.getState();
                io.to(room.id).emit("battleUpdate", { result: res, needsSwitch: Array.from(room.forceSwitchNeeded), deadline: room.forceSwitchDeadline ?? null, rooms: { trick: s.field.room, magic: s.field.magicRoom, wonder: s.field.wonderRoom } });
            }
            if (room.forceSwitchNeeded.size === 0) {
                room.phase = "normal";
                io.to(room.id).emit("phase", { phase: room.phase });
                clearForceSwitchTimer(room);
                // Clear prompt dedup so the next emitMovePrompts isn't blocked
                room.lastPromptByPlayer = {};
                // Emit new move prompts so players can choose their next action
                const freshState = room.engine.getState();
                emitMovePrompts(room, freshState);
            }
            return;
        }
        // Validate switch actions before buffering
        if (data.action.type === "switch") {
            const normalState = room.engine.getState();
            const normalPlayer = normalState.players.find(p => p.id === data.playerId);
            if (normalPlayer) {
                const targetMon = normalPlayer.team[data.action.toIndex];
                if (!targetMon || targetMon.currentHP <= 0) {
                    return socket.emit("error", { error: "cannot switch to a fainted Pokemon" });
                }
                if (data.action.toIndex === normalPlayer.activeIndex) {
                    return socket.emit("error", { error: "cannot switch to the same Pokemon" });
                }
            }
        }
        // Convert moveIndex-based action to moveId-based action
        // Client may send { type: 'move', moveId: '...', moveIndex: 0 }
        let processedAction = data.action;
        if (data.action.type === "move") {
            const moveState = room.engine.getState();
            const movePlayer = moveState.players.find(p => p.id === data.playerId);
            if (movePlayer) {
                const activePokemon = movePlayer.team[movePlayer.activeIndex];
                const opponent = moveState.players.find(p => p.id !== data.playerId);
                const opponentActive = opponent?.team[opponent.activeIndex];
                const providedMoveId = data.action.moveId;
                const moveIndex = data.action.moveIndex;
                const moveFromIndex = typeof moveIndex === "number" ? activePokemon?.moves?.[moveIndex] : undefined;
                const resolvedMoveId = providedMoveId || (moveFromIndex ? (typeof moveFromIndex === 'string' ? moveFromIndex : (moveFromIndex.id || moveFromIndex.name)) : undefined);
                if (resolvedMoveId) {
                    processedAction = {
                        type: "move",
                        actorPlayerId: data.playerId,
                        pokemonId: activePokemon.id,
                        moveId: resolvedMoveId,
                        targetLoc: data.action.targetLoc,
                        targetPlayerId: opponent?.id || "",
                        targetPokemonId: opponentActive?.id || "",
                        mega: !!data.action.mega,
                        zmove: !!data.action.zmove,
                        dynamax: !!data.action.dynamax,
                        terastallize: !!data.action.terastallize,
                    };
                    if (typeof moveIndex === "number") {
                        console.log(`[Server] Converted moveIndex ${moveIndex} to moveId ${resolvedMoveId}`);
                    }
                    else {
                        console.log(`[Server] Using provided moveId ${resolvedMoveId}`);
                    }
                }
            }
        }
        // Handle switch action - client may send switchTo or toIndex
        if (data.action.type === "switch") {
            const switchState = room.engine.getState();
            const switchPlayer = switchState.players.find(p => p.id === data.playerId);
            if (switchPlayer) {
                const activePokemon = switchPlayer.team[switchPlayer.activeIndex];
                // Support both switchTo (legacy) and toIndex
                const targetIndex = data.action.toIndex ?? data.action.switchTo;
                processedAction = {
                    type: "switch",
                    actorPlayerId: data.playerId,
                    pokemonId: activePokemon?.id || "",
                    toIndex: targetIndex,
                };
                console.log(`[Server] Processed switch action to index ${targetIndex}`);
            }
        }
        // Handle multi-choice actions (doubles/triples - one choice per active slot)
        if (data.action.type === "multi-choice") {
            const mcChoices = data.action.choices;
            if (Array.isArray(mcChoices)) {
                processedAction = {
                    type: "multi-choice",
                    actorPlayerId: data.playerId,
                    choices: mcChoices.map((c) => {
                        if (c.type === "move") {
                            return { type: "move", moveId: c.moveId, moveIndex: c.moveIndex, targetLoc: c.targetLoc, mega: !!c.mega, zmove: !!c.zmove, dynamax: !!c.dynamax, terastallize: !!c.terastallize };
                        }
                        if (c.type === "switch") {
                            return { type: "switch", toIndex: c.toIndex ?? c.switchTo };
                        }
                        return { type: "move", moveId: "default" };
                    }),
                };
                console.log(`[Server] Processed multi-choice action with ${mcChoices.length} choices`);
            }
        }
        room.turnBuffer[data.playerId] = processedAction;
        console.log(`[Server] Action received from ${data.playerId}:`, JSON.stringify(processedAction));
        const currentState = room.engine.getState();
        // In boss mode, count real players (boss + each challenger) instead of engine players (always 2)
        // In team battle mode, count all real players across both sides
        let expected;
        if (room.bossMode) {
            // Boss (1) + all challengers on the merged side
            expected = 1 + room.bossMode.playerSlots.length;
        }
        else if (room.teamBattleMode) {
            // Sum all real players across both merged sides
            expected = room.teamBattleMode.sides.reduce((sum, s) => sum + s.playerSlots.length, 0);
        }
        else {
            expected = currentState.players.length;
        }
        // Log disconnected players but DO NOT auto-fill their actions
        const livePlayerIds = new Set(room.players.filter((p) => io.sockets.sockets.has(p.socketId)).map((p) => p.id));
        const missingPlayers = currentState.players.filter((p) => !livePlayerIds.has(p.id));
        if (missingPlayers.length > 0) {
            console.warn(`[Server] Disconnected players: ${missingPlayers.map(p => p.id).join(', ')} - waiting for reconnection or timeout`);
        }
        console.log(`[Server] Turn buffer size: ${Object.keys(room.turnBuffer).length}/${expected}`);
        if (Object.keys(room.turnBuffer).length >= expected) {
            // In boss mode, combine individual challenger actions into a multi-choice for the engine
            if (room.bossMode) {
                const mergedChoices = [];
                for (const slotInfo of room.bossMode.playerSlots) {
                    const action = room.turnBuffer[slotInfo.playerId];
                    if (action) {
                        if (action.type === "move") {
                            mergedChoices.push({ type: "move", moveId: action.moveId, moveIndex: action.moveIndex, targetLoc: action.targetLoc, mega: !!action.mega, zmove: !!action.zmove, dynamax: !!action.dynamax, terastallize: !!action.terastallize });
                        }
                        else if (action.type === "switch") {
                            mergedChoices.push({ type: "switch", toIndex: action.toIndex });
                        }
                        else {
                            mergedChoices.push(action);
                        }
                        delete room.turnBuffer[slotInfo.playerId];
                    }
                }
                // Replace individual ally actions with a single multi-choice for the merged player
                room.turnBuffer[room.bossMode.mergedPlayerId] = {
                    type: "multi-choice",
                    actorPlayerId: room.bossMode.mergedPlayerId,
                    choices: mergedChoices,
                };
                console.log(`[Server] Combined ${mergedChoices.length} boss-mode actions into multi-choice for ${room.bossMode.mergedPlayerId}`);
            }
            // In team battle mode, combine actions for each merged side
            if (room.teamBattleMode) {
                for (const sideConfig of room.teamBattleMode.sides) {
                    const mergedChoices = [];
                    for (const slotInfo of sideConfig.playerSlots) {
                        const action = room.turnBuffer[slotInfo.playerId];
                        if (action) {
                            if (action.type === "move") {
                                mergedChoices.push({ type: "move", moveId: action.moveId, moveIndex: action.moveIndex, targetLoc: action.targetLoc, mega: !!action.mega, zmove: !!action.zmove, dynamax: !!action.dynamax, terastallize: !!action.terastallize });
                            }
                            else if (action.type === "switch") {
                                mergedChoices.push({ type: "switch", toIndex: action.toIndex });
                            }
                            else {
                                mergedChoices.push(action);
                            }
                            delete room.turnBuffer[slotInfo.playerId];
                        }
                    }
                    room.turnBuffer[sideConfig.mergedPlayerId] = {
                        type: "multi-choice",
                        actorPlayerId: sideConfig.mergedPlayerId,
                        choices: mergedChoices,
                    };
                    console.log(`[Server] Combined ${mergedChoices.length} team-battle actions for side ${sideConfig.sideId}`);
                }
            }
            processTurnWithBuffer(room);
        }
        else {
            // Send "waiting" notification ONLY to the player who just submitted
            socket.emit("promptAction", {
                roomId: data.roomId,
                playerId: data.playerId,
                waitingFor: expected - Object.keys(room.turnBuffer).length,
                prompt: { wait: true }
            });
        }
    });
    socket.on("sendChat", (data) => {
        const room = rooms.get(data.roomId);
        if (!room)
            return;
        io.to(room.id).emit("chatMessage", { user: user.username, text: data.text, time: Date.now() });
    });
    socket.on("createChallenge", (data) => {
        const room = data?.roomId ? rooms.get(data.roomId) : undefined;
        if (!room)
            return socket.emit("error", { error: "room not found" });
        const isPlayer = Boolean(findPlayerBySocket(room, socket.id));
        if (!isPlayer)
            return socket.emit("error", { error: "must join as player" });
        const rawId = typeof data?.challengeId === "string" ? data.challengeId.trim() : "";
        const challengeId = rawId && !room.challenges.has(rawId) ? rawId : (0, uuid_1.v4)().slice(0, 8);
        const targetPlayer = data?.toPlayerId ? room.players.find((p) => p.id === data.toPlayerId) : undefined;
        const ownerPayload = data?.player ? JSON.parse(JSON.stringify(data.player)) : undefined;
        const ownerTrainerSprite = coerceTrainerSprite(ownerPayload?.trainerSprite ?? ownerPayload?.avatar ?? user.trainerSprite);
        if (ownerPayload && ownerTrainerSprite) {
            ownerPayload.trainerSprite = ownerTrainerSprite;
            ownerPayload.avatar = ownerTrainerSprite;
        }
        const challenge = {
            id: challengeId,
            roomId: room.id,
            createdAt: Date.now(),
            rules: data?.rules,
            format: data?.format,
            status: "pending",
            owner: {
                playerId: user.id,
                username: user.username,
                socketId: socket.id,
                accepted: true,
                trainerSprite: ownerTrainerSprite,
                playerPayload: ownerPayload,
            },
            target: targetPlayer
                ? {
                    playerId: targetPlayer.id,
                    username: targetPlayer.username,
                    socketId: targetPlayer.socketId,
                    accepted: false,
                }
                : undefined,
            allies: [],
            open: !targetPlayer,
        };
        room.challenges.set(challenge.id, challenge);
        emitChallengeCreated(room, challenge);
        broadcastRoomSummary(room);
    });
    socket.on("cancelChallenge", (data) => {
        const room = data?.roomId ? rooms.get(data.roomId) : undefined;
        if (!room)
            return;
        const challenge = data?.challengeId ? room.challenges.get(data.challengeId) : undefined;
        if (!challenge)
            return;
        if (challenge.owner.socketId !== socket.id)
            return socket.emit("error", { error: "not authorized" });
        room.challenges.delete(challenge.id);
        emitChallengeRemoved(room, challenge.id, "cancelled");
        broadcastRoomSummary(room);
    });
    socket.on("respondChallenge", (data) => {
        const room = data?.roomId ? rooms.get(data.roomId) : undefined;
        if (!room)
            return socket.emit("error", { error: "room not found" });
        const challenge = data?.challengeId ? room.challenges.get(data.challengeId) : undefined;
        if (!challenge)
            return socket.emit("error", { error: "challenge not found" });
        let participant;
        if (challenge.owner.socketId === socket.id)
            participant = challenge.owner;
        if (!participant && challenge.target && challenge.target.socketId === socket.id)
            participant = challenge.target;
        if (!participant) {
            // Check if already an ally
            participant = challenge.allies.find(a => a.socketId === socket.id);
        }
        if (!participant && data?.accepted) {
            // New player joining - determine which slot to fill
            const requiredAllies = getRequiredAllyCount(challenge.rules?.playerFormat);
            if (!challenge.target) {
                // Fill the target (boss/opponent) slot first
                challenge.target = {
                    playerId: user.id,
                    username: user.username,
                    socketId: socket.id,
                    accepted: false,
                };
                participant = challenge.target;
            }
            else if (challenge.allies.length < requiredAllies) {
                // Fill an ally slot on the owner's side
                const newAlly = {
                    playerId: user.id,
                    username: user.username,
                    socketId: socket.id,
                    accepted: false,
                };
                challenge.allies.push(newAlly);
                participant = newAlly;
            }
        }
        if (!participant)
            return socket.emit("error", { error: "not part of challenge" });
        if (!data?.accepted) {
            // If an ally declines, remove just that ally; if owner/target declines, cancel the whole challenge
            const allyIdx = challenge.allies.indexOf(participant);
            if (allyIdx >= 0) {
                challenge.allies.splice(allyIdx, 1);
                emitChallengeUpdated(room, challenge);
                broadcastRoomSummary(room);
            }
            else {
                room.challenges.delete(challenge.id);
                emitChallengeRemoved(room, challenge.id, "declined");
                broadcastRoomSummary(room);
            }
            return;
        }
        if (!data?.player)
            return socket.emit("error", { error: "team payload required" });
        const participantPayload = JSON.parse(JSON.stringify(data.player));
        const participantTrainerSprite = coerceTrainerSprite(participantPayload?.trainerSprite ?? participantPayload?.avatar ?? user.trainerSprite);
        if (participantTrainerSprite) {
            participantPayload.trainerSprite = participantTrainerSprite;
            participantPayload.avatar = participantTrainerSprite;
        }
        participant.accepted = true;
        participant.username = user.username;
        participant.trainerSprite = participantTrainerSprite;
        participant.playerPayload = participantPayload;
        if (isChallengeReady(challenge)) {
            challenge.status = "launching";
            emitChallengeUpdated(room, challenge);
            launchChallenge(room, challenge);
        }
        else {
            emitChallengeUpdated(room, challenge);
        }
    });
    // Explicit state recovery — client requests full current state after reconnecting
    socket.on("requestBattleState", (data) => {
        const room = data?.roomId ? rooms.get(data.roomId) : undefined;
        if (!room || !room.engine || !room.battleStarted)
            return;
        const state = room.engine.getState();
        socket.emit("battleStarted", { roomId: room.id, state });
        emitMovePrompts(room, state);
    });
    socket.on("disconnect", () => {
        for (const room of rooms.values()) {
            // Find if this socket is a player in an active battle
            const player = room.players.find((p) => p.socketId === socket.id);
            if (player && room.battleStarted) {
                // Battle in progress: move to grace period instead of removing
                if (!room.disconnectedPlayers)
                    room.disconnectedPlayers = new Map();
                room.disconnectedPlayers.set(player.id, { data: { ...player }, timestamp: Date.now() });
                room.players = room.players.filter((p) => p.socketId !== socket.id);
                console.log(`[Server] Player ${player.id} (${player.username}) disconnected from battle room ${room.id} — grace period ${RECONNECT_GRACE_MS}ms`);
                // After grace period, remove permanently if not reconnected
                setTimeout(() => {
                    const entry = room.disconnectedPlayers?.get(player.id);
                    if (entry) {
                        room.disconnectedPlayers.delete(player.id);
                        console.log(`[Server] Grace period expired for ${player.id} in room ${room.id}`);
                        broadcastRoomSummary(room);
                        const isEmpty = room.players.length === 0 && room.spectators.length === 0 && (!room.disconnectedPlayers || room.disconnectedPlayers.size === 0);
                        if (isEmpty && room.id !== DEFAULT_LOBBY_ID) {
                            rooms.delete(room.id);
                            io.emit("roomRemoved", { id: room.id });
                        }
                    }
                }, RECONNECT_GRACE_MS);
                broadcastRoomSummary(room);
                continue;
            }
            // Not in active battle: remove immediately (original behavior)
            const removed = removeClientFromRoom(room, socket.id);
            if (removed) {
                // Clean up challenges involving this socket
                for (const challenge of Array.from(room.challenges.values())) {
                    if (challenge.owner.socketId === socket.id) {
                        room.challenges.delete(challenge.id);
                        emitChallengeRemoved(room, challenge.id, "creator-left");
                    }
                    else if (challenge.target && challenge.target.socketId === socket.id) {
                        challenge.target = undefined;
                        challenge.status = "pending";
                        emitChallengeUpdated(room, challenge);
                    }
                    else {
                        // Check if disconnecting player was an ally
                        const allyIdx = challenge.allies.findIndex(a => a.socketId === socket.id);
                        if (allyIdx >= 0) {
                            challenge.allies.splice(allyIdx, 1);
                            emitChallengeUpdated(room, challenge);
                        }
                    }
                }
                broadcastRoomSummary(room);
            }
            const isEmpty = room.players.length === 0 && room.spectators.length === 0 && (!room.disconnectedPlayers || room.disconnectedPlayers.size === 0);
            if (isEmpty && room.id !== DEFAULT_LOBBY_ID) {
                rooms.delete(room.id);
                io.emit("roomRemoved", { id: room.id });
            }
        }
    });
});
function summary(room) {
    return {
        id: room.id,
        name: room.name,
        roomType: room.roomType ?? "battle",
        mapOwnerId: room.mapOwnerId,
        players: room.players.map((p) => ({ id: p.id, username: p.username, trainerSprite: p.trainerSprite, avatar: p.trainerSprite })),
        spectCount: room.spectators.length,
        battleStarted: room.battleStarted,
        challengeCount: room.challenges.size,
    };
}
function saveReplay(room) {
    const id = (0, uuid_1.v4)().slice(0, 8);
    const file = path_1.default.join(REPLAYS_DIR, `${id}.json`);
    const payload = {
        id,
        room: { id: room.id, name: room.name },
        createdAt: Date.now(),
        replay: room.replay,
    };
    fs_1.default.writeFileSync(file, JSON.stringify(payload, null, 2));
    return id;
}
function startServer(port = Number(process.env.PORT) || 3000) {
    server.listen(port, () => {
        console.log(`Server running on :${port}`);
        (0, ifdex_daily_sync_1.startIfdexDailySyncJob)({ backendPort: port });
    });
}
if (require.main === module) {
    startServer();
}
//# sourceMappingURL=index.js.map