# TestMate AI — Tester Install Guide

A self-contained desktop QA tool for Android mobile games. **No external dependencies required** — ADB ships with the app.

## Download

Pick the one that matches your machine:

| Platform | File | Size |
|---|---|---|
| **Mac, Apple Silicon (M1/M2/M3/M4)** | `TestMate AI-1.0.0-arm64.dmg` | 103 MB |
| **Mac, Intel** | `TestMate AI-1.0.0.dmg` | 108 MB |
| **Windows 10 / 11 (64-bit)** | `TestMate AI Setup 1.0.0.exe` | 78 MB |

## Install

### macOS

1. Double-click the `.dmg` to mount it.
2. Drag **TestMate AI** to your **Applications** folder.
3. Eject the dmg.

> ⚠️ **First launch on Mac**: Because the app isn't notarised yet (v1), macOS will say *"TestMate AI cannot be opened because it is from an unidentified developer"* or *"is damaged"*.
> **Workaround**: right-click (or Control-click) the app → **Open** → confirm. After this once, double-click works normally.
> Alternative: `xattr -cr "/Applications/TestMate AI.app"` in Terminal.

### Windows

1. Double-click `TestMate AI Setup 1.0.0.exe`.
2. Windows SmartScreen may show *"Windows protected your PC"* — click **More info** → **Run anyway**.
3. Pick install location (defaults to `Program Files`), click **Install**.
4. Launch from the Start menu.

## Connect a device

1. On your Android device, enable **Developer Options** (Settings → About phone → tap Build number 7 times).
2. In Developer Options, turn on **USB debugging**.
3. Connect via USB cable. Accept the *"Allow USB debugging?"* prompt on the device.
4. In TestMate AI, click **Test Session** → device should show **CONNECTED** in the status bar.

If the device isn't detected, unplug & re-plug, or check **Settings → Developer options → Revoke USB debugging authorizations** then re-plug.

## Quick start

1. **Create a project** from the sidebar (e.g. *MyGame*).
2. **Drag-drop your APK** onto the Test Session tab.
3. Click **▶ Start Test** — APK installs, app launches, live monitoring begins.
4. Play the game for as long as you want.
5. Click **■ Stop** — full QA report auto-generates.
6. Open the **History** tab to view the saved report (verdict + automated checks + key metrics).
7. Use the **QA Checklist** tab to walk through manual tests (20 sections, 111 items) and export a JSON report.

## What's bundled

- Android Debug Bridge (ADB) for your platform
- AAPT (Android Asset Packaging Tool) for Windows; Mac uses the Node-based parser
- All Node.js / Electron dependencies — nothing to install

## Reporting bugs

When something looks wrong, please attach:
- Screenshot
- The session's report JSON (in History → click session → Export)
- The console log if the app crashed (View → Toggle Developer Tools → Console)
