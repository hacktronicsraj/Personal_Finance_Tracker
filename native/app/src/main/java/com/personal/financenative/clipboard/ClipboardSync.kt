package com.personal.financenative.clipboard

import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import com.personal.financenative.data.FinanceRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import java.util.UUID

/**
 * Phone → Mac clipboard sending, shared by the Clipboard screen and the
 * "Send to Mac" Quick Settings tile so both use one device id and one
 * "already sent" memory.
 */
object ClipboardSync {
    /** Outlives the invisible activity the tile opens, so a send isn't cut off when it closes. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences("clipboard", Context.MODE_PRIVATE)

    fun deviceId(context: Context): String {
        val p = prefs(context)
        return p.getString("deviceId", null)
            ?: ("phone-" + UUID.randomUUID().toString().take(8)).also { p.edit().putString("deviceId", it).apply() }
    }

    val deviceName: String get() = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"

    /** The last text this phone sent or took from the list, so neither is sent back. */
    fun lastSeen(context: Context): String? = prefs(context).getString("lastSeenText", null)
    fun markSeen(context: Context, text: String) = prefs(context).edit().putString("lastSeenText", text.trim()).apply()

    /** Reads the clipboard. Only works while one of this app's windows has focus. */
    fun readText(context: Context): String? {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        return runCatching {
            cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
        }.getOrNull()?.trim()?.takeIf { it.isNotEmpty() }
    }

    enum class Result { SENT, ALREADY_SENT, EMPTY, FAILED }

    /** Sends [text] to the Mac. Without [force], text already sent or taken from the list is skipped. */
    suspend fun send(context: Context, repo: FinanceRepository, text: String?, force: Boolean = false): Result {
        val t = text?.trim().orEmpty()
        if (t.isEmpty()) return Result.EMPTY
        if (!force && t == lastSeen(context)) return Result.ALREADY_SENT
        val ok = runCatching { repo.pushClip(t, deviceId(context), deviceName) }.isSuccess
        if (ok) markSeen(context, t)
        return if (ok) Result.SENT else Result.FAILED
    }
}
