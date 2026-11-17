package com.personal.financenative.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.personal.financenative.BuildConfig
import com.personal.financenative.data.FinanceRepository
import com.personal.financenative.ui.components.Card
import com.personal.financenative.ui.components.SectionLabel
import com.personal.financenative.ui.theme.Tokens

@Composable
fun SettingsScreen(repo: FinanceRepository, onReconcileStatement: () -> Unit = {}) {
    val health by produceState<Boolean?>(initialValue = null) { value = repo.health() }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Settings", color = Tokens.Text, fontWeight = FontWeight.ExtraBold, fontSize = 32.sp,
            modifier = Modifier.padding(top = 8.dp, bottom = 4.dp))

        Card(modifier = Modifier.clickable(onClick = onReconcileStatement)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Reconcile a statement", color = Tokens.Text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                    Text("Upload a bank PDF to catch anything the app missed.", color = Tokens.Muted, fontSize = 12.5.sp)
                }
                Text("→", color = Tokens.Accent, fontSize = 18.sp)
            }
        }

        Card {
            SectionLabel("Backend")
            Spacer(Modifier.height(10.dp))
            KeyVal("Status", when (health) {
                null -> "Checking…"; true -> "● Connected"; false -> "● Unreachable"
            }, valueColor = when (health) { true -> Tokens.Accent; false -> Tokens.Neg; else -> Tokens.Sub })
            KeyVal("Endpoint", BuildConfig.BASE_URL.removePrefix("https://").removeSuffix("/"))
            KeyVal("Auth", if (BuildConfig.API_TOKEN.isNotBlank()) "Token set" else "Open")
        }

        Card {
            SectionLabel("App")
            Spacer(Modifier.height(10.dp))
            KeyVal("Build", "Native • Kotlin + Compose")
            KeyVal("Version", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
            KeyVal("Package", "com.personal.financenative")
        }

        Text(
            "Fresh native build on its own Worker + D1. Deep phone-usage tracking and the Focus gate land in upcoming phases.",
            color = Tokens.Muted, fontSize = 12.sp, lineHeight = 18.sp, modifier = Modifier.padding(4.dp),
        )
    }
}

@Composable
private fun KeyVal(key: String, value: String, valueColor: androidx.compose.ui.graphics.Color = Tokens.Text) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(key, color = Tokens.Sub, fontSize = 14.sp)
        Spacer(Modifier.width(12.dp))
        Text(value, color = valueColor, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}
