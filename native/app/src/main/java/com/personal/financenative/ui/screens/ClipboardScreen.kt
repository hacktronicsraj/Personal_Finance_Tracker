package com.personal.financenative.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.Laptop
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewModelScope
import com.personal.financenative.clipboard.ClipboardSync
import com.personal.financenative.data.FinanceRepository
import com.personal.financenative.data.api.ClipItem
import com.personal.financenative.ui.components.SectionLabel
import com.personal.financenative.ui.theme.Tokens
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.time.Duration
import java.time.Instant

/*
 * Shared clipboard with the Mac (Dr Watson), relayed through the pft-native
 * Worker's /clipboard routes.
 *
 *  Mac → phone: the Mac pushes every copy; this screen lists them, newest
 *  first, and a tap puts one on the phone's clipboard.
 *  Phone → Mac: Android only lets the focused app read the clipboard, so the
 *  phone's clipboard is sent whenever this screen gains focus (and on the
 *  "Send" button). The Mac puts it on its pasteboard.
 */

data class ClipState(
    val items: List<ClipItem> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
)

class ClipboardViewModel(private val repo: FinanceRepository, context: Context) : ViewModel() {
    private val app = context.applicationContext
    private val _state = MutableStateFlow(ClipState())
    val state: StateFlow<ClipState> = _state.asStateFlow()

    val deviceId: String = ClipboardSync.deviceId(app)

    suspend fun refresh() {
        runCatching { repo.clipboard() }
            .onSuccess { res -> _state.value = ClipState(items = res.items.filterNot { it.deleted }, loading = false) }
            .onFailure { _state.value = _state.value.copy(loading = false, error = "Can't reach the server") }
    }

    /** Sends the phone's current clipboard text, unless it came from here already. */
    fun sendIfNew(text: String?, force: Boolean = false, onSent: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            val result = ClipboardSync.send(app, repo, text, force)
            if (result == ClipboardSync.Result.SENT) refresh()
            onSent(result == ClipboardSync.Result.SENT)
        }
    }

    fun markTaken(text: String) = ClipboardSync.markSeen(app, text)

    fun delete(id: String) {
        _state.value = _state.value.copy(items = _state.value.items.filterNot { it.id == id })
        viewModelScope.launch { runCatching { repo.deleteClip(id) } }
    }

    suspend fun blob(id: String): ByteArray? = withContext(Dispatchers.IO) { runCatching { repo.clipBlob(id) }.getOrNull() }
}

@Composable
fun ClipboardScreen(vm: ClipboardViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val clipboard = remember { context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val focused = LocalWindowInfo.current.isWindowFocused

    // Poll while the screen is visible.
    LaunchedEffect(Unit) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) { vm.refresh(); delay(4_000) }
        }
    }
    // Phone → Mac: clipboard reads only work once the window has focus.
    LaunchedEffect(focused) {
        if (focused) vm.sendIfNew(ClipboardSync.readText(context))
    }

    val scope = androidx.compose.runtime.rememberCoroutineScope()
    fun toast(msg: String) = Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()

    Column(Modifier.fillMaxSize().background(Tokens.Bg)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Clipboard", color = Tokens.Text, fontWeight = FontWeight.Bold, fontSize = 22.sp)
                Text("Shared with your Mac · tap to copy", color = Tokens.Muted, fontSize = 13.sp)
                Text("Tip: add the \"Send to Mac\" tile to Quick Settings", color = Tokens.Ghost, fontSize = 12.sp)
            }
            Button(
                onClick = {
                    val text = ClipboardSync.readText(context)
                    if (text.isNullOrBlank()) toast("Phone clipboard is empty")
                    else vm.sendIfNew(text, force = true) { ok -> toast(if (ok) "Sent to Mac" else "Couldn't send") }
                },
                colors = ButtonDefaults.buttonColors(containerColor = Tokens.AccentDim, contentColor = Tokens.Accent),
            ) { Text("Send to Mac") }
        }

        when {
            state.loading && state.items.isEmpty() -> Hint("Loading…")
            state.items.isEmpty() -> Hint(state.error ?: "Nothing yet. Copy something on your Mac and it shows up here.")
            else -> LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (state.error != null) item { Text(state.error!!, color = Tokens.Amber, fontSize = 12.sp) }
                item { SectionLabel("Last 7 days", Modifier.padding(start = 4.dp, bottom = 2.dp)) }
                items(state.items, key = { it.id }) { item ->
                    ClipRow(
                        item = item,
                        fromThisPhone = item.deviceId == vm.deviceId,
                        onTap = {
                            when (item.kind) {
                                "text" -> {
                                    val text = item.text.orEmpty()
                                    vm.markTaken(text)
                                    clipboard.setPrimaryClip(ClipData.newPlainText("From Mac", text))
                                    if (Build.VERSION.SDK_INT < 33) toast("Copied")
                                }
                                "image" -> scope.launch {
                                    val bytes = vm.blob(item.id) ?: return@launch toast("Couldn't download")
                                    val uri = withContext(Dispatchers.IO) { cacheImage(context, item, bytes) }
                                    clipboard.setPrimaryClip(ClipData.newUri(context.contentResolver, "Image from Mac", uri))
                                    if (Build.VERSION.SDK_INT < 33) toast("Image copied")
                                }
                                else -> scope.launch {
                                    val bytes = vm.blob(item.id) ?: return@launch toast("Couldn't download")
                                    val saved = withContext(Dispatchers.IO) { saveToDownloads(context, item, bytes) }
                                    toast(if (saved) "Saved to Downloads" else "Couldn't save")
                                }
                            }
                        },
                        onDelete = { vm.delete(item.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun ClipRow(item: ClipItem, fromThisPhone: Boolean, onTap: () -> Unit, onDelete: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Tokens.Surface)
            .clickable(onClick = onTap).padding(start = 14.dp, top = 12.dp, bottom = 12.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            when (item.kind) {
                "image" -> Icons.Outlined.Image
                "file" -> Icons.AutoMirrored.Outlined.InsertDriveFile
                else -> if (fromThisPhone) Icons.Outlined.PhoneAndroid else Icons.Outlined.Laptop
            },
            contentDescription = null, tint = if (fromThisPhone) Tokens.Muted else Tokens.Accent, modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                when (item.kind) {
                    "text" -> item.text.orEmpty()
                    "image" -> "Image" + (item.byteSize?.let { " · ${sizeLabel(it)}" } ?: "")
                    else -> (item.fileName ?: "File") + (item.byteSize?.let { " · ${sizeLabel(it)}" } ?: "")
                },
                color = Tokens.Text, fontSize = 15.sp, maxLines = 4, overflow = TextOverflow.Ellipsis,
            )
            Text(
                (if (fromThisPhone) "This phone" else item.deviceName ?: "Mac") + " · " + ago(item.createdAt),
                color = Tokens.Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 3.dp),
            )
        }
        Icon(
            Icons.Outlined.Close, contentDescription = "Remove", tint = Tokens.Ghost,
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onDelete).padding(10.dp).size(16.dp),
        )
    }
}

@Composable
private fun Hint(text: String) {
    Text(text, color = Tokens.Muted, fontSize = 14.sp, modifier = Modifier.padding(24.dp))
}

private fun cacheImage(context: Context, item: ClipItem, bytes: ByteArray): android.net.Uri {
    val dir = File(context.cacheDir, "clipboard").apply { mkdirs() }
    dir.listFiles()?.forEach { it.delete() }   // keep only the latest
    val ext = if (item.mime == "image/jpeg") "jpg" else "png"
    val file = File(dir, "clip-${item.id.take(8)}.$ext").apply { writeBytes(bytes) }
    return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
}

private fun saveToDownloads(context: Context, item: ClipItem, bytes: ByteArray): Boolean {
    if (Build.VERSION.SDK_INT < 29) return false
    val values = ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, item.fileName ?: "file")
        put(MediaStore.Downloads.MIME_TYPE, item.mime ?: "application/octet-stream")
        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
    }
    val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return false
    return runCatching { context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } != null }.getOrDefault(false)
}

private fun sizeLabel(bytes: Long): String = when {
    bytes >= 1_048_576 -> "%.1f MB".format(bytes / 1_048_576.0)
    bytes >= 1024 -> "${bytes / 1024} KB"
    else -> "$bytes B"
}

private fun ago(iso: String): String {
    val then = runCatching { Instant.parse(iso) }.getOrNull() ?: return ""
    val s = Duration.between(then, Instant.now()).seconds
    return when {
        s < 60 -> "just now"
        s < 3600 -> "${s / 60}m ago"
        s < 86_400 -> "${s / 3600}h ago"
        else -> "${s / 86_400}d ago"
    }
}
