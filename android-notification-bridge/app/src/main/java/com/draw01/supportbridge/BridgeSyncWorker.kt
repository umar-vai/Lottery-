package com.draw01.supportbridge

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

class BridgeSyncWorker(
    appContext: Context,
    params: WorkerParameters
) : Worker(appContext, params) {

    override fun doWork(): Result {
        val token = BridgeConfig.token(applicationContext)
        if (token.length < 20) return Result.failure()

        val parsed = TransactionParser.Parsed(
            amount = inputData.getDouble("amount", 0.0),
            trxId = inputData.getString("trxId").orEmpty(),
            senderHash = inputData.getString("senderHash").orEmpty(),
            senderLast4 = inputData.getString("senderLast4").orEmpty(),
            fingerprint = inputData.getString("fingerprint").orEmpty()
        )
        val receivedAt = inputData.getString("receivedAt").orEmpty()
        if (parsed.amount <= 0 || parsed.trxId.isBlank() || parsed.senderHash.length != 64 || parsed.fingerprint.length != 64) {
            return Result.failure()
        }

        return try {
            val response = BridgeApi.sendParsed(token, parsed, receivedAt)
            BridgeConfig.prefs(applicationContext).edit()
                .putString(BridgeConfig.KEY_LAST_RESULT, if (response.ok) "Synced ${parsed.trxId}" else response.message)
                .apply()
            if (response.ok) Result.success() else Result.retry()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
