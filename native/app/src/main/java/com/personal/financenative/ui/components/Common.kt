package com.personal.financenative.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.personal.financenative.ui.theme.Tokens

/** A round monogram for a payee (first letter). */
@Composable
fun Monogram(name: String?, size: Int = 44) {
    val letter = name?.trim()?.firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(Tokens.Surface2),
        contentAlignment = Alignment.Center,
    ) {
        Text(letter, color = Tokens.Sub, fontWeight = FontWeight.SemiBold, fontSize = (size * 0.4).sp)
    }
}

/** Small category color dot. */
@Composable
fun CategoryDot(category: String?, size: Int = 9) {
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(Tokens.categoryColor(category)),
    )
}

/** A rounded surface panel. */
@Composable
fun Card(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Tokens.Surface)
            .padding(18.dp),
    ) { content() }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        color = Tokens.Muted,
        fontWeight = FontWeight.Bold,
        fontSize = 11.sp,
        letterSpacing = 1.sp,
        modifier = modifier,
    )
}

/** One transaction line: monogram, name + category·day, signed amount. */
@Composable
fun SpendRow(
    merchant: String?,
    category: String?,
    subtitle: String,
    amount: Double,
    direction: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Monogram(merchant)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                merchant ?: "Unknown",
                color = Tokens.Text,
                fontWeight = FontWeight.SemiBold,
                fontSize = 15.sp,
                maxLines = 1,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                CategoryDot(category, size = 7)
                Spacer(Modifier.width(6.dp))
                Text(subtitle, color = Tokens.Muted, fontSize = 12.5.sp, maxLines = 1)
            }
        }
        Spacer(Modifier.width(8.dp))
        Text(
            signedRupee(amount, direction),
            color = if (direction == "credit") Tokens.Accent else Tokens.Text,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
        )
    }
}

/** Standard loading / error / empty wrapper so screens behave consistently. */
@Composable
fun <T> LoadState(
    loading: Boolean,
    error: String?,
    data: T?,
    empty: Boolean = false,
    emptyText: String = "Nothing here yet.",
    onRetry: (() -> Unit)? = null,
    content: @Composable (T) -> Unit,
) {
    when {
        loading && data == null -> Box(Modifier.fillMaxSize(), Alignment.Center) {
            CircularProgressIndicator(color = Tokens.Accent)
        }
        error != null && data == null -> Box(Modifier.fillMaxSize(), Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("⚠️", fontSize = 32.sp)
                Text(error, color = Tokens.Muted, fontSize = 13.sp)
                if (onRetry != null) Text("Tap to retry", color = Tokens.Accent, fontSize = 13.sp,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Tokens.AccentDim).padding(horizontal = 14.dp, vertical = 8.dp))
            }
        }
        data != null && empty -> Box(Modifier.fillMaxSize(), Alignment.Center) {
            Text(emptyText, color = Tokens.Muted, fontSize = 13.sp)
        }
        data != null -> content(data)
    }
}
