# Installing PokéTTRPG on macOS (Unsigned App)

PokéTTRPG is not code-signed with an Apple Developer certificate.
macOS Gatekeeper will block it the first time you try to open it.
Here's how to get around that.

---

## Method 1: Right-Click → Open (Easiest)

1. Download the `.dmg` file from the [Releases page](../../releases)
2. Double-click the `.dmg` to mount it
3. Drag **pokettrpg** into your **Applications** folder
4. **Don't** double-click to open — instead:
   - **Right-click** (or **Control + click**) on the app
   - Click **Open** from the context menu
   - A dialog will appear saying the app is from an unidentified developer
   - Click **Open** again to confirm
5. After the first launch, macOS remembers your choice and you can open it normally

> **Note:** Regular double-click won't work the first time — you *must* right-click → Open.

---

## Method 2: Terminal Command (If Method 1 Doesn't Work)

Open **Terminal** (search for it in Spotlight) and run:

```bash
xattr -cr /Applications/pokettrpg.app
```

Then double-click the app to open it normally.

### What this command does
- `xattr -cr` removes the quarantine flag that macOS adds to downloaded files
- `-c` clears all extended attributes, `-r` does it recursively
- This is safe — it just tells macOS "I trust this app"

---

## Method 3: System Settings (macOS Ventura+)

1. Try to open the app (it will be blocked)
2. Go to **System Settings** → **Privacy & Security**
3. Scroll down — you'll see a message like:
   > "pokettrpg" was blocked from use because it is not from an identified developer
4. Click **Open Anyway**
5. Enter your password
6. The app will now open

---

## Apple Silicon (M1/M2/M3/M4) vs Intel

The release includes a **universal binary** that works on both:
- **Apple Silicon** (M1, M2, M3, M4 chips) — runs natively
- **Intel Macs** — runs natively

No Rosetta translation needed.

---

## Troubleshooting

### "The application is damaged and can't be opened"
Run this in Terminal:
```bash
xattr -cr /Applications/pokettrpg.app
```

### App crashes immediately
Make sure you're running macOS 11 (Big Sur) or later.

### "The app is damaged" after an update
You need to clear the quarantine flag again after each new download:
```bash
xattr -cr /Applications/pokettrpg.app
```

### Still can't open it?
Try moving the app out of Applications, then back in:
```bash
xattr -cr ~/Downloads/pokettrpg.app
mv ~/Downloads/pokettrpg.app /Applications/
```

---

## Why isn't it signed?

Apple charges $99/year for a Developer account to sign apps. Since PokéTTRPG is a free, open-source fan project, we don't have a signing certificate. The app is completely safe — you can [view the source code](../../) and [build it yourself](../tauri-app/README.md) if you prefer.
