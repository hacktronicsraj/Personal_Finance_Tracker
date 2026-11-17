package com.personal.financenative.focus

import android.content.Context
import android.content.Intent
import android.provider.Settings

/** Bridges the gate state, permissions, and Instagram control for UI + services. */
class FocusController(private val context: Context) {
    private val app = context.applicationContext
    private val prefs = FocusPrefs(app)

    fun usedMinutesToday(): Int = UsageStatsReader.minutesToday(app, Gate.INSTAGRAM_PKG)

    /** Instagram minutes since the last cleared checkpoint — across days. */
    fun usedSinceCheckpoint(): Int =
        UsageStatsReader.minutesSince(app, Gate.INSTAGRAM_PKG, prefs.lastCheckpointMs)

    fun currentDecision(): Gate.Decision = Gate.decide(usedSinceCheckpoint())

    /** The user cleared a checkpoint: count it, restart the clock, open Instagram. */
    fun clearCheckpointAndLaunchInstagram() {
        prefs.clearedToday = prefs.clearedToday + 1
        prefs.lastCheckpointMs = System.currentTimeMillis()
        launchInstagram()
    }

    fun launchInstagram() {
        val i = app.packageManager.getLaunchIntentForPackage(Gate.INSTAGRAM_PKG)
        if (i != null) {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            app.startActivity(i)
        }
    }

    fun goHome() {
        val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        app.startActivity(i)
    }

    /* ── Permissions & status ── */

    fun canDrawOverlays(): Boolean = Settings.canDrawOverlays(app)

    /** Starts the gate watcher if both permissions are granted. */
    fun startWatcher() = GateWatchService.start(app)

    fun hasUsageAccess(): Boolean = UsageStatsReader.hasPermission(app)

    fun openOverlaySettings() {
        app.startActivity(
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, android.net.Uri.parse("package:" + app.packageName))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
    fun openUsageAccessSettings() = startSettings(Settings.ACTION_USAGE_ACCESS_SETTINGS)

    private fun startSettings(action: String) {
        app.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
