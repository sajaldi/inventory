
import os

content = r"""// Top-level build file where you can add configuration options common to all sub-project/modules.

buildscript {
  ext {
    ndkVersion = "26.3.11579264"
  }
  repositories {
    google()
    mavenCentral()
  }
  dependencies {
    classpath('com.android.tools.build:gradle')
    classpath('com.facebook.react:react-native-gradle-plugin')
    classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')
  }
}

allprojects {
  repositories {
    google()
    mavenCentral()
    maven { url 'https://www.jitpack.io' }
  }
}

apply plugin: "expo-root-project"
apply plugin: "com.facebook.react.rootproject"
"""

with open(r'D:\Apps\Inv\EscanerCodigos\android\build.gradle', 'w') as f:
    f.write(content)
print("Updated build.gradle")
