package com.personal.financenative.data

import com.personal.financenative.data.api.AddTxnRequest
import com.personal.financenative.data.api.AnalyticsSummary
import com.personal.financenative.data.api.AskRequest
import com.personal.financenative.data.api.Category
import com.personal.financenative.data.api.FinanceApi
import com.personal.financenative.data.api.GradeRequest
import com.personal.financenative.data.api.GradeResponse
import com.personal.financenative.data.api.PatchTxnRequest
import com.personal.financenative.data.api.CategoryTotal
import com.personal.financenative.data.api.QuizResponse
import com.personal.financenative.data.api.Txn
import com.personal.financenative.data.local.TxnDao
import com.personal.financenative.data.local.toEntity
import com.personal.financenative.data.local.toTxn
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Single entry point the UI talks to. Network-first, with a Room cache so Home
 * and Activity keep working offline. */
class FinanceRepository(
    private val api: FinanceApi = Network.api(),
    private val dao: TxnDao? = null,
) {

    /** Network → cache the result → return. On network failure, serve the cache. */
    suspend fun transactions(
        from: String? = null, to: String? = null, category: String? = null,
        q: String? = null, limit: Int? = null,
    ): List<Txn> = try {
        val txns = api.transactions(from, to, category, q, limit).transactions
        dao?.let { withContext(Dispatchers.IO) { it.upsertAll(txns.map(Txn::toEntity)) } }
        txns
    } catch (e: Exception) {
        val d = dao ?: throw e
        withContext(Dispatchers.IO) {
            (if (!q.isNullOrBlank()) d.search(q, limit ?: 500) else d.recent(limit ?: 500)).map { it.toTxn() }
        }
    }

    /** Network → return. Offline → recompute a summary from the cached debits. */
    suspend fun summary(from: String? = null, to: String? = null): AnalyticsSummary = try {
        api.analyticsSummary(from, to)
    } catch (e: Exception) {
        val d = dao ?: throw e
        val rows = withContext(Dispatchers.IO) { d.debitsSince(from ?: "0000") }
        val byCat = rows.groupBy { it.category }
            .map { (cat, list) -> CategoryTotal(cat, list.size, list.sumOf { it.amount }) }
            .sortedByDescending { it.total }
        AnalyticsSummary(totalSpent = rows.sumOf { it.amount }, byCategory = byCat, topMerchants = emptyList())
    }

    suspend fun categories(): List<Category> = api.categories().categories

    suspend fun addTransaction(req: AddTxnRequest): Txn {
        val txn = api.addTransaction(req).transaction
        dao?.let { withContext(Dispatchers.IO) { it.upsertAll(listOf(txn.toEntity())) } }
        return txn
    }

    suspend fun patchTransaction(id: String, req: PatchTxnRequest): Txn {
        val txn = api.patchTransaction(id, req).transaction
        dao?.let { withContext(Dispatchers.IO) { it.upsertAll(listOf(txn.toEntity())) } }
        return txn
    }

    suspend fun deleteTransaction(id: String) {
        api.deleteTransaction(id)
        dao?.let { withContext(Dispatchers.IO) { it.deleteById(id) } }
    }

    suspend fun health(): Boolean = runCatching { api.health().ok }.getOrDefault(false)

    /* ── Flashcards ── */


    suspend fun flashcardCount(): Int = runCatching { api.flashcardCount().count }.getOrDefault(0)

    suspend fun quiz(n: Int = 7): QuizResponse = api.quiz(n)

    suspend fun grade(answers: Map<String, Int>, retry: Boolean = false): GradeResponse = api.grade(GradeRequest(answers, retry))

    /* ── Ask your money ── */
    suspend fun ask(question: String): String = api.ask(AskRequest(question)).answer

    /* ── App usage history ── */
    suspend fun uploadUsage(sessions: List<com.personal.financenative.data.api.UsageSessionIn>) =
        api.uploadUsage(com.personal.financenative.data.api.UsageUpload(sessions))

    suspend fun usageDays(pkg: String, days: Int) = api.usageDays(pkg, days).days

    suspend fun usageSessions(pkg: String, day: String) = api.usageSessions(pkg, day).sessions

    /* ── Shared clipboard (Mac ↔ phone) ── */
    suspend fun clipboard(since: String = ""): com.personal.financenative.data.api.ClipListResponse =
        api.clipboard(since)

    suspend fun pushClip(text: String, deviceId: String, deviceName: String) =
        api.pushClip(com.personal.financenative.data.api.ClipPushRequest(text, deviceId, deviceName))

    suspend fun deleteClip(id: String) = api.deleteClip(id)

    suspend fun clipBlob(id: String): ByteArray = api.clipBlob(id).use { it.bytes() }

    /* ── Capture (SMS / shared payment) ── */
    suspend fun classify(req: com.personal.financenative.data.api.ClassifyRequest): com.personal.financenative.data.api.ClassifyResponse =
        api.classify(req)

    /* ── Statement reconciliation ── */
    suspend fun uploadStatement(pages: List<String>): com.personal.financenative.data.api.ReconcileResult =
        api.uploadStatement(com.personal.financenative.data.api.StatementUploadRequest(pages = pages))

    suspend fun statement(id: String): com.personal.financenative.data.api.StatementDetail = api.statement(id)

    suspend fun applyStatement(id: String, decisions: Map<String, String>): com.personal.financenative.data.api.ApplyResult =
        api.applyStatement(id, com.personal.financenative.data.api.ApplyRequest(decisions))
}
