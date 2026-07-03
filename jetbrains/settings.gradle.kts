pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

plugins {
    // Lets Gradle auto-download a JDK 21 toolchain (jvmToolchain(21) in
    // build.gradle.kts) when none is found locally. Requires 1.0.0+ on Gradle 9
    // — older versions reference JvmVendorSpec.IBM_SEMERU, removed in Gradle 9.
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "pi-webui-jetbrains"
