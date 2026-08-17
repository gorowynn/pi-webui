package com.gorowynn.piwebui

import com.google.gson.Gson
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * SDD trust-boundary (SEC-17a / REL-24a / SEC-07): pure bridge-helper tests.
 * No IntelliJ platform fixtures — runs in the plain JVM test task, next to
 * WorkspaceContainmentTest.
 */
class DiffBridgeTest {
    private val gson = Gson()

    // ---- SEC-17a: parsePayload is fail-closed ----

    @Test
    fun validFullPayload() {
        val json =
            gson.toJson(
                mapOf(
                    "filename" to "app.js",
                    "path" to "public/app.js",
                    "op" to "edit",
                    "edits" to listOf(mapOf("oldText" to "a", "newText" to "b")),
                    "content" to "c",
                    "leftText" to "L",
                    "rightText" to "R",
                    "requestId" to "r-1",
                    "toolCallId" to "tc-9",
                    "mode" to "default",
                    "options" to listOf("Allow once", "Deny"),
                ),
            )
        val p = DiffBridge.parsePayload(json)
        assertNotNull(p)
        assertEquals("app.js", p.filename)
        assertEquals("public/app.js", p.path)
        assertEquals("edit", p.op)
        assertEquals(1, p.edits.size)
        assertEquals("a", p.edits[0].oldText)
        assertEquals("b", p.edits[0].newText)
        assertEquals("r-1", p.requestId)
        assertEquals("tc-9", p.toolCallId)
        assertEquals(listOf("Allow once", "Deny"), p.options) // SEC-07 rides the payload
    }

    @Test
    fun blankJsonIsNull() {
        assertNull(DiffBridge.parsePayload(""), "empty string")
        assertNull(DiffBridge.parsePayload("   "), "whitespace")
    }

    @Test
    fun malformedJsonIsNull() {
        // review evidence: "{not json" must NOT become an empty DiffPayload
        assertNull(DiffBridge.parsePayload("{not json"))
    }

    @Test
    fun wrongRootTypeIsNull() {
        assertNull(DiffBridge.parsePayload("[1,2]"), "array root")
        assertNull(DiffBridge.parsePayload("\"denied\""), "string root")
        assertNull(DiffBridge.parsePayload("42"), "number root")
    }

    @Test
    fun missingOptionalFieldsUseDefaults() {
        val p = DiffBridge.parsePayload("{}")
        assertNotNull(p, "empty object is well-formed; defaults, not null")
        assertEquals("", p.path)
        assertEquals(emptyList(), p.options)
        assertEquals("", p.requestId)
    }

    // ---- REL-24a: composeResolveCall is exact ----

    @Test
    fun resolveCallExact() {
        assertEquals(
            "window.__piDiffResolve(\"abc\",\"Deny\");",
            DiffBridge.composeResolveCall("abc", "Deny"),
        )
    }

    @Test
    fun resolveCallSerializesObjects() {
        val value = mapOf("label" to "Allow once", "oldFull" to "a\nb", "newFull" to "c")
        val js = DiffBridge.composeResolveCall("r-7", value)
        assertTrue(js.startsWith("window.__piDiffResolve(\"r-7\","), "id first arg")
        assertTrue(js.endsWith(");"), "statement terminated")
        // the value stays ONE argument (Gson-escaped), then the close paren
        assertEquals(
            gson.toJson(value),
            js.removePrefix("window.__piDiffResolve(\"r-7\",").removeSuffix(");"),
        )
    }

    // ---- SEC-07: normalizeOptions ----

    @Test
    fun normalizeOptionsExtractsLabels() {
        val raw = listOf<Any?>("Allow once", mapOf("label" to "Deny"), null, emptyMap<String, String>(), 42)
        assertEquals(listOf("Allow once", "Deny"), DiffBridge.normalizeOptions(raw))
    }

    @Test
    fun normalizeOptionsEmptyList() {
        assertEquals(emptyList(), DiffBridge.normalizeOptions(emptyList()))
        assertEquals(emptyList(), DiffBridge.normalizeOptions(listOf(null, 7)))
    }

    // ---- SEC-17b: staleness helpers (pure logic) ----

    @Test
    fun isStaleBasics() {
        assertTrue(DiffBridge.isStale("a", "b"), "changed on disk")
        assertFalse(DiffBridge.isStale("a", "a"), "unchanged")
        assertFalse(DiffBridge.isStale(null, "b"), "no base to compare (new file)")
        assertFalse(DiffBridge.isStale("a", null), "unreadable disk → not stale (fail toward the normal gate)")
    }

    @Test
    fun shouldBlockAllowOnlyWhenStaleAllow() {
        val allowLabels = listOf("Allow once", "Allow for this session", "Allow always (save to config)")
        for (label in allowLabels) {
            assertTrue(DiffBridge.shouldBlockAllow(label, true), "stale + $label → blocked")
            assertFalse(DiffBridge.shouldBlockAllow(label, false), "fresh + $label → allowed")
        }
        assertFalse(DiffBridge.shouldBlockAllow("Deny", true), "Deny always resolves (fail-closed)")
        assertFalse(DiffBridge.shouldBlockAllow("Deny", false))
    }

    // ---- SEC-17c: DiffReviewFile.decide is exactly-once (CAS) ----

    @Test
    fun decideResolvesExactlyOnce() {
        var calls = 0
        var first: Any? = null
        val file =
            DiffReviewFile(DiffPayload(filename = "a.txt")) { v ->
                calls++
                first = v
            }
        file.decide("Allow once")
        file.decide("Deny") // dispose→Deny racing a click
        file.decide("Allow once")
        assertEquals(1, calls, "exactly one onDecide invocation")
        assertEquals("Allow once", first, "the FIRST decision wins")
    }
}
