package com.gorowynn.piwebui

import java.io.File

/**
 * Canonical project containment (SDD permission-policy C11, FR-38).
 * Pure helper (no IntelliJ deps) so it is unit-testable without the platform.
 *
 * `isInside(root, target)` is true when `target` resolves INSIDE `root` after
 * canonicalization (symlink hops + `..` collapsed). Case-tolerant on Windows.
 * The plugin refuses to read/render files outside the project root through the
 * IDE filesystem — app.js falls back to the webui diff for those.
 */
object WorkspaceContainment {
    fun isInside(
        root: File,
        target: File,
    ): Boolean {
        val r = runCatching { root.absoluteFile.canonicalFile }.getOrNull() ?: return false
        val t = runCatching { target.absoluteFile.canonicalFile }.getOrNull() ?: return false
        val sep = File.separatorChar
        val norm = { s: String -> if (sep == '\\') s.lowercase() else s }
        val rp = norm(r.path)
        val tp = norm(t.path)
        if (tp == rp) return true
        return tp.startsWith(rp + sep)
    }
}
