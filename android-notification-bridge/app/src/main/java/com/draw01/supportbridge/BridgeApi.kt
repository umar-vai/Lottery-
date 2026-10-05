package com.draw01.supportbridge

import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection

object BridgeApi {
    private const val ENDPOINT = "https://mwtlsnneooxmryondrex.supabase.co/functions/v1/support-phone-bridge"

    data class Result(val ok: Boolean, val message: String)

    fun sendParsed(
        token: String,
        parsed: TransactionParser.Parsed,
        receivedAt: String
    ): Result {
        val tx = JSONObject()
            .put("amount", parsed.amount)
            .put("trxId", parsed.trxId)
            .put("senderHash", parsed.senderHash)
            .put("senderLast4", parsed.senderLast4)
            .put("fingerprint", parsed.fingerprint)
            .put("receivedAt", receivedAt)
        val body = JSONObject()
            .put("source", "android_sms")
            .put("transaction", tx)
        return post(token, body)
    }

    private fun post(token: String, body: JSONObject): Result {
        val conn = (URL(ENDPOINT).openConnection() as HttpsURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15000
            readTimeout = 15000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("x-bridge-token", token)
        }
        return try {
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(text) }.getOrNull()
            val ok = conn.responseCode in 200..299 && (json?.optBoolean("ok", true) ?: true)
            val message = json?.optString("error")?.takeIf { it.isNotBlank() }
                ?: if (ok) "Synced" else "HTTP ${conn.responseCode}"
            Result(ok, message)
        } finally {
            conn.disconnect()
        }
    }
}
