# PokeTTRPG - Tauri App

## IMPORTANT: TAURI-ONLY WORKFLOW

- Do not use or modify app(do not touch) for builds, fixes, or releases.
- All active app work must happen in tauri-app.
- Use release.ps1 for release automation (it targets tauri-app).
- Read the release/build policy: ../docs/TAURI_ONLY_RELEASE_POLICY.md

A Pokemon Tabletop RPG companion app built with Tauri 2.x, React, and TypeScript.

## 🚀 Features

- **Pokemon Battle System** - Full battle simulation powered by @pkmn/sim
- **Multiplayer** - LAN and online networking via Socket.io
- **Team Builder** - Create and manage Pokemon teams
- **Ruleset Editor** - Customize game rules (bans, level caps, etc.)
- **Cross-Platform** - Windows, macOS, Linux, iOS, and Android support

## 📦 Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop Runtime | Tauri 2.9.x |
| Frontend | React 18 + TypeScript |
| Build Tool | Vite 7.x |
| Battle Engine | @pkmn/sim |
| Networking | Socket.io |
| Styling | CSS Modules |

## 🛠️ Development

### Prerequisites

- Node.js 18+
- Rust 1.93+
- Windows: Visual Studio Build Tools
- macOS: Xcode Command Line Tools
- Linux: webkit2gtk-4.0, libgtk-3-dev

### Setup

```bash
# Install dependencies
npm install

# Start development server
npm run tauri:dev

# Build for production
npm run tauri:build
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Build frontend only |
| `npm run tauri:dev` | Start Tauri in dev mode |
| `npm run tauri:build` | Build release executable |
| `npm run worker:start` | Start Windows fusion worker backend with fusion-gen env preconfigured |

### Fusion Worker (Windows)

Use this when your Pi backend proxies `/fusion/generate` to your Windows worker:

```powershell
cd tauri-app
npm run worker:start
```

Optional flags:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-fusion-worker.ps1 -Port 3000 -Workers 10
```

Legacy entry points kept for compatibility:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/Start-Worker.ps1 -Port 3000 -Workers 10
```

## 📱 Mobile Builds

See [MOBILE_BUILD_GUIDE.md](docs/MOBILE_BUILD_GUIDE.md) for iOS and Android build instructions.

## 🏗️ Project Structure

```
tauri-app/
├── src/                 # React frontend source
│   ├── main.tsx        # App entry point
│   ├── ui/             # React components
│   ├── net/            # Networking (Socket.io)
│   ├── ps/             # Pokemon Showdown integration
│   ├── rules/          # Ruleset definitions
│   ├── data/           # Pokemon data
│   └── styles/         # CSS styles
├── public/             # Static assets
│   ├── vendor/         # Showdown client files
│   └── fx/             # Battle effects
├── src-tauri/          # Rust backend
│   ├── src/            # Rust source files
│   ├── Cargo.toml      # Rust dependencies
│   └── tauri.conf.json # Tauri configuration
└── dist/               # Built frontend (generated)
```

## 🔧 Configuration

### `tauri.conf.json`

Key settings:
- `identifier`: `com.pokettrpg.desktop`
- `window`: 1400x900, resizable
- `CSP`: Configured for WebSocket connections

### Environment Variables

None required for basic operation. For LAN play, ensure firewall allows connections.

## 📄 License

MIT - See LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## ⚡ Why Tauri?

| Feature | Electron | Tauri |
|---------|----------|-------|
| Bundle Size | ~100 MB | ~3 MB |
| Memory Usage | ~100 MB | ~30 MB |
| Startup Time | ~2s | ~0.5s |
| Mobile Support | ❌ | ✅ |

Tauri provides a significantly smaller, faster, and more efficient app while maintaining the same React-based development experience.
