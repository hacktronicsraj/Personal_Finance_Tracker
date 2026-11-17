package com.personal.financenative.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.personal.financenative.data.api.AnalyticsSummary
import com.personal.financenative.data.api.Txn
import com.personal.financenative.ui.components.Card
import com.personal.financenative.ui.components.CategoryDot
import com.personal.financenative.ui.components.LoadState
import com.personal.financenative.ui.components.SpendRow
import com.personal.financenative.ui.components.rupee
import com.personal.financenative.ui.components.shortDay
import com.personal.financenative.ui.components.shortTime
import com.personal.financenative.ui.theme.Tokens

@Composable
fun HomeScreen(vm: HomeViewModel, onSeeAll: () -> Unit, onTxn: (String) -> Unit, onAsk: () -> Unit = {}) {
    val state by vm.state.collectAsStateWithLifecycle()

    LoadState(
        loading = state.loading,
        error = state.error,
        data = state.summary?.let { it to state.recent },
        onRetry = vm::load,
    ) { (summary, recent) ->
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                Row(
                    Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Bottom,
                ) {
                    Text(state.monthLabel, color = Tokens.Text, fontWeight = FontWeight.ExtraBold, fontSize = 32.sp)
                    Text(
                        "Ask 💬",
                        color = Tokens.Accent,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp,
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(Tokens.AccentDim)
                            .clickableNoRipple(onAsk)
                            .padding(horizontal = 14.dp, vertical = 7.dp),
                    )
                }
            }
            item { SpendCard(summary) }
            item {
                Row(
                    Modifier.fillMaxWidth().padding(top = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Recent", color = Tokens.Text, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Text("All →", color = Tokens.Accent, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                        modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Tokens.AccentDim)
                            .clickableNoRipple(onSeeAll).padding(horizontal = 10.dp, vertical = 5.dp))
                }
            }
            if (recent.isEmpty()) {
                item { Text("No transactions yet.", color = Tokens.Muted, fontSize = 13.sp, modifier = Modifier.padding(8.dp)) }
            } else {
                item {
                    Card {
                        recent.forEachIndexed { i, t ->
                            SpendRow(
                                merchant = t.merchant,
                                category = t.category,
                                subtitle = "${t.category} · ${shortDay(t.occurred_at ?: t.created_at).ifEmpty { shortTime(t.created_at) }}",
                                amount = t.amount,
                                direction = t.direction,
                                modifier = Modifier.clickableNoRipple { onTxn(t.id) },
                            )
                            if (i < recent.lastIndex) HorizontalDivider(color = Tokens.Divider)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SpendCard(summary: AnalyticsSummary) {
    Card {
        Text("SPENT THIS MONTH", color = Tokens.Muted, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 1.sp)
        Spacer(Modifier.height(6.dp))
        Text(rupee(summary.totalSpent, withDecimals = true), color = Tokens.Text, fontWeight = FontWeight.ExtraBold, fontSize = 40.sp)
        Spacer(Modifier.height(14.dp))
        CategoryBar(summary)
        Spacer(Modifier.height(14.dp))
        summary.byCategory.take(4).forEach { c ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 5.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CategoryDot(c.category)
                    Spacer(Modifier.width(10.dp))
                    Text(c.category, color = Tokens.Text, fontSize = 14.5.sp, fontWeight = FontWeight.Medium)
                }
                val pct = if (summary.totalSpent > 0) (c.total / summary.totalSpent * 100).toInt() else 0
                Text("${rupee(c.total)} · $pct%", color = Tokens.Sub, fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun CategoryBar(summary: AnalyticsSummary) {
    val total = summary.byCategory.sumOf { it.total }.coerceAtLeast(0.0001)
    Row(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp))) {
        summary.byCategory.forEach { c ->
            Box(
                Modifier
                    .weight((c.total / total).toFloat().coerceAtLeast(0.01f))
                    .fillMaxSize()
                    .background(Tokens.categoryColor(c.category)),
            )
        }
    }
}

/** Clickable without the default ripple/indication (keeps the flat aesthetic). */
private fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier = composed {
    clickable(
        interactionSource = remember { MutableInteractionSource() },
        indication = null,
        onClick = onClick,
    )
}
