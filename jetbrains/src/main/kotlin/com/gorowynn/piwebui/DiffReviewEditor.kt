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
) : UserDataHolderBase(), FileEditor {

    private val diffDisp = Disposer.newDisposable()
    private var built: JComponent? = null

    // The right ("Proposed") pane is EDITABLE: the user can tweak pi's proposal
    // before approving. On decision we read it back and, if changed, ship the
    // full old/new text so safeguard can mutate pi's tool input (event.input)
    // and pi applies the EDITED version — keeping pi's context consistent.
    private var leftText: String = ""
    private var origRight: String = ""
    private var rightContent: DocumentContent? = null

    private fun build(): JComponent {
        val (left, right, fileType) = resolveContents(proj, file.payload)
        leftText = left
        origRight = right
        val factory = DiffContentFactory.getInstance()
        rightContent = factory.createEditable(proj, right, fileType) // editable right pane
        val request = SimpleDiffRequest(
            "Approve change — ${file.payload.filename}",
            listOf(factory.create(proj, left, fileType), rightContent!!),
            listOf("Current", "Proposed (from pi) — editable"),
        )
        val panel: DiffRequestPanel =
            DiffManager.getInstance().createRequestPanel(proj, diffDisp, null)
        panel.setRequest(request)
        panel.component.preferredSize = Dimension(1000, 700)

        val bar = JPanel(BorderLayout())
        bar.border = JBUI.Borders.empty(8)
        bar.add(JLabel("Approve pi's change to ${file.payload.filename}?"), BorderLayout.WEST)
        val buttons = JPanel()
        for (label in listOf(ALLOW_ONCE, ALLOW_SESSION, ALLOW_ALWAYS, DENY)) {
            buttons.add(JButton(object : AbstractAction(label) {
                override fun actionPerformed(e: ActionEvent) = decideAndClose(label)
            }))
        }
        bar.add(buttons, BorderLayout.EAST)

        val root = JPanel(BorderLayout())
        root.add(bar, BorderLayout.NORTH)
        root.add(panel.component, BorderLayout.CENTER)
        return root
    }

    /**
     * The value sent over the bridge: the bare safeguard [label] when the user
     * didn't edit, or `{label, oldFull, newFull}` when they did (read back from
     * the editable right pane). safeguard mutates pi's tool input with the
     * edited text so pi applies the user's version.
     */
    private fun resolveValue(label: String): Any {
        val edited = rightContent?.document?.text
        return if (edited != null && edited != origRight)
            mapOf("label" to label, "oldFull" to leftText, "newFull" to edited)
        else label
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

    @Volatile private var decided = false

    /**
     * Idempotent: the FIRST decision wins; later calls (dispose→Deny, double-click) are ignored.
     * [value] is normally a safeguard label String, or a `{label, oldFull, newFull}` Map when the
     * user EDITED pi's proposal in the diff (safeguard feeds it back via event.input mutation).
     */
    fun decide(value: Any) {
        if (decided) return
        decided = true
        onDecide(value)
    }
}

/**
 * Claims [DiffReviewFile]s and renders them with [DiffReviewEditor].
 * [FileEditorPolicy.HIDE_DEFAULT_EDITOR] keeps the text editor off our tab, and
 * [DumbAware] keeps the gate working during indexing (otherwise openFile would
 * be skipped → the JS promise would hang → pi's approval latch stalls).
 */
class DiffReviewEditorProvider : FileEditorProvider, DumbAware {
    override fun accept(project: Project, file: VirtualFile): Boolean = file is DiffReviewFile
    override fun createEditor(project: Project, file: VirtualFile): FileEditor =
        DiffReviewEditor(project, file as DiffReviewFile)
    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR
    override fun getEditorTypeId(): String = "pi-webui-diff-review"
}

// ---- diff content resolution ----

private data class Resolved(val left: String, val right: String, val type: FileType)

private fun resolveContents(proj: Project, payload: DiffPayload): Resolved {
    val vf = resolveVirtualFile(proj, payload)
    if (vf != null) {
        val left = readCurrentText(vf)
        val right = when (payload.op) {
            "write" -> payload.content
            "edit" -> applyEdits(left, payload.edits)
            else -> payload.rightText
        }
        return Resolved(left, right, vf.fileType)
    }
    return Resolved(payload.leftText, payload.rightText, FileTypes.PLAIN_TEXT)
}

private fun resolveVirtualFile(proj: Project, payload: DiffPayload): VirtualFile? {
    val raw = payload.path.takeIf { it.isNotBlank() } ?: return null
    val io = java.io.File(raw)
    val candidate = if (io.isAbsolute) io else java.io.File(proj.basePath ?: return null, raw)
    return LocalFileSystem.getInstance().findFileByIoFile(candidate)
}

/** Open editor's text (unsaved edits included) when loaded; else VFS content. */
private fun readCurrentText(vf: VirtualFile): String =
    FileDocumentManager.getInstance().getDocument(vf)?.text ?: VfsUtil.loadText(vf) ?: ""

/** Mirror app.js: first-occurrence replace per hunk (display-only preview). */
private fun applyEdits(text: String, edits: List<EditHunk>): String {
    var t = text
    for (e in edits) t = t.replaceFirst(e.oldText, e.newText)
    return t
}
