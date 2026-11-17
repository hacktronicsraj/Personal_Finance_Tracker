package com.personal.financenative.capture

import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Carries an incoming share (from MainActivity's intent) to the nav host.
 *
 * Flashcard import is no longer driven by shares — cards arrive through the web
 * CSV upload page — so a shared ChatGPT link is now just text.
 */
object ShareBus {
    /** A shared payment text to log, or null. */
    val paymentText = MutableStateFlow<String?>(null)

    /** A shared bank-statement PDF (content URI string), or null. */
    val pdfUri = MutableStateFlow<String?>(null)

    /** Set when the user taps the weekly reminder → open the statement flow. */
    val openStatement = MutableStateFlow(false)

    fun offerText(text: String?) {
        if (text.isNullOrBlank()) return
        paymentText.value = text
    }

    fun offerPdf(uri: String?) {
        if (!uri.isNullOrBlank()) pdfUri.value = uri
    }

    fun consumePayment() { paymentText.value = null }
    fun consumePdf() { pdfUri.value = null }
    fun consumeOpenStatement() { openStatement.value = false }
}
