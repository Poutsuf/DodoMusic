package com.dodospoti.app

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
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
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import androidx.webkit.WebViewAssetLoader
import com.dodospoti.app.ui.theme.DodoSpotiTheme
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.GZIPInputStream

class MainActivity : ComponentActivity() {

    companion object {
        const val CHANNEL_ID = "dodospoti_playback_channel"
        const val NOTIFICATION_ID = 1001
        const val ACTION_PREV = "com.dodospoti.app.ACTION_PREV"
        const val ACTION_PLAY_PAUSE = "com.dodospoti.app.ACTION_PLAY_PAUSE"
        const val ACTION_NEXT = "com.dodospoti.app.ACTION_NEXT"
        const val ACTION_STOP = "com.dodospoti.app.ACTION_STOP"
    }

    private var dodoWebView: WebView? = null
    private var mediaSession: MediaSessionCompat? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var lastCoverUrl: String? = null
    private var lastCoverBitmap: Bitmap? = null

    private val mediaReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                ACTION_PLAY_PAUSE -> {
                    dodoWebView?.post {
                        dodoWebView?.evaluateJavascript("window.togglePlayPause && window.togglePlayPause()", null)
                    }
                }
                ACTION_NEXT -> {
                    dodoWebView?.post {
                        dodoWebView?.evaluateJavascript("window.playNextTrack && window.playNextTrack()", null)
                    }
                }
                ACTION_PREV -> {
                    dodoWebView?.post {
                        dodoWebView?.evaluateJavascript("window.playPrevTrack && window.playPrevTrack()", null)
                    }
                }
                ACTION_STOP -> {
                    dodoWebView?.post {
                        dodoWebView?.evaluateJavascript("window.stopPlayback && window.stopPlayback()", null)
                    }
                    closeMediaNotification()
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        window.statusBarColor = Color.parseColor("#06070b")
        window.navigationBarColor = Color.parseColor("#06070b")

        createNotificationChannel()
        setupMediaSession()

        val filter = IntentFilter().apply {
            addAction(ACTION_PLAY_PAUSE)
            addAction(ACTION_NEXT)
            addAction(ACTION_PREV)
            addAction(ACTION_STOP)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(mediaReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(mediaReceiver, filter)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 101)
            }
        }

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
                        activity = this@MainActivity,
                        onWebViewCreated = { webView ->
                            dodoWebView = webView
                        }
                    )
                }
            }
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                CHANNEL_ID,
                "DodoSpoti Воспроизведение",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Управление воспроизведением музыки на экране блокировки"
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                setShowBadge(false)
                enableVibration(false)
                setSound(null, null)
            }
            manager.createNotificationChannel(channel)
        }
    }

    private fun setupMediaSession() {
        mediaSession = MediaSessionCompat(this, "DodoSpotiMediaSession").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    dodoWebView?.post {
                        dodoWebView?.evaluateJavascript("window.togglePlayPause && window.togglePlayPause()", null)
                    }
                }
                override fun onPause() {
                    dodoWebView?.post {
                        dodoWebView?.evaluateJavascript("window.togglePlayPause && window.togglePlayPause()", null)
                    }
                }
                override fun onSkipToNext() {
                    dodoWebView?.post {
                        dodoWebView?.evaluateJavascript("window.playNextTrack && window.playNextTrack()", null)
                    }
                }
                override fun onSkipToPrevious() {
                    dodoWebView?.post {
                        dodoWebView?.evaluateJavascript("window.playPrevTrack && window.playPrevTrack()", null)
                    }
                }
                override fun onStop() {
                    dodoWebView?.post {
                        dodoWebView?.evaluateJavascript("window.stopPlayback && window.stopPlayback()", null)
                    }
                    closeMediaNotification()
                }
            })
            isActive = true
        }
    }

    private fun updateWakeLock(isPlaying: Boolean) {
        try {
            if (wakeLock == null) {
                val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DodoSpoti:PlaybackWakeLock")
            }
            if (isPlaying) {
                if (wakeLock?.isHeld != true) {
                    wakeLock?.acquire(3 * 60 * 60 * 1000L)
                }
            } else {
                if (wakeLock?.isHeld == true) {
                    wakeLock?.release()
                }
            }
        } catch (e: Exception) {
            android.util.Log.w("DodoSpoti", "WakeLock error: ${e.message}")
        }
    }

    fun updateMediaNotification(title: String, artist: String, coverUrl: String, isPlaying: Boolean) {
        updateWakeLock(isPlaying)

        val state = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_STOP
            )
            .setState(
                if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN,
                1.0f
            )
            .build()
        mediaSession?.setPlaybackState(state)

        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPendingIntent = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val prevIntent = Intent(ACTION_PREV).setPackage(packageName)
        val prevPending = PendingIntent.getBroadcast(
            this, 1, prevIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val playPauseIntent = Intent(ACTION_PLAY_PAUSE).setPackage(packageName)
        val playPausePending = PendingIntent.getBroadcast(
            this, 2, playPauseIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val nextIntent = Intent(ACTION_NEXT).setPackage(packageName)
        val nextPending = PendingIntent.getBroadcast(
            this, 3, nextIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = Intent(ACTION_STOP).setPackage(packageName)
        val stopPending = PendingIntent.getBroadcast(
            this, 4, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        fun postNotification(bitmap: Bitmap?) {
            val meta = MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            if (bitmap != null) {
                meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bitmap)
            }
            mediaSession?.setMetadata(meta.build())

            val builder = NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(artist)
                .setContentIntent(contentPendingIntent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(isPlaying)
                .setShowWhen(false)
                .addAction(android.R.drawable.ic_media_previous, "Назад", prevPending)
                .addAction(
                    if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                    if (isPlaying) "Пауза" else "Играть",
                    playPausePending
                )
                .addAction(android.R.drawable.ic_media_next, "Вперёд", nextPending)
                .setStyle(
                    MediaStyle()
                        .setMediaSession(mediaSession?.sessionToken)
                        .setShowActionsInCompactView(0, 1, 2)
                        .setShowCancelButton(true)
                        .setCancelButtonIntent(stopPending)
                )

            if (bitmap != null) {
                builder.setLargeIcon(bitmap)
            }

            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(NOTIFICATION_ID, builder.build())
        }

        if (coverUrl.isNotEmpty() && coverUrl != lastCoverUrl) {
            lastCoverUrl = coverUrl
            Thread {
                try {
                    val conn = URL(coverUrl).openConnection()
                    conn.connectTimeout = 4000
                    conn.readTimeout = 4000
                    val bmp = BitmapFactory.decodeStream(conn.getInputStream())
                    lastCoverBitmap = bmp
                    runOnUiThread { postNotification(bmp) }
                } catch (_: Exception) {
                    runOnUiThread { postNotification(null) }
                }
            }.start()
        } else {
            postNotification(lastCoverBitmap)
        }
    }

    fun closeMediaNotification() {
        updateWakeLock(false)
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(NOTIFICATION_ID)
        mediaSession?.let {
            val stoppedState = PlaybackStateCompat.Builder()
                .setState(PlaybackStateCompat.STATE_STOPPED, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 0f)
                .build()
            it.setPlaybackState(stoppedState)
        }
    }

    override fun onDestroy() {
        updateWakeLock(false)
        closeMediaNotification()
        mediaSession?.release()
        mediaSession = null
        try {
            unregisterReceiver(mediaReceiver)
        } catch (_: Exception) {}
        dodoWebView?.destroy()
        dodoWebView = null
        super.onDestroy()
    }
}

class AndroidBridgeInterface(
    private val activity: MainActivity
) {
    @JavascriptInterface
    fun updateMediaNotification(title: String, artist: String, coverUrl: String, isPlaying: Boolean) {
        activity.runOnUiThread {
            activity.updateMediaNotification(title, artist, coverUrl, isPlaying)
        }
    }

    @JavascriptInterface
    fun closeMediaNotification() {
        activity.runOnUiThread {
            activity.closeMediaNotification()
        }
    }

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
    activity: MainActivity,
    onWebViewCreated: (WebView) -> Unit
) {
    val context = LocalContext.current
    val assetLoader = remember {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()
    }
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

                        useWideViewPort = true
                        loadWithOverviewMode = true

                        cacheMode = WebSettings.LOAD_DEFAULT
                        userAgentString = "$userAgentString DodoSpotiAndroid/1.3"
                    }

                    addJavascriptInterface(AndroidBridgeInterface(activity), "AndroidBridge")

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
