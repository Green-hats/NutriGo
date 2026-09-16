package com.greenhats.nutrigo

import android.os.Bundle
import android.os.Build
import android.graphics.Color
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.annotation.Keep
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private val insetsBridge = AppInsetsBridge()
  private var appWebView: WebView? = null

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    appWebView = webView
    webView.setBackgroundColor(Color.rgb(247, 248, 243))
    // Only exposes read-only geometry; no native actions or user data.
    webView.addJavascriptInterface(insetsBridge, "NutriGoInsets")
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isStatusBarContrastEnforced = false
      window.isNavigationBarContrastEnforced = false
    }
    window.decorView.setBackgroundColor(Color.rgb(247, 248, 243))
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, windowInsets ->
      val bars = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      val ime = WindowInsetsCompat.Type.ime()
      val safe = windowInsets.getInsets(bars)
      val keyboardOpen = windowInsets.isVisible(ime)
      // Keep the WebView behind system bars. Only the keyboard resizes it natively.
      // CSS positions controls inside the safe area, letting page backgrounds fill the screen.
      view.setPadding(0, 0, 0, windowInsets.getInsets(ime).bottom)
      val snapshot = """{"top":${safe.top},"right":${safe.right},"bottom":${if (keyboardOpen) 0 else safe.bottom},"left":${safe.left},"keyboardOpen":$keyboardOpen}"""
      if (insetsBridge.snapshot != snapshot) {
        insetsBridge.snapshot = snapshot
        appWebView?.evaluateJavascript("window.dispatchEvent(new Event('nutrigo:insets'))", null)
      }
      // Zero, rather than consume, so old and new WebViews both clear stale keyboard insets.
      val handled = bars or ime
      WindowInsetsCompat.Builder(windowInsets).setInsets(handled, Insets.NONE).build()
    }
    ViewCompat.requestApplyInsets(content)
  }
}

@Keep
class AppInsetsBridge {
  @Volatile
  var snapshot: String = """{"top":0,"right":0,"bottom":0,"left":0,"keyboardOpen":false}"""

  @JavascriptInterface
  fun getInsets(): String = snapshot
}
