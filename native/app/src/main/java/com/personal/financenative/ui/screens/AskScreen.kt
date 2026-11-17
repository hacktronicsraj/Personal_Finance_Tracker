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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.personal.financenative.data.FinanceRepository
import com.personal.financenative.ui.theme.Tokens
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class Msg(val role: String, val text: String)

data class AskState(
    val messages: List<Msg> = emptyList(),
    val sending: Boolean = false,
)

class AskViewModel(private val repo: FinanceRepository) : ViewModel() {
    private val _state = MutableStateFlow(AskState())
    val state: StateFlow<AskState> = _state.asStateFlow()

    fun send(question: String) {
        if (question.isBlank() || _state.value.sending) return
        _state.value = _state.value.copy(
            messages = _state.value.messages + Msg("user", question),
            sending = true,
        )
        viewModelScope.launch {
            runCatching { repo.ask(question) }
                .onSuccess { answer ->
                    _state.value = _state.value.copy(
                        messages = _state.value.messages + Msg("assistant", answer),
                        sending = false,
                    )
                }
                .onFailure {
                    _state.value = _state.value.copy(
                        messages = _state.value.messages + Msg(
                            "assistant",
                            "Sorry, I couldn't work that out — mind trying again?",
                        ),
                        sending = false,
                    )
                }
        }
    }
}

private val suggestions = listOf(
    "How much did I spend this month?",
    "What's my biggest category?",
    "How much on food?",
)

@Composable
fun AskScreen(vm: AskViewModel, onBack: () -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()

    LaunchedEffect(state.messages.size) {
        if (state.messages.isNotEmpty()) listState.animateScrollToItem(state.messages.size - 1)
    }

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
            Text("Ask your money", color = Tokens.Text, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (state.messages.isEmpty()) {
                EmptyHint(onSuggestion = vm::send)
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    itemsIndexed(state.messages, key = { i, _ -> i }) { _, msg -> MessageBubble(msg) }
                }
            }
        }

        Composer(sending = state.sending, onSend = vm::send)
    }
}

@Composable
private fun EmptyHint(onSuggestion: (String) -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            "Ask anything about your spending",
            color = Tokens.Sub,
            fontWeight = FontWeight.SemiBold,
            fontSize = 16.sp,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.size(4.dp))
        Text(
            "I'll dig through your transactions for the answer.",
            color = Tokens.Muted,
            fontSize = 13.sp,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.size(20.dp))
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            suggestions.forEach { s ->
                Text(
                    s,
                    color = Tokens.Text,
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier
                        .clip(RoundedCornerShape(20.dp))
                        .background(Tokens.Surface2)
                        .clickableNoRipple { onSuggestion(s) }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                )
            }
        }
    }
}

@Composable
private fun MessageBubble(msg: Msg) {
    val isUser = msg.role == "user"
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start) {
        Text(
            msg.text,
            color = if (isUser) Tokens.Bg else Tokens.Text,
            fontSize = 14.5.sp,
            modifier = Modifier
                .widthIn(max = 280.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(if (isUser) Tokens.Text else Tokens.Surface2)
                .padding(horizontal = 14.dp, vertical = 10.dp),
        )
    }
}

@Composable
private fun Composer(sending: Boolean, onSend: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    val canSend = text.isNotBlank() && !sending

    Row(
        Modifier.fillMaxWidth().padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier.weight(1f),
            placeholder = { Text("Ask about your spending…", color = Tokens.Ghost, fontSize = 14.sp) },
            textStyle = TextStyle(color = Tokens.Text, fontSize = 14.sp),
            singleLine = true,
            shape = RoundedCornerShape(24.dp),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Tokens.Surface2,
                unfocusedContainerColor = Tokens.Surface2,
                disabledContainerColor = Tokens.Surface2,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                cursorColor = Tokens.Accent,
            ),
        )
        Spacer(Modifier.width(8.dp))
        IconButton(
            onClick = { if (canSend) { onSend(text); text = "" } },
            enabled = canSend,
            modifier = Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(if (canSend) Tokens.Accent else Tokens.Surface2),
        ) {
            if (sending) {
                CircularProgressIndicator(color = Tokens.Muted, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
            } else {
                Icon(
                    Icons.AutoMirrored.Outlined.Send,
                    contentDescription = "Send",
                    tint = if (canSend) Tokens.Bg else Tokens.Muted,
                )
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
