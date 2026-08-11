package com.gorowynn.piwebui

import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * U6 C11 (FR-38): canonical containment unit tests. Pure-helper tests — no
 * IntelliJ platform fixtures, so they run in a plain JVM test task.
 */
class WorkspaceContainmentTest {
    private fun tempRoot(): File = Files.createTempDirectory("piwebui-contain").toFile()

    @Test
    fun insideChildren() {
        val root = tempRoot()
        val child =
            File(root, "src/main/a.ts").apply {
                parentFile.mkdirs()
                writeText("x")
            }
        assertTrue(WorkspaceContainment.isInside(root, child), "direct child")
        assertTrue(WorkspaceContainment.isInside(root, root), "root itself")
        assertTrue(
            WorkspaceContainment.isInside(root, File(root, "nested/deep/b.ts")),
            "deep relative child (need not exist)",
        )
    }

    @Test
    fun outsideRejected() {
        val root = tempRoot()
        val sibling = tempRoot()
        assertFalse(WorkspaceContainment.isInside(root, sibling), "sibling dir")
        assertFalse(WorkspaceContainment.isInside(root, File(sibling, "x.txt")), "sibling file")
        val system = File(if (File.separatorChar == '\\') "C:\\Windows" else "/etc")
        assertFalse(WorkspaceContainment.isInside(root, system), "system path")
    }

    @Test
    fun dotDotCollapses() {
        val root = tempRoot()
        // root/../secret.txt must canonicalize OUTSIDE root
        val escape = File(root, ".." + File.separator + "secret.txt")
        assertFalse(WorkspaceContainment.isInside(root, escape), ".. escape collapses outside")
        val inside = File(root, "src" + File.separator + ".." + File.separator + "src" + File.separator + "x.ts")
        assertTrue(WorkspaceContainment.isInside(root, inside), ".. within root stays inside")
    }

    @Test
    fun prefixIsNotContainment() {
        val root = tempRoot()
        // /root-evil must NOT count as inside /root
        val evil = File(root.parentFile, root.name + "-evil")
        evil.mkdirs()
        assertFalse(WorkspaceContainment.isInside(root, evil), "name-prefix sibling rejected")
        evil.delete()
    }
}
