package com.personal.financenative.focus

import android.content.Context

/**
 * Gate state in SharedPreferences — the shared source of truth the watcher
 * service and the UI both read/write.
 *
 * The gate's state is a single moment: when the last checkpoint was cleared.
 * Instagram minutes are counted from then, with no daily reset. The cleared
 * counter is just a stat for the Focus screen and does roll at IST midnight.
 */
class FocusPrefs(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    companion object {
        const val PREFS = "focus_guard"
        private const val KEY_DAY = "day"
        private const val KEY_CLEARED = "cleared"
        private const val KEY_LAST_CHECKPOINT = "lastCheckpointMs"
    }

    /** Checkpoints cleared today; a new IST day resets it to 0. */
    var clearedToday: Int
        get() {
            if (prefs.getString(KEY_DAY, null) != Gate.istToday()) return 0
            return prefs.getInt(KEY_CLEARED, 0)
        }
        set(value) {
            prefs.edit().putString(KEY_DAY, Gate.istToday()).putInt(KEY_CLEARED, value).apply()
        }

    /**
     * When the last checkpoint was cleared (epoch ms). First run after the
     * upgrade from the per-day counter starts the count now.
     */
    var lastCheckpointMs: Long
        get() {
            val v = prefs.getLong(KEY_LAST_CHECKPOINT, 0L)
            if (v > 0L) return v
            val now = System.currentTimeMillis()
            prefs.edit().putLong(KEY_LAST_CHECKPOINT, now).apply()
            return now
        }
        set(value) {
            prefs.edit().putLong(KEY_LAST_CHECKPOINT, value).apply()
        }
}
