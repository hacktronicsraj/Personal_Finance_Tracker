package com.personal.financenative.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import android.widget.Toast
import kotlinx.coroutines.delay
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.personal.financenative.data.FinanceRepository
import com.personal.financenative.focus.FocusController
import com.personal.financenative.focus.FocusPrefs
import com.personal.financenative.focus.Gate
import com.personal.financenative.ui.components.Card
import com.personal.financenative.ui.components.SectionLabel
import com.personal.financenative.ui.theme.Tokens

@Composable
fun FocusScreen(
    controller: FocusController,
    repo: FinanceRepository,
    onOpenUsage: () -> Unit,
    onOpenHistory: () -> Unit,
) {
    var refresh by remember { mutableIntStateOf(0) }
    val context = LocalContext.current
    LifecycleResumeEffect(Unit) {
        controller.startWatcher()
        refresh++
        onPauseOrDispose { }
    }

    val usedMinutes = remember(refresh) { controller.usedMinutesToday() }
    val overlayOk = remember(refresh) { controller.canDrawOverlays() }
    val usageOk = remember(refresh) { controller.hasUsageAccess() }
    val flashcardCount by produceState(initialValue = 0, refresh) { value = repo.flashcardCount() }

    val prefs = remember(refresh) { FocusPrefs(context) }
    val cleared = remember(refresh) { prefs.clearedToday }
    val sinceCheckpoint = remember(refresh) { controller.usedSinceCheckpoint() }
    val owed = !Gate.decide(sinceCheckpoint).allowed

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 90.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            "Focus",
            color = Tokens.Text,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 32.sp,
            modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
        )

        Card {
            SectionLabel("Instagram today")
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    "$usedMinutes",
                    color = if (owed) Tokens.Amber else Tokens.Accent,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 32.sp,
                )
                Text(
                    "min",
                    color = Tokens.Muted,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    modifier = Modifier.padding(start = 4.dp, bottom = 4.dp),
                )
            }
            Spacer(Modifier.height(10.dp))
            // Progress toward the NEXT checkpoint, not toward a cap.
            val progress = if (owed) 1f
            else (sinceCheckpoint.toFloat() / Gate.CHECKPOINT_MIN).coerceIn(0f, 1f)
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
                        .fillMaxWidth(progress.coerceAtLeast(0.02f))
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (owed) Tokens.Amber else Tokens.Accent),
                )
            }
            Spacer(Modifier.height(10.dp))
            Text(
                when {
                    owed -> "A flashcard checkpoint is due. Answer the cards to open Instagram."
                    else -> {
                        val left = Gate.minutesUntilNextCheckpoint(sinceCheckpoint)
                        if (left == 0) "Next open needs flashcards."
                        else "$sinceCheckpoint of ${Gate.CHECKPOINT_MIN} min used since your last checkpoint — " +
                            "$left min of Instagram left before the next one."
                    }
                },
                color = Tokens.Sub,
                fontSize = 13.sp,
                lineHeight = 18.sp,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "${cleared} checkpoint${if (cleared == 1) "" else "s"} cleared today",
                color = Tokens.Muted,
                fontSize = 12.sp,
            )
        }

        Card {
            SectionLabel("Flashcards")
            Spacer(Modifier.height(10.dp))
            Text(
                "$flashcardCount",
                color = Tokens.Text,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 32.sp,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                "Built from the ChatGPT chats you share into this app. Share a conversation (⋯ → Share → Finance) to add more.",
                color = Tokens.Sub,
                fontSize = 13.sp,
                lineHeight = 18.sp,
            )
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(Tokens.Surface)
                .clickable(onClick = onOpenUsage)
                .padding(horizontal = 18.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Screen time", color = Tokens.Text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text("→", color = Tokens.Accent, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(Tokens.Surface)
                .clickable(onClick = onOpenHistory)
                .padding(horizontal = 18.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text("Instagram history", color = Tokens.Text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Text("Hours per day, and every open", color = Tokens.Muted, fontSize = 12.sp)
            }
            Text("→", color = Tokens.Accent, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }

        SectionLabel("Permissions", modifier = Modifier.padding(start = 2.dp, top = 4.dp))

        Card {
            PermissionRow(
                label = "Display over other apps",
                ok = overlayOk,
                hint = "Lets the checkpoint open on top of Instagram. Required. " +
                    "(No accessibility service, so payment apps aren't blocked.)",
                actionLabel = "Allow",
                onAction = controller::openOverlaySettings,
            )
            Spacer(Modifier.height(16.dp))
            PermissionRow(
                label = "Usage access",
                ok = usageOk,
                hint = "Counts your Instagram minutes so checkpoints come due on time. Required.",
                actionLabel = "Grant",
                onAction = controller::openUsageAccessSettings,
            )
        }

        Text(
            "Every ${Gate.CHECKPOINT_MIN} minutes of actual Instagram use, a flashcard checkpoint comes due. " +
                "Minutes carry over across days — only time spent in Instagram counts, not the clock. " +
                "Clearing the cards is the only thing that opens Instagram.",
            color = Tokens.Muted,
            fontSize = 12.sp,
            lineHeight = 18.sp,
            modifier = Modifier.padding(4.dp),
        )
    }
}


@Composable
private fun PermissionRow(
    label: String,
    ok: Boolean,
    hint: String,
    actionLabel: String,
    onAction: () -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(9.dp)
                    .clip(CircleShape)
                    .background(if (ok) Tokens.Accent else Tokens.Neg),
            )
            Spacer(Modifier.width(10.dp))
            Text(label, color = Tokens.Text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        }
        Spacer(Modifier.height(6.dp))
        Text(
            hint,
            color = Tokens.Muted,
            fontSize = 12.5.sp,
            lineHeight = 17.sp,
            modifier = Modifier.padding(start = 19.dp),
        )
        if (!ok) {
            OutlinedButton(
                onClick = onAction,
                modifier = Modifier.padding(top = 10.dp, start = 19.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Tokens.Accent),
            ) {
                Text(actionLabel, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            }
        }
    }
}
