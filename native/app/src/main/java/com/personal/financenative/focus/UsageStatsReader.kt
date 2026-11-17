package com.personal.financenative.focus

import android.app.AppOpsManager
import android.app.usage.NetworkStats
import android.app.usage.NetworkStatsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.net.ConnectivityManager
import android.os.Process
import java.time.LocalDate
import java.time.ZoneId

/** Reads Android UsageStats — per-app foreground time since IST midnight. */
object UsageStatsReader {
    private val IST: ZoneId = ZoneId.of("Asia/Kolkata")

    fun hasPermission(context: Context): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = appOps.unsafeCheckOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName,
        )
        return mode == AppOpsManager.MODE_ALLOWED
    }

    private fun istMidnightMs(): Long =
        LocalDate.now(IST).atStartOfDay(IST).toInstant().toEpochMilli()

    /**
     * Foreground minutes for one package today (IST), including the session in
     * progress. Built from raw resume/pause events: the daily usage totals only
     * count a session once the app is left, so mid-scroll they read low.
     */
    fun minutesToday(context: Context, pkg: String): Int = minutesSince(context, pkg, istMidnightMs())

    /** How far back [minutesSince] looks. Android keeps raw usage events for
     *  about a week; anything older than this is ignored. */
    private const val MAX_LOOKBACK_MS = 6L * 24 * 60 * 60 * 1000

    /** How far before the window [minutesSince] reads, to learn whether the
     *  app was already open when the window began. */
    private const val LEAD_IN_MS = 12L * 60 * 60 * 1000

    /**
     * Foreground minutes for [pkg] from [fromMs] until now, including the
     * session in progress. Not tied to the calendar day.
     *
     * The app counts as open while ANY of its activities is resumed. Apps
     * like Instagram open a second activity (a modal) on top of the main one;
     * that modal stopping must not end the session while the main activity
     * is still in front.
     *
     * Reads from a lead-in before [fromMs] and clips to the window, so a
     * session already running at [fromMs] with no events since (one long
     * scroll) still counts from [fromMs].
     */
    fun minutesSince(context: Context, pkg: String, fromMs: Long): Int {
        return try {
            val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val now = System.currentTimeMillis()
            val start = fromMs.coerceIn(now - MAX_LOOKBACK_MS, now)
            val queryFrom = start - LEAD_IN_MS
            val events = usm.queryEvents(queryFrom, now)
            val e = UsageEvents.Event()
            var ms = 0L
            val resumed = HashSet<String>()      // activities of pkg currently in front
            var openSince: Long? = null          // when the app came to the front
            var sawAny = false
            fun add(from: Long, to: Long) {
                val a = maxOf(from, start)
                val b = minOf(to, now)
                if (b > a) ms += b - a
            }
            while (events.hasNextEvent()) {
                events.getNextEvent(e)
                if (e.packageName != pkg) continue
                val activity = e.className ?: ""
                when (e.eventType) {
                    UsageEvents.Event.ACTIVITY_RESUMED -> {
                        if (resumed.isEmpty()) openSince = e.timeStamp
                        resumed.add(activity)
                        sawAny = true
                    }
                    UsageEvents.Event.ACTIVITY_PAUSED, UsageEvents.Event.ACTIVITY_STOPPED -> {
                        if (resumed.remove(activity)) {
                            if (resumed.isEmpty()) {
                                openSince?.let { add(it, e.timeStamp) }
                                openSince = null
                            }
                        } else if (!sawAny) {
                            // Leaving with no resume seen: it was open before the lead-in.
                            add(queryFrom, e.timeStamp)
                        }
                        sawAny = true
                    }
                }
            }
            if (resumed.isNotEmpty()) openSince?.let { add(it, now) }   // still in the app
            (ms / 60000L).toInt()
        } catch (e: Exception) {
            0
        }
    }

    /**
     * Sessions of [pkg] between [fromMs] and now: when it was opened and when it
     * was left, as epoch ms. Switching between the app's own screens fires a
     * pause then a resume; gaps under [MERGE_GAP_MS] are one session. A session
     * still open ends at "now" and is extended on the next upload.
     */
    fun sessions(context: Context, pkg: String, fromMs: Long): List<LongArray> {
        val out = ArrayList<LongArray>()
        try {
            val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val now = System.currentTimeMillis()
            val events = usm.queryEvents(fromMs, now)
            val e = UsageEvents.Event()
            var openSince: Long? = null
            while (events.hasNextEvent()) {
                events.getNextEvent(e)
                if (e.packageName != pkg) continue
                when (e.eventType) {
                    UsageEvents.Event.ACTIVITY_RESUMED -> if (openSince == null) {
                        val prev = out.lastOrNull()
                        if (prev != null && e.timeStamp - prev[1] < MERGE_GAP_MS) {
                            out.removeAt(out.size - 1)   // same session, carry on
                            openSince = prev[0]
                        } else {
                            openSince = e.timeStamp
                        }
                    }
                    UsageEvents.Event.ACTIVITY_PAUSED, UsageEvents.Event.ACTIVITY_STOPPED -> {
                        // A close with no open before it began before the window: skip it.
                        openSince?.let { if (e.timeStamp > it) out.add(longArrayOf(it, e.timeStamp)) }
                        openSince = null
                    }
                }
            }
            openSince?.let { if (now > it) out.add(longArrayOf(it, now)) }
        } catch (_: Exception) {
        }
        return out
    }

    private const val MERGE_GAP_MS = 15_000L

    data class AppUsage(val pkg: String, val label: String, val minutes: Int)

    /** All apps used today (IST), most-used first — for the usage dashboard. */
    fun usageToday(context: Context): List<AppUsage> {
        return try {
            val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val pm = context.packageManager
            val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, istMidnightMs(), System.currentTimeMillis())
                ?: return emptyList()
            val byPkg = HashMap<String, Long>()
            for (s in stats) if (s.totalTimeInForeground > 0) {
                byPkg[s.packageName] = (byPkg[s.packageName] ?: 0L) + s.totalTimeInForeground
            }
            byPkg.entries
                .map { (pkg, ms) ->
                    val label = runCatching {
                        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
                    }.getOrDefault(pkg)
                    AppUsage(pkg, label, (ms / 60000L).toInt())
                }
                .filter { it.minutes >= 1 }
                .sortedByDescending { it.minutes }
        } catch (e: Exception) {
            emptyList()
        }
    }

    data class AppData(val label: String, val bytes: Long)

    /** Per-app mobile+wifi data used today (IST), most first. Needs usage access.
     * Best-effort — returns empty when stats are unavailable (common on emulators). */
    fun dataUsageToday(context: Context): List<AppData> {
        return try {
            val nsm = context.getSystemService(Context.NETWORK_STATS_SERVICE) as NetworkStatsManager
            val pm = context.packageManager
            val start = istMidnightMs()
            val end = System.currentTimeMillis()
            val byUid = HashMap<Int, Long>()
            for (transport in intArrayOf(ConnectivityManager.TYPE_MOBILE, ConnectivityManager.TYPE_WIFI)) {
                val stats = runCatching { nsm.querySummary(transport, null, start, end) }.getOrNull() ?: continue
                val bucket = NetworkStats.Bucket()
                while (stats.hasNextBucket()) {
                    stats.getNextBucket(bucket)
                    byUid[bucket.uid] = (byUid[bucket.uid] ?: 0L) + bucket.rxBytes + bucket.txBytes
                }
                stats.close()
            }
            byUid.entries
                .mapNotNull { (uid, bytes) ->
                    if (bytes < 100_000) return@mapNotNull null // ignore <100 KB noise
                    val pkg = pm.getPackagesForUid(uid)?.firstOrNull() ?: return@mapNotNull null
                    val label = runCatching { pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString() }.getOrDefault(pkg)
                    AppData(label, bytes)
                }
                .sortedByDescending { it.bytes }
                .take(15)
        } catch (e: Exception) {
            emptyList()
        }
    }
}
