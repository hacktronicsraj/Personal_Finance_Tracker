package com.personal.financenative.data.api

import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming
import okhttp3.ResponseBody

/** The pft-native Worker API. */
interface FinanceApi {
    @GET("health")
    suspend fun health(): Health

    @GET("transactions")
    suspend fun transactions(
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
        @Query("category") category: String? = null,
        @Query("q") q: String? = null,
        @Query("limit") limit: Int? = null,
    ): TxnListResponse

    @POST("transactions")
    suspend fun addTransaction(@Body body: AddTxnRequest): TxnResponse

    @PATCH("transactions/{id}")
    suspend fun patchTransaction(@Path("id") id: String, @Body body: PatchTxnRequest): TxnResponse

    @DELETE("transactions/{id}")
    suspend fun deleteTransaction(@Path("id") id: String)

    @GET("analytics/summary")
    suspend fun analyticsSummary(
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
    ): AnalyticsSummary

    @GET("categories")
    suspend fun categories(): CategoriesResponse

    @GET("flashcards/count")
    suspend fun flashcardCount(): FlashcardCount

    @GET("flashcards/quiz")
    suspend fun quiz(@Query("n") n: Int = 5): QuizResponse

    @POST("flashcards/grade")
    suspend fun grade(@Body body: GradeRequest): GradeResponse

    @POST("ask")
    suspend fun ask(@Body body: AskRequest): AskResponse

    @POST("classify")
    suspend fun classify(@Body body: ClassifyRequest): ClassifyResponse

    @POST("statements")
    suspend fun uploadStatement(@Body body: StatementUploadRequest): ReconcileResult

    @GET("statements/{id}")
    suspend fun statement(@Path("id") id: String): StatementDetail

    @POST("statements/{id}/apply")
    suspend fun applyStatement(@Path("id") id: String, @Body body: ApplyRequest): ApplyResult

    /* ── Shared clipboard (Mac ↔ phone) ── */

    @GET("clipboard")
    suspend fun clipboard(@Query("since") since: String = "", @Query("limit") limit: Int = 100): ClipListResponse

    @POST("clipboard")
    suspend fun pushClip(@Body body: ClipPushRequest): ClipPushResponse

    @DELETE("clipboard/{id}")
    suspend fun deleteClip(@Path("id") id: String)

    @Streaming
    @GET("clipboard/{id}/blob")
    suspend fun clipBlob(@Path("id") id: String): ResponseBody

    /* ── App usage history ── */

    @POST("usage/sessions")
    suspend fun uploadUsage(@Body body: UsageUpload): UsageUploadResult

    @GET("usage/days")
    suspend fun usageDays(@Query("pkg") pkg: String, @Query("days") days: Int): UsageDaysResponse

    @GET("usage/sessions")
    suspend fun usageSessions(@Query("pkg") pkg: String, @Query("day") day: String): UsageSessionsResponse
}
