package com.personal.financenative.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.personal.financenative.data.FinanceRepository
import com.personal.financenative.data.api.Txn
import com.personal.financenative.ui.components.Card
import com.personal.financenative.ui.components.LoadState
import com.personal.financenative.ui.components.SectionLabel
import com.personal.financenative.ui.components.SpendRow
import com.personal.financenative.ui.components.dayHeader
import com.personal.financenative.ui.components.istDayKey
import com.personal.financenative.ui.components.shortTime
import com.personal.financenative.ui.theme.Tokens
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ActivityState(
    val loading: Boolean = true,
    val error: String? = null,
    val txns: List<Txn> = emptyList(),
    val query: String = "",
)

class ActivityViewModel(private val repo: FinanceRepository) : ViewModel() {
    private val _state = MutableStateFlow(ActivityState())
    val state: StateFlow<ActivityState> = _state.asStateFlow()

    init { load() }

    fun load() {
        val q = _state.value.query
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            runCatching { repo.transactions(q = q.ifBlank { null }, limit = 500) }
                .onSuccess { txns -> _state.value = _state.value.copy(loading = false, txns = txns) }
                .onFailure { e -> _state.value = _state.value.copy(loading = false, error = e.message ?: "Couldn't reach the server") }
        }
    }

    fun setQuery(q: String) {
        _state.value = _state.value.copy(query = q)
        load()
    }
}

@Composable
fun ActivityScreen(vm: ActivityViewModel, onTxn: (String) -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()

    // Keep showing the last list while a search reload is in flight; only blank on first load.
    val data: List<Txn>? = if (state.loading && state.txns.isEmpty()) null else state.txns

    LoadState(
        loading = state.loading,
        error = state.error,
        data = data,
        empty = state.txns.isEmpty(),
        emptyText = "No transactions found.",
        onRetry = vm::load,
    ) { txns ->
        val groups = txns.groupBy { istDayKey(it.occurred_at ?: it.created_at) }
        val dayKeys = groups.keys.sortedDescending()

        LazyColumn(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 90.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                Text(
                    "Activity",
                    color = Tokens.Text,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 32.sp,
                    modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
                )
            }
            item {
                OutlinedTextField(
                    value = state.query,
                    onValueChange = vm::setQuery,
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Search transactions", color = Tokens.Muted) },
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = Tokens.Text,
                        unfocusedTextColor = Tokens.Text,
                        focusedBorderColor = Tokens.Accent,
                        unfocusedBorderColor = Tokens.Hairline,
                        cursorColor = Tokens.Accent,
                        focusedContainerColor = Tokens.Surface,
                        unfocusedContainerColor = Tokens.Surface,
                    ),
                )
            }
            dayKeys.forEach { key ->
                val dayTxns = groups[key].orEmpty()
                item { SectionLabel(dayHeader(key), modifier = Modifier.padding(top = 4.dp)) }
                item {
                    Card {
                        dayTxns.forEachIndexed { i, t ->
                            SpendRow(
                                merchant = t.merchant,
                                category = t.category,
                                subtitle = "${t.category} · ${shortTime(t.occurred_at ?: t.created_at)}",
                                amount = t.amount,
                                direction = t.direction,
                                modifier = Modifier.clickableNoRipple { onTxn(t.id) },
                            )
                            if (i < dayTxns.lastIndex) HorizontalDivider(color = Tokens.Divider)
                        }
                    }
                }
            }
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
