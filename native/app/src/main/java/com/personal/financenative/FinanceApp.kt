package com.personal.financenative

import android.app.Application
import android.content.Context
import androidx.room.Room
import com.personal.financenative.data.FinanceRepository
import com.personal.financenative.data.local.AppDatabase

/** Manual DI — a small app doesn't need Hilt. One container, built once. */
class AppContainer(context: Context) {
    private val db = Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, "finance.db")
        .fallbackToDestructiveMigration()
        .build()

    val repository: FinanceRepository by lazy { FinanceRepository(dao = db.txns()) }
}

class FinanceApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        com.personal.financenative.capture.scheduleStatementReminder(this)
        com.personal.financenative.focus.UsageSync.schedule(this)
        // Leftover from the old accessibility pause; its worker class no longer exists.
        androidx.work.WorkManager.getInstance(this).cancelUniqueWork("gate-resume")
        com.personal.financenative.focus.GateWatchService.start(this)
    }
}
