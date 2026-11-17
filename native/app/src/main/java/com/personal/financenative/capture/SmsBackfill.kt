package com.personal.financenative.capture

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony
import com.personal.financenative.FinanceApp
import com.personal.financenative.data.api.ClassifyRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import kotlin.math.absoluteValue

/**
 * Catches up on bank SMS the live [SmsReceiver] missed: no permission yet, no
 * network, or the app wasn't running. Reads the inbox since the last message
 * handled and sends each debit through the same classify call, with the same
 * dedupe key as the receiver, so nothing is stored twice.
 *
 * Runs whenever the app opens. Stops at the first network failure and keeps
 * its place, so the rest is retried next time.
 */
object SmsBackfill {
    private const val PREFS = "sms_backfill"
    private const val KEY_LAST = "lastMs"

    /** First run: just after the last SMS the old app captured (2026-11-11 15:48 UTC). */
    private const val FIRST_RUN_FROM_MS = 1_794_412_080_000L

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()

    fun hasPermission(context: Context): Boolean =
        context.checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED

    fun runAsync(context: Context) {
        val app = context.applicationContext
        if (!hasPermission(app)) return
        scope.launch { lock.withLock { run(app) } }
    }

    private suspend fun run(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        var last = prefs.getLong(KEY_LAST, FIRST_RUN_FROM_MS)
        val repo = (context as FinanceApp).container.repository

        val rows = ArrayList<Triple<Long, String?, String>>()
        context.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            arrayOf(Telephony.Sms.DATE, Telephony.Sms.ADDRESS, Telephony.Sms.BODY),
            "${Telephony.Sms.DATE} > ?",
            arrayOf(last.toString()),
            "${Telephony.Sms.DATE} ASC",
        )?.use { c ->
            while (c.moveToNext()) {
                val body = c.getString(2)?.trim().orEmpty()
                if (body.isNotEmpty()) rows += Triple(c.getLong(0), c.getString(1), body)
            }
        }

        for ((date, sender, body) in rows) {
            val parsed = SmsParser.parse(body, sender)
            if (parsed != null) {
                val key = "sms:${sender ?: ""}:${parsed.amount}:${body.hashCode().absoluteValue}"
                val ok = runCatching {
                    repo.classify(
                        ClassifyRequest(
                            parsed = parsed.copy(occurredAt = Instant.ofEpochMilli(date).toString()),
                            dedupeKey = key,
                            source = "sms",
                        ),
                    )
                }.isSuccess
                if (!ok) break // offline: keep our place, retry next open
            }
            last = date
            prefs.edit().putLong(KEY_LAST, last).apply()
        }
    }
}
