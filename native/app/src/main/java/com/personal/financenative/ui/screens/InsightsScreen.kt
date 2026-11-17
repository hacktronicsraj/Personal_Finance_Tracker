package com.personal.financenative.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.personal.financenative.data.FinanceRepository
import com.personal.financenative.data.api.AnalyticsSummary
import com.personal.financenative.data.api.CategoryTotal
import com.personal.financenative.data.api.MerchantTotal
import com.personal.financenative.ui.components.Card
import com.personal.financenative.ui.components.CategoryDot
import com.personal.financenative.ui.components.LoadState
import com.personal.financenative.ui.components.Monogram
import com.personal.financenative.ui.components.SectionLabel
import com.personal.financenative.ui.components.rupee
import com.personal.financenative.ui.theme.Tokens
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId

data class InsightsState(
    val loading: Boolean = true,
    val error: String? = null,
    val summary: AnalyticsSummary? = null,
)

class InsightsViewModel(private val repo: FinanceRepository) : ViewModel() {
    private val _state = MutableStateFlow(InsightsState())
    val state: StateFlow<InsightsState> = _state.asStateFlow()

    private val ist = ZoneId.of("Asia/Kolkata")

    init { load() }

    fun load() {
        val fromIso = LocalDate.now(ist).withDayOfMonth(1).atStartOfDay(ist).toInstant().toString()
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            runCatching { repo.summary(from = fromIso) }
                .onSuccess { summary -> _state.value = InsightsState(loading = false, summary = summary) }
                .onFailure { e ->
                    _state.value = _state.value.copy(loading = false, error = e.message ?: "Couldn't reach the server")
                }
        }
    }
}

@Composable
fun InsightsScreen(vm: InsightsViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()

    LoadState(
        loading = state.loading,
        error = state.error,
        data = state.summary,
        onRetry = vm::load,
    ) { summary ->
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 90.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                Text(
                    "Insights",
                    color = Tokens.Text,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 32.sp,
                    modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
                )
            }
            item { TotalCard(summary) }
            item { SectionLabel("By category", modifier = Modifier.padding(start = 2.dp)) }
            item { CategoryBreakdownCard(summary) }
            if (summary.topMerchants.isNotEmpty()) {
                item { SectionLabel("Top merchants", modifier = Modifier.padding(start = 2.dp)) }
                item { TopMerchantsCard(summary.topMerchants) }
            }
        }
    }
}

@Composable
private fun TotalCard(summary: AnalyticsSummary) {
    Card {
        Text("TOTAL SPENT", color = Tokens.Muted, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 1.sp)
        Spacer(Modifier.height(6.dp))
        Text(rupee(summary.totalSpent, withDecimals = true), color = Tokens.Text, fontWeight = FontWeight.ExtraBold, fontSize = 40.sp)
    }
}

@Composable
private fun CategoryBreakdownCard(summary: AnalyticsSummary) {
    val max = (summary.byCategory.maxOfOrNull { it.total } ?: 1.0).coerceAtLeast(0.0001)
    Card {
        summary.byCategory.forEachIndexed { i, c ->
            CategoryRow(c, summary.totalSpent, max)
            if (i < summary.byCategory.lastIndex) Spacer(Modifier.height(14.dp))
        }
    }
}

@Composable
private fun CategoryRow(c: CategoryTotal, totalSpent: Double, max: Double) {
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CategoryDot(c.category)
                Spacer(Modifier.width(10.dp))
                Text(c.category, color = Tokens.Text, fontSize = 14.5.sp, fontWeight = FontWeight.Medium)
            }
            val pct = if (totalSpent > 0) (c.total / totalSpent * 100).toInt() else 0
            Text("${rupee(c.total)} · $pct%", color = Tokens.Sub, fontSize = 13.sp)
        }
        Spacer(Modifier.height(8.dp))
        val fraction = (c.total / max).toFloat().coerceIn(0.01f, 1f)
        Box(
            Modifier
                .fillMaxWidth()
                .height(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(Tokens.Surface2),
        ) {
            Box(
                Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(fraction)
                    .clip(RoundedCornerShape(4.dp))
                    .background(Tokens.categoryColor(c.category)),
            )
        }
    }
}

@Composable
private fun TopMerchantsCard(merchants: List<MerchantTotal>) {
    Card {
        merchants.forEachIndexed { i, m ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Monogram(m.merchant)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(m.merchant ?: "Unknown", color = Tokens.Text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1)
                    Text(
                        "${m.count} transaction${if (m.count == 1) "" else "s"}",
                        color = Tokens.Muted,
                        fontSize = 12.5.sp,
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(rupee(m.total), color = Tokens.Text, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            }
            if (i < merchants.lastIndex) HorizontalDivider(color = Tokens.Divider)
        }
    }
}
