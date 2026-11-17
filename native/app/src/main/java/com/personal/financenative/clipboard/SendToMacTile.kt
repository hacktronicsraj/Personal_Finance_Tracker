package com.personal.financenative.clipboard

import android.annotation.SuppressLint
import android.app.Activity
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.widget.Toast
import com.personal.financenative.FinanceApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Quick Settings tile: copy something, pull down the shade, tap "Send to Mac".
 *
 * A tile can't read the clipboard itself (Android only allows the focused
 * app), so it opens [SendToMacActivity], an invisible window that reads the
 * clipboard the moment it gains focus, hands the send off and closes.
 */
class SendToMacTileService : TileService() {
    override fun onStartListening() {
        qsTile?.apply { state = Tile.STATE_INACTIVE; updateTile() }
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    override fun onClick() {
        val intent = Intent(this, SendToMacActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val launch = {
            if (Build.VERSION.SDK_INT >= 34) {
                startActivityAndCollapse(
                    PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
                )
            } else {
                @Suppress("DEPRECATION") startActivityAndCollapse(intent)
            }
        }
        if (isLocked) unlockAndRun(launch) else launch()
    }
}

class SendToMacActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private var done = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // If focus never arrives, don't leave an invisible window in the way.
        handler.postDelayed({ finishWith(null) }, 2_000)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) finishWith(ClipboardSync.readText(this))
    }

    private fun finishWith(text: String?) {
        if (done) return
        done = true
        handler.removeCallbacksAndMessages(null)
        val app = applicationContext
        if (text == null) {
            Toast.makeText(app, "Clipboard is empty", Toast.LENGTH_SHORT).show()
        } else {
            val repo = (application as FinanceApp).container.repository
            ClipboardSync.scope.launch {
                // The tile is an explicit "send this", so resend even if it was sent before.
                val result = ClipboardSync.send(app, repo, text, force = true)
                withContext(Dispatchers.Main) {
                    Toast.makeText(
                        app,
                        if (result == ClipboardSync.Result.SENT) "Sent to Mac" else "Couldn't reach the server",
                        Toast.LENGTH_SHORT,
                    ).show()
                }
            }
        }
        finish()
        @Suppress("DEPRECATION") overridePendingTransition(0, 0)
    }
}
