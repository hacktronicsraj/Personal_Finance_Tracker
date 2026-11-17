package com.personal.financenative

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.personal.financenative.capture.ShareBus
import com.personal.financenative.ui.AppScaffold
import com.personal.financenative.ui.theme.FinanceTheme

class MainActivity : ComponentActivity() {
    companion object {
        const val ACTION_OPEN_STATEMENT = "com.personal.financenative.OPEN_STATEMENT"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        handleShare(intent)
        com.personal.financenative.focus.GateWatchService.start(this)
        askForSmsOnce()
        val repo = (application as FinanceApp).container.repository
        setContent {
            FinanceTheme {
                AppScaffold(repo)
            }
        }
    }

    private val smsPermission = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions(),
    ) { com.personal.financenative.capture.SmsBackfill.runAsync(this) }

    /** Bank SMS capture needs these; ask once per install rather than on every open. */
    private fun askForSmsOnce() {
        if (com.personal.financenative.capture.SmsBackfill.hasPermission(this)) return
        val p = getSharedPreferences("sms_backfill", MODE_PRIVATE)
        if (p.getBoolean("asked", false)) return
        p.edit().putBoolean("asked", true).apply()
        smsPermission.launch(arrayOf(android.Manifest.permission.RECEIVE_SMS, android.Manifest.permission.READ_SMS))
    }

    override fun onResume() {
        super.onResume()
        // Catch up on bank SMS the live receiver missed.
        com.personal.financenative.capture.SmsBackfill.runAsync(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleShare(intent)
    }

    /** A shared ChatGPT link → flashcards; a PDF → statement reconcile; other text → a spend. */
    private fun handleShare(intent: Intent?) {
        if (intent?.action == ACTION_OPEN_STATEMENT) { ShareBus.openStatement.value = true; return }
        if (intent?.action != Intent.ACTION_SEND) return
        when {
            intent.type == "text/plain" -> ShareBus.offerText(intent.getStringExtra(Intent.EXTRA_TEXT))
            intent.type == "application/pdf" -> {
                val uri: Uri? =
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                        intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                    else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
                ShareBus.offerPdf(uri?.toString())
            }
        }
    }
}
