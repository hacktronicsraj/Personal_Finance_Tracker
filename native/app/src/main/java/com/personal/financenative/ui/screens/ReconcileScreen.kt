package com.personal.financenative.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.personal.financenative.data.FinanceRepository
import com.personal.financenative.data.api.StatementDetail
import com.personal.financenative.data.api.StatementItem
import com.personal.financenative.ui.components.Card
import com.personal.financenative.ui.components.LoadState
import com.personal.financenative.ui.components.SectionLabel
import com.personal.financenative.ui.components.rupee
import com.personal.financenative.ui.components.shortDay
import com.personal.financenative.ui.theme.Tokens
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private fun StatementItem.actionable() = kind == "add" || kind == "remove"

data class ReconcileState(
    val loading: Boolean = true,
    val error: String? = null,
    val detail: StatementDetail? = null,
    val decisions: Map<String, Boolean> = emptyMap(),
    val applying: Boolean = false,
)

class ReconcileViewModel(
    private val repo: FinanceRepository,
    private val statementId: String,
) : ViewModel() {
    private val _state = MutableStateFlow(ReconcileState())
    val state: StateFlow<ReconcileState> = _state.asStateFlow()

    init { load() }

    fun load() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            runCatching { repo.statement(statementId) }
                .onSuccess { detail ->
                    val decisions = detail.items
                        .filter { it.actionable() }
                        .associate { it.id to (it.suggested == "approve") }
                    _state.value = _state.value.copy(loading = false, detail = detail, decisions = decisions)
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(loading = false, error = e.message ?: "Couldn't reach the server")
                }
        }
    }

    fun toggle(itemId: String, approve: Boolean) {
        _state.value = _state.value.copy(decisions = _state.value.decisions + (itemId to approve))
    }

    fun apply(onDone: (added: Int, removed: Int) -> Unit) {
        val s = _state.value
        val detail = s.detail ?: return
        _state.value = s.copy(applying = true, error = null)
        val payload = detail.items
            .filter { it.actionable() }
            .associate { it.id to if (s.decisions[it.id] == true) "approve" else "deny" }
        viewModelScope.launch {
            runCatching { repo.applyStatement(statementId, payload) }
                .onSuccess { r ->
                    _state.value = _state.value.copy(applying = false)
                    onDone(r.added, r.removed)
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(applying = false, error = e.message ?: "Couldn't apply changes")
                }
        }
    }
}

@Composable
fun ReconcileScreen(vm: ReconcileViewModel, onDone: () -> Unit, onBack: () -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize().background(Tokens.Bg)) {
        LoadState(
            loading = state.loading,
            error = state.error.takeIf { state.detail == null },
            data = state.detail,
            onRetry = vm::load,
        ) { detail ->
            ReconcileContent(
                detail = detail,
                decisions = state.decisions,
                applying = state.applying,
                error = state.error,
                onToggle = vm::toggle,
                onApply = { vm.apply { _, _ -> onDone() } },
                onDone = onDone,
                onBack = onBack,
            )
        }
    }
}

@Composable
private fun ReconcileContent(
    detail: StatementDetail,
    decisions: Map<String, Boolean>,
    applying: Boolean,
    error: String?,
    onToggle: (String, Boolean) -> Unit,
    onApply: () -> Unit,
    onDone: () -> Unit,
    onBack: () -> Unit,
) {
    val st = detail.statement
    val matched = detail.items.count { it.kind == "match" }
    val adds = detail.items.filter { it.kind == "add" }
    val removes = detail.items.filter { it.kind == "remove" }
    val checkedCount = (adds + removes).count { decisions[it.id] == true }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 100.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "‹ Back",
                    color = Tokens.Sub,
                    fontSize = 14.sp,
                    modifier = Modifier.clickable(onClick = onBack).padding(vertical = 8.dp, horizontal = 4.dp),
                )
            }
            Text("Reconcile", color = Tokens.Text, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
        }
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(st.bank ?: "Statement", color = Tokens.Text, fontSize = 17.sp, fontWeight = FontWeight.Medium)
                    Text(
                        "${st.period_start?.let { shortDay(it) } ?: "?"} – ${st.period_end?.let { shortDay(it) } ?: "?"}",
                        color = Tokens.Sub,
                        fontSize = 13.sp,
                    )
                    Text(
                        "$matched matched · ${adds.size} to add · ${removes.size} to remove",
                        color = Tokens.Muted,
                        fontSize = 13.sp,
                    )
                }
            }
        }

        if (adds.isEmpty() && removes.isEmpty()) {
            item {
                Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text("Everything already matches — nothing to reconcile.", color = Tokens.Sub, fontSize = 15.sp)
                    Button(
                        onClick = onDone,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = Tokens.Accent, contentColor = Tokens.Bg),
                    ) { Text("Done") }
                }
            }
        } else {
            if (adds.isNotEmpty()) {
                item { SectionLabel("ADD — not captured yet", Modifier.padding(top = 12.dp)) }
                items(adds, key = { it.id }) { item ->
                    ItemRow(item, decisions[item.id] == true) { onToggle(item.id, it) }
                }
            }
            if (removes.isNotEmpty()) {
                item { SectionLabel("REMOVE — not on the statement", Modifier.padding(top = 12.dp)) }
                items(removes, key = { it.id }) { item ->
                    ItemRow(item, decisions[item.id] == true) { onToggle(item.id, it) }
                }
            }
            item {
                Column(Modifier.fillMaxWidth().padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (error != null) Text(error, color = Tokens.Neg, fontSize = 13.sp)
                    Button(
                        onClick = onApply,
                        enabled = !applying,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Tokens.Accent, contentColor = Tokens.Bg),
                    ) {
                        if (applying) {
                            CircularProgressIndicator(Modifier.size(18.dp), color = Tokens.Bg, strokeWidth = 2.dp)
                        } else {
                            Text("Apply changes ($checkedCount)")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ItemRow(item: StatementItem, checked: Boolean, onChange: (Boolean) -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, top = 8.dp, bottom = 8.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    item.merchant ?: item.description ?: "Unknown",
                    color = Tokens.Text,
                    fontSize = 15.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    listOfNotNull(item.amount?.let { rupee(it) }, item.date?.let { shortDay(it) }).joinToString(" · "),
                    color = Tokens.Sub,
                    fontSize = 13.sp,
                )
                if (!item.note.isNullOrBlank()) {
                    Text(item.note, color = Tokens.Muted, fontSize = 12.sp)
                }
            }
            Checkbox(
                checked = checked,
                onCheckedChange = onChange,
                colors = CheckboxDefaults.colors(
                    checkedColor = Tokens.Accent,
                    uncheckedColor = Tokens.Muted,
                    checkmarkColor = Tokens.Bg,
                ),
            )
        }
    }
}
