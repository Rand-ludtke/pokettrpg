# PokeTTRPG Mobile Build Guide

## Overview

This guide covers how to build PokeTTRPG for iOS and Android using Tauri Mobile.

## Prerequisites

### For All Mobile Builds:
- Rust 1.93+ with cross-compilation targets
- Node.js 18+
- Tauri CLI installed

### For Android:
- Android Studio with SDK (API 24+)
- NDK installed
- Java JDK 17+
- Environment variables set (`ANDROID_HOME`, `NDK_HOME`, etc.)

### For iOS:
- **Requires macOS** (Apple policy - iOS apps can only be built on Mac)
- Xcode 15+ with Command Line Tools
- Apple Developer Account ($99/year for distribution)
- CocoaPods

---

## Android Build

### 1. Install Android Prerequisites

```bash
# Install Rust Android targets
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

# Set environment variables (add to your profile)
$env:ANDROID_HOME = "$HOME\Android\Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\26.1.10909125"
$env:JAVA_HOME = "C:\Program Files\Java\jdk-17"
```

### 2. Initialize Android Support

```bash
cd tauri-app
npx tauri android init
```

### 3. Build APK

```bash
# Development build
npx tauri android dev

# Release build
npx tauri android build --apk
```

The APK will be in `src-tauri/gen/android/app/build/outputs/apk/`.

---

## iOS Build Options

Since iOS builds **require macOS**, here are your options:

### Option 1: Ask a Friend with a Mac (Recommended)

**What to provide your friend:**
1. This entire `tauri-app` folder (ZIP it up)
2. Your Apple Developer Account credentials (or have them use theirs temporarily)
3. The build instructions below

**Steps for the Mac user:**

```bash
# 1. Unzip the project and navigate to it
cd tauri-app

# 2. Install prerequisites
brew install cocoapods
rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim

# 3. Initialize iOS support
npx tauri ios init

# 4. Open in Xcode to configure signing
npx tauri ios dev -- --open

# 5. In Xcode:
#    - Select your development team
#    - Set bundle identifier to "com.pokettrpg.mobile"
#    - Configure signing certificates

# 6. Build IPA for distribution
npx tauri ios build
```

### Option 2: GitHub Actions CI/CD (Free, Automated)

Set up a GitHub workflow that builds iOS on Apple's M1 runners:

**Create `.github/workflows/ios-build.yml`:**

```yaml
name: iOS Build

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  build-ios:
    runs-on: macos-14  # M1 Mac runner
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          
      - name: Setup Rust
        uses: dtolnay/rust-action@stable
        with:
          targets: aarch64-apple-ios,x86_64-apple-ios,aarch64-apple-ios-sim
          
      - name: Install dependencies
        run: |
          cd tauri-app
          npm ci
          npm install -g @tauri-apps/cli
          
      - name: Init iOS
        run: |
          cd tauri-app
          npx tauri ios init
          
      - name: Build iOS
        run: |
          cd tauri-app
          npx tauri ios build
          
      - name: Upload IPA
        uses: actions/upload-artifact@v4
        with:
          name: ios-build
          path: tauri-app/src-tauri/gen/apple/build/**/*.ipa
```

### Option 3: Cloud Mac Services

**MacStadium / MacinCloud / AWS EC2 Mac:**
- Rent a cloud Mac by the hour (~$0.50-1/hour)
- SSH in and run the build commands
- Download the IPA

**Codemagic CI:**
- Free tier includes iOS builds
- Set up with GitHub integration
- Automatic builds on push

### Option 4: Hackintosh VM (Not Recommended)
- Legally gray area
- Difficult to set up
- May violate Apple TOS

---

## iOS Distribution Without Mac

Once you have an IPA file, you can distribute it:

### TestFlight (Requires Apple Developer Account)
1. Upload IPA via Transporter app (Windows version available)
2. Or use `altool` on any platform with proper credentials
3. Invite testers via TestFlight

### Ad-Hoc Distribution
- Requires registered device UDIDs
- Limited to 100 devices
- 1-year certificate validity

### Enterprise Distribution
- Requires Enterprise Developer Account ($299/year)
- Unlimited devices within organization

---

## Mobile-Specific Configuration

### `tauri.conf.json` additions for mobile:

```json
{
  "bundle": {
    "iOS": {
      "developmentTeam": "YOUR_TEAM_ID",
      "minimumSystemVersion": "13.0"
    },
    "android": {
      "minSdkVersion": 24
    }
  }
}
```

### Touch-Friendly UI Adjustments

Consider these CSS changes for mobile:

```css
/* In your styles, add media queries */
@media (max-width: 768px) {
  .battle-controls button {
    min-height: 48px;  /* Touch-friendly size */
    font-size: 16px;
  }
  
  .pokemon-sprite {
    max-width: 80px;  /* Smaller for mobile screens */
  }
}
```

---

## Troubleshooting

### "Signing certificate not found" (iOS)
- Open Xcode and go to Preferences > Accounts
- Add your Apple ID and download certificates

### "NDK not found" (Android)
- Install NDK via Android Studio SDK Manager
- Verify `NDK_HOME` points to correct version

### "WebView not loading" (Mobile)
- Check CSP settings in tauri.conf.json
- Ensure `connect-src` includes your server URLs

---

## Estimated Build Times

| Platform | Build Type | Time |
|----------|-----------|------|
| Windows | Release | ~5 min |
| Android APK | Release | ~10 min |
| iOS IPA | Release | ~15 min |

---

## Quick Reference

```bash
# Windows/Desktop
npx tauri build                    # Build release
npx tauri dev                      # Development mode

# Android
npx tauri android init             # Initialize Android
npx tauri android dev              # Dev on connected device
npx tauri android build            # Build release APK

# iOS (Mac only)
npx tauri ios init                 # Initialize iOS
npx tauri ios dev                  # Dev on simulator
npx tauri ios build                # Build release IPA
```
