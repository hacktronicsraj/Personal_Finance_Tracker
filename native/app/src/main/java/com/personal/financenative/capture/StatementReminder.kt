package com.personal.financenative.capture

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.personal.financenative.MainActivity
import java.time.DayOfWeek
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit

/**
 * Weekly nudge to upload a bank statement. A daily worker fires the notification
 * on Fridays (IST); WorkManager survives reboots and app death.
 */
class StatementReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val istDay = ZonedDateTime.now(ZoneId.of("Asia/Kolkata")).dayOfWeek
        if (istDay == DayOfWeek.FRIDAY) notifyUploadStatement(applicationContext)
        return Result.success()
    }
}

private const val CHANNEL = "reminders"
private const val NOTIF_ID = 4201

fun scheduleStatementReminder(context: Context) {
    ensureChannel(context)
    val work = PeriodicWorkRequestBuilder<StatementReminderWorker>(1, TimeUnit.DAYS).build()
    WorkManager.getInstance(context).enqueueUniquePeriodicWork(
        "statement-reminder", ExistingPeriodicWorkPolicy.KEEP, work,
    )
}

private fun ensureChannel(context: Context) {
    val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (mgr.getNotificationChannel(CHANNEL) == null) {
        mgr.createNotificationChannel(
            NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_DEFAULT),
        )
    }
}

private fun notifyUploadStatement(context: Context) {
    ensureChannel(context)
    val intent = Intent(context, MainActivity::class.java)
        .setAction(MainActivity.ACTION_OPEN_STATEMENT)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    val pi = PendingIntent.getActivity(
        context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notif = NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(android.R.drawable.ic_menu_upload)
        .setContentTitle("Upload this week's statement 🧾")
        .setContentText("Reconcile your bank statement so your ledger stays complete.")
        .setAutoCancel(true)
        .setContentIntent(pi)
        .build()
    runCatching { NotificationManagerCompat.from(context).notify(NOTIF_ID, notif) }
}
