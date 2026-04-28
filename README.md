# TestMate AI

**TestMate AI** is a production-grade performance prediction and SDK intelligence engine for mobile applications. It helps developers and QA teams analyze real-time telemetry and predict how apps will perform across various hardware targets (Flagship, Mid-range, Budget).

## Key Features

- **Device Performance Prediction**: Deterministic FPS scaling across global hardware profiles.
- **SDK Intelligence**: Real-time detection and audit of Ad SDKs, Analytics, and Attribution tools.
- **Runtime Event Timeline**: Live ADB-based event tracking and filtering.
- **Security Audit**: Automated check for manifest vulnerabilities, dangerous permissions, and cleartext traffic.
- **Bottleneck Detection**: Identifies whether your app is CPU-bound, GPU-bound, or under memory pressure.

## Technology Stack

- **Frontend**: Electron, Vanilla JavaScript, CSS (with Glassmorphism/Modern Aesthetics).
- **Backend**: Node.js, ADB (Android Debug Bridge) for telemetry collection.
- **Intelligence**: Custom deterministic scaling algorithms for cross-device performance forecasting.

## Getting Started

1.  **Install Dependencies**:
    ```bash
    cd electron-app && npm install
    ```
2.  **Run the App**:
    ```bash
    npm start
    ```

## Usage

- Select a project or create a new one.
- Drop an APK for static analysis.
- Connect an Android device via ADB to start a real-time QA session.
- View live performance predictions and SDK activity in the dashboard.

---
*Developed for Advanced Agentic Coding - AI Essentials.*
