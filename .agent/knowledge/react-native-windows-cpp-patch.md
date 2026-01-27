# Knowledge Base: Solving React Native C++ Compilation Errors on Windows

## Problem: `std::format` not found in React Native 0.81.5
When building a React Native project with the **New Architecture** enabled on a Windows machine, the build fails with multiple C++ errors similar to:
`error: no member named 'format' in namespace 'std'; did you mean 'folly::format'?`

This happens because `std::format` (C++20) is not reliably recognized by the NDK/Clang environment used by some React Native prefabs when compiled on Windows, despite the `-std=c++20` flag.

## Solution

### 1. Patching `node_modules`
The primary source of the error is in the React Native renderer headers.
File: `node_modules/react-native/ReactCommon/react/renderer/core/graphicsConversions.h`

**Replace:**
```cpp
return std::format("{}%", dimension.value);
```
**With:**
```cpp
return std::to_string(dimension.value) + "%";
```

### 2. Patching the Gradle Transform Cache (Surgical Fix)
React Native autolinks modules (like `reanimated`, `async-storage`, `safe-area-context`) as prebuilt artifacts. During the build, Gradle transforms these artifacts and stores headers in its cache. Autolinked modules often point to these cached headers instead of the one in `node_modules`.

**Verification**: Use `find_by_name` or `dir /s` to locate `graphicsConversions.h` inside `.gradle/caches/8.14.3/transforms/`.

**Action**: You must apply the same `std::to_string` patch to **all** instances of `graphicsConversions.h` found in the transforms cache for both `debug` and `release` variants.

### 3. Build Configuration
Ensure the root `android/build.gradle` has a top-level `ext` block to standardize versions across all modules, especially for SDK 36:

```gradle
ext {
    compileSdkVersion = 36
    targetSdkVersion = 34
    buildToolsVersion = "36.0.0"
    minSdkVersion = 24
    ndkVersion = "26.3.11579264"
}
```

### 4. Network Connectivity in Production APKs
Android blocks cleartext traffic (HTTP) by default in release builds. To allow connection to a local API via HTTP:

In `android/app/src/main/AndroidManifest.xml`:
```xml
<application 
    ... 
    android:usesCleartextTraffic="true">
```

## Summary of Fixes
The primary issues resolved were:
1. **Compilation**: Bypassing missing `std::format` support on Windows by using `std::to_string`.
2. **Connectivity**: Enabling `usesCleartextTraffic` to allow production APKs to reach HTTP endpoints.
