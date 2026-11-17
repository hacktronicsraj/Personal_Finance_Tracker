package com.personal.financenative.ui.components

import android.content.Context
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * World map for the geography "which country is in red?" cards.
 *
 * Outlines are Natural Earth 1:50m admin-0 countries (public domain),
 * pre-projected (equirectangular, 84°N–58°S) and simplified into
 * assets/world_map.json, so the map works offline. Keyed by ISO 3166-1
 * alpha-2 — the same code the card carries as `[map:XX]`.
 */
object WorldMapData {
    class Country(val path: Path, val label: Offset, val bbox: Rect)
    class Data(val width: Float, val height: Float, val countries: Map<String, Country>, val others: List<Path>)

    @Volatile private var cached: Data? = null

    /** Parses the asset once (≈200 KB); call off the main thread. */
    fun load(context: Context): Data = cached ?: synchronized(this) {
        cached ?: parse(context).also { cached = it }
    }

    private fun parse(context: Context): Data {
        val json = JSONObject(context.assets.open("world_map.json").bufferedReader().use { it.readText() })
        fun path(d: String): Path = PathParser().parsePathString(d).toPath()
        val countries = HashMap<String, Country>()
        val cs = json.getJSONObject("countries")
        for (iso in cs.keys()) {
            val c = cs.getJSONObject(iso)
            val label = c.getJSONArray("label")
            val b = c.getJSONArray("bbox")
            countries[iso] = Country(
                path = path(c.getString("d")),
                label = Offset(label.getDouble(0).toFloat(), label.getDouble(1).toFloat()),
                bbox = Rect(b.getDouble(0).toFloat(), b.getDouble(1).toFloat(), b.getDouble(2).toFloat(), b.getDouble(3).toFloat()),
            )
        }
        val others = json.getJSONArray("others").let { arr -> List(arr.length()) { path(arr.getString(it)) } }
        return Data(json.getDouble("w").toFloat(), json.getDouble("h").toFloat(), countries, others)
    }
}

private val Sea = Color(0xFF0B1118)
private val Land = Color(0xFF3A4654)
private val Border = Color(0xFF0B1118)
private val Target = Color(0xFFE53935)

/** Pulls `XX` out of a question's `[map:XX]` line, if it has one. */
fun mapCodeOf(line: String): String? =
    Regex("""^\[map:([A-Z]{2})]$""").find(line.trim())?.groupValues?.get(1)

/**
 * The country [iso] in red: the whole world on top, its surroundings zoomed
 * in below. Countries too small to see at a scale get a red ring.
 */
@Composable
fun CountryOnMap(iso: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val data by produceState<WorldMapData.Data?>(null) {
        value = withContext(Dispatchers.Default) { runCatching { WorldMapData.load(context) }.getOrNull() }
    }
    val map = data
    val country = map?.countries?.get(iso)
    Column(modifier.fillMaxWidth()) {
        if (map == null || country == null) {
            Box(
                Modifier.fillMaxWidth().aspectRatio(2.4f).clip(RoundedCornerShape(10.dp)).background(Sea),
            )
            return@Column
        }
        MapView(map, iso, Rect(0f, 0f, map.width, map.height), Modifier.fillMaxWidth().aspectRatio(map.width / map.height))
        Spacer(Modifier.height(8.dp))
        val zoom = zoomWindow(map, country.bbox)
        MapView(map, iso, zoom, Modifier.fillMaxWidth().aspectRatio(zoom.width / zoom.height))
    }
}

/** A 2:1 window around the country: at least ~43° wide, and 3× the country. */
private fun zoomWindow(map: WorldMapData.Data, b: Rect): Rect {
    val w = maxOf(120f, b.width * 3f, b.height * 3f * 2f).coerceAtMost(map.width)
    val h = (w / 2f).coerceAtMost(map.height)
    val cx = b.center.x.coerceIn(w / 2f, map.width - w / 2f)
    val cy = b.center.y.coerceIn(h / 2f, map.height - h / 2f)
    return Rect(cx - w / 2f, cy - h / 2f, cx + w / 2f, cy + h / 2f)
}

@Composable
private fun MapView(map: WorldMapData.Data, iso: String, view: Rect, modifier: Modifier) {
    val country = map.countries.getValue(iso)
    Canvas(modifier.clip(RoundedCornerShape(10.dp)).background(Sea)) {
        val scale = size.width / view.width
        clipRect {
            withTransform({
                translate(-view.left * scale, -view.top * scale)
                scale(scale, scale, Offset.Zero)
            }) {
                val border = Stroke(width = 0.8.dp.toPx() / scale)
                for (p in map.others) drawLand(p, Land, border)
                for ((code, c) in map.countries) if (code != iso) drawLand(c.path, Land, border)
                drawLand(country.path, Target, border)
            }
            // Ring anything smaller than ~10dp on screen so it can't be missed.
            val onScreen = maxOf(country.bbox.width, country.bbox.height) * scale
            if (onScreen < 10.dp.toPx()) {
                val at = Offset((country.label.x - view.left) * scale, (country.label.y - view.top) * scale)
                drawCircle(Target, radius = 9.dp.toPx(), center = at, style = Stroke(width = 2.dp.toPx()))
            }
        }
    }
}

private fun DrawScope.drawLand(path: Path, fill: Color, border: Stroke) {
    drawPath(path, fill)
    drawPath(path, Border, style = border)
}
