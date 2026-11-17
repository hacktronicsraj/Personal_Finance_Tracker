package com.personal.financenative.focus

import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import com.personal.financenative.GateActivity
import com.personal.financenative.MainActivity
import com.personal.financenative.R

/**
 * Enforces the Instagram gate without an accessibility service.
 *
 * Banking/UPI apps (Google Pay India in particular) block payments while any
 * sideloaded accessibility service is on, and keep blocking until a restart.
 * So instead of accessibility, this foreground service asks Android which app
 * came to the front (usage events, the same source as the minute counts) and,
 * when Instagram is up with a checkpoint due, opens [GateActivity] over it.
 * Opening an activity from the background needs "Display over other apps".
 *
 * Battery: it only polls while the screen is on and unlocked, every [POLL_MS],
 * and each poll reads only the events since the last one. The minute count
 * (a scan since midnight) runs only while Instagram is in front, every
 * [RECHECK_MS], and once on each switch into Instagram.
 */
class GateWatchService : Service() {
    companion object {
        private const val POLL_MS = 1_500L
        private const val RECHECK_MS = 30_000L
        private const val CHANNEL = "gate_watch"
        private const val NOTIF_ID = 4242

        fun canRun(context: Context): Boolean =
            UsageStatsReader.hasPermission(context) && Settings.canDrawOverlays(context)

        /** Starts the watcher if its permissions are in place. Safe to call repeatedly. */
        fun start(context: Context) {
            if (!canRun(context)) return
            runCatching {
                context.startForegroundService(Intent(context, GateWatchService::class.java))
            }
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private val prefs by lazy { FocusPrefs(this) }
    private val usm by lazy { getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager }

    private var polling = false
    private var lastQueryMs = 0L
    private var foreground: String? = null
    private var lastCheckMs = 0L
    private var lastGateAt = 0L

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_SCREEN_OFF -> stopPolling()
                Intent.ACTION_USER_PRESENT, Intent.ACTION_SCREEN_ON -> startPollingIfAwake()
            }
        }
    }

    private val tick = object : Runnable {
        override fun run() {
            if (!polling) return
            try { poll() } catch (_: Exception) { }
            handler.postDelayed(this, POLL_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startInForeground()
        registerReceiver(screenReceiver, IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        })
        startPollingIfAwake()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!canRun(this)) { stopSelf(); return START_NOT_STICKY }
        startPollingIfAwake()
        return START_STICKY
    }

    override fun onDestroy() {
        stopPolling()
        runCatching { unregisterReceiver(screenReceiver) }
        super.onDestroy()
    }

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Focus gate", NotificationManager.IMPORTANCE_MIN).apply {
                description = "Keeps the Instagram checkpoint running"
                setShowBadge(false)
            },
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val n = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_tile_send_to_mac)
            .setContentTitle("Focus gate on")
            .setContentText("Watching for Instagram")
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ID, n)
        }
    }

    private fun startPollingIfAwake() {
        val pm = getSystemService(PowerManager::class.java)
        val km = getSystemService(KeyguardManager::class.java)
        if (!pm.isInteractive || km.isKeyguardLocked) return
        if (polling) return
        polling = true
        // Look back far enough to learn what's in front right now.
        lastQueryMs = System.currentTimeMillis() - 10 * 60_000L
        foreground = null
        handler.post(tick)
    }

    private fun stopPolling() {
        polling = false
        handler.removeCallbacks(tick)
    }

    private fun poll() {
        val now = System.currentTimeMillis()
        val events = usm.queryEvents(lastQueryMs, now)
        lastQueryMs = now
        val e = UsageEvents.Event()
        var latest: String? = null
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            if (e.eventType == UsageEvents.Event.ACTIVITY_RESUMED) latest = e.packageName
        }
        val switchedIn = latest != null && latest != foreground && latest == Gate.INSTAGRAM_PKG
        if (latest != null) foreground = latest

        if (foreground != Gate.INSTAGRAM_PKG) return
        if (!switchedIn && now - lastCheckMs < RECHECK_MS) return
        lastCheckMs = now

        val used = UsageStatsReader.minutesSince(this, Gate.INSTAGRAM_PKG, prefs.lastCheckpointMs)
        val decision = Gate.decide(used)
        if (decision.allowed) return
        if (now - lastGateAt < 3_000L) return
        lastGateAt = now
        // Re-check soon after: if the gate is dismissed back into Instagram, reopen it.
        lastCheckMs = 0L
        foreground = packageName
        startActivity(
            Intent(this, GateActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(GateActivity.EXTRA_REASON, decision.reason.name),
        )
    }
}

/** Restarts the watcher after a reboot or an app update. */
class GateWatchBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        GateWatchService.start(context)
    }
}
