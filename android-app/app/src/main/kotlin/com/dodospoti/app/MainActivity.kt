package com.dodospoti.app

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import com.dodospoti.app.ui.theme.DodoSpotiTheme
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : ComponentActivity() {

    private var dodoWebView: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        window.statusBarColor = Color.parseColor("#06070b")
        window.navigationBarColor = Color.parseColor("#06070b")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (dodoWebView?.canGoBack() == true) {
                    dodoWebView?.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        setContent {
            DodoSpotiTheme {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(androidx.compose.ui.graphics.Color(0xFF06070B))
                        .systemBarsPadding()
                ) {
                    DodoSpotiPlayerScreen(
                        onWebViewCreated = { webView ->
                            dodoWebView = webView
                        }
                    )
                }
            }
        }
    }

    override fun onDestroy() {
        dodoWebView?.destroy()
        dodoWebView = null
        super.onDestroy()
    }
}

class AndroidBridgeInterface(private val context: Context) {
    @JavascriptInterface
    fun fetchUrl(urlStr: String): String {
        return try {
            val url = URL(urlStr)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 7000
                readTimeout = 7000
                setRequestProperty(
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                )
                setRequestProperty("Accept", "*/*")
                if (urlStr.contains("soundcloud.com")) {
                    setRequestProperty("Origin", "https://soundcloud.com")
                    setRequestProperty("Referer", "https://soundcloud.com/")
                }
            }
            conn.inputStream.bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            android.util.Log.e("DodoSpoti", "fetchUrl error for $urlStr: ${e.message}")
            ""
        }
    }

    @JavascriptInterface
    fun getPlatform(): String = "android"
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun DodoSpotiPlayerScreen(
    onWebViewCreated: (WebView) -> Unit
) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("dodospoti_prefs", Context.MODE_PRIVATE) }
    val assetLoader = remember {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()
    }
    val defaultUrl = "https://appassets.androidplatform.net/assets/www/index.html"
    var currentUrl by remember {
        mutableStateOf(prefs.getString("server_url", defaultUrl) ?: defaultUrl)
    }
    var activeWebView by remember { mutableStateOf<WebView?>(null) }

    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                WebView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                    setBackgroundColor(Color.parseColor("#06070b"))

                    // Включаем аппаратное ускорение для максимальной плавности
                    setLayerType(View.LAYER_TYPE_HARDWARE, null)
                    isVerticalScrollBarEnabled = false
                    isHorizontalScrollBarEnabled = false

                    settings.apply {
                        javaScriptEnabled = true
                        domStorageEnabled = true
                        databaseEnabled = true
                        mediaPlaybackRequiresUserGesture = false
                        mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                        allowFileAccess = true
                        allowContentAccess = true
                        allowFileAccessFromFileURLs = true
                        allowUniversalAccessFromFileURLs = true

                        // Корректный мобильный Viewport: страница подстраивается точно под ширину экрана
                        useWideViewPort = true
                        loadWithOverviewMode = true

                        cacheMode = WebSettings.LOAD_DEFAULT
                        userAgentString = "$userAgentString DodoSpotiAndroid/1.3"
                    }

                    // Добавляем нативный мост для HTTP запросов без CORS
                    addJavascriptInterface(AndroidBridgeInterface(context), "AndroidBridge")

                    webChromeClient = object : WebChromeClient() {
                        override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                            android.util.Log.d(
                                "DodoSpoti",
                                "[JS] ${consoleMessage?.message()} (${consoleMessage?.lineNumber()})"
                            )
                            return true
                        }
                    }

                    webViewClient = object : WebViewClient() {
                        override fun shouldInterceptRequest(
                            view: WebView?,
                            request: WebResourceRequest?
                        ): WebResourceResponse? {
                            val url = request?.url ?: return null
                            return assetLoader.shouldInterceptRequest(url)
                        }

                        override fun onReceivedError(
                            view: WebView?,
                            request: WebResourceRequest?,
                            error: WebResourceError?
                        ) {
                            super.onReceivedError(view, request, error)
                            android.util.Log.e("DodoSpoti", "WebView Error: ${error?.description}")
                        }
                    }

                    loadUrl(currentUrl)
                    activeWebView = this
                    onWebViewCreated(this)
                }
            }
        )
    }
}
