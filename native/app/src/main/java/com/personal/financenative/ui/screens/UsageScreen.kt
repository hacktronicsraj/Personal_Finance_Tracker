package com.personal.financenative.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.personal.financenative.capture.NotifItem
import com.personal.financenative.capture.NotificationStore
import com.personal.financenative.focus.FocusController
import com.personal.financenative.focus.UsageStatsReader
import com.personal.financenative.ui.components.Card
import com.personal.financenative.ui.components.SectionLabel
import com.personal.financenative.ui.theme.Tokens
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val IST: ZoneId = ZoneId.of("Asia/Kolkata")
private val TIME_FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

@Composable
fun UsageScreen(controller: FocusController, onBack: () -> Unit) {
    val context = LocalContext.current
    var refreshKey by remember { mutableIntStateOf(0) }

    val hasAccess = remember(refreshKey) { controller.hasUsageAccess() }

    Column(Modifier.fillMaxSize().background(Tokens.Bg)) {
        Row(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = "Back",
                tint = Tokens.Text,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickableNoRipple(onBack).padding(6.dp),
            )
            Spacer(Modifier.width(10.dp))
            Text(
                "Screen time",
                color = Tokens.Text,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp,
                modifier = Modifier.weight(1f),
            )
            Icon(
                Icons.Outlined.Refresh,
                contentDescription = "Refresh",
                tint = Tokens.Sub,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickableNoRipple { refreshKey++ }.padding(6.dp),
            )
        }

        if (!hasAccess) {
            Column(Modifier.fillMaxSize().padding(16.dp)) {
                Card {
                    Text("Usage access needed", color = Tokens.Text, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Grant usage access so Finance can show per-app screen time and today's Instagram count.",
                        color = Tokens.Muted,
                        fontSize = 13.sp,
                        lineHeight = 18.sp,
                    )
                    Spacer(Modifier.height(14.dp))
                    Text(
                        "Grant access",
                        color = Tokens.Accent,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp,
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(Tokens.AccentDim)
                            .clickableNoRipple { controller.openUsageAccessSettings() }
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                    )
                }
            }
        } else {
            val usedMinutes = remember(refreshKey) { controller.usedMinutesToday() }
            val appUsage = remember(refreshKey) { UsageStatsReader.usageToday(context).take(15) }
            val dataUsage = remember(refreshKey) { UsageStatsReader.dataUsageToday(context) }
            val notifications = remember(refreshKey) { NotificationStore.all(context).take(20) }

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, top = 0.dp, end = 16.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                item {
                    Card {
                        SectionLabel("Instagram today")
                        Spacer(Modifier.height(10.dp))
                        Row(verticalAlignment = Alignment.Bottom) {
                            Text(
                                "$usedMinutes",
                                color = if (usedMinutes >= 30) Tokens.Neg else Tokens.Text,
                                fontWeight = FontWeight.ExtraBold,
                                fontSize = 28.sp,
                            )
                            Text(
                                "/30m",
                                color = Tokens.Muted,
                                fontSize = 15.sp,
                                modifier = Modifier.padding(start = 4.dp, bottom = 4.dp),
                            )
                        }
                        Spacer(Modifier.height(10.dp))
                        val fraction = (usedMinutes / 30f).coerceIn(0f, 1f)
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(8.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .background(Tokens.Surface2),
                        ) {
                            Box(
                                Modifier
                                    .fillMaxWidth(fraction)
                                    .fillMaxHeight()
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(if (usedMinutes >= 30) Tokens.Neg else Tokens.Accent),
                            )
                        }
                    }
                }

                item { SectionLabel("Apps today", modifier = Modifier.padding(top = 4.dp)) }
                if (appUsage.isEmpty()) {
                    item {
                        Card { Text("No app usage recorded yet today.", color = Tokens.Muted, fontSize = 13.sp) }
                    }
                } else {
                    val maxMinutes = appUsage.maxOf { it.minutes }.coerceAtLeast(1)
                    item {
                        Card {
                            appUsage.forEachIndexed { i, app ->
                                AppUsageRow(app.label, app.minutes, maxMinutes)
                                if (i < appUsage.lastIndex) Spacer(Modifier.height(10.dp))
                            }
                        }
                    }
                }

                if (dataUsage.isNotEmpty()) {
                    item { SectionLabel("Data today", modifier = Modifier.padding(top = 4.dp)) }
                    item {
                        Card {
                            dataUsage.forEachIndexed { i, app ->
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text(app.label, color = Tokens.Text, fontSize = 14.sp, maxLines = 1, modifier = Modifier.weight(1f))
                                    Text(formatBytes(app.bytes), color = Tokens.Sub, fontSize = 13.sp)
                                }
                                if (i < dataUsage.lastIndex) Spacer(Modifier.height(10.dp))
                            }
                        }
                    }
                }

                item { SectionLabel("Recent notifications", modifier = Modifier.padding(top = 4.dp)) }
                if (notifications.isEmpty()) {
                    item {
                        Card {
                            Text(
                                "Enable notification access in system settings so recent notifications show up here.",
                                color = Tokens.Muted,
                                fontSize = 13.sp,
                                lineHeight = 18.sp,
                            )
                        }
                    }
                } else {
                    item {
                        Card {
                            notifications.forEachIndexed { i, n ->
                                NotificationRow(n)
                                if (i < notifications.lastIndex) Spacer(Modifier.height(12.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AppUsageRow(label: String, minutes: Int, maxMinutes: Int) {
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, color = Tokens.Text, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1)
            Text(formatMinutes(minutes), color = Tokens.Sub, fontSize = 13.sp)
        }
        Spacer(Modifier.height(6.dp))
        val fraction = (minutes.toFloat() / maxMinutes).coerceIn(0f, 1f)
        Box(
            Modifier
                .fillMaxWidth()
                .height(6.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(Tokens.Surface2),
        ) {
            Box(
                Modifier
                    .fillMaxWidth(fraction)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(3.dp))
                    .background(Tokens.Accent),
            )
        }
    }
}

@Composable
private fun NotificationRow(n: NotifItem) {
    Column(Modifier.fillMaxWidth()) {
        Text(
            buildString {
                append(n.app)
                append(" · ")
                if (n.title.isNotBlank()) {
                    append(n.title)
                    append(" — ")
                }
                append(n.text)
            },
            color = Tokens.Text,
            fontSize = 13.sp,
            lineHeight = 18.sp,
            maxLines = 2,
        )
        Spacer(Modifier.height(2.dp))
        Text(formatTime(n.time), color = Tokens.Ghost, fontSize = 11.sp)
    }
}

private fun formatMinutes(m: Int): String = if (m >= 60) "${m / 60}h ${m % 60}m" else "${m}m"

private fun formatTime(epochMs: Long): String = Instant.ofEpochMilli(epochMs).atZone(IST).format(TIME_FMT)

/** Clickable without the default ripple/indication (keeps the flat aesthetic). */
private fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier = composed {
    clickable(
        interactionSource = remember { MutableInteractionSource() },
        indication = null,
        onClick = onClick,
    )
}

private fun formatBytes(b: Long): String = when {
    b >= 1_000_000_000 -> "%.1f GB".format(b / 1_000_000_000.0)
    b >= 1_000_000 -> "%.1f MB".format(b / 1_000_000.0)
    else -> "%.0f KB".format(b / 1000.0)
}
