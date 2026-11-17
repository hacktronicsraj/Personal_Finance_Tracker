package com.personal.financenative.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.personal.financenative.data.FinanceRepository
import com.personal.financenative.data.api.UsageDay
import com.personal.financenative.data.api.UsageSession
import com.personal.financenative.focus.Gate
import com.personal.financenative.focus.UsageStatsReader
import com.personal.financenative.focus.UsageSync
import com.personal.financenative.ui.components.Card
import com.personal.financenative.ui.components.SectionLabel
import com.personal.financenative.ui.theme.Tokens
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val IST_ZONE: ZoneId = ZoneId.of("Asia/Kolkata")
private val CLOCK = DateTimeFormatter.ofPattern("h:mm a")
private val DAY_LONG = DateTimeFormatter.ofPattern("EEE, d MMM")
private val DAY_SHORT = DateTimeFormatter.ofPattern("d MMM")

/**
 * Instagram usage history, kept on the server: hours per day, and for any day
 * every open — when, and for how long. Uploads the latest sessions on open.
 */
@Composable
fun InstagramHistoryScreen(repo: FinanceRepository, onBack: () -> Unit) {
    val context = LocalContext.current
    var range by remember { mutableIntStateOf(30) }
    var days by remember { mutableStateOf<List<UsageDay>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var selected by remember { mutableStateOf<String?>(null) }
    var sessions by remember { mutableStateOf<List<UsageSession>?>(null) }
    var synced by remember { mutableStateOf(false) }

    LaunchedEffect(range) {
        if (!synced) { UsageSync.sync(context, repo); synced = true }
        runCatching { repo.usageDays(Gate.INSTAGRAM_PKG, range) }
            .onSuccess { days = it; error = null; if (selected == null) selected = it.lastOrNull()?.day }
            .onFailure { error = "Can't reach the server" }
    }
    LaunchedEffect(selected) {
        val day = selected ?: return@LaunchedEffect
        sessions = null
        sessions = runCatching { repo.usageSessions(Gate.INSTAGRAM_PKG, day) }.getOrNull()
    }

    Column(Modifier.fillMaxSize().background(Tokens.Bg)) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back", tint = Tokens.Text,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onBack).padding(6.dp),
            )
            Spacer(Modifier.width(10.dp))
            Text("Instagram history", color = Tokens.Text, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }

        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (!UsageStatsReader.hasPermission(context)) {
                Text("Usage access is off, so new sessions aren't being recorded.", color = Tokens.Amber, fontSize = 13.sp)
            }
            val list = days
            when {
                list == null && error != null -> Text(error!!, color = Tokens.Muted, fontSize = 14.sp)
                list == null -> Text("Loading…", color = Tokens.Muted, fontSize = 14.sp)
                else -> {
                    Summary(list)
                    Card {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Hours per day", color = Tokens.Text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
                                modifier = Modifier.weight(1f))
                            listOf(30, 90).forEach { r ->
                                Text(
                                    "${r}d",
                                    color = if (range == r) Tokens.Accent else Tokens.Muted,
                                    fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                                    modifier = Modifier.clip(RoundedCornerShape(8.dp))
                                        .background(if (range == r) Tokens.AccentDim else Tokens.Surface)
                                        .clickable { range = r }.padding(horizontal = 10.dp, vertical = 5.dp),
                                )
                            }
                        }
                        Spacer(Modifier.height(14.dp))
                        DailyBars(list, selected, onSelect = { selected = it })
                    }
                    selected?.let { day -> list.firstOrNull { it.day == day }?.let { DayDetail(it, sessions) } }
                    Text(
                        "Recorded from Android's app events and kept on your server. Android only holds about a " +
                            "week of raw events, so history starts from the first upload.",
                        color = Tokens.Ghost, fontSize = 11.5.sp, lineHeight = 16.sp,
                        modifier = Modifier.padding(start = 4.dp, end = 4.dp, bottom = 24.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun Summary(days: List<UsageDay>) {
    val today = days.lastOrNull()
    val last7 = days.takeLast(7)
    val avg7 = if (last7.isEmpty()) 0.0 else last7.sumOf { it.minutes } / last7.size
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Tile("Today", fmtMinutes(today?.minutes ?: 0.0), "${today?.opens ?: 0} opens", Modifier.weight(1f))
        Tile("7-day avg", fmtMinutes(avg7), "per day", Modifier.weight(1f))
        Tile("${days.size} days", fmtMinutes(days.sumOf { it.minutes }), "${days.sumOf { it.opens }} opens", Modifier.weight(1f))
    }
}

@Composable
private fun Tile(label: String, value: String, sub: String, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(16.dp)).background(Tokens.Surface).padding(12.dp)) {
        Text(label, color = Tokens.Muted, fontSize = 11.5.sp)
        Text(value, color = Tokens.Text, fontWeight = FontWeight.ExtraBold, fontSize = 20.sp, modifier = Modifier.padding(top = 4.dp))
        Text(sub, color = Tokens.Sub, fontSize = 11.5.sp)
    }
}

/**
 * One series, one hue: bars anchored to the baseline with rounded tops and a
 * 2dp gap. Tap a bar to select its day. A single recessive gridline marks the
 * scale; the selected day's value is written in the detail card below.
 */
@Composable
private fun DailyBars(days: List<UsageDay>, selected: String?, onSelect: (String) -> Unit) {
    if (days.isEmpty()) return
    val maxMin = (days.maxOfOrNull { it.minutes } ?: 0.0).coerceAtLeast(60.0)
    val topHours = kotlin.math.ceil(maxMin / 60.0).toInt()
    val scaleMin = topHours * 60.0
    val description = "Instagram hours per day, last ${days.size} days. Highest " +
        fmtMinutes(days.maxOfOrNull { it.minutes } ?: 0.0) + "."

    Row {
        Column(Modifier.height(150.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Text("${topHours}h", color = Tokens.Muted, fontSize = 10.5.sp)
            Text("0", color = Tokens.Muted, fontSize = 10.5.sp)
        }
        Spacer(Modifier.width(6.dp))
        Box(Modifier.weight(1f)) {
            Canvas(
                Modifier.fillMaxWidth().height(150.dp)
                    .semantics { contentDescription = description }
                    .pointerInput(days) {
                        detectTapGestures { pos ->
                            val i = (pos.x / (size.width / days.size)).toInt().coerceIn(0, days.size - 1)
                            onSelect(days[i].day)
                        }
                    },
            ) {
                val gap = 2.dp.toPx()
                val slot = size.width / days.size
                val barW = (slot - gap).coerceAtLeast(1f)
                val radius = minOf(4.dp.toPx(), barW / 2)
                // Recessive gridlines: top of scale and baseline.
                drawLine(Tokens.Hairline, Offset(0f, 0f), Offset(size.width, 0f), strokeWidth = 1f)
                drawLine(Tokens.Hairline, Offset(0f, size.height), Offset(size.width, size.height), strokeWidth = 1f)
                days.forEachIndexed { i, d ->
                    if (d.minutes <= 0) return@forEachIndexed
                    val h = (d.minutes / scaleMin * size.height).toFloat().coerceAtLeast(2f)
                    val left = i * slot + gap / 2
                    val top = size.height - h
                    val r = minOf(radius, h)
                    // Rounded top, square base.
                    val path = Path().apply {
                        moveTo(left, size.height)
                        lineTo(left, top + r)
                        quadraticTo(left, top, left + r, top)
                        lineTo(left + barW - r, top)
                        quadraticTo(left + barW, top, left + barW, top + r)
                        lineTo(left + barW, size.height)
                        close()
                    }
                    val isSel = d.day == selected
                    drawPath(path, if (isSel || selected == null) Tokens.Accent else Tokens.Accent.copy(alpha = 0.45f))
                }
                selected?.let { s ->
                    val i = days.indexOfFirst { it.day == s }
                    if (i >= 0) drawRoundRect(
                        Tokens.Text.copy(alpha = 0.5f), topLeft = Offset(i * slot, 0f), size = Size(slot, size.height),
                        cornerRadius = CornerRadius(4.dp.toPx()), style = Stroke(1.dp.toPx()),
                    )
                }
            }
        }
    }
    Row(Modifier.fillMaxWidth().padding(start = 22.dp, top = 6.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        listOf(days.first(), days[days.size / 2], days.last()).forEach {
            Text(LocalDate.parse(it.day).format(DAY_SHORT), color = Tokens.Muted, fontSize = 10.5.sp)
        }
    }
}

@Composable
private fun DayDetail(day: UsageDay, sessions: List<UsageSession>?) {
    Card {
        Text(LocalDate.parse(day.day).format(DAY_LONG), color = Tokens.Text, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Spacer(Modifier.height(4.dp))
        Text(
            "${fmtMinutes(day.minutes)} · ${day.opens} open${if (day.opens == 1) "" else "s"}" +
                (if (day.longestMinutes > 0) " · longest ${fmtMinutes(day.longestMinutes)}" else ""),
            color = Tokens.Sub, fontSize = 13.sp,
        )
        if (day.firstOpenMs != null && day.lastCloseMs != null) {
            Text("First open ${clock(day.firstOpenMs)} · last used ${clock(day.lastCloseMs)}", color = Tokens.Muted, fontSize = 12.sp,
                modifier = Modifier.padding(top = 2.dp))
        }
        Spacer(Modifier.height(12.dp))
        SectionLabel("Each open")
        Spacer(Modifier.height(6.dp))
        when {
            sessions == null -> Text("Loading…", color = Tokens.Muted, fontSize = 13.sp)
            sessions.isEmpty() -> Text("No Instagram use recorded this day.", color = Tokens.Muted, fontSize = 13.sp)
            else -> sessions.forEach { s ->
                Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        (if (s.continued) "from midnight" else clock(s.startMs)) + " – " + clock(s.endMs),
                        color = Tokens.Text, fontSize = 14.sp, modifier = Modifier.weight(1f),
                    )
                    Text(fmtMinutes(s.minutes), color = Tokens.Sub, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                }
            }
        }
    }
}

private fun clock(ms: Long): String = Instant.ofEpochMilli(ms).atZone(IST_ZONE).format(CLOCK)

private fun fmtMinutes(m: Double): String {
    val total = kotlin.math.round(m).toInt()
    return when {
        m > 0 && total == 0 -> "<1m"
        total >= 60 -> "${total / 60}h ${total % 60}m"
        else -> "${total}m"
    }
}
