package com.personal.financenative.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.personal.financenative.capture.PdfText
import com.personal.financenative.data.FinanceRepository
import com.personal.financenative.ui.theme.Tokens
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private sealed interface ImportUi {
    data object Idle : ImportUi
    data class Working(val status: String) : ImportUi
    data class Password(val uri: Uri, val error: Boolean) : ImportUi
    data class Error(val message: String) : ImportUi
}

/**
 * Pick or receive a bank-statement PDF, extract its text on-device (password
 * unlocked here), upload only the text, and hand off to the reconcile screen.
 */
@Composable
fun StatementImportScreen(
    repo: FinanceRepository,
    incomingUri: String?,
    onReconcile: (String) -> Unit,
    onCancel: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var ui by remember { mutableStateOf<ImportUi>(ImportUi.Idle) }

    fun process(uri: Uri, password: String?) {
        ui = ImportUi.Working("Reading the PDF…")
        scope.launch {
            try {
                val pages = withContext(Dispatchers.IO) { PdfText.extractPages(context, uri, password) }
                ui = ImportUi.Working("Reconciling with your ledger…")
                val result = repo.uploadStatement(pages)
                onReconcile(result.id)
            } catch (e: PdfText.NeedsPassword) {
                ui = ImportUi.Password(uri, error = password != null)
            } catch (e: Exception) {
                ui = ImportUi.Error(e.message ?: "Couldn't read that statement.")
            }
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) process(uri, null) else if (incomingUri == null) onCancel()
    }

    LaunchedEffect(incomingUri) {
        if (incomingUri != null) process(Uri.parse(incomingUri), null)
    }

    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        when (val s = ui) {
            is ImportUi.Idle -> {
                Text("🧾", fontSize = 40.sp)
                Text("Reconcile a statement", color = Tokens.Text, fontWeight = FontWeight.Bold, fontSize = 20.sp,
                    modifier = Modifier.padding(top = 10.dp, bottom = 6.dp))
                Text(
                    "Pick your bank statement PDF. It stays on your phone — only the extracted text is sent to reconcile against your ledger.",
                    color = Tokens.Muted, fontSize = 13.5.sp, modifier = Modifier.padding(bottom = 20.dp),
                )
                Button(
                    onClick = { picker.launch(arrayOf("application/pdf")) },
                    colors = ButtonDefaults.buttonColors(containerColor = Tokens.Accent, contentColor = Tokens.Bg),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Choose PDF", fontWeight = FontWeight.SemiBold) }
                TextButton(onClick = onCancel) { Text("Cancel", color = Tokens.Muted) }
            }

            is ImportUi.Working -> {
                CircularProgressIndicator(color = Tokens.Accent)
                Text(s.status, color = Tokens.Text, fontWeight = FontWeight.SemiBold, fontSize = 16.sp,
                    modifier = Modifier.padding(top = 16.dp))
                Text("Your statement stays on the phone.", color = Tokens.Muted, fontSize = 12.5.sp,
                    modifier = Modifier.padding(top = 6.dp))
            }

            is ImportUi.Password -> {
                var pw by remember { mutableStateOf("") }
                Text("🔒", fontSize = 40.sp)
                Text("Password-protected PDF", color = Tokens.Text, fontWeight = FontWeight.Bold, fontSize = 18.sp,
                    modifier = Modifier.padding(top = 10.dp, bottom = 6.dp))
                if (s.error) Text("Wrong password — try again.", color = Tokens.Neg, fontSize = 13.sp,
                    modifier = Modifier.padding(bottom = 8.dp))
                OutlinedTextField(
                    value = pw, onValueChange = { pw = it },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = { process(s.uri, pw) }, enabled = pw.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(containerColor = Tokens.Accent, contentColor = Tokens.Bg),
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                ) { Text("Unlock", fontWeight = FontWeight.SemiBold) }
                TextButton(onClick = onCancel) { Text("Cancel", color = Tokens.Muted) }
            }

            is ImportUi.Error -> {
                Text("🧾", fontSize = 40.sp)
                Text(s.message, color = Tokens.Muted, fontSize = 14.sp, modifier = Modifier.padding(vertical = 14.dp))
                Button(
                    onClick = onCancel,
                    colors = ButtonDefaults.buttonColors(containerColor = Tokens.Surface2, contentColor = Tokens.Text),
                ) { Text("Close") }
            }
        }
    }
}
