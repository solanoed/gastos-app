package expo.modules.banknotifications

import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BankNotificationsModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("BankNotifications")

    /** Si el usuario ya le dio a la app acceso a las notificaciones. */
    Function("isEnabled") {
      val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners").orEmpty()
      enabled.contains(context.packageName)
    }

    Function("openSettings") {
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    /** JSON con las notificaciones capturadas que aún no se han enviado. */
    Function("getPending") {
      NotificationStore.all(context)
    }

    Function("remove") { keys: List<String> ->
      NotificationStore.remove(context, keys)
    }
  }
}
