package com.gorowynn.piwebui

import com.google.gson.Gson
import com.google.gson.JsonSyntaxException

/**
 * Pure helpers for the JS↔Kotlin approval bridge (SDD trust-boundary:
 * SEC-17a fail-closed parsing, REL-24a id-keyed resolve calls, SEC-07 offered
 * options, SEC-17b staleness gating). No IDE/CEF types — unit-testable in the
 * plain JVM test task (DiffBridgeTest).
 */
object DiffBridge {
    private val gson = Gson()

    /**
     * SEC-17a: parse a bridge payload, fail-closed. Returns null on blank
     * input, malformed JSON, or a non-object root — the caller treats null as
     * an immediate Deny (never an empty DiffPayload the user could approve).
     */
    fun parsePayload(json: String): DiffPayload? {
        val trimmed = json.trim()
        if (trimmed.isEmpty()) return null
        return try {
            val tree =
                com.google.gson.JsonParser
                    .parseString(trimmed)
            if (!tree.isJsonObject) return null
            gson.fromJson(tree, DiffPayload::class.java)
        } catch (_: JsonSyntaxException) {
            null
        } catch (_: IllegalStateException) {
            null
        }
    }

    /**
     * REL-24a: build the JS resolve call for the id-keyed resolver map. The
     * injected `window.__piDiffResolve(id, value)` pops exactly one resolver;
     * unknown ids and double resolves are no-ops in the page.
     */
    fun composeResolveCall(
        id: String,
        value: Any,
    ): String = "window.__piDiffResolve(" + gson.toJson(id) + "," + gson.toJson(value) + ");"

    /**
     * SEC-07: normalize offered options (string or {label}) to their string
     * labels; malformed entries are skipped. The IDE button bar renders only
     * these — a mandatory-ask can never show a four-label bar.
     */
    fun normalizeOptions(raw: List<Any?>): List<String> =
        raw.mapNotNull { o ->
            when (o) {
                is String -> o
                is Map<*, *> -> o["label"] as? String
                else -> null
            }
        }

    /**
     * SEC-17b: true when the file's on-disk text no longer matches the base
     * the diff was built from. A null base (new file) or unreadable disk
     * (null) is NOT stale — the normal gate already covers those.
     */
    fun isStale(
        base: String?,
        disk: String?,
    ): Boolean = base != null && disk != null && base != disk

    /**
     * SEC-17b: an ALLOW against a stale base is blocked until the user
     * re-reads the file; Deny always resolves (fail-closed direction).
     */
    fun shouldBlockAllow(
        label: String,
        stale: Boolean,
    ): Boolean = stale && label != "Deny"
}

/** Payload sent from app.js across the bridge. Gson is bundled in the
 *  IntelliJ Platform (lib/gson-*.jar).
 *
 *  `path`+`op`+`edits`/`content` let the dialog build a REAL diff against the
 *  IDE's file (syntax highlighting via FileType + the open editor's current
 *  text). `leftText`/`rightText` are the app.js fallback (server.js /api/file)
 *  for paths not under the project. `options` (SEC-07) are the gate's OFFERED
 *  labels — the button bar renders only those. */
data class DiffPayload(
    var filename: String = "change",
    var path: String = "",
    var op: String = "", // "edit" | "write"
    var edits: List<EditHunk> = emptyList(),
    var content: String = "",
    var leftText: String = "",
    var rightText: String = "",
    // U6 C11 (FR-39/41): broker identity + active mode ride the payload so the
    // native tab can key decisions by request id and show the gate's posture.
    var requestId: String = "",
    var toolCallId: String = "",
    var mode: String = "",
    // SEC-07: offered option labels ("Allow once" | {label} → string)
    var options: List<String> = emptyList(),
)

data class EditHunk(
    var oldText: String = "",
    var newText: String = "",
)
