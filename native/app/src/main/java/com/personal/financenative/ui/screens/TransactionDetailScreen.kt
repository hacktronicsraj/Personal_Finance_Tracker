package com.personal.financenative.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.personal.financenative.data.FinanceRepository
import com.personal.financenative.data.api.Category
import com.personal.financenative.data.api.PatchTxnRequest
import com.personal.financenative.data.api.Txn
import com.personal.financenative.ui.components.Card
import com.personal.financenative.ui.components.CategoryDot
import com.personal.financenative.ui.components.LoadState
import com.personal.financenative.ui.components.SectionLabel
import com.personal.financenative.ui.components.fullDateTime
import com.personal.financenative.ui.components.rupee
import com.personal.financenative.ui.theme.Tokens
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class DetailState(
    val loading: Boolean = true,
    val error: String? = null,
    val txn: Txn? = null,
    val categories: List<Category> = emptyList(),
)

class TransactionDetailViewModel(
    private val repo: FinanceRepository,
    private val txnId: String,
) : ViewModel() {
    private val _state = MutableStateFlow(DetailState())
    val state: StateFlow<DetailState> = _state.asStateFlow()

    init { load() }

    fun load() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            runCatching {
                val txnDeferred = async { repo.transactions(limit = 500).firstOrNull { it.id == txnId } }
                val categoriesDeferred = async { repo.categories() }
                txnDeferred.await() to categoriesDeferred.await()
            }.onSuccess { (txn, categories) ->
                _state.value = _state.value.copy(loading = false, txn = txn, categories = categories)
            }.onFailure { e ->
                _state.value = _state.value.copy(loading = false, error = e.message ?: "Couldn't reach the server")
            }
        }
    }

    fun changeCategory(category: String) {
        viewModelScope.launch {
            runCatching { repo.patchTransaction(txnId, PatchTxnRequest(category = category)) }
                .onSuccess { updated -> _state.value = _state.value.copy(txn = updated) }
        }
    }

    fun delete(onDeleted: () -> Unit) {
        viewModelScope.launch {
            runCatching { repo.deleteTransaction(txnId) }.onSuccess { onDeleted() }
        }
    }
}

@Composable
fun TransactionDetailScreen(vm: TransactionDetailViewModel, onBack: () -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()

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
            Text("Transaction", color = Tokens.Text, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }

        LoadState(
            loading = state.loading,
            error = state.error,
            data = state.txn,
            onRetry = vm::load,
        ) { txn ->
            TransactionDetailBody(
                txn = txn,
                categories = state.categories,
                onChangeCategory = vm::changeCategory,
                onDelete = { vm.delete(onBack) },
            )
        }
    }
}

@Composable
private fun TransactionDetailBody(
    txn: Txn,
    categories: List<Category>,
    onChangeCategory: (String) -> Unit,
    onDelete: () -> Unit,
) {
    var confirmDelete by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Card {
                Text(
                    (if (txn.direction == "credit") "+" else "-") + rupee(txn.amount, withDecimals = true),
                    color = if (txn.direction == "credit") Tokens.Accent else Tokens.Text,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 36.sp,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    txn.merchant ?: txn.merchant_raw ?: "Unknown",
                    color = Tokens.Text,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 18.sp,
                )
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CategoryDot(txn.category, size = 8)
                    Spacer(Modifier.width(6.dp))
                    Text(fullDateTime(txn.occurred_at ?: txn.created_at), color = Tokens.Sub, fontSize = 13.sp)
                }
                if (txn.notes != null || txn.user_note != null) {
                    Spacer(Modifier.height(14.dp))
                    HorizontalDivider(color = Tokens.Divider)
                    Spacer(Modifier.height(14.dp))
                    txn.notes?.let {
                        Text(it, color = Tokens.Muted, fontSize = 11.5.sp)
                        Spacer(Modifier.height(4.dp))
                    }
                    txn.user_note?.let {
                        Text(it, color = Tokens.Sub, fontSize = 14.sp)
                    }
                }
            }
        }
        item { SectionLabel("Category") }
        item {
            LazyRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(categories, key = { it.id }) { cat ->
                    CategoryChip(cat, selected = cat.name == txn.category, onClick = { onChangeCategory(cat.name) })
                }
            }
        }
        item {
            Text(
                if (confirmDelete) "Tap again to delete" else "Delete",
                color = Tokens.Neg,
                fontWeight = FontWeight.SemiBold,
                fontSize = 15.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Tokens.Neg.copy(alpha = 0.14f))
                    .clickableNoRipple { if (confirmDelete) onDelete() else confirmDelete = true }
                    .padding(vertical = 14.dp),
            )
        }
    }
}

@Composable
private fun CategoryChip(category: Category, selected: Boolean, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(if (selected) Tokens.categoryColor(category.name).copy(alpha = 0.22f) else Tokens.Surface2)
            .clickableNoRipple(onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp),
    ) {
        CategoryDot(category.name, size = 8)
        Spacer(Modifier.width(6.dp))
        Text(
            category.name,
            color = if (selected) Tokens.Text else Tokens.Sub,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            fontSize = 13.5.sp,
        )
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
