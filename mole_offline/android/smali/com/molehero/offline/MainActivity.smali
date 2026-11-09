.class public Lcom/molehero/offline/MainActivity;
.super Landroid/app/Activity;
.source "MainActivity.java"

.implements Landroid/view/View$OnClickListener;

# Full-screen WebView that runs Ruffle + the local game server (assets/game/index.html).
# Everything is served from APK assets through AssetClient; no network is used.
# If the previous run crashed (files/last_crash.txt), the report is shown first.

.field private web:Landroid/webkit/WebView;

.method public constructor <init>()V
    .registers 1
    invoke-direct {p0}, Landroid/app/Activity;-><init>()V
    return-void
.end method

.method protected onCreate(Landroid/os/Bundle;)V
    .registers 6
    invoke-super {p0, p1}, Landroid/app/Activity;->onCreate(Landroid/os/Bundle;)V

    # no title, fullscreen, keep screen on (must happen before any setContentView)
    const/4 v0, 0x1
    invoke-virtual {p0, v0}, Landroid/app/Activity;->requestWindowFeature(I)Z
    invoke-virtual {p0}, Landroid/app/Activity;->getWindow()Landroid/view/Window;
    move-result-object v0
    const/16 v1, 0x480
    invoke-virtual {v0, v1}, Landroid/view/Window;->addFlags(I)V

    new-instance v0, Ljava/io/File;
    invoke-virtual {p0}, Landroid/app/Activity;->getFilesDir()Ljava/io/File;
    move-result-object v1
    const-string v2, "last_crash.txt"
    invoke-direct {v0, v1, v2}, Ljava/io/File;-><init>(Ljava/io/File;Ljava/lang/String;)V
    invoke-virtual {v0}, Ljava/io/File;->exists()Z
    move-result v2
    if-eqz v2, :start
    invoke-static {v0}, Lcom/molehero/offline/NativeBridge;->readAll(Ljava/io/File;)Ljava/lang/String;
    move-result-object v2
    invoke-direct {p0, v2}, Lcom/molehero/offline/MainActivity;->showCrash(Ljava/lang/String;)V
    return-void
    :start
    invoke-direct {p0}, Lcom/molehero/offline/MainActivity;->startGame()V
    return-void
.end method

.method private startGame()V
    .registers 5
    :try_start
    invoke-direct {p0}, Lcom/molehero/offline/MainActivity;->setupWeb()V
    :try_end
    .catch Ljava/lang/Throwable; {:try_start .. :try_end} :fail
    return-void
    :fail
    move-exception v0
    new-instance v1, Ljava/lang/StringBuilder;
    invoke-direct {v1}, Ljava/lang/StringBuilder;-><init>()V
    const-string v2, "启动游戏失败:\n"
    invoke-virtual {v1, v2}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-static {v0}, Lcom/molehero/offline/CrashHandler;->stackTrace(Ljava/lang/Throwable;)Ljava/lang/String;
    move-result-object v2
    invoke-virtual {v1, v2}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v1}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v1
    invoke-virtual {p0}, Landroid/app/Activity;->getFilesDir()Ljava/io/File;
    move-result-object v2
    const-string v3, "last_crash.txt"
    invoke-static {v2, v3, v1}, Lcom/molehero/offline/CrashHandler;->writeText(Ljava/io/File;Ljava/lang/String;Ljava/lang/String;)V
    invoke-direct {p0, v1}, Lcom/molehero/offline/MainActivity;->showCrash(Ljava/lang/String;)V
    return-void
.end method

.method private showCrash(Ljava/lang/String;)V
    .registers 8
    # message + tail of files/mole_log.txt
    new-instance v0, Ljava/lang/StringBuilder;
    invoke-direct {v0}, Ljava/lang/StringBuilder;-><init>()V
    const-string v1, "摩尔勇士离线版：上次运行出现问题。\n请把这一页截图发给开发者，然后点击屏幕继续进入游戏。\n\n"
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v0, p1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    const-string v1, "\n\n---- 最近日志 ----\n"
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    new-instance v1, Ljava/io/File;
    invoke-virtual {p0}, Landroid/app/Activity;->getFilesDir()Ljava/io/File;
    move-result-object v2
    const-string v3, "mole_log.txt"
    invoke-direct {v1, v2, v3}, Ljava/io/File;-><init>(Ljava/io/File;Ljava/lang/String;)V
    invoke-static {v1}, Lcom/molehero/offline/NativeBridge;->readAll(Ljava/io/File;)Ljava/lang/String;
    move-result-object v1
    if-eqz v1, :nolog
    invoke-virtual {v1}, Ljava/lang/String;->length()I
    move-result v2
    const/16 v3, 0xfa0
    if-le v2, v3, :short
    sub-int v3, v2, v3
    invoke-virtual {v1, v3}, Ljava/lang/String;->substring(I)Ljava/lang/String;
    move-result-object v1
    :short
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    :nolog
    invoke-virtual {v0}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v0

    new-instance v1, Landroid/widget/TextView;
    invoke-direct {v1, p0}, Landroid/widget/TextView;-><init>(Landroid/content/Context;)V
    invoke-virtual {v1, v0}, Landroid/widget/TextView;->setText(Ljava/lang/CharSequence;)V
    const/high16 v2, 0x41400000
    invoke-virtual {v1, v2}, Landroid/widget/TextView;->setTextSize(F)V
    const/high16 v2, -0x1000000
    invoke-virtual {v1, v2}, Landroid/widget/TextView;->setTextColor(I)V
    const/4 v2, -0x1
    invoke-virtual {v1, v2}, Landroid/view/View;->setBackgroundColor(I)V
    const/16 v2, 0x20
    invoke-virtual {v1, v2, v2, v2, v2}, Landroid/view/View;->setPadding(IIII)V
    invoke-virtual {v1, p0}, Landroid/view/View;->setOnClickListener(Landroid/view/View$OnClickListener;)V

    new-instance v2, Landroid/widget/ScrollView;
    invoke-direct {v2, p0}, Landroid/widget/ScrollView;-><init>(Landroid/content/Context;)V
    const/4 v3, -0x1
    invoke-virtual {v2, v3}, Landroid/view/View;->setBackgroundColor(I)V
    invoke-virtual {v2, v1}, Landroid/widget/ScrollView;->addView(Landroid/view/View;)V
    invoke-virtual {p0, v2}, Landroid/app/Activity;->setContentView(Landroid/view/View;)V
    return-void
.end method

.method public onClick(Landroid/view/View;)V
    .registers 5
    new-instance v0, Ljava/io/File;
    invoke-virtual {p0}, Landroid/app/Activity;->getFilesDir()Ljava/io/File;
    move-result-object v1
    const-string v2, "last_crash.txt"
    invoke-direct {v0, v1, v2}, Ljava/io/File;-><init>(Ljava/io/File;Ljava/lang/String;)V
    invoke-virtual {v0}, Ljava/io/File;->delete()Z
    invoke-direct {p0}, Lcom/molehero/offline/MainActivity;->startGame()V
    return-void
.end method

.method private setupWeb()V
    .registers 5
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
    invoke-direct {v1, v2, p0}, Lcom/molehero/offline/AssetClient;-><init>(Landroid/content/res/AssetManager;Landroid/app/Activity;)V
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
    .registers 3
    invoke-super {p0, p1}, Landroid/app/Activity;->onWindowFocusChanged(Z)V
    if-eqz p1, :cond_done
    iget-object v0, p0, Lcom/molehero/offline/MainActivity;->web:Landroid/webkit/WebView;
    if-eqz v0, :cond_done
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
    const/4 v0, 0x0
    iput-object v0, p0, Lcom/molehero/offline/MainActivity;->web:Landroid/webkit/WebView;
    :cond_done
    invoke-super {p0}, Landroid/app/Activity;->onDestroy()V
    return-void
.end method
