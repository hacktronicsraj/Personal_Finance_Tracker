package com.personal.financenative.data.api

import kotlinx.serialization.Serializable

/** Wire shapes returned by the pft-native Worker. Field names match the JSON. */

@Serializable
data class Txn(
    val id: String,
    val amount: Double,
    val direction: String,
    val currency: String = "INR",
    val bank: String? = null,
    val merchant: String? = null,
    val merchant_raw: String? = null,
    val account_tail: String? = null,
    val ref_no: String? = null,
    val balance: Double? = null,
    val occurred_at: String? = null,
    val category: String = "Other",
    val confidence: Double = 0.0,
    val notes: String? = null,
    val user_note: String? = null,
    val tags: String? = null,
    val source: String = "sms",
    val corrected: Int = 0,
    val created_at: String,
    val updated_at: String,
)

@Serializable
data class TxnListResponse(val transactions: List<Txn>)

@Serializable
data class TxnResponse(val transaction: Txn)

@Serializable
data class CategoryTotal(val category: String, val count: Int, val total: Double)

@Serializable
data class MerchantTotal(val merchant: String? = null, val count: Int, val total: Double)

@Serializable
data class AnalyticsSummary(
    val totalSpent: Double = 0.0,
    val byCategory: List<CategoryTotal> = emptyList(),
    val topMerchants: List<MerchantTotal> = emptyList(),
)

@Serializable
data class Category(
    val id: String,
    val name: String,
    val icon: String? = null,
    val color: String? = null,
    val is_default: Int = 0,
)

@Serializable
data class CategoriesResponse(val categories: List<Category>)

@Serializable
data class AddTxnRequest(
    val amount: Double,
    val merchant: String? = null,
    val category: String? = null,
    val occurredAt: String? = null,
    val note: String? = null,
    val direction: String = "debit",
)

@Serializable
data class PatchTxnRequest(
    val category: String? = null,
    val merchant: String? = null,
    val amount: Double? = null,
    val note: String? = null,
)

@Serializable
data class Health(val ok: Boolean, val service: String? = null, val time: String? = null)

/* ── Flashcards ── */
@Serializable
data class FlashcardCount(val count: Int = 0)

@Serializable
data class QuizCard(val id: String, val question: String, val options: List<String>, val difficulty: String = "medium")

@Serializable
data class QuizResponse(val count: Int = 0, val cards: List<QuizCard> = emptyList())

@Serializable
data class GradeRequest(val answers: Map<String, Int>, val retry: Boolean = false)

@Serializable
data class GradeResult(val id: String, val correct: Boolean = false, val answer: Int = 0)

@Serializable
data class GradeResponse(
    val passed: Boolean = false,
    val correct: Int = 0,
    val total: Int = 0,
    val results: List<GradeResult> = emptyList(),
)

/* ── Ask your money ── */
@Serializable
data class AskRequest(val question: String)

@Serializable
data class AskResponse(val answer: String = "")

/* ── Classify (SMS / shared payment capture) ── */
@Serializable
data class ParsedTxnDto(
    val amount: Double,
    val direction: String,
    val currency: String = "INR",
    val bank: String? = null,
    val merchant: String? = null,
    val accountTail: String? = null,
    val refNo: String? = null,
    val balance: Double? = null,
    val occurredAt: String? = null,
    val rawText: String? = null,
)

@Serializable
data class ClassifyRequest(
    val parsed: ParsedTxnDto,
    val dedupeKey: String? = null,
    val deviceId: String? = null,
    val source: String = "sms",
    val category: String? = null,
    val note: String? = null,
)

@Serializable
data class ClassifyResponse(
    val transaction: Txn? = null,
    val deduped: Boolean = false,
    val ignored: String? = null,
)

/* ── Statement reconciliation ── */
@Serializable
data class StatementUploadRequest(val pages: List<String>, val images: List<String>? = null)

@Serializable
data class BalanceCheck(val checked: Int = 0, val ok: Int = 0)

@Serializable
data class ReconcileResult(
    val id: String,
    val bank: String? = null,
    val accountTail: String? = null,
    val periodStart: String? = null,
    val periodEnd: String? = null,
    val parser: String = "heuristic",
    val rowCount: Int = 0,
    val balanceCheck: BalanceCheck = BalanceCheck(),
    val matched: Int = 0,
    val adds: Int = 0,
    val removes: Int = 0,
    val creditsIgnored: Int = 0,
)

@Serializable
data class StatementSummary(
    val id: String,
    val bank: String? = null,
    val account_tail: String? = null,
    val period_start: String? = null,
    val period_end: String? = null,
    val parser: String? = null,
    val row_count: Int = 0,
    val credits_ignored: Int = 0,
    val status: String = "pending",
    val created_at: String = "",
)

@Serializable
data class StatementItem(
    val id: String,
    val statement_id: String,
    val kind: String,              // add | remove | match
    val idx: Int? = null,
    val date: String? = null,
    val description: String? = null,
    val merchant: String? = null,
    val amount: Double? = null,
    val type: String? = null,
    val ref: String? = null,
    val txn_id: String? = null,
    val note: String? = null,
    val suggested: String? = null,
    val decision: String = "pending",
)

@Serializable
data class StatementDetail(val statement: StatementSummary, val items: List<StatementItem> = emptyList())

@Serializable
data class ApplyRequest(val decisions: Map<String, String>)

@Serializable
data class ApplyResult(val added: Int = 0, val removed: Int = 0)

/* ── Shared clipboard (Mac ↔ phone) ── */

@Serializable
data class ClipItem(
    val id: String,
    val kind: String,                 // text | image | file
    val text: String? = null,
    val deviceId: String? = null,
    val deviceName: String? = null,
    val mime: String? = null,
    val fileName: String? = null,
    val byteSize: Long? = null,
    val createdAt: String,
    val deleted: Boolean = false,
)

@Serializable
data class ClipListResponse(val items: List<ClipItem> = emptyList(), val serverTime: String? = null)

@Serializable
data class ClipPushRequest(val text: String, val deviceId: String, val deviceName: String)

@Serializable
data class ClipPushResponse(val id: String, val createdAt: String? = null, val duplicate: Boolean = false)

/* ── App usage history ── */

@Serializable
data class UsageSessionIn(val pkg: String, val startMs: Long, val endMs: Long)

@Serializable
data class UsageUpload(val sessions: List<UsageSessionIn>)

@Serializable
data class UsageUploadResult(val stored: Int = 0, val skipped: Int = 0)

@Serializable
data class UsageDay(
    val day: String,
    val minutes: Double = 0.0,
    val opens: Int = 0,
    val longestMinutes: Double = 0.0,
    val firstOpenMs: Long? = null,
    val lastCloseMs: Long? = null,
)

@Serializable
data class UsageDaysResponse(val days: List<UsageDay> = emptyList())

@Serializable
data class UsageSession(val startMs: Long, val endMs: Long, val minutes: Double, val continued: Boolean = false)

@Serializable
data class UsageSessionsResponse(val day: String, val sessions: List<UsageSession> = emptyList())
