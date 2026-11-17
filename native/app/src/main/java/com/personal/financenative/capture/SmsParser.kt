package com.personal.financenative.capture

import com.personal.financenative.data.api.ParsedTxnDto

/**
 * Parses Indian bank/UPI SMS into a [ParsedTxnDto]. Ported from the reference
 * TypeScript implementation at mobile/src/parse/parser.ts (see also
 * mobile/src/sms/ingest.ts, which gates every message through `isFinancialSms`
 * before handing the same raw text to `parseTransaction`).
 *
 * `occurredAt` is intentionally left null here — the backend stamps the
 * transaction time server-side, so the TS parser's date-extraction logic
 * (`parseDate`) was not ported.
 */
object SmsParser {

    // ── Financial-message gate (ports isFinancialSms / isBankSender) ──

    private val OTP_RE =
        Regex("""\b(otp|one[\s-]?time\s?password|verification code|do not share|kyc|password)\b""", RegexOption.IGNORE_CASE)
    private val OTP_EXCEPTION_RE = Regex("""\b(debited|credited|spent|paid)\b""", RegexOption.IGNORE_CASE)
    private val MONEY_RE = Regex("""(?:rs|inr|₹)\.?\s?[\d,]+(?:\.\d{1,2})?""", RegexOption.IGNORE_CASE)
    private val TXN_HINT_RE =
        Regex("""\b(debited|credited|spent|paid|withdrawn|purchase|txn|transaction|upi|debit|credit|sent|received)\b""", RegexOption.IGNORE_CASE)

    // Substrings found in Indian bank/UPI SMS sender IDs (e.g. "AX-IDBIBK", "VM-HDFCBK",
    // "JD-SBIINB", "VK-PAYTMB"). Matched without word boundaries because the code is
    // glued to a "BK"/"INB" suffix. A money token + a known bank sender = financial,
    // even when the verb is one the body regex doesn't list.
    private val BANK_SENDER_RE = Regex(
        "(IDBI|HDFC|ICIC|SBI|AXIS|KOTAK|PNB|BOB|BARB|CANBK|CANARA|UBIN|UNION|YESB|IDFC|INDUS|FEDB|FEDERAL|RBL|BOI|CBI|CENTBK|UCO|IOB|KVB|SIB|DBS|HSBC|CITI|SCB|AUBL|AUBANK|BANDHN|EQUITAS|PAYTM|PYTM|GPAY|PHONPE|PHONEPE|AMZN|JUPITER|SLICE|CRED)",
        RegexOption.IGNORE_CASE,
    )
    // Sender ID is upper-cased before these two run, so (unlike BANK_SENDER_RE above) no
    // IGNORE_CASE is needed here — mirrors the TS regexes exactly.
    private val BANK_SENDER_SUFFIX_RE = Regex("(BK|BNK|BANK|UPI)$")
    private val BANK_SENDER_PB_SUFFIX_RE = Regex("-PB$")

    // A biller's "your bill is due" reminder, which carries an amount and a date but
    // means no money has moved. These are rejected outright: unlike the softer
    // EXCLUDE_RE below, no transaction verb elsewhere in the message can rescue them,
    // because reminders routinely end with "ignore if already paid" (see
    // HYPOTHETICAL_RE) or offer a "pay now" link.
    private val DUE_NOTICE_RE = Regex(
        """\b(?:bill|payment|amount|emi|premium|due amount|min(?:imum)? due|total due)\b[^.]{0,60}?\bis\s+due\b|\bdue\s+for\s+payment\b|\bis\s+due\s+(?:on|by)\b|\bplease\s+pay\s+(?:by|before)\b""",
        RegexOption.IGNORE_CASE,
    )

    // Clauses that name a payment verb hypothetically rather than reporting one.
    // "Please ignore if already paid" was letting every bill reminder through the
    // EXCLUDE_RE gate, booking the due amount as a completed debit.
    private val HYPOTHETICAL_RE = Regex(
        """\b(?:please\s+)?ignore\s+(?:this\s+)?if\s+(?:already\s+)?paid\b|\bif\s+(?:you\s+have\s+)?(?:already\s+)?(?:not\s+)?paid\b|\bkindly\s+ignore\b""",
        RegexOption.IGNORE_CASE,
    )

    // Excludes mandate/autopay setup, payment reminders, failed/reversed txns,
    // promotional offers, and EMI due reminders — unless the message also contains
    // an actual transaction verb proving money already moved.
    private val EXCLUDE_RE = Regex(
        """\b(mandate|auto[\s-]?pay|autopay|si registered|standing instruction|reminder|due date|due on|payment due|pay by|last date|failed|declined|unsuccessful|reversed|could not|cashback offer|get ₹|earn ₹|win ₹|flat ₹|emi due|emi of|instalment|set up|register|activate|e-?nach|nach debit|renewal|upcoming|will be debited|will be charged|scheduled|is due)\b""",
        RegexOption.IGNORE_CASE,
    )
    private val ACTUAL_TXN_RE = Regex("""\b(debited|credited|spent|paid|withdrawn)\b""", RegexOption.IGNORE_CASE)

    // ── Transaction extraction (ports parseTransaction) ──

    private val BLOCK_UPI_TAIL_RE = Regex("""To Block UPI[\s\S]*$""", RegexOption.IGNORE_CASE)
    private val DISPUTE_TAIL_RE = Regex("""To dispute[\s\S]*$""", RegexOption.IGNORE_CASE)
    private val BANK_SIGNATURE_TAIL_RE = Regex("""-\s*[A-Za-z ]+(?:Bank|SFBL?|Ltd)\.?\s*$""", RegexOption.IGNORE_CASE)
    private val WHITESPACE_RE = Regex("""\s+""")
    private val TRAILING_PUNCT_RE = Regex("""[.,;:]+$""")

    // Direction is governed by the ACCOUNT verb (first verb after the account no) when
    // present; otherwise fall back to the first debit/credit verb anywhere in the text.
    private val ACCT_VERB_RE =
        Regex("""A/?c(?:ct)?\.?\s*(?:no\.?)?\s*[Xx*]+\s*\d+\s+(debited|credited)""", RegexOption.IGNORE_CASE)
    private val DEBIT_VERB_RE = Regex("""\b(debited|spent|withdrawn|paid|sent|purchase)\b""", RegexOption.IGNORE_CASE)
    private val CREDIT_VERB_RE = Regex("""\b(credited|received|deposited)\b""", RegexOption.IGNORE_CASE)

    // Amount — prefer the amount tied to the debit/credit verb, else the first money token.
    private val AMT_NEAR_RE = Regex(
        """(?:debited|credited|spent|paid|withdrawn|sent|received)\s*(?:for|of|by|with)?\s*(?:rs|inr|₹)\.?\s?([\d,]+(?:\.\d{1,2})?)""",
        RegexOption.IGNORE_CASE,
    )
    private val AMT_ANY_RE = Regex("""(?:rs|inr|₹)\.?\s?([\d,]+(?:\.\d{1,2})?)""", RegexOption.IGNORE_CASE)

    private val ACCOUNT_TAIL_RE = Regex("""[Xx*]{2,}\s*(\d{3,6})""")
    private val BANK_NAME_RE = Regex("""\b([A-Za-z]+\s?Bank)\b""", RegexOption.IGNORE_CASE)
    private val UPI_REF_RE = Regex("""UPI[:\s]*([0-9]{6,})""", RegexOption.IGNORE_CASE)
    private val GENERIC_REF_RE = Regex("""(?:Ref|RRN|txn)\s*(?:no\.?|id)?[:\s]*([A-Za-z0-9]{6,})""", RegexOption.IGNORE_CASE)
    private val BALANCE_RE = Regex("""Bal(?:ance)?\.?\s*(?:Rs|INR|₹)?\.?\s?([\d,]+(?:\.\d{1,2})?)""", RegexOption.IGNORE_CASE)

    private val VPA_RE = Regex("""([A-Za-z0-9.\-_]{2,}@[A-Za-z]{2,})""")
    // Handles the IDBI/UPI shape where the account is *debited* while the payee's name
    // appears immediately before the word "credited":
    //   "IDBI Bank Acct XX417 debited for Rs 9000.00 on 02-Jul-26; Bal Rs 432.58
    //    Groww Invest Te credited. UPI:618359694589. ..."
    private val DEBIT_MERCHANT_BAL_RE = Regex(
        """Bal(?:ance)?\.?\s*(?:Rs|INR|₹)?[\d,. ]+\s+([A-Za-z0-9 .&@'\-]+?)\s+credited""",
        RegexOption.IGNORE_CASE,
    )
    private val DEBIT_MERCHANT_TO_AT_RE =
        Regex("""\b(?:to|at|towards)\s+([A-Za-z0-9 .&@'\-]+?)(?:\s+on|\.|;|$)""", RegexOption.IGNORE_CASE)
    // SuperCard (Utkarsh SFBL) alerts carry no payee — just "for UPI - <ref>". Label them
    // so they read as a real spend instead of "Unknown".
    private val SUPERCARD_RE = Regex("""\bsuper\s?card\b""", RegexOption.IGNORE_CASE)
    private val CREDIT_MERCHANT_FROM_BY_RE =
        Regex("""\b(?:from|by)\s+([A-Za-z0-9 .&@'\-]+?)(?:\s+on|\.|;|$)""", RegexOption.IGNORE_CASE)
    private val CREDIT_MERCHANT_DEBITED_RE = Regex("""([A-Za-z0-9 .&@'\-]+?)\s+debited""", RegexOption.IGNORE_CASE)

    /**
     * Parse an Indian bank/UPI SMS into a normalized transaction. Returns null if the
     * message isn't a real transaction alert (OTP/promo/reminder/no-amount, etc.) or
     * doesn't carry a recognizable amount/direction.
     */
    fun parse(body: String, sender: String?): ParsedTxnDto? {
        if (body.isEmpty()) return null
        if (!isFinancialSms(body, sender)) return null

        // 1) Strip UPI-block / dispute / helpline boilerplate and trailing bank signature
        //    so none of it gets mistaken for the payee (e.g. "To dispute call ... SFBL").
        val text = body
            .replace(BLOCK_UPI_TAIL_RE, " ")
            .replace(DISPUTE_TAIL_RE, " ")
            .replace(BANK_SIGNATURE_TAIL_RE, " ")
            .replace(WHITESPACE_RE, " ")
            .trim()

        // 2) Direction.
        val acctVerbMatch = ACCT_VERB_RE.find(text)
        var direction: String? = acctVerbMatch?.groupValues?.get(1)?.let { verb ->
            if (verb.equals("debited", ignoreCase = true)) "debit" else "credit"
        }
        if (direction == null) {
            direction = when {
                DEBIT_VERB_RE.containsMatchIn(text) -> "debit"
                CREDIT_VERB_RE.containsMatchIn(text) -> "credit"
                else -> null
            }
        }
        val resolvedDirection = direction ?: return null

        // 3) Amount.
        val amtNear = AMT_NEAR_RE.find(text)?.groupValues?.get(1)
        val amtAny = AMT_ANY_RE.find(text)?.groupValues?.get(1)
        val amount = toNumber(amtNear ?: amtAny) ?: return null

        // 4) Account tail, bank, ref, balance.
        val accountTail = ACCOUNT_TAIL_RE.find(text)?.groupValues?.get(1)
        val bank = BANK_NAME_RE.find(text)?.groupValues?.get(1)?.replace(WHITESPACE_RE, " ")?.trim()
        val refNo = UPI_REF_RE.find(text)?.groupValues?.get(1)
            ?: GENERIC_REF_RE.find(text)?.groupValues?.get(1)
        val balance = toNumber(BALANCE_RE.find(text)?.groupValues?.get(1))

        // 5) Merchant / counterparty.
        val vpa = VPA_RE.find(text)?.groupValues?.get(1)
        val merchant: String? = if (resolvedDirection == "debit") {
            cleanMerchant(DEBIT_MERCHANT_BAL_RE.find(text)?.groupValues?.get(1))
                ?: cleanMerchant(DEBIT_MERCHANT_TO_AT_RE.find(text)?.groupValues?.get(1))
                ?: cleanMerchant(vpa)
                ?: (if (SUPERCARD_RE.containsMatchIn(body)) "SuperCard Payment" else null)
        } else {
            cleanMerchant(CREDIT_MERCHANT_FROM_BY_RE.find(text)?.groupValues?.get(1))
                ?: cleanMerchant(CREDIT_MERCHANT_DEBITED_RE.find(text)?.groupValues?.get(1))
                ?: cleanMerchant(vpa)
        }

        return ParsedTxnDto(
            amount = amount,
            direction = resolvedDirection,
            currency = "INR",
            bank = bank,
            merchant = merchant,
            accountTail = accountTail,
            refNo = refNo,
            balance = balance,
            occurredAt = null,
            rawText = body,
        )
    }

    /**
     * True when the message looks like a real bank/UPI transaction alert (and is NOT
     * an OTP / promotional / KYC / bill-reminder message). A money token from a known
     * bank sender counts even without a hint verb.
     */
    private fun isFinancialSms(text: String, sender: String?): Boolean {
        if (text.isEmpty()) return false
        if (OTP_RE.containsMatchIn(text) && !OTP_EXCEPTION_RE.containsMatchIn(text)) return false

        // A due notice never represents money that moved — reject before anything else.
        if (DUE_NOTICE_RE.containsMatchIn(text)) return false

        // Test the verb against text with hypothetical clauses removed, so "ignore if
        // already paid" can't stand in as proof the payment happened.
        val evidence = text.replace(HYPOTHETICAL_RE, " ")
        if (EXCLUDE_RE.containsMatchIn(text) && !ACTUAL_TXN_RE.containsMatchIn(evidence)) return false

        if (!MONEY_RE.containsMatchIn(text)) return false
        return TXN_HINT_RE.containsMatchIn(text) || isBankSender(sender)
    }

    /** True when the SMS sender ID looks like a bank / payments bank / UPI biller. */
    private fun isBankSender(sender: String?): Boolean {
        if (sender.isNullOrEmpty()) return false
        val s = sender.uppercase()
        if (BANK_SENDER_SUFFIX_RE.containsMatchIn(s) || BANK_SENDER_PB_SUFFIX_RE.containsMatchIn(s)) return true
        return BANK_SENDER_RE.containsMatchIn(s)
    }

    private fun toNumber(s: String?): Double? {
        if (s.isNullOrEmpty()) return null
        val n = s.replace(",", "").toDoubleOrNull() ?: return null
        return n.takeIf { it.isFinite() }
    }

    private fun cleanMerchant(s: String?): String? {
        if (s == null) return null
        val cleaned = s.replace(WHITESPACE_RE, " ").replace(TRAILING_PUNCT_RE, "").trim()
        return cleaned.takeIf { it.length >= 2 }
    }
}
