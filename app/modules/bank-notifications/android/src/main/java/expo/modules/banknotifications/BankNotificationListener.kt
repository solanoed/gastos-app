package expo.modules.banknotifications

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Guarda las notificaciones de movimientos del banco (apps de Bancolombia, Nequi, Daviplata y SMS bancarios)
 * en una cola local; la app las manda al servidor cuando se abre. Ignora todo lo demás.
 */
class BankNotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    try {
      handle(sbn)
    } catch (_: Exception) {
      // Nunca tumbar el servicio por una notificación rara.
    }
  }

  private fun handle(sbn: StatusBarNotification) {
    val pkg = sbn.packageName ?: return
    val bank = bankName(pkg)
    val isSms = pkg in SMS_APPS
    if (bank == null && !isSms) return
    val n = sbn.notification ?: return
    if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    val extras = n.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))
      ?.toString().orEmpty()
    if (text.isBlank()) return
    val full = "$title $text"
    // Solo avisos con un monto; de los SMS, solo los que vienen de un banco.
    if (!AMOUNT.containsMatchIn(full)) return
    if (isSms && !SMS_BANK.containsMatchIn(full)) return
    NotificationStore.add(this, pkg, bank ?: "SMS", title, text, sbn.postTime)
  }

  companion object {
    private val BANK_APPS = mapOf(
      "com.todo1.mobile" to "Bancolombia",
      "com.nequi.MobileApp" to "Nequi",
      "com.davivienda.daviplataapp" to "Daviplata",
    )
    private val SMS_APPS = setOf(
      "com.google.android.apps.messaging",
      "com.samsung.android.messaging",
      "com.android.mms",
      "com.android.messaging",
    )
    private val AMOUNT = Regex("""\$\s?\d|\d{1,3}([.,]\d{3})+""")
    private val SMS_BANK = Regex("bancolombia|nequi|daviplata|davivienda|compraste|pagaste|transferiste|recibiste", RegexOption.IGNORE_CASE)

    fun bankName(pkg: String): String? {
      BANK_APPS[pkg]?.let { return it }
      val p = pkg.lowercase()
      return when {
        "bancolombia" in p -> "Bancolombia"
        "nequi" in p -> "Nequi"
        "daviplata" in p -> "Daviplata"
        else -> null
      }
    }
  }
}
