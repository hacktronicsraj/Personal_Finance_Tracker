package com.personal.financenative.ui.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.personal.financenative.data.FinanceRepository
import com.personal.financenative.data.api.AnalyticsSummary
import com.personal.financenative.data.api.Txn
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.ZoneId
import java.time.format.DateTimeFormatter

data class HomeState(
    val loading: Boolean = true,
    val error: String? = null,
    val monthLabel: String = "",
    val summary: AnalyticsSummary? = null,
    val recent: List<Txn> = emptyList(),
)

class HomeViewModel(private val repo: FinanceRepository) : ViewModel() {
    private val _state = MutableStateFlow(HomeState())
    val state: StateFlow<HomeState> = _state.asStateFlow()

    private val ist = ZoneId.of("Asia/Kolkata")

    init { load() }

    fun load() {
        val monthStart = java.time.LocalDate.now(ist).withDayOfMonth(1)
        val fromIso = monthStart.atStartOfDay(ist).toInstant().toString()
        val label = monthStart.format(DateTimeFormatter.ofPattern("MMMM"))
        _state.value = _state.value.copy(loading = true, error = null, monthLabel = label)
        viewModelScope.launch {
            runCatching {
                val summaryDeferred = async { repo.summary(from = fromIso) }
                val recentDeferred = async { repo.transactions(limit = 8) }
                summaryDeferred.await() to recentDeferred.await()
            }.onSuccess { (summary, recent) ->
                _state.value = HomeState(loading = false, monthLabel = label, summary = summary, recent = recent)
            }.onFailure { e ->
                _state.value = _state.value.copy(loading = false, error = e.message ?: "Couldn't reach the server")
            }
        }
    }
}
