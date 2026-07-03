package com.gorowynn.piwebui

import com.intellij.diff.DiffManager
import com.intellij.diff.contents.DiffContent
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import java.awt.event.ActionEvent
import javax.swing.AbstractAction
import javax.swing.Action
import javax.swing.JComponent
import javax.swing.JLabel

/**
 * The IDE-side approval gate for edit/write: opens the proposed change in the
 * native JetBrains diff viewer, then a 4-button dialog for the decision. The
 * chosen button's label is returned and posted by the webui via
 * extension_ui_response — these strings are a wire contract with safeguard.ts
 * and must match EXACTLY:
 *   "Allow once" / "Allow for this session" / "Allow always (save to config)" / "Deny"
 *
 * Closing the window any other way (Esc, X) defaults to "Deny" (fail-closed),
 * matching safeguard's null/Esc handling.
 *
 * Uses the rock-solid DiffManager.showDiff() + a button DialogWrapper. Single-
 * window embedding (DiffManager.createRequestPanel(...) holding the diff AND the
 * buttons) is a follow-up — same contents + buttons, nicer frame.
 */
class DiffApprovalDialog(
    private val proj: Project,
    private val payload: DiffPayload,
) : DialogWrapper(proj) {

    private var decision: String = DENY

    init {
        title = "Approve change — ${payload.filename}"
        init()
    }

    override fun createCenterPanel(): JComponent =
        JLabel("Review the change in the diff window, then choose an option below.")

    override fun createActions(): Array<Action> = arrayOf(
        decisionAction(ALLOW_ONCE),
        decisionAction(ALLOW_SESSION),
        decisionAction(ALLOW_ALWAYS),
        decisionAction(DENY),
    )

    private fun decisionAction(value: String) = object : AbstractAction(value) {
        override fun actionPerformed(e: ActionEvent) {
            decision = value
            close(OK_EXIT_CODE)
        }
    }

    /** Opens the diff viewer, then the decision dialog; returns the chosen label. */
    fun open(): String {
        // DiffContentFactory lives in com.intellij.diff (NOT .contents) — that
        // package mismatch was the build break. create(String) → read-only text.
        val factory = DiffContentFactory.getInstance()
        val left: DiffContent = factory.create(payload.leftText)
        val right: DiffContent = factory.create(payload.rightText)
        DiffManager.getInstance().showDiff(
            proj,
            SimpleDiffRequest(
                title,
                listOf(left, right),
                listOf("Current (on disk)", "Proposed (from pi)"),
            ),
        )
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
