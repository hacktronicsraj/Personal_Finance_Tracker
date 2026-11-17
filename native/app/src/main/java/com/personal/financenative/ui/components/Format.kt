package com.personal.financenative.ui.components

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.abs
import kotlin.math.roundToLong

private val IST: ZoneId = ZoneId.of("Asia/Kolkata")

/** Indian digit grouping: 69,044 / 1,30,304 / 12,34,567. */
fun groupIndian(n: Long): String {
    val s = abs(n).toString()
    if (s.length <= 3) return s
    val last3 = s.substring(s.length - 3)
    val rest = s.substring(0, s.length - 3)
    val withCommas = rest.reversed().chunked(2).joinToString(",").reversed()
    return "$withCommas,$last3"
}

/** ₹ amount, whole rupees, Indian grouping. e.g. 69044.22 -> "₹69,044". */
fun rupee(amount: Double, withDecimals: Boolean = false): String {
    val neg = amount < 0
    val whole = abs(amount).roundToLong()
    val base = if (withDecimals) {
        val paise = (abs(amount) * 100).roundToLong()
        "${groupIndian(paise / 100)}.${(paise % 100).toString().padStart(2, '0')}"
    } else groupIndian(whole)
    return (if (neg) "-₹" else "₹") + base
}

/** A signed spend line, e.g. "-₹247". */
fun signedRupee(amount: Double, direction: String): String {
    val sign = if (direction == "credit") "+" else "-"
    return "$sign${rupee(amount)}"
}

private val dayFmt = DateTimeFormatter.ofPattern("d MMM").withZone(IST)
private val timeFmt = DateTimeFormatter.ofPattern("HH:mm").withZone(IST)
private val fullFmt = DateTimeFormatter.ofPattern("d MMM yyyy · HH:mm").withZone(IST)

private fun parseInstant(iso: String?): Instant? =
    iso?.let { runCatching { Instant.parse(it) }.getOrNull() }

fun shortDay(iso: String?): String = parseInstant(iso)?.let { dayFmt.format(it) } ?: ""
fun shortTime(iso: String?): String = parseInstant(iso)?.let { timeFmt.format(it) } ?: ""
fun fullDateTime(iso: String?): String = parseInstant(iso)?.let { fullFmt.format(it) } ?: ""

/** IST day key (yyyy-MM-dd) for grouping. */
fun istDayKey(iso: String?): String {
    val inst = parseInstant(iso) ?: return ""
    return inst.atZone(IST).toLocalDate().toString()
}

/** Friendly header for a day key: Today / Yesterday / "12 Sept". */
fun dayHeader(dayKey: String): String {
    val today = Instant.now().atZone(IST).toLocalDate()
    return when (dayKey) {
        today.toString() -> "Today"
        today.minusDays(1).toString() -> "Yesterday"
        else -> runCatching {
            java.time.LocalDate.parse(dayKey).format(DateTimeFormatter.ofPattern("d MMM"))
        }.getOrDefault(dayKey)
    }
}
