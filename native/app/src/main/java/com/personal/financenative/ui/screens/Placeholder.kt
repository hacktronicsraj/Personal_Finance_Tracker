package com.personal.financenative.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.personal.financenative.ui.theme.Tokens

/** Temporary placeholder until the real screen is built (next phase). */
@Composable
fun Placeholder(title: String, emoji: String) {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(emoji, fontSize = 40.sp)
        Text(title, color = Tokens.Text, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Text("Coming next", color = Tokens.Muted, fontSize = 13.sp)
    }
}
