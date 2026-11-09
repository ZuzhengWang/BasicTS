.class public Lcom/molehero/offline/MainActivity;
.super Landroid/app/Activity;
.source "MainActivity.java"

# Full-screen WebView that runs Ruffle + the local game server (assets/game/index.html).
# Everything is served from APK assets through AssetClient; no network is used.

.field private web:Landroid/webkit/WebView;

.method public constructor <init>()V
    .registers 1
    invoke-direct {p0}, Landroid/app/Activity;-><init>()V
    return-void
.end method

.method protected onCreate(Landroid/os/Bundle;)V
    .registers 6
    invoke-super {p0, p1}, Landroid/app/Activity;->onCreate(Landroid/os/Bundle;)V

    # no title, fullscreen, keep screen on
    const/4 v0, 0x1
    invoke-virtual {p0, v0}, Landroid/app/Activity;->requestWindowFeature(I)Z
    invoke-virtual {p0}, Landroid/app/Activity;->getWindow()Landroid/view/Window;
    move-result-object v0
    const/16 v1, 0x480
    invoke-virtual {v0, v1}, Landroid/view/Window;->addFlags(I)V

    # WebView.setWebContentsDebuggingEnabled(true) so chrome://inspect can read logs during testing
    const/4 v0, 0x1
    invoke-static {v0}, Landroid/webkit/WebView;->setWebContentsDebuggingEnabled(Z)V

    new-instance v0, Landroid/webkit/WebView;
    invoke-direct {v0, p0}, Landroid/webkit/WebView;-><init>(Landroid/content/Context;)V
    iput-object v0, p0, Lcom/molehero/offline/MainActivity;->web:Landroid/webkit/WebView;

    invoke-virtual {v0}, Landroid/webkit/WebView;->getSettings()Landroid/webkit/WebSettings;
    move-result-object v1
    const/4 v2, 0x1
    const/4 v3, 0x0
    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setJavaScriptEnabled(Z)V
    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setDomStorageEnabled(Z)V
    invoke-virtual {v1, v3}, Landroid/webkit/WebSettings;->setMediaPlaybackRequiresUserGesture(Z)V
    invoke-virtual {v1, v3}, Landroid/webkit/WebSettings;->setAllowFileAccess(Z)V
    invoke-virtual {v1, v3}, Landroid/webkit/WebSettings;->setAllowContentAccess(Z)V
    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setUseWideViewPort(Z)V
    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setLoadWithOverviewMode(Z)V
    invoke-virtual {v1, v3}, Landroid/webkit/WebSettings;->setSupportZoom(Z)V
    const/4 v2, 0x2
    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setCacheMode(I)V

    new-instance v1, Lcom/molehero/offline/AssetClient;
    invoke-virtual {p0}, Landroid/app/Activity;->getAssets()Landroid/content/res/AssetManager;
    move-result-object v2
    invoke-direct {v1, v2}, Lcom/molehero/offline/AssetClient;-><init>(Landroid/content/res/AssetManager;)V
    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setWebViewClient(Landroid/webkit/WebViewClient;)V

    new-instance v1, Landroid/webkit/WebChromeClient;
    invoke-direct {v1}, Landroid/webkit/WebChromeClient;-><init>()V
    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setWebChromeClient(Landroid/webkit/WebChromeClient;)V

    new-instance v1, Lcom/molehero/offline/NativeBridge;
    invoke-virtual {p0}, Landroid/app/Activity;->getFilesDir()Ljava/io/File;
    move-result-object v2
    invoke-direct {v1, v2}, Lcom/molehero/offline/NativeBridge;-><init>(Ljava/io/File;)V
    const-string v2, "MoleNative"
    invoke-virtual {v0, v1, v2}, Landroid/webkit/WebView;->addJavascriptInterface(Ljava/lang/Object;Ljava/lang/String;)V

    invoke-virtual {p0, v0}, Landroid/app/Activity;->setContentView(Landroid/view/View;)V
    invoke-direct {p0}, Lcom/molehero/offline/MainActivity;->hideSystemUi()V
    invoke-virtual {v0}, Landroid/webkit/WebView;->requestFocus()Z

    const-string v1, "https://mole.local/index.html"
    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V
    return-void
.end method

.method private hideSystemUi()V
    .registers 3
    invoke-virtual {p0}, Landroid/app/Activity;->getWindow()Landroid/view/Window;
    move-result-object v0
    invoke-virtual {v0}, Landroid/view/Window;->getDecorView()Landroid/view/View;
    move-result-object v0
    # IMMERSIVE_STICKY|FULLSCREEN|HIDE_NAVIGATION|LAYOUT_* flags
    const/16 v1, 0x1706
    invoke-virtual {v0, v1}, Landroid/view/View;->setSystemUiVisibility(I)V
    return-void
.end method

.method public onWindowFocusChanged(Z)V
    .registers 2
    invoke-super {p0, p1}, Landroid/app/Activity;->onWindowFocusChanged(Z)V
    if-eqz p1, :cond_done
    invoke-direct {p0}, Lcom/molehero/offline/MainActivity;->hideSystemUi()V
    :cond_done
    return-void
.end method

.method public onBackPressed()V
    .registers 2
    # keep the game alive on an accidental back press
    const/4 v0, 0x1
    invoke-virtual {p0, v0}, Landroid/app/Activity;->moveTaskToBack(Z)Z
    return-void
.end method

.method protected onDestroy()V
    .registers 2
    iget-object v0, p0, Lcom/molehero/offline/MainActivity;->web:Landroid/webkit/WebView;
    if-eqz v0, :cond_done
    invoke-virtual {v0}, Landroid/webkit/WebView;->destroy()V
    :cond_done
    invoke-super {p0}, Landroid/app/Activity;->onDestroy()V
    return-void
.end method
