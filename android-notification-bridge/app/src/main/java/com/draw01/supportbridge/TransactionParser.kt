package com.draw01.supportbridge

import java.security.MessageDigest

object TransactionParser {
    data class Parsed(
        val amount: Double,
        val trxId: String,
        val senderHash: String,
        val senderLast4: String,
        val fingerprint: String
    )

    private val blockedWords = listOf(
        "otp", "one time password", "one-time password", "verification code",
        "security code", "pin", "password", "do not share", "secret code"
    )

    fun parse(title: String, body: String): Parsed? {
        val normalizedTitle = ascii(title).trim()
        val normalizedBody = ascii(body).trim()
        val combined = "$normalizedTitle\n$normalizedBody"
        if (!combined.contains("bkash", ignoreCase = true)) return null
        if (blockedWords.any { combined.contains(it, ignoreCase = true) }) return null
        if (!normalizedBody.contains("received", ignoreCase = true)) return null
        if (!Regex("trx\\s*id", RegexOption.IGNORE_CASE).containsMatchIn(normalizedBody)) return null

        val trx = Regex("trx\\s*id\\s*[:\\-]?\\s*([A-Za-z0-9]{6,32})", RegexOption.IGNORE_CASE)
            .find(normalizedBody)?.groupValues?.getOrNull(1)?.uppercase() ?: return null

        val senderRaw = Regex("from\\s*(\\+?8801\\d{9}|01\\d{9})", RegexOption.IGNORE_CASE)
            .find(normalizedBody)?.groupValues?.getOrNull(1) ?: return null
        val sender = normalizePhone(senderRaw) ?: return null

        val amountText = Regex("received\\s*(?:tk\\.?|bdt|৳)?\\s*([0-9,]+(?:\\.[0-9]{1,2})?)", RegexOption.IGNORE_CASE)
            .find(normalizedBody)?.groupValues?.getOrNull(1)
            ?: Regex("(?:tk\\.?|bdt|৳)\\s*([0-9,]+(?:\\.[0-9]{1,2})?)\\s*(?:has\\s+been\\s+)?received", RegexOption.IGNORE_CASE)
                .find(normalizedBody)?.groupValues?.getOrNull(1)
            ?: return null
        val amount = amountText.replace(",", "").toDoubleOrNull() ?: return null
        if (amount <= 0.0 || amount > 1_000_000.0) return null

        val fingerprintSource = normalizedBody.replace(Regex("\\s+"), " ").lowercase()
        return Parsed(
            amount = amount,
            trxId = trx,
            senderHash = sha256(sender),
            senderLast4 = sender.takeLast(4),
            fingerprint = sha256(fingerprintSource)
        )
    }

    private fun normalizePhone(value: String): String? {
        val digits = value.filter { it.isDigit() }
        return when {
            digits.length == 11 && digits.startsWith("01") -> "88$digits"
            digits.length == 13 && digits.startsWith("8801") -> digits
            else -> null
        }
    }

    private fun ascii(value: String): String {
        val bn = "০১২৩৪৫৬৭৮৯"
        return buildString(value.length) {
            value.forEach { ch ->
                val idx = bn.indexOf(ch)
                append(if (idx >= 0) ('0'.code + idx).toChar() else ch)
            }
        }
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}
