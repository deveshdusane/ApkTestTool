# TestMate AI — Tool Capabilities & Accuracy Reference

_Last reviewed: 2026-06-04 · Source of truth: code in `agent/` and `electron-app/` (not docs, which can lag)._

This document explains **what TestMate AI does**, **which features exist**, **which features actually work**, and — most importantly — **which outputs are real measured data vs. heuristic estimates vs. placeholders**. It is written for testers and developers deciding how far to trust each number in a report.

---

## 1. What This Tool Is

TestMate AI is an **Electron + Node.js desktop app for Android game QA**. A tester loads an APK, connects a device (USB or wireless), and the tool drives a test session: it installs and launches the app, captures logcat / video / screenshots, monitors performance, detects SDKs and events, watches for gameplay blockers, and assembles a QA report with a pass/fail verdict.

It also does **static APK analysis** (no device needed) and has **early iOS support** (static IPA analysis only — see §9).

- **Frontend**: Electron (`electron-app/`) — 9-tab UI, IPC bridge to the agent.
- **Backend ("agent")**: Node.js (`agent/`) — all analysis, ADB control, report generation.
- **Platforms**: Runs on Windows + macOS + Linux for Android work. iOS runtime work is Mac-only (and not yet built).

---

## 2. Accuracy Legend

Throughout this doc:

| Tag | Meaning |
|-----|---------|
| 🟢 **Measured** | Real data parsed from device/APK (dumpsys, gfxinfo, logcat, ZIP contents). Trustworthy. |
| 🟡 **Heuristic** | Real inputs, but the verdict uses thresholds/pattern-matching that can false-positive or false-negative. Useful signal, verify before acting. |
| 🔴 **Placeholder / Not real** | Stubbed, simulated, or random output. **Do not trust for QA sign-off.** |
| ⚪ **Static reference** | Hardcoded lookup table (SDK catalog, device DB). Accurate as written, goes stale over time. |

---

## 3. Feature Map (the 9 UI tabs)

| Tab | What it shows | Backing modules |
|-----|---------------|-----------------|
| **Test** | APK upload, start/stop session, live FPS/network/device dashboard, status log | `main.js` (QAAgent), `monitorEngine` |
| **Runtime** | Detected SDKs, engine, runtime network calls, permissions used | `runtimeIntelligence`, `sdkIntelligence`, `networkDomainMonitor` |
| **Events** | FB App Events + narrative Choice Events timelines, counts | `fbEventTracker`, `choiceEventTracker`, `eventEngine` |
| **IAP Validation** | Purchase lifecycle (initiate→ack→consume), error codes, verdict | `iapValidationEngine` |
| **Regression Compare** | Build-vs-build diff (size, perms, SDKs, perf) | `buildRegressionComparator` |
| **QA Checklist** | 111-item manual checklist + automated rows, export | `qaChecklistManager`, `testValidationAggregator` |
| **Static Analysis** | APK metadata, permissions, security audit, exported components; iOS IPA info | `apkAnalyzer`, `securityAnalyzer`, `preflightAnalyzer`, `ipaAnalyzer` |
| **Device Prediction** | FPS forecast on other devices, bottleneck, confidence | `deviceMatcher`, `performanceScaler` |
| **History** | Past sessions (last 5), saved reports, delete, compare | `projectManager`, `historyManager` |

Plus: **Wireless ADB** modal and **scrcpy screen cast** (external window).

---

## 4. Static APK Analysis (no device required)

### What works
- **APK metadata** — package, version, min/target SDK, permissions, debuggable flag. 🟢 Measured (binary manifest parse via `app-info-parser`, with AAPT badging fallback).
- **Security audit** — dangerous permissions, exported components, cleartext traffic, allowBackup. 🟢 Measured for the facts; 🟡 **the 0–100 risk score is heuristic** (hardcoded weights: debuggable +50, critical perm +40, etc. — `securityAnalyzer.js:251`).
- **Preflight / Play-Store readiness** — 64-bit lib presence, target SDK ≥ 33, signing, etc. 🟢 Measured facts; 🟡 the readiness score weights are authored, not derived.
- **Asset Integrity** (narrative-focused) — zero-byte assets, tiny audio stubs (<10KB), duplicate assets, localization gaps + completeness %. 🟢 Measured from ZIP contents.
- **SDK Intelligence** — detects 14 SDK families from dex class signatures + manifest. 🟢 ~95% reliable. Extracts API keys (AdMob, Firebase, AWS/Stripe secrets) from strings. 🟢 reliable when keys are plaintext; 🟡 the `.arsc` string-pool key pairing is fragile.

### Caveats
- **Engine/SDK detection is filename/path based** (`apkAnalyzer.js:36-76`) — custom/rebranded builds or stripped Unity assets can be missed; unknown engines default to "Native / Unknown".
- **AAPT is optional but recommended** — without it some parsing falls back to JS-only and is less complete. Preflight specifically *requires* AAPT.
- **Hardcoded permission lists** go stale (e.g. Android 13 `READ_MEDIA_*` won't be flagged until updated).
- **Localization analysis only works if the APK ships text `strings.xml`** — compiled `resources.arsc`-only APKs get limited analysis.

---

## 5. Runtime Performance Monitoring (device required)

### FPS — 🟢 Measured (with important caveats)
`monitorEngine.js` measures FPS three ways, in fallback order:
1. `dumpsys gfxinfo framestats` — per-frame timestamps + jank. Best quality.
2. Cumulative frame count / elapsed time.
3. SurfaceFlinger compositor FPS — **whole-screen, not app-specific**.

**Caveats:**
- **Unity / Unreal games often don't populate framestats** → falls back to method 3, which reports *system* FPS, not game FPS. Numbers can look inflated. This is the single biggest FPS-accuracy gotcha.
- **Jank threshold is hardcoded to 60 FPS** (16.67 ms). On 90/120 Hz devices, normal frames get falsely marked janky.
- EMA smoothing (α=0.4) adds ~1–2 frames of lag, masking brief stutters.

### Memory — 🟢 Measured / 🔴–🟡 leak detection
- PSS from `dumpsys meminfo` is real.
- **Memory-leak detection is a heuristic pattern-match** (`memoryAnalyzer.js`): flags if recent samples grow monotonically AND current >40% above early average. **High false-positive rate** — Firebase/ads SDK init routinely allocates 50–100 MB and trips it. Treat "leak detected" as "investigate," not "confirmed."

### CPU / Battery / Ping — 🟢 Measured
- CPU % from `dumpsys cpuinfo` (averaged over ~30s, so ±5–10% and slightly stale).
- Battery from `dumpsys battery`. Ping = real ICMP to 8.8.8.8.

### Performance status labels — 🟡 Heuristic
`performanceMonitor.js` "Performance issues" labels use arbitrary thresholds (1.5× memory growth, 70% CPU, 30 jank). Not calibrated per device/genre.

### SDK key memory scan — 🟢 Measured, debuggable-only
`memoryScanner.js` dumps heap via `run-as` + `strings` to find SDK keys. **Only works on debuggable builds** (returns −1 otherwise). Some false positives from binary garbage.

---

## 6. Gameplay Blocker Detection — 🟢 inputs / 🟡 thresholds

`gameplayBlockerDetector.js` detects 9 blocker classes from logcat + metrics: crash, ANR, native crash, no-UI, OOM-kill, sustained low-FPS, splash-stuck, network-loss, auth-failure. **Every blocker carries the raw triggering evidence** (logcat line / metric values) so testers can verify.

- **Crash / ANR / native crash / process death** — 🟢 reliable logcat matches.
- **OOM-kill** — 🟡 process death + peak PSS >500 MB. The 500 MB threshold is arbitrary; wrong for both low-RAM (false negative) and high-RAM (false positive) devices.
- **Low-FPS** — 🟡 5 samples <20 FPS. Threshold not scaled to device refresh rate; a GC pause can trip it.
- **Splash-stuck** — 🟡 splash-named activity >60s. Long legitimate downloads false-positive. (This blocker is *excluded* from the validation aggregator on purpose because the name-matching is fragile.)
- **Auth-failure** — only detected if the session was started with the auth-SDK opt-in flag.

---

## 7. Event & IAP Validation — 🟢/🟡 (depends on app logging)

**Universal caveat:** all of this reads **logcat**. If the app is a release build that strips debug/verbose logging, much of it goes blind. Reliability is highest on debug/QA builds.

- **Facebook App Events** (`fbEventParser/Tracker/Validator/Catalog`) — ~95% reliable parsing across 4 log formats (JSON/verbose/KV/Unity wrapper), validates against a ⚪ static FB event catalog (22 standard events). Flush-pairing and "debug-logging-off" detection are 🟡 heuristics with a 30–60s window.
- **Choice Events** (narrative) — parses choice events across FB/Firebase/GameAnalytics/AppsFlyer/Unity/generic JSON. Tracks unique choices, chapters, premium choices, parser issues. 🟢 when the app logs analytics events.
- **Generic event engine** — GA/FB/IAP/AppsFlyer/Adjust/lifecycle. 🟡 dedup within 2s and per-category caps can drop rapid events; uses wall-clock time, not logcat timestamp.
- **IAP validation** (`iapValidationEngine`) — SDK detection 🟢; lifecycle (initiate→ack→consume) tracking ~85% on native Billing, ~75% Unity IAP, **~55% behind mediation layers** (AppLovin/LevelPlay can swallow logs). **No real payment/receipt verification** — it infers from logs only. "Purchase finalized" verdict is time-window heuristic (60s).

---

## 8. Network & SDK Traffic — 🟢 Measured

- **Network analyzer** — real ICMP ping, real RX/TX bytes from `dumpsys netstats`, real disconnect detection. **Production-ready, ~90% accurate.** (Logcat drop detection is debounced to 1/15s, so rapid reconnects can be masked.)
- **Domain monitor** — reads live `/proc/net/tcp[6]`, reverse-DNS resolves destinations, matches against 17 known ad/analytics SDK host patterns. 🟢 real; ⚪ the SDK host list is hardcoded. DNS latency can miss very short-lived beacons.

---

## 9. Device Performance Prediction — 🟡🔴 Estimate only

**This is the least trustworthy feature. Treat predictions as rough estimates, never ground truth.**

- `deviceMatcher.js` matches the connected device to a ⚪ **20-device database** (11 Android + 9 iOS) by name, falling back to crude **RAM-tier buckets** (e.g. *all* 8 GB devices → Galaxy S23 scores). ~95% of real-world devices hit the fallback.
- `performanceScaler.js` predicts FPS via **linear GPU-score scaling**: `predictedFPS = baseFPS × (targetScore / currentScore)`, with hardcoded penalties and ±2 FPS deterministic "variance" (cosmetic noise). Bottleneck detection mixes current CPU usage with target GPU score (incoherent). Confidence caps at 95% with no statistical basis.
- **Realistic error: ±15–30 FPS** cross-architecture or cross-workload. For real decisions, use on-device profiling or a device farm.

---

## 10. iOS Support — Static only (Phase 1)

- **`ipaAnalyzer` + `plistParser`** — 🟢 **real, production-quality static IPA analysis**: bundle ID/version, min iOS, device families, permissions, ATS, URL schemes, frameworks, SDK detection, Mach-O CPU architectures, provisioning profile (team/expiry/device count, signature *not* cryptographically verified), localization, asset integrity. Works on any host OS.
- **iOS runtime testing is NOT implemented.** Starting a session on an `.ipa` returns: _"iOS test sessions are not yet implemented (Phase 1 is static-only)."_ Runtime (install, syslog, FPS, crash logs) needs macOS + libimobiledevice + Xcode — deferred to Phase 2. `platformDispatch.js` correctly gates this.

---

## 11. Reporting & Verdict — 🟢 real logic, except UI analysis

- **`reportGenerator` verdict** — 🟢 real deterministic decision tree: `CRITICAL` → `NEEDS_FIXES` → `NEEDS_REVIEW` → `PRODUCTION_READY`, based on automated fails/warns + manual checklist %. Trustworthy.
- **`testValidationAggregator`** — 🟢 fuses preflight + gameplay blockers + runtime intel + IAP into PASS/WARN/FAIL rows with explicit confidence labels ("Verified", "Needs Manual Validation"). **Only emits PASS rows when a session actually ran** — won't claim untested features pass.
- **`insightEngine`** — 🟡 rule-based thresholds. **The "aiInsights" name is aspirational — there is no ML/AI here**, just if/else rules.
- **`bugReporter`** — ⚪ maps issues to 8 static bug templates. No dedup (same root cause → multiple reports).
- **`logAnalyzer`** — 🟢/🟡 keyword matching with dedup. Known bug: **ANR count is capped at 1 per session** (set to 1, not incremented); crash/error dedup keys (50–80 chars) can collide.

### UI Analysis — 🟢 now wired to real data (fixed 2026-06-04)
`uiAnalyzer.js` previously generated **random** UI findings (`simulateVisualAnalysis`). That stub is **removed**. `analyzeUI()` now **derives its findings from the real `textOverflowDetector` view-hierarchy snapshot** captured during the session — missing-string placeholders, truncation, edge-clipping, empty/squashed widgets — each with real resourceId, className, location (from pixel bounds), and timestamp. Score is deterministic (100 minus weighted penalties); status is `FAIL`/`WARNING`/`PASS`. When no UI dumps were captured (dump blocked or session too short) it honestly returns `NOT TESTED` instead of inventing findings.

> ✅ The "UI evaluation" block is now trustworthy and reproducible. It still does **not** do pixel/image analysis or OCR — it surfaces deterministic widget-level findings. (Note: the report's `uiEvaluation` field is not currently rendered in any UI tab; the same findings are also shown directly in the text-overflow view.)

---

## 12. Narrative-Game Analyzers (the 4 you asked about earlier)

| Analyzer | Real? | Catches |
|----------|-------|---------|
| **Choice Branch Tracker** (`choiceEventTracker`) | 🟢 (needs app to log events) | Branch coverage: unique choices fired, chapters exercised, premium choices, untested paths |
| **Save State Monitor** (`saveStateMonitor`) | 🟢 (debuggable build for internal dirs) | Save corruption mid-session: file disappeared, truncated to 0, dramatic shrink, JSON/XML became invalid |
| **Text Overflow Detector** (`textOverflowDetector`) | 🟢 (uiautomator, no root) | Missing-string placeholders, ellipsis truncation, edge-clipping, empty/squashed text widgets |
| **Asset Integrity** (`assetIntegrityAnalyzer`) | 🟢 (static) | Zero-byte assets, tiny voice stubs, duplicate assets, localization gaps + completeness % |

These are the genuine narrative-QA value — unlike the faked screenshot UI analysis.

---

## 13. Infrastructure — 🟢 Production

- **ADB control** — serialized command queue, bundled adb, system fallback, 5s device timeout, 3-strike disconnect grace.
- **Wireless ADB** — fully implemented, two modes: **USB→TCP/IP bootstrap** (Android 4.0+) and **pairing-code** (Android 11+, no USB). Persistent known-device store, auto-reconnect on launch.
  - ⚠️ Office constraint: corporate Wi-Fi often blocks phone↔PC. Default to USB in-office; wireless needs hotspot/dongle.
- **scrcpy cast** — opens an **external** mirror window (not embedded in the app); graceful no-op if the binary isn't bundled.
- **Project/session storage** — JSON on disk. **Hard cap: last 5 sessions per project** (older auto-deleted on stop).
- **Preflight cache** — keyed by APK path; cleared on new APK selection. First validation poll may miss rows (lazy background run), next poll picks them up.

---

## 14. Trust Summary (one-glance)

| Capability | Trust | Note |
|------------|-------|------|
| APK metadata / permissions / security facts | 🟢 High | |
| Security/preflight **score** | 🟡 | facts real, weights authored |
| Asset integrity (incl. localization) | 🟢 High | static, reliable |
| SDK detection | 🟢 High | dex/manifest based |
| FPS (standard View/Canvas games) | 🟢 High | |
| FPS (Unity/Unreal games) | 🟡 | may report system FPS |
| Memory PSS | 🟢 High | |
| Memory **leak detection** | 🔴–🟡 Low | heuristic, false-positives common |
| CPU / battery / ping / network | 🟢 High | |
| Gameplay blockers | 🟡 | real evidence, arbitrary thresholds |
| FB / choice events | 🟢/🟡 | needs app logging; debug builds best |
| IAP validation | 🟡 | log-inferred, no receipt check, mediation lowers it |
| Save-state / text-overflow | 🟢 | genuine narrative checks |
| Report verdict / aggregation | 🟢 High | real deterministic logic |
| "AI insights" | 🟡 | rules, not ML |
| UI analysis (`uiEvaluation`) | 🟢 | wired to real text-overflow findings (was fake, fixed 2026-06-04) |
| Device FPS **prediction** | 🟡🔴 Low | ±15–30 FPS, estimate only |
| iOS static (IPA) | 🟢 High | |
| iOS runtime | ⛔ Not built | static-only Phase 1 |

---

## 15. Top Things To Fix / Know Before Trusting Reports

1. ~~Screenshot UI analysis is random~~ **DONE (2026-06-04)** — `uiAnalyzer.js` now derives findings from real `textOverflowDetector` data; honest `NOT TESTED` when no dumps. A future vision/OCR layer could still add pixel-level checks.
2. **Memory-leak heuristic over-fires** — recalibrate the 40% threshold and lengthen the 15s idle window past SDK init, or label it "suspected."
3. **Unity/Unreal FPS** falls back to system FPS — surface a warning in the UI when framestats are empty so testers don't trust inflated numbers.
4. **Device FPS prediction** is a linear toy model on a 20-device DB — present it as an estimate, not a verdict.
5. **ANR count caps at 1** (`logAnalyzer.js:140`) — increment it.
6. **Most runtime/event/IAP accuracy assumes debug logging** — on stripped release builds, expect blind spots. State the build type in the report.
7. **Hardcoded lists go stale** (permissions, FB catalog, SDK hosts, device DB) — schedule periodic updates.
