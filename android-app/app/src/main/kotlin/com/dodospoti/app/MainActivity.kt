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
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import com.dodospoti.app.ui.theme.DodoSpotiTheme
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.GZIPInputStream

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
            var currentUrl = URL(urlStr)
            var redirects = 0
            while (redirects < 6) {
                val conn = (currentUrl.openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 9000
                    readTimeout = 9000
                    instanceFollowRedirects = true
                    setRequestProperty(
                        "User-Agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                    )
                    setRequestProperty("Accept", "*/*")
                    if (currentUrl.host.contains("soundcloud.com")) {
                        setRequestProperty("Origin", "https://soundcloud.com")
                        setRequestProperty("Referer", "https://soundcloud.com/")
                    }
                }

                val responseCode = conn.responseCode
                if (responseCode in 301..308) {
                    val location = conn.getHeaderField("Location") ?: break
                    currentUrl = URL(currentUrl, location)
                    redirects++
                    continue
                }

                val stream = if (responseCode in 200..299) {
                    conn.inputStream
                } else {
                    conn.errorStream ?: return ""
                }

                val encoding = conn.contentEncoding
                val inputStream = if ("gzip".equals(encoding, ignoreCase = true)) {
                    GZIPInputStream(stream)
                } else {
                    stream
                }

                return inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            }
            ""
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
    val assetLoader = remember {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()
    }
    // Автономное приложение всегда загружает локальные веб-ресурсы без зависимости от внешних серверов
    val targetUrl = "https://appassets.androidplatform.net/assets/www/index.html"

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

                    // Включаем аппаратное ускорение для максимальной плавности (60-120 FPS)
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

                        // Мобильный Viewport: идеальная подгонка под ширину экрана без вылезания
                        useWideViewPort = true
                        loadWithOverviewMode = true

                        cacheMode = WebSettings.LOAD_DEFAULT
                        userAgentString = "$userAgentString DodoSpotiAndroid/1.3"
                    }

                    // Нативный мост для мгновенных запросов к SoundCloud/Audius без CORS
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

                    loadUrl(targetUrl)
                    onWebViewCreated(this)
                }
            }
        )
    }
}
