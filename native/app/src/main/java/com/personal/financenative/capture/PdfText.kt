package com.personal.financenative.capture

import android.content.Context
import android.net.Uri
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper

/**
 * On-device bank-statement PDF text extraction. The statement (and its password)
 * never leave the phone — only the extracted text is uploaded to reconcile.
 */
object PdfText {
    @Volatile private var initialized = false

    private fun ensureInit(context: Context) {
        if (!initialized) {
            PDFBoxResourceLoader.init(context.applicationContext)
            initialized = true
        }
    }

    class NeedsPassword : Exception("This PDF is password-protected.")

    /** Extract per-page text from a shared/picked PDF. `password` for locked PDFs. */
    fun extractPages(context: Context, uri: Uri, password: String? = null): List<String> {
        ensureInit(context)
        val input = context.contentResolver.openInputStream(uri)
            ?: throw IllegalStateException("Couldn't open the PDF.")
        input.use { stream ->
            val doc = try {
                if (password != null) PDDocument.load(stream, password) else PDDocument.load(stream)
            } catch (e: com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException) {
                throw NeedsPassword()
            }
            doc.use { d ->
                val stripper = PDFTextStripper()
                val pages = ArrayList<String>(d.numberOfPages)
                for (p in 1..d.numberOfPages) {
                    stripper.startPage = p
                    stripper.endPage = p
                    pages.add(stripper.getText(d))
                }
                return pages
            }
        }
    }
}
