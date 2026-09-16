package com.greenhats.nutrigo

import android.os.Bundle
import android.graphics.Color
import android.view.View
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
    // 原生层处理系统栏、刘海与键盘，兼容尚未支持 CSS insets 的旧 WebView。
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, windowInsets ->
      val handled = WindowInsetsCompat.Type.systemBars() or
        WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
      val safe = windowInsets.getInsets(handled)
      view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
      WindowInsetsCompat.Builder(windowInsets).setInsets(handled, Insets.NONE).build()
    }
    ViewCompat.requestApplyInsets(content)
  }
}
