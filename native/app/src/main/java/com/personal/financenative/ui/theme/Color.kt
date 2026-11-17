package com.personal.financenative.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Design tokens — a dark, near-black palette with a green accent, matching the
 * app's established look. One source of truth for every screen.
 */
object Tokens {
    val Bg = Color(0xFF000000)
    val Surface = Color(0xFF121317)
    val Surface2 = Color(0xFF1B1D23)
    val Hairline = Color(0xFF26282F)
    val Divider = Color(0xFF202228)

    val Text = Color(0xFFF4F5F9)
    val Sub = Color(0xFFA6ABB8)
    val Muted = Color(0xFF7B808C)
    val Ghost = Color(0xFF565B66)

    val Accent = Color(0xFF34D399)      // green — primary accent
    val AccentDim = Color(0x2234D399)
    val Amber = Color(0xFFF59E0B)
    val AmberDim = Color(0x22F59E0B)
    val Neg = Color(0xFFF87171)         // red — over-limit / delete

    // Category swatch colors (match the backend seed).
    val CatColors = mapOf(
        "Food & Dining" to Color(0xFFEF4444),
        "Groceries" to Color(0xFFF59E0B),
        "Transport" to Color(0xFF3B82F6),
        "Shopping" to Color(0xFF8B5CF6),
        "Bills & Utilities" to Color(0xFF14B8A6),
        "Entertainment" to Color(0xFFEC4899),
        "Health" to Color(0xFF10B981),
        "Transfers" to Color(0xFF94A3B8),
        "Card Payment" to Color(0xFFA1A1AA),
        "Income" to Color(0xFF22C55E),
        "Other" to Color(0xFF94A3B8),
    )

    fun categoryColor(name: String?): Color = CatColors[name] ?: Color(0xFF94A3B8)
}
