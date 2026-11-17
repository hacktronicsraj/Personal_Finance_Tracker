package com.personal.financenative.data

import com.personal.financenative.BuildConfig
import com.personal.financenative.data.api.FinanceApi
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import retrofit2.Retrofit
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

/** Builds the Retrofit-backed API: base URL + bearer token from BuildConfig. */
object Network {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    fun api(): FinanceApi {
        val client = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val req = chain.request().newBuilder()
                    .header("content-type", "application/json")
                    .apply {
                        if (BuildConfig.API_TOKEN.isNotBlank()) {
                            header("authorization", "Bearer ${BuildConfig.API_TOKEN}")
                        }
                    }
                    .build()
                chain.proceed(req)
            }
            .build()

        return Retrofit.Builder()
            .baseUrl(BuildConfig.BASE_URL)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(FinanceApi::class.java)
    }

    private val plainClient by lazy {
        OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()
    }

    /** Fetch a URL's body as text (used to pull ChatGPT share HTML on-device). */
    fun fetchText(url: String): String {
        val req = Request.Builder().url(url)
            .header("user-agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36")
            .header("accept", "text/html")
            .build()
        plainClient.newCall(req).execute().use { res ->
            return res.body?.string() ?: ""
        }
    }
}
