package com.gorowynn.piwebui

import com.intellij.diff.DiffContentFactory
import com.intellij.diff.DiffManager
import com.intellij.diff.DiffRequestPanel
import com.intellij.diff.contents.DocumentContent
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.fileTypes.FileTypes
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VfsUtil
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.testFramework.LightVirtualFile
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.event.ActionEvent
import java.beans.PropertyChangeListener
import java.util.concurrent.atomic.AtomicBoolean
import javax.swing.AbstractAction
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel

/**
 * The IDE-side approval gate for edit/write, rendered as a CENTER editor tab —
 * i.e. inside the IDE's main window, like opening a file — instead of a floating
 * [com.intellij.openapi.ui.DialogWrapper]. The proposed change is shown in the
 * NATIVE JetBrains diff viewer (embedded via [DiffRequestPanel]) with the 4
 * safeguard decision buttons in a top bar. A decision (or closing the tab)
 * resolves the JS promise; [safeguard] (the security gate) is untouched.
 *
 * This replaced the earlier floating DialogWrapper (a separate window) per request.
 *
 * Extends [UserDataHolderBase] to satisfy [FileEditor]'s [com.intellij.openapi.util.UserDataHolder]
 * surface (getUserData/putUserData) — these have no defaults in this platform build.
 *
 * Wire contract — these labels must match safeguard.ts EXACTLY:
 *   "Allow once" / "Allow for this session" / "Allow always (save to config)" / "Deny"
 *
 * Fail-closed: closing the tab any way except a button click (tab ✕, etc.)
 * disposes the editor, which resolves "Deny", matching the old dialog's Esc/X
 * handling. Enter never approves (there is no default OK action here).
 */
class DiffReviewEditor(
    private val proj: Project,
    private val file: DiffReviewFile,
) : UserDataHolderBase(),
    FileEditor {
    private val diffDisp = Disposer.newDisposable()
    private var built: JComponent? = null

    // The right ("Proposed") pane is EDITABLE: the user can tweak pi's proposal
    // before approving. On decision we read it back and, if changed, ship the
    // full old/new text so safeguard can mutate pi's tool input (event.input)
    // and pi applies the EDITED version — keeping pi's context consistent.
    private var leftText: String = ""
    private var origRight: String = ""
    private var rightContent: DocumentContent? = null

    // SEC-17b: rebuilt-diff plumbing (root panel + current center pane) and
    // the inline staleness warning the blocked-allow path fills.
    private var rootPanel: JPanel? = null
    private var diffPane: JComponent? = null
    private var diffPanel: DiffRequestPanel? = null
    private var staleWarn: JLabel? = null

    private fun build(): JComponent {
        val bar = JPanel(BorderLayout())
        bar.border = JBUI.Borders.empty(8)
        // U6 C11 (FR-41): the active permission mode rides the bridge payload
        // (app.js sends pendingApproval.provenance.mode) so the gate shows its
        // own posture; yolo gets a warning badge.
        val modeLabel =
            when (file.payload.mode) {
                "yolo" -> "⚠ YOLO ACTIVE — all actions auto-allowed"
                "", "default" -> "mode: default"
                else -> "mode: ${file.payload.mode}"
            }
        bar.add(JLabel("Approve pi's change to ${file.payload.filename}? · $modeLabel"), BorderLayout.WEST)
        // SEC-17b: filled when an allow is blocked because the file changed on
        // disk; cleared by the re-read that re-bases the diff.
        staleWarn = JLabel("").also { bar.add(it, BorderLayout.CENTER) }
        val east = JPanel()
        east.add(
            JButton(
                object : AbstractAction("Re-read file") {
                    override fun actionPerformed(e: ActionEvent) = reRead()
                },
            ),
        )
        // SEC-07: render ONLY the options the gate actually offered (a
        // mandatory-ask shows Allow once/Deny — never a four-label bar that
        // could mint a session/persistent grant the gate never offered).
        // Old-webui payloads without options fall back to the four labels.
        val labels = file.payload.options.ifEmpty { listOf(ALLOW_ONCE, ALLOW_SESSION, ALLOW_ALWAYS, DENY) }
        for (label in labels) {
            east.add(
                JButton(
                    object : AbstractAction(label) {
                        override fun actionPerformed(e: ActionEvent) = attemptDecision(label)
                    },
                ),
            )
        }
        bar.add(east, BorderLayout.EAST)

        val root = JPanel(BorderLayout())
        root.add(bar, BorderLayout.NORTH)
        rootPanel = root
        rebuildDiffPane(root)
        return root
    }

    /** (Re)build the CENTER diff against the CURRENT on-disk base. Used by
     *  build() and by the SEC-17b re-read after a blocked stale allow (fresh
     *  base, proposal re-applied per payload.op, right pane reset). */
    private fun rebuildDiffPane(root: JPanel) {
        val oldPanel = diffPanel
        val (left, right, fileType) = resolveContents(proj, file.payload)
        leftText = left
        origRight = right
        val factory = DiffContentFactory.getInstance()
        rightContent = factory.createEditable(proj, right, fileType) // editable right pane
        val request =
            SimpleDiffRequest(
                "Approve change — ${file.payload.filename}",
                listOf(factory.create(proj, left, fileType), rightContent!!),
                listOf("Current", "Proposed (from pi) — editable"),
            )
        val panel: DiffRequestPanel =
            DiffManager.getInstance().createRequestPanel(proj, diffDisp, null)
        panel.setRequest(request)
        panel.component.preferredSize = Dimension(1000, 700)
        diffPane?.let { root.remove(it) }
        oldPanel?.let { Disposer.dispose(it) } // free the swapped-out panel
        root.add(panel.component, BorderLayout.CENTER)
        root.revalidate()
        root.repaint()
        diffPane = panel.component
        diffPanel = panel
    }

    /** SEC-17b re-read: rebuild the diff from the fresh on-disk base and
     *  clear the staleness block (the next allow is judged against the new
     *  base; the user's in-flight right-pane edits reset — the proposal is
     *  re-applied verbatim). */
    private fun reRead() {
        val root = rootPanel ?: return
        rebuildDiffPane(root)
        staleWarn?.text = ""
    }

    /** SEC-17b: an ALLOW against a file that changed on disk since the diff
     *  was built is BLOCKED until the user explicitly re-reads (a silent
     *  approval could clobber newer content). Deny always resolves
     *  (fail-closed direction). */
    private fun attemptDecision(label: String) {
        if (DiffBridge.shouldBlockAllow(label, currentStale())) {
            staleWarn?.text = "⚠ changed on disk — Re-read file before allowing (Deny works)"
            return
        }
        decideAndClose(label)
    }

    private fun currentStale(): Boolean {
        if (file.payload.path.isBlank()) return false
        return runCatching {
            val vf = resolveVirtualFile(proj, file.payload) ?: return false
            DiffBridge.isStale(leftText, readCurrentText(vf))
        }.getOrDefault(false)
    }

    /**
     * The value sent over the bridge: the bare safeguard [label] when the user
     * didn't edit, or `{label, oldFull, newFull}` when they did (read back from
     * the editable right pane). safeguard mutates pi's tool input with the
     * edited text so pi applies the user's version.
     *
     * U6 C11 (FR-40): when the user EDITED while the file changed on disk
     * (leftText no longer matches the current document), the object carries
     * `conflict: true` so the webui can warn that the base may be stale. An
     * edit-less decision ships the bare label — pi's own edit tool re-reads the
     * file and applies its conflict handling.
     */
    private fun resolveValue(label: String): Any {
        val edited = rightContent?.document?.text
        val conflict =
            file.payload.path.isNotBlank() &&
                runCatching {
                    val vf = resolveVirtualFile(proj, file.payload)
                    vf != null && readCurrentText(vf) != leftText
                }.getOrDefault(false)
        return when {
            edited != null && edited != origRight -> {
                mapOf("label" to label, "oldFull" to leftText, "newFull" to edited, "conflict" to conflict)
            }

            else -> {
                label
            }
        }
    }

    /** Record the decision (idempotent — resolves the JS promise once), then close this tab. */
    private fun decideAndClose(label: String) {
        file.decide(resolveValue(label))
        FileEditorManager.getInstance(proj).closeFile(file)
    }

    override fun getComponent(): JComponent = built ?: build().also { built = it }

    override fun getPreferredFocusedComponent(): JComponent? = built

    override fun getName(): String = file.payload.filename + " (pi change)"

    override fun setState(state: FileEditorState) {}

    override fun isModified(): Boolean = false

    override fun isValid(): Boolean = true

    override fun addPropertyChangeListener(listener: PropertyChangeListener) {}

    override fun removePropertyChangeListener(listener: PropertyChangeListener) {}

    override fun dispose() {
        file.decide(DENY) // fail-closed if not already decided (tab ✕ / session close)
        Disposer.dispose(diffDisp) // tears down the embedded diff panel
    }

    companion object {
        const val ALLOW_ONCE = "Allow once"
        const val ALLOW_SESSION = "Allow for this session"
        const val ALLOW_ALWAYS = "Allow always (save to config)"
        const val DENY = "Deny"
    }
}

/**
 * In-memory file that carries the diff payload + a decision callback to the
 * bridge. Short-lived: open only while the review tab is shown, GC'd on close.
 * // ponytail: callback lives on the VirtualFile — fewer moving parts than a
 * // side-registry keyed by file identity.
 */
class DiffReviewFile(
    val payload: DiffPayload,
    private val onDecide: (Any) -> Unit,
) : LightVirtualFile(payload.filename + " — pi change") {
    // U6 C11 (FR-39): the broker identity rides the payload so resolvers can
    // key decisions by request id; the webui adds the marker ({v, toolCallId,
    // decision}) to the extension_ui_response — the broker validates there.
    val requestId: String get() = payload.requestId
    val toolCallId: String get() = payload.toolCallId

    private val decided = AtomicBoolean(false)

    /**
     * Idempotent + race-free (SEC-17c): the FIRST decision wins; later calls
     * (dispose→Deny, double-click racing dispose) are ignored via atomic
     * compare-and-set — exactly one [onDecide] invocation ever.
     * [value] is normally a safeguard label String, or a `{label, oldFull, newFull}` Map when the
     * user EDITED pi's proposal in the diff (safeguard feeds it back via event.input mutation).
     */
    fun decide(value: Any) {
        if (!decided.compareAndSet(false, true)) return
        onDecide(value)
    }
}

/**
 * Claims [DiffReviewFile]s and renders them with [DiffReviewEditor].
 * [FileEditorPolicy.HIDE_DEFAULT_EDITOR] keeps the text editor off our tab, and
 * [DumbAware] keeps the gate working during indexing (otherwise openFile would
 * be skipped → the JS promise would hang → pi's approval latch stalls).
 */
class DiffReviewEditorProvider :
    FileEditorProvider,
    DumbAware {
    override fun accept(
        project: Project,
        file: VirtualFile,
    ): Boolean = file is DiffReviewFile

    override fun createEditor(
        project: Project,
        file: VirtualFile,
    ): FileEditor = DiffReviewEditor(project, file as DiffReviewFile)

    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR

    override fun getEditorTypeId(): String = "pi-webui-diff-review"
}

// ---- diff content resolution ----

private data class Resolved(
    val left: String,
    val right: String,
    val type: FileType,
)

private fun resolveContents(
    proj: Project,
    payload: DiffPayload,
): Resolved {
    val vf = resolveVirtualFile(proj, payload)
    if (vf != null) {
        val left = readCurrentText(vf)
        val right =
            when (payload.op) {
                "write" -> payload.content
                "edit" -> applyEdits(left, payload.edits)
                else -> payload.rightText
            }
        return Resolved(left, right, vf.fileType)
    }
    return Resolved(payload.leftText, payload.rightText, FileTypes.PLAIN_TEXT)
}

private fun resolveVirtualFile(
    proj: Project,
    payload: DiffPayload,
): VirtualFile? {
    val raw = payload.path.takeIf { it.isNotBlank() } ?: return null
    val base = proj.basePath ?: return null
    val io = java.io.File(raw)
    val candidate = if (io.isAbsolute) io else java.io.File(base, raw)
    // U6 C11 (FR-38): canonical containment — after symlink/.. resolution the
    // target must live under the project root. Outside → null: no IDE-filesystem
    // read of out-of-project files; resolveContents falls back to the webui's
    // own payload text (the webui diff remains the gate for those).
    if (!WorkspaceContainment.isInside(java.io.File(base), candidate)) return null
    return LocalFileSystem.getInstance().findFileByIoFile(candidate)
}

/** Open editor's text (unsaved edits included) when loaded; else VFS content. */
private fun readCurrentText(vf: VirtualFile): String = FileDocumentManager.getInstance().getDocument(vf)?.text ?: VfsUtil.loadText(vf) ?: ""

/** Mirror app.js: first-occurrence replace per hunk (display-only preview). */
private fun applyEdits(
    text: String,
    edits: List<EditHunk>,
): String {
    var t = text
    for (e in edits) t = t.replaceFirst(e.oldText, e.newText)
    return t
}
