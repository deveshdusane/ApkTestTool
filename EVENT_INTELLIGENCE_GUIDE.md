# 🕒 TestMate AI: Event Intelligence Guide

The **Event Intelligence** system in TestMate AI allows you to monitor, verify, and audit business-critical events in real-time during your QA sessions. This guide explains how the system works and how to set it up for maximum coverage.

---

## 🚀 What is Event Intelligence?

In modern mobile games, "events" are the heartbeat of the business. They track when a player starts a level, makes a purchase, or sees an ad. TestMate AI captures these events as they happen, allowing you to verify that your analytics and monetization SDKs are working correctly without having to manually check server logs.

### Supported SDKs & Events
*   **GameAnalytics:** DESIGN, PROGRESSION, BUSINESS, and ERROR events.
*   **Firebase Analytics:** All named events (e.g., `level_up`, `tutorial_complete`).
*   **Facebook SDK:** LogAppEvents and standard purchase events.
*   **In-App Purchases (IAP):** Google Play Billing and Unity IAP transaction signals.
*   **Attribution:** AppsFlyer and Adjust event tracking tokens.
*   **Unity Lifecycle:** Scene changes, engine startup, and application focus.

---

## 🛠 How to Use the Feature

### 1. Basic Event Monitoring (Phase 1)
This is active by default for all **Debug Builds**.
1.  Connect your Android device via ADB.
2.  Start a **Test Session** in TestMate AI.
3.  Navigate to the **Runtime Events** tab in the sidebar.
4.  As you play the game, events will appear in the live feed with timestamps.
5.  Use the **Category Filters** (GA, Firebase, IAP, etc.) to isolate specific SDK traffic.

### 2. AI-Enhanced Classification (Phase 2)
For unknown SDKs or custom game logs, TestMate uses Gemini AI to "understand" and categorize logs that don't match standard patterns.
*   **How to enable:** 
    1. Go to **Settings** in the tool.
    2. Paste your **Gemini API Key**.
    3. Events identified by AI will be marked with a `🤖` icon in the timeline.

---

## 🔑 Key Configuration

| Item | Requirement | Purpose |
|---|---|---|
| **Gemini API Key** | Optional | Enables AI classification of unknown/custom log events. |
| **ADB Debugging** | Mandatory | Primary data pipe for all runtime intelligence. |
| **USB Debug Props** | Auto-set | TestMate forces `log.tag.<SDK> VERBOSE` at session start. |

---

## 📈 Accuracy Levels

*   **HIGH (logcat):** Direct string match from SDK logs. 100% accurate.
*   **INFERRED (AI):** AI-guessed event based on context. 80-90% accurate.

---

> [!TIP]
> **Pro Tip:** If you see "No Events" for a specific SDK, check if you have called the SDK's `Initialize()` method in your game code. TestMate can only detect what the game actually attempts to send!
