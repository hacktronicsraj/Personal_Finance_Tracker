package com.personal.financenative

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.personal.financenative.focus.FocusController
import com.personal.financenative.focus.Gate
import com.personal.financenative.ui.screens.GateScreen
import com.personal.financenative.ui.theme.FinanceTheme

/**
 * Full-screen gate shown over Instagram by GateWatchService. Clearing the
 * flashcards grants the checkpoint and reopens Instagram; cancelling goes home.
 */
class GateActivity : ComponentActivity() {
    companion object {
        const val EXTRA_REASON = "reason"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val controller = FocusController(this)
        val reason = runCatching { Gate.Reason.valueOf(intent.getStringExtra(EXTRA_REASON) ?: "") }
            .getOrDefault(controller.currentDecision().reason)
        val repo = (application as FinanceApp).container.repository

        setContent {
            FinanceTheme {
                GateScreen(
                    reason = reason,
                    repo = repo,
                    onPass = { controller.clearCheckpointAndLaunchInstagram(); finish() },
                    onCancel = { controller.goHome(); finish() },
                )
            }
        }
    }
}
