// Standalone Gradle project — does NOT touch the webui's zero-build invariant
// (server.js/app.js/style.css/index.html stay build-free). A native IDE plugin
// inherently needs Gradle; it's the IntelliJ Platform's contract, not our choice.
plugins {
    id("org.jetbrains.intellij.platform") version "2.7.0"
    id("org.jetbrains.kotlin.jvm") version "2.4.0"
}

group = "com.gorowynn"
version = "0.1.0"

repositories {
    mavenCentral()
    intellijPlatform { defaultRepositories() }
}

val ideHome: String = providers.gradleProperty("riderHome").orNull
    ?: providers.environmentVariable("RIDER_HOME").orNull
    ?: findInstalledIde()
    ?: error("No IntelliJ IDE found. Set RIDER_HOME or pass -PriderHome=<install dir>.")

fun findInstalledIde(): String? {
    val userHome = System.getProperty("user.home")
    val localAppData = System.getenv("LOCALAPPDATA")
    val roots = mutableListOf<File>()
    fun add(p: String) {
        File(p).takeIf { it.isDirectory }?.let { roots += it }
    }
    add("C:/Program Files/JetBrains")
    localAppData?.let { add("$it/Programs"); add("$it/JetBrains/Toolbox/apps") }
    add("$userHome/JetBrains"); add("/opt")
    File("/Applications").listFiles()
        ?.filter { Regex("IntelliJ|Rider|PyCharm|WebStorm|GoLand|CLion|RubyMine|DataGrip|Android Studio").containsMatchIn(it.name) }
        ?.let { roots += it }
    add("$userHome/Library/Application Support/JetBrains/Toolbox/apps")
    add("$userHome/.local/share/JetBrains/Toolbox/apps")
    return roots
        .flatMap { r ->
            r.walkTopDown().maxDepth(4)
                .filter { it.isFile && it.name == "product-info.json" }
                .toList()
        }
        .map { it.parentFile }
        .distinctBy { it.absolutePath }
        .maxByOrNull { it.name }
        ?.absolutePath
}

dependencies {
    intellijPlatform {
        local(ideHome)
    }
}

intellijPlatform {
    // ponytail: instrumentCode disabled. It runs platform bytecode-instrumentation
    // on the Gradle JVM (JDK 25 ms-25.0.3) which throws "Packages does not exist";
    // it only injects @NotNull checks, not load-bearing. Re-enable on a JDK 21 build.
    instrumentCode = false
    pluginConfiguration {
        ideaVersion { sinceBuild.set("261") } // 2026.1 (matches Rider); lower for broader compat
        // untilBuild intentionally unset: stays forward-compatible (SDK recommendation)
    }
}

kotlin { jvmToolchain(21) }
