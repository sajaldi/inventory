---
description: Build Android APK locally (Debug or Release)
---
# Build Android APK

This workflow generates an installable APK file for Android using the local Gradle build system.

## Turbo Build (Debug)
// turbo
1. Build Debug APK
   ```powershell
   cd android; ./gradlew assembleDebug
   ```

**Output:** `android/app/build/outputs/apk/debug/app-debug.apk`

---

## Release Build (Requires Signing Config)
// turbo
1. Build Release APK
   ```powershell
   cd android; ./gradlew assembleRelease
   ```

**Output:** `android/app/build/outputs/apk/release/app-release.apk`

> **Note:** If you haven't configured a keystore for release signing in `build.gradle`, the release APK will be unsigned and may not install on devices. For quick testing, use the **Debug** build.
