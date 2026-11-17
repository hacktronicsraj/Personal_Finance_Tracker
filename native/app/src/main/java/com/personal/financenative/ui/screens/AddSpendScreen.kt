package com.personal.financenative.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.personal.financenative.data.FinanceRepository
import com.personal.financenative.data.api.AddTxnRequest
import com.personal.financenative.data.api.Category
import com.personal.financenative.ui.components.SectionLabel
import com.personal.financenative.ui.theme.Tokens
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class AddState(
    val categories: List<Category> = emptyList(),
    val submitting: Boolean = false,
    val error: String? = null,
)

class AddSpendViewModel(private val repo: FinanceRepository) : ViewModel() {
    private val _state = MutableStateFlow(AddState())
    val state: StateFlow<AddState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            runCatching { repo.categories() }
                .onSuccess { cats -> _state.value = _state.value.copy(categories = cats) }
        }
    }

    fun submit(amount: Double, merchant: String, category: String?, note: String, onDone: () -> Unit) {
        _state.value = _state.value.copy(submitting = true, error = null)
        viewModelScope.launch {
            runCatching {
                repo.addTransaction(
                    AddTxnRequest(
                        amount = amount,
                        merchant = merchant.ifBlank { null },
                        category = category,
                        note = note.ifBlank { null },
                    ),
                )
            }.onSuccess {
                _state.value = _state.value.copy(submitting = false)
                onDone()
            }.onFailure { e ->
                _state.value = _state.value.copy(submitting = false, error = e.message ?: "Couldn't save")
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AddSpendScreen(vm: AddSpendViewModel, onDone: () -> Unit, onCancel: () -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    val categories = state.categories
    val submitting = state.submitting
    val error = state.error

    var amountText by remember { mutableStateOf("") }
    var merchant by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf<String?>(null) }

    val amount = amountText.toDoubleOrNull()
    val canSave = amount != null && amount > 0 && !submitting

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Add spend", color = Tokens.Text, fontWeight = FontWeight.ExtraBold, fontSize = 26.sp)
            IconButton(onClick = onCancel) {
                Icon(Icons.Outlined.Close, contentDescription = "Cancel", tint = Tokens.Muted)
            }
        }

        Spacer(Modifier.height(8.dp))

        OutlinedTextField(
            value = amountText,
            onValueChange = { amountText = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("0", color = Tokens.Ghost, fontSize = 32.sp) },
            leadingIcon = { Text("₹", color = Tokens.Text, fontWeight = FontWeight.Bold, fontSize = 28.sp) },
            textStyle = TextStyle(color = Tokens.Text, fontWeight = FontWeight.ExtraBold, fontSize = 32.sp),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            singleLine = true,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Tokens.Accent,
                unfocusedBorderColor = Tokens.Hairline,
                cursorColor = Tokens.Accent,
            ),
        )

        Spacer(Modifier.height(20.dp))

        SectionLabel("Merchant")
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = merchant,
            onValueChange = { merchant = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Where'd you spend?", color = Tokens.Ghost, fontSize = 15.sp) },
            textStyle = TextStyle(color = Tokens.Text, fontSize = 15.sp),
            singleLine = true,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Tokens.Accent,
                unfocusedBorderColor = Tokens.Hairline,
                cursorColor = Tokens.Accent,
            ),
        )

        Spacer(Modifier.height(20.dp))

        SectionLabel("Category")
        Spacer(Modifier.height(8.dp))
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            categories.forEach { cat ->
                val selected = selectedCategory == cat.name
                Text(
                    cat.name,
                    color = if (selected) Tokens.Accent else Tokens.Sub,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp,
                    modifier = Modifier
                        .clip(RoundedCornerShape(20.dp))
                        .background(if (selected) Tokens.AccentDim else Tokens.Surface2)
                        .clickable { selectedCategory = if (selected) null else cat.name }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
        }

        Spacer(Modifier.height(20.dp))

        SectionLabel("Note (optional)")
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = note,
            onValueChange = { note = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Add a note", color = Tokens.Ghost, fontSize = 15.sp) },
            textStyle = TextStyle(color = Tokens.Text, fontSize = 15.sp),
            singleLine = true,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Tokens.Accent,
                unfocusedBorderColor = Tokens.Hairline,
                cursorColor = Tokens.Accent,
            ),
        )

        if (error != null) {
            Spacer(Modifier.height(12.dp))
            Text(error, color = Tokens.Neg, fontSize = 13.sp)
        }

        Spacer(Modifier.height(24.dp))

        Button(
            onClick = { amount?.let { vm.submit(it, merchant, selectedCategory, note, onDone) } },
            enabled = canSave,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Tokens.Accent,
                contentColor = Tokens.Bg,
                disabledContainerColor = Tokens.Surface2,
                disabledContentColor = Tokens.Muted,
            ),
        ) {
            if (submitting) {
                CircularProgressIndicator(color = Tokens.Bg, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
            } else {
                Text("Save", fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }
        }

        Spacer(Modifier.height(16.dp))
    }
}
