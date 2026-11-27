package com.bunpocket.app

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var appWebView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    // 个人自用：release 包也默认开启 WebView 远程调试（chrome://inspect）。
    // 注意：任何已授权 USB 调试的电脑都能通过 CDP 检查页面、执行 JS；换机/发布前应移除。
    WebView.setWebContentsDebuggingEnabled(true)
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // 注册晚于各插件（LIFO 优先级最高），接管 tauri AppPlugin 的返回回调：
    // 手势（预测性返回）与返回键都会经过 dispatcher 到这里。
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val webView = appWebView
        if (webView == null) {
          moveTaskToBack(true)
          return
        }
        if (webView.canGoBack()) {
          webView.goBack()
          return
        }
        // 到栈底后的去留交给 JS 判定（router 状态是唯一可信源；
        // WebView.getUrl() 对 pushState 的反映不可靠）：
        // 在首页 → 返回 "exit" → 退到桌面；否则 location.replace 回首页（不增长历史栈）。
        webView.evaluateJavascript(
          "(location.hash==='#/'||location.hash==='#'||location.hash==='') ? 'exit' : (location.replace('#/'), 'nav')",
        ) { result ->
          if (result == "\"exit\"") moveTaskToBack(true)
        }
      }
    })
  }

  override fun onPause() {
    super.onPause()
    // 回到桌面时立即刷新小组件数据
    BunPocketWidgetProvider.pushAll(this)
  }

  override fun onWebViewCreate(webView: WebView) {
    appWebView = webView
  }
}
