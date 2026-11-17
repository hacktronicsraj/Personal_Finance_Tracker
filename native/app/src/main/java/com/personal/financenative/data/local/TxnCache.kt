package com.personal.financenative.data.local

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import com.personal.financenative.data.api.Txn

/** Local mirror of a transaction so Home/Activity work offline. */
@Entity(tableName = "txns")
data class TxnEntity(
    @PrimaryKey val id: String,
    val amount: Double,
    val direction: String,
    val currency: String,
    val merchant: String?,
    val category: String,
    val occurredAt: String?,
    val createdAt: String,
    val updatedAt: String,
    val source: String,
    val userNote: String?,
)

fun Txn.toEntity() = TxnEntity(
    id = id, amount = amount, direction = direction, currency = currency, merchant = merchant,
    category = category, occurredAt = occurred_at, createdAt = created_at, updatedAt = updated_at,
    source = source, userNote = user_note,
)

fun TxnEntity.toTxn() = Txn(
    id = id, amount = amount, direction = direction, currency = currency, merchant = merchant,
    category = category, occurred_at = occurredAt, created_at = createdAt, updated_at = updatedAt,
    source = source, user_note = userNote,
)

@Dao
interface TxnDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(txns: List<TxnEntity>)

    @Query("SELECT * FROM txns ORDER BY COALESCE(occurredAt, createdAt) DESC, createdAt DESC LIMIT :limit")
    suspend fun recent(limit: Int): List<TxnEntity>

    @Query("SELECT * FROM txns WHERE merchant LIKE '%' || :q || '%' ORDER BY COALESCE(occurredAt, createdAt) DESC LIMIT :limit")
    suspend fun search(q: String, limit: Int): List<TxnEntity>

    @Query("DELETE FROM txns WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("SELECT * FROM txns WHERE direction = 'debit' AND category != 'Card Payment' AND COALESCE(occurredAt, createdAt) >= :fromIso")
    suspend fun debitsSince(fromIso: String): List<TxnEntity>
}

@Database(entities = [TxnEntity::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun txns(): TxnDao
}
