package com.personal.financenative.capture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.personal.financenative.FinanceApp
import com.personal.financenative.data.api.ClassifyRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlin.math.absoluteValue

/**
 * Live bank/UPI SMS → ledger. Parses the message on-device and posts it to the
 * backend for classification + storage (debit-only; credits/Groww dropped there).
 */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        val body = messages.joinToString("") { it.displayMessageBody ?: "" }.trim()
        val sender = messages.firstOrNull()?.displayOriginatingAddress
        if (body.isEmpty()) return

        val parsed = SmsParser.parse(body, sender) ?: return
        val repo = (context.applicationContext as FinanceApp).container.repository
        val dedupeKey = "sms:${sender ?: ""}:${parsed.amount}:${body.hashCode().absoluteValue}"

        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                repo.classify(ClassifyRequest(parsed = parsed, dedupeKey = dedupeKey, source = "sms"))
            } catch (_: Exception) {
                // offline / transient — the SMS is lost for now; live capture only
            } finally {
                pending.finish()
            }
        }
    }
}
