package com.personal.financenative.focus

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.personal.financenative.FinanceApp
import com.personal.financenative.data.FinanceRepository
import com.personal.financenative.data.api.UsageSessionIn
import java.util.concurrent.TimeUnit

/**
 * Uploads Instagram sessions to the server, where they're kept for good
 * (Android drops its raw events after about a week). Runs hourly and whenever
 * the history screen opens. Re-sending a session is harmless server-side.
 */
object UsageSync {
    private const val PREFS = "usage_sync"
    private const val KEY_LAST = "lastSyncMs"
    /** Re-read this far behind the last upload so a session open at the time gets its real end. */
    private const val OVERLAP_MS = 6 * 3_600_000L
    /** First upload: everything Android still has. */
    private const val FIRST_LOOKBACK_MS = 30L * 86_400_000L

    suspend fun sync(context: Context, repo: FinanceRepository): Boolean {
        if (!UsageStatsReader.hasPermission(context)) return false
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val last = prefs.getLong(KEY_LAST, 0L)
        val from = if (last == 0L) now - FIRST_LOOKBACK_MS else last - OVERLAP_MS
        val sessions = UsageStatsReader.sessions(context, Gate.INSTAGRAM_PKG, from)
            .map { UsageSessionIn(Gate.INSTAGRAM_PKG, it[0], it[1]) }
        val ok = runCatching {
            sessions.chunked(200).forEach { repo.uploadUsage(it) }
        }.isSuccess
        if (ok) prefs.edit().putLong(KEY_LAST, now).apply()
        return ok
    }

    fun schedule(context: Context) {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "usage-sync", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<UsageSyncWorker>(1, TimeUnit.HOURS).build(),
        )
    }
}

class UsageSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        // No usage access: nothing to send, and retrying won't change that.
        if (!UsageStatsReader.hasPermission(applicationContext)) return Result.success()
        val repo = (applicationContext as FinanceApp).container.repository
        return if (UsageSync.sync(applicationContext, repo)) Result.success() else Result.retry()
    }
}
