package com.gorowynn.piwebui

import com.google.gson.Gson
import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.SimpleToolWindowPanel
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import javax.swing.JLabel

class PiWebuiToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = SimpleToolWindowPanel(/* vertical = */ true, /* borderless = */ true)
        val url = PiWebuiSettings.url
        val content = ContentFactory.getInstance().createContent(panel, "", /* isLockable = */ false)

        if (!JBCefApp.isSupported()) {
            panel.setContent(JLabel("JCEF unavailable in this runtime. Open $url in a browser."))
            toolWindow.contentManager.addContent(content)
            return
        }

        val browser = JBCefBrowser()
        browser.loadURL(url)
        panel.setContent(browser.component)
        content.setDisposer(browser)

        wireDiffBridge(project, browser)
        toolWindow.contentManager.addContent(content)
    }

    /** JS↔Kotlin bridge: app.js calls window.piWebuiOpenDiff(payload) → Promise<String>;
     *  we open the IDE's native diff as the approval gate and resolve with one of
     *  safeguard's option labels. The webui posts that label via
     *  extension_ui_response, so safeguard.ts (the security gate) is untouched. */
    private fun wireDiffBridge(project: Project, browser: JBCefBrowser) {
        val openDiff = JBCefJSQuery.create(browser)
        // IDE identity for the webui's "ide connected" badge (read on EDT here;
        // reused on every onLoadEnd inject — ApplicationInfo won't change).
        val app = ApplicationInfo.getInstance()
        val ideName = Gson().toJson(app.versionName)
        val ideVer = Gson().toJson(app.fullVersion)
        openDiff.addHandler { json: String ->
            // runs on the CEF thread → open the modal on the EDT, then resolve the
            // promise asynchronously (no blocking the CEF message thread).
            ApplicationManager.getApplication().invokeLater {
                val decision = try {
                    val payload = try {
                        Gson().fromJson(json, DiffPayload::class.java)
                    } catch (_: Exception) {
                        DiffPayload()
                    }
                    DiffApprovalDialog(project, payload).open()
                } catch (e: Exception) {
                    // Fail-closed: never leave the JS promise pending (that would
                    // hang app.js's await → pi's approval latch). Resolve as Deny.
                    DiffApprovalDialog.DENY
                }
                val js = "window.__piDiffResolve(" + Gson().toJson(decision) + ");"
                browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url, 0)
            }
            null
        }

        // page-context functions are wiped on each navigation, so re-inject on load
        // end. (The cefQuery binding that JBCefJSQuery.inject emits persists across
        // loads; only our wrapper function needs re-installing.) JBCefBrowser →
        // JBCefClient → raw CefClient; addLoadHandler hooks onLoadEnd for the inject.
        browser.jbCefClient.cefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(b: CefBrowser?, frame: CefFrame?, httpStatusCode: Int) {
                val inject = """
                    window.piWebuiIdeInfo = { name: $ideName, version: $ideVer };
                    if (window.piWebuiIdeStatus) window.piWebuiIdeStatus(window.piWebuiIdeInfo);
                    window.piWebuiOpenDiff = function(payload) {
                      return new Promise(function(resolve) {
                        window.__piDiffResolve = resolve;
                        ${openDiff.inject("JSON.stringify(payload)")};
                      });
                    };
                """.trimIndent()
                b?.executeJavaScript(inject, b.url, 0)
            }
        })
        // ponytail: TODO dispose `openDiff` and remove this load handler on tool-window
        // close (both currently outlive the browser — fine for one long-lived window).
    }
}

/** Payload sent from app.js across the bridge. Gson is bundled in the IntelliJ
 *  Platform (lib/gson-*.jar); if your Gradle run doesn't expose it, add
 *  `implementation("com.google.code.gson:gson:2.10.1")` to dependencies.
 *
 *  `path`+`op`+`edits`/`content` let the dialog build a REAL diff against the
 *  IDE's file (syntax highlighting via FileType + the open editor's current
 *  text). `leftText`/`rightText` are the app.js fallback (server.js /api/file)
 *  for paths not under the project. */
data class DiffPayload(
    var filename: String = "change",
    var path: String = "",
    var op: String = "", // "edit" | "write"
    var edits: List<EditHunk> = emptyList(),
    var content: String = "",
    var leftText: String = "",
    var rightText: String = "",
)

data class EditHunk(var oldText: String = "", var newText: String = "")
