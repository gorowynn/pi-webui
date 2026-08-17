package com.gorowynn.piwebui

import com.google.gson.Gson
import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.SimpleToolWindowPanel
import com.intellij.openapi.util.Disposer
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
    override fun createToolWindowContent(
        project: Project,
        toolWindow: ToolWindow,
    ) {
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

        wireDiffBridge(project, browser, content)
        toolWindow.contentManager.addContent(content)
    }

    /** JS↔Kotlin bridge: app.js calls window.piWebuiOpenDiff(payload) → Promise<String>;
     *  we open the IDE's native diff as the approval gate and resolve with one of
     *  safeguard's option labels. The webui posts that label via
     *  extension_ui_response, so safeguard.ts (the security gate) is untouched. */
    private fun wireDiffBridge(
        project: Project,
        browser: JBCefBrowser,
        content: com.intellij.ui.content.Content,
    ) {
        val openDiff = JBCefJSQuery.create(browser)
        // IDE identity for the webui's "ide connected" badge (read on EDT here;
        // reused on every onLoadEnd inject — ApplicationInfo won't change).
        val app = ApplicationInfo.getInstance()
        val ideName = Gson().toJson(app.versionName)
        val ideVer = Gson().toJson(app.fullVersion)

        // REL-24b: one parent disposable owns the whole bridge — the JS query,
        // the load handler, and the browser. The tool-window content's disposer
        // fires on tool-window close → everything below is released (previously
        // the query + handler outlived the browser).
        val bridgeDisp = Disposer.newDisposable("pi-webui-diff-bridge")
        Disposer.register(bridgeDisp, openDiff)

        openDiff.addHandler { json: String ->
            // runs on the CEF thread → open the editor tab on the EDT; the JS
            // promise resolves later, from the editor's decision callback (or
            // fail-closed Deny on tab close / open error). Never left pending.
            ApplicationManager.getApplication().invokeLater {
                val resolveJs = { id: String, value: Any ->
                    val js = DiffBridge.composeResolveCall(id, value)
                    runCatching { browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url, 0) }
                }
                // SEC-17a: malformed bridge JSON fails CLOSED — no editor tab,
                // immediate Deny (never an empty DiffPayload the user could
                // approve against nothing). "malformed" keys no resolver — a
                // garbage cefQuery never registered a promise, so no-op is right.
                val payload = DiffBridge.parsePayload(json)
                if (payload == null) {
                    resolveJs("malformed", DiffReviewEditor.DENY)
                    return@invokeLater
                }
                // REL-24a: resolve through the page's id-keyed resolver map. The
                // page assigns payload.requestId itself when absent (before
                // stringify), so both ends always agree on the id.
                val resolveId = payload.requestId
                try {
                    val onDecide: (Any) -> Unit = { value -> resolveJs(resolveId, value) }
                    val file = DiffReviewFile(payload, onDecide)
                    FileEditorManager.getInstance(project).openFile(file, /* focusEditor = */ true)
                } catch (_: Exception) {
                    // Fail-closed: never leave the JS promise pending (that would
                    // hang app.js's await → pi's approval latch).
                    resolveJs(resolveId, DiffReviewEditor.DENY)
                }
            }
            null
        }

        // page-context functions are wiped on each navigation, so re-inject on load
        // end. (The cefQuery binding that JBCefJSQuery.inject emits persists across
        // loads; only our wrapper function needs re-installing.) JBCefBrowser →
        // JBCefClient → raw CefClient; addLoadHandler hooks onLoadEnd for the inject.
        val loadHandler =
            object : CefLoadHandlerAdapter() {
                override fun onLoadEnd(
                    b: CefBrowser?,
                    frame: CefFrame?,
                    httpStatusCode: Int,
                ) {
                    val inject =
                        """
                        window.piWebuiIdeInfo = { name: $ideName, version: $ideVer };
                        if (window.piWebuiIdeStatus) window.piWebuiIdeStatus(window.piWebuiIdeInfo);
                        window.__piDiffResolvers = window.__piDiffResolvers || {};
                        window.__piDiffResolve = function(id, value) {
                          var r = window.__piDiffResolvers[id];
                          if (r) { delete window.__piDiffResolvers[id]; r(value); }
                        };
                        window.piWebuiOpenDiff = function(payload) {
                          return new Promise(function(resolve) {
                            if (!payload || !payload.requestId) {
                              payload = Object.assign({}, payload, { requestId: "diff-" + Math.random().toString(36).slice(2) });
                            }
                            window.__piDiffResolvers[payload.requestId] = resolve;
                            ${openDiff.inject("JSON.stringify(payload)")};
                          });
                        };
                        """.trimIndent()
                    b?.executeJavaScript(inject, b.url, 0)
                }
            }
        browser.jbCefClient.cefClient.addLoadHandler(loadHandler)
        // REL-24b: remove the load handler BEFORE the browser goes away
        // (registration order guarantees this child disposes first).
        Disposer.register(bridgeDisp) {
            runCatching { browser.jbCefClient.cefClient.removeLoadHandler() }
        }
        Disposer.register(bridgeDisp, browser)
        content.setDisposer(bridgeDisp)
    }
}
