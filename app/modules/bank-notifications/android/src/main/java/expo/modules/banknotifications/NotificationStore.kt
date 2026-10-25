package expo.modules.banknotifications

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Cola de notificaciones pendientes de enviar, en SharedPreferences (máximo 200). */
object NotificationStore {
  private const val PREFS = "bank_notifications"
  private const val KEY = "queue"
  private const val MAX = 200

  private fun read(context: Context): JSONArray =
    try {
      JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]"))
    } catch (_: Exception) {
      JSONArray()
    }

  private fun write(context: Context, arr: JSONArray) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, arr.toString()).apply()
  }

  @Synchronized
  fun add(context: Context, pkg: String, app: String, title: String, text: String, postedAt: Long) {
    // La misma notificación puede publicarse varias veces (actualizaciones): una clave por app, día y contenido.
    val day = SimpleDateFormat("yyyyMMdd", Locale.US).format(Date(postedAt))
    val key = "$pkg|$day|${(title + "\n" + text).hashCode()}"
    val arr = read(context)
    for (i in 0 until arr.length()) if (arr.getJSONObject(i).optString("key") == key) return
    arr.put(
      JSONObject()
        .put("key", key)
        .put("app", app)
        .put("title", title.take(300))
        .put("text", text.take(2000))
        .put("posted_at", postedAt),
    )
    while (arr.length() > MAX) arr.remove(0)
    write(context, arr)
  }

  @Synchronized
  fun all(context: Context): String = read(context).toString()

  @Synchronized
  fun remove(context: Context, keys: List<String>) {
    val drop = keys.toSet()
    val arr = read(context)
    val kept = JSONArray()
    for (i in 0 until arr.length()) {
      val o = arr.getJSONObject(i)
      if (o.optString("key") !in drop) kept.put(o)
    }
    write(context, kept)
  }
}
