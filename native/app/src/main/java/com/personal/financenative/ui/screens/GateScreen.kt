package com.personal.financenative.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.personal.financenative.data.FinanceRepository
import com.personal.financenative.data.api.QuizCard
import com.personal.financenative.focus.Gate
import com.personal.financenative.ui.components.Card
import com.personal.financenative.ui.components.CountryOnMap
import com.personal.financenative.ui.components.mapCodeOf
import com.personal.financenative.ui.theme.Tokens
import kotlinx.coroutines.launch

/** Full-screen Instagram gate — the only thing between the user and the feed. */
@Composable
fun GateScreen(
    reason: Gate.Reason,
    repo: FinanceRepository,
    onPass: () -> Unit,
    onCancel: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .padding(24.dp),
    ) {
        when (reason) {
            Gate.Reason.FLASHCARDS -> FlashcardsGate(repo, onPass, onCancel)
            Gate.Reason.ALLOW -> AllowGate(onPass)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FlashcardsGate(repo: FinanceRepository, onPass: () -> Unit, onCancel: () -> Unit) {
    val scope = rememberCoroutineScope()
    var loading by remember { mutableStateOf(true) }
    var cards by remember { mutableStateOf<List<QuizCard>>(emptyList()) }
    var picks by remember { mutableStateOf<Map<String, Int>>(emptyMap()) }
    var grading by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    var noCards by remember { mutableStateOf(false) }
    // Correct option per missed card, shown during the retry round. A retry
    // re-asks cards whose answer was just revealed, so the server treats it as
    // practice and leaves their spaced-repetition schedule alone.
    var reveal by remember { mutableStateOf<Map<String, Int>>(emptyMap()) }

    // The checkpoint set. Wrong answers come back until every card is right, so
    // `cards` shrinks to just the misses rather than being replaced.
    fun loadQuiz() {
        scope.launch {
            loading = true
            picks = emptyMap()
            reveal = emptyMap()
            val quiz = repo.quiz(7)
            if (quiz.cards.isEmpty()) {
                noCards = true
            } else {
                cards = quiz.cards
            }
            loading = false
        }
    }

    LaunchedEffect(Unit) { loadQuiz() }

    if (noCards) {
        EmptyDeckGate(onCancel)
        return
    }

    if (loading && cards.isEmpty()) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            CircularProgressIndicator(color = Tokens.Accent)
        }
        return
    }

    val allAnswered = cards.isNotEmpty() && cards.all { picks.containsKey(it.id) }

    Column(Modifier.fillMaxSize()) {
        Text("🧠", fontSize = 32.sp)
        Text(
            "Answer these to open Instagram",
            color = Tokens.Text,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 22.sp,
            modifier = Modifier.padding(top = 8.dp),
        )
        if (result != null) {
            Text(result!!, color = Tokens.Amber, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .padding(top = 20.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            cards.forEachIndexed { index, card ->
                Card(modifier = Modifier.padding(bottom = 14.dp)) {
                    val (prompt, flag) = splitFlag(card.question)
                    val mapIso = card.question.lines().lastOrNull()?.let { mapCodeOf(it) }
                    Text(
                        "${index + 1}. $prompt",
                        color = Tokens.Text,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp,
                    )
                    if (flag != null) {
                        Text(flag, fontSize = 72.sp, modifier = Modifier.padding(top = 6.dp))
                    }
                    if (mapIso != null) {
                        CountryOnMap(mapIso, Modifier.padding(top = 10.dp))
                    }
                    reveal[card.id]?.let { right ->
                        Text(
                            "Answer: ${card.options.getOrNull(right) ?: ""}",
                            color = Tokens.Amber,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                    }
                    FlowRow(
                        modifier = Modifier.padding(top = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        card.options.forEachIndexed { optionIndex, option ->
                            val selected = picks[card.id] == optionIndex
                            Text(
                                option,
                                color = if (selected) Tokens.Bg else Tokens.Sub,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 13.sp,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(20.dp))
                                    .background(if (selected) Tokens.Accent else Tokens.Surface2)
                                    .clickable { picks = picks + (card.id to optionIndex) }
                                    .padding(horizontal = 14.dp, vertical = 8.dp),
                            )
                        }
                    }
                }
            }
            Box(Modifier.height(4.dp))
        }

        Button(
            onClick = {
                scope.launch {
                    grading = true
                    val grade = repo.grade(picks, retry = reveal.isNotEmpty())
                    grading = false
                    if (grade.passed) {
                        onPass()
                    } else {
                        // Keep only the misses: they come back until every card in
                        // the set is answered correctly.
                        val missed = grade.results.filter { !it.correct }.map { it.id }.toSet()
                        val remaining = cards.filter { it.id in missed }
                        if (remaining.isEmpty()) {
                            // Server said not passed but flagged nothing wrong —
                            // don't strand the user; ask for a fresh set.
                            result = "Something went wrong. Loading a new set."
                            loadQuiz()
                        } else {
                            result = "${grade.correct}/${grade.total} right — ${remaining.size} to go. " +
                                "Here are the answers; pick them to lock them in."
                            reveal = grade.results.filter { !it.correct }.associate { it.id to it.answer }
                            cards = remaining
                            picks = emptyMap()
                        }
                    }
                }
            },
            enabled = allAnswered && !grading,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Tokens.Accent,
                contentColor = Tokens.Bg,
                disabledContainerColor = Tokens.Surface2,
                disabledContentColor = Tokens.Muted,
            ),
        ) {
            if (grading) {
                CircularProgressIndicator(color = Tokens.Bg, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
            } else {
                Text("Check answers", fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }
        }

        OutlinedButton(
            onClick = onCancel,
            modifier = Modifier.fillMaxWidth().height(48.dp).padding(top = 10.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Tokens.Muted),
        ) {
            Text("Never mind", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        }
    }
}

@Composable
private fun EmptyDeckGate(onCancel: () -> Unit) {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("🗂️", fontSize = 40.sp)
        Text(
            "No flashcards yet",
            color = Tokens.Text,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 22.sp,
            modifier = Modifier.padding(top = 12.dp),
        )
        Text(
            "Upload some cards at the web page, then come back. Instagram stays closed until the deck has cards.",
            color = Tokens.Muted,
            fontSize = 14.sp,
            modifier = Modifier.padding(top = 8.dp, start = 12.dp, end = 12.dp),
        )
        Button(
            onClick = onCancel,
            modifier = Modifier.fillMaxWidth().height(52.dp).padding(top = 28.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Tokens.Accent, contentColor = Tokens.Bg),
        ) {
            Text("Close Instagram", fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }
    }
}

@Composable
private fun AllowGate(onPass: () -> Unit) {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("✅", fontSize = 40.sp)
        Text(
            "You're in",
            color = Tokens.Text,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 22.sp,
            modifier = Modifier.padding(top = 12.dp),
        )
        Button(
            onClick = onPass,
            modifier = Modifier.fillMaxWidth().height(52.dp).padding(top = 28.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Tokens.Accent, contentColor = Tokens.Bg),
        ) {
            Text("Continue", fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }
    }
}

/**
 * Splits "Which country's flag is this?\n🇫🇷" into the prompt and the flag, so
 * the flag can be drawn large. A trailing `[map:XX]` line is dropped from the
 * prompt too; the card draws the map for it.
 */
private fun splitFlag(question: String): Pair<String, String?> {
    val lines = question.split("\n")
    val last = lines.last().trim()
    if (lines.size > 1 && mapCodeOf(last) != null) return lines.dropLast(1).joinToString("\n") to null
    val isFlag = lines.size > 1 && last.isNotEmpty() &&
        last.codePoints().allMatch { it in 0x1F1E6..0x1F1FF }
    return if (isFlag) lines.dropLast(1).joinToString("\n") to last else question to null
}
