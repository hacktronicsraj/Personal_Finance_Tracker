package com.personal.financenative.capture

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/** Captures posted notifications into an on-device store for the usage dashboard. */
class NotificationCaptureService : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val n = sbn ?: return
        val extras = n.notification?.extras ?: return
        val title = extras.getCharSequence("android.title")?.toString().orEmpty()
        val text = extras.getCharSequence("android.text")?.toString().orEmpty()
        if (title.isBlank() && text.isBlank()) return
        val pm = applicationContext.packageManager
        val app = runCatching {
            pm.getApplicationLabel(pm.getApplicationInfo(n.packageName, 0)).toString()
        }.getOrDefault(n.packageName)
        NotificationStore.add(
            applicationContext,
            NotifItem(pkg = n.packageName, app = app, title = title, text = text, time = n.postTime),
        )
    }
}
