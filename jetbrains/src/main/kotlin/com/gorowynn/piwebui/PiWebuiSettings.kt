package com.gorowynn.piwebui

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

/** Persisted single setting: the webui base URL. Registered in plugin.xml. */
@State(name = "PiWebuiSettings", storages = [Storage("pi-webui.xml")])
class PiWebuiSettings : PersistentStateComponent<PiWebuiSettings.State> {
    data class State(var url: String = "http://127.0.0.1:4317")

    private var myState = State()
    override fun getState(): State = myState
    override fun loadState(state: State) { myState = state }

    companion object {
        val url: String
            get() = ApplicationManager.getApplication()
                .getService(PiWebuiSettings::class.java).state.url
    }
}
