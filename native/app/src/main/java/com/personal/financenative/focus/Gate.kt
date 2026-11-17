package com.personal.financenative.focus

import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * The Instagram gate — pure decision logic, shared by the Compose UI and the
 * watcher service that enforces it (all times IST).
 *
 * Rules, per the user's spec:
 *  • There is NO daily time cap. Instagram time is unlimited.
 *  • A checkpoint comes due after [CHECKPOINT_MIN] minutes of Instagram use
 *    counted since the last cleared checkpoint — actual time in the app, not
 *    wall-clock time. Opening it for 2 minutes and coming back hours later
 *    leaves 13 minutes on the clock.
 *  • The count does NOT reset at midnight: minutes carry across days, so the
 *    time of day never matters.
 *  • Clearing a checkpoint restarts the count from zero, so at most one
 *    checkpoint is ever owed.
 */
object Gate {
    /** Minutes of Instagram use per checkpoint. */
    const val CHECKPOINT_MIN = 15
    const val INSTAGRAM_PKG = "com.instagram.android"
    private val IST: ZoneId = ZoneId.of("Asia/Kolkata")

    enum class Reason { FLASHCARDS, ALLOW }

    data class Decision(
        val allowed: Boolean,
        val reason: Reason,
        /** Instagram minutes used since the last cleared checkpoint. */
        val usedSinceCheckpoint: Int,
    )

    fun istToday(nowMs: Long = System.currentTimeMillis()): String =
        ZonedDateTime.ofInstant(java.time.Instant.ofEpochMilli(nowMs), IST).toLocalDate().toString()

    /** What should happen when Instagram opens (or stays open) now. */
    fun decide(usedSinceCheckpoint: Int): Decision {
        val owed = usedSinceCheckpoint >= CHECKPOINT_MIN
        return Decision(
            allowed = !owed,
            reason = if (owed) Reason.FLASHCARDS else Reason.ALLOW,
            usedSinceCheckpoint = usedSinceCheckpoint,
        )
    }

    /** Minutes until the next checkpoint comes due (0 if one is already owed). */
    fun minutesUntilNextCheckpoint(usedSinceCheckpoint: Int): Int =
        (CHECKPOINT_MIN - usedSinceCheckpoint).coerceAtLeast(0)
}
