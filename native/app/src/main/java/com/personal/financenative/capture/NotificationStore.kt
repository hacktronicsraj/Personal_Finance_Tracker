package com.personal.financenative.capture

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class NotifItem(val pkg: String, val app: String, val title: String, val text: String, val time: Long)

/** A capped, on-device ring buffer of recent notifications (deep-tracking data). */
object NotificationStore {
    private const val PREFS = "notif_capture"
    private const val KEY = "items"
    private const val CAP = 200
    private val json = Json { ignoreUnknownKeys = true }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun add(context: Context, item: NotifItem) {
        val list = all(context).toMutableList()
        list.add(0, item)
        while (list.size > CAP) list.removeAt(list.size - 1)
        prefs(context).edit().putString(KEY, json.encodeToString(list)).apply()
    }

    fun all(context: Context): List<NotifItem> {
        val raw = prefs(context).getString(KEY, null) ?: return emptyList()
        return runCatching { json.decodeFromString<List<NotifItem>>(raw) }.getOrDefault(emptyList())
    }
}
