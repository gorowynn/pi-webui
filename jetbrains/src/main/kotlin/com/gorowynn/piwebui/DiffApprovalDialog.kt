package com.gorowynn.piwebui

import com.intellij.diff.DiffContentFactory
import com.intellij.diff.DiffManager
import com.intellij.diff.DiffRequestPanel
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.fileTypes.FileTypes
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VfsUtil
import com.intellij.openapi.vfs.VirtualFile
import java.awt.Dimension
import java.awt.event.ActionEvent
import javax.swing.AbstractAction
import javax.swing.Action
import javax.swing.JComponent

/**
 * The IDE-side approval gate for edit/write: the proposed change is shown in
 * the NATIVE JetBrains diff viewer, EMBEDDED as this dialog's center panel, with
 * the 4 safeguard decision buttons in the dialog's bottom action bar — ONE
 * window, so the buttons never sit on top of (and block) the diff, and a
 * decision closes the whole dialog (diff included). This replaced an earlier
 * two-window design (showDiff() modal + a button DialogWrapper) that blocked
 * scrolling and left the diff window open after a decision.
 *
 * The chosen button's label is posted by the webui via extension_ui_response —
 * these strings are a wire contract with safeguard.ts and must match EXACTLY:
 *   "Allow once" / "Allow for this session" / "Allow always (save to config)" / "Deny"
 *
 * Closing any other way (Esc, X) defaults to "Deny" (fail-closed), matching
 * safeguard's null/Esc handling.
 */
class DiffApprovalDialog(
    private val proj: Project,
    private val payload: DiffPayload,
) : DialogWrapper(proj) {

    private var decision: String = DENY
    private val parentDisp = Disposer.newDisposable()

    init {
        title = "Approve change — ${payload.filename}"
        init()
    }

    override fun createCenterPanel(): JComponent {
        val factory = DiffContentFactory.getInstance()
        val (leftText, rightText, fileType) = resolveContents()
        val request = SimpleDiffRequest(
            title,
            listOf(factory.create(proj, leftText, fileType), factory.create(proj, rightText, fileType)),
            listOf("Current", "Proposed (from pi)"),
        )
        // createRequestPanel(Project, Disposable parent, Window) — modern API,
        // no DiffContext. The panel is torn down via parentDisp in dispose().
        val panel: DiffRequestPanel =
            DiffManager.getInstance().createRequestPanel(proj, parentDisp, null)
        panel.setRequest(request)
        panel.component.preferredSize = Dimension(1000, 700)
        return panel.component
    }

    /**
     * Prefer the IDE's real file: reflects the open editor (incl. unsaved edits)
     * + the file's FileType for syntax highlighting. Falls back to the app.js-
     * provided text (server.js /api/file) when the path isn't under the project.
     */
    private fun resolveContents(): Triple<String, String, FileType> {
        val vf = resolveVirtualFile()
        if (vf != null) {
            val left = readCurrentText(vf)
            val right = when (payload.op) {
                "write" -> payload.content
                "edit" -> applyEdits(left, payload.edits)
                else -> payload.rightText
            }
            return Triple(left, right, vf.fileType)
        }
        return Triple(payload.leftText, payload.rightText, FileTypes.PLAIN_TEXT)
    }

    private fun resolveVirtualFile(): VirtualFile? {
        val raw = payload.path.takeIf { it.isNotBlank() } ?: return null
        val io = java.io.File(raw)
        val candidate = if (io.isAbsolute) io else {
            val base = proj.basePath ?: return null
            java.io.File(base, raw)
        }
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

    override fun createActions(): Array<Action> = arrayOf(
        decisionAction(ALLOW_ONCE),
        decisionAction(ALLOW_SESSION),
        decisionAction(ALLOW_ALWAYS),
        decisionAction(DENY),
    )

    private fun decisionAction(value: String) = object : AbstractAction(value) {
        override fun actionPerformed(e: ActionEvent) {
            decision = value
            close(OK_EXIT_CODE) // closes the whole dialog — diff + buttons together
        }
    }

    // Enter (→ doOKAction) must NOT implicitly approve: fail closed to Deny. The
    // only path to Allow is an explicit button click. Matches Esc / window-X.
    override fun doOKAction() {
        decision = DENY
        super.doOKAction()
    }

    override fun dispose() {
        Disposer.dispose(parentDisp) // tears down the embedded diff panel
        super.dispose()
    }

    fun open(): String {
        show()
        return decision
    }

    companion object {
        const val ALLOW_ONCE = "Allow once"
        const val ALLOW_SESSION = "Allow for this session"
        const val ALLOW_ALWAYS = "Allow always (save to config)"
        const val DENY = "Deny"
    }
}
