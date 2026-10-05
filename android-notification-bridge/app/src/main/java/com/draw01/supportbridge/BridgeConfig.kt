package com.draw01.supportbridge

import android.content.Context

object BridgeConfig {
    const val PREFS = "draw01_support_bridge"
    const val KEY_TOKEN = "device_token"
    const val KEY_ENABLED = "bridge_enabled"
    const val KEY_SOURCE_APP = "source_app"
    const val KEY_LAST_RESULT = "last_result"

    fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun token(context: Context): String = prefs(context).getString(KEY_TOKEN, "")?.trim().orEmpty()
    fun enabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, false)
    fun sourceApp(context: Context): String = prefs(context).getString(KEY_SOURCE_APP, "com.google.android.apps.messaging").orEmpty()
}
