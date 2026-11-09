.class public Lcom/molehero/offline/AssetClient;
.super Landroid/webkit/WebViewClient;
.source "AssetClient.java"

# Serves https://mole.local/<path> from APK assets "game/<path>".
# Any other host gets a 404 so the game never touches the network.

.field private final am:Landroid/content/res/AssetManager;

.method public constructor <init>(Landroid/content/res/AssetManager;)V
    .registers 2
    invoke-direct {p0}, Landroid/webkit/WebViewClient;-><init>()V
    iput-object p1, p0, Lcom/molehero/offline/AssetClient;->am:Landroid/content/res/AssetManager;
    return-void
.end method

.method private static headers()Ljava/util/Map;
    .registers 3
    new-instance v0, Ljava/util/HashMap;
    invoke-direct {v0}, Ljava/util/HashMap;-><init>()V
    const-string v1, "Access-Control-Allow-Origin"
    const-string v2, "*"
    invoke-interface {v0, v1, v2}, Ljava/util/Map;->put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;
    const-string v1, "Cache-Control"
    const-string v2, "no-cache"
    invoke-interface {v0, v1, v2}, Ljava/util/Map;->put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;
    return-object v0
.end method

.method private static notFound()Landroid/webkit/WebResourceResponse;
    .registers 8
    new-instance v0, Landroid/webkit/WebResourceResponse;
    const-string v1, "text/plain"
    const-string v2, "utf-8"
    const/16 v3, 0x194
    const-string v4, "Not Found"
    invoke-static {}, Lcom/molehero/offline/AssetClient;->headers()Ljava/util/Map;
    move-result-object v5
    new-instance v6, Ljava/io/ByteArrayInputStream;
    const/4 v7, 0x0
    new-array v7, v7, [B
    invoke-direct {v6, v7}, Ljava/io/ByteArrayInputStream;-><init>([B)V
    invoke-direct/range {v0 .. v6}, Landroid/webkit/WebResourceResponse;-><init>(Ljava/lang/String;Ljava/lang/String;ILjava/lang/String;Ljava/util/Map;Ljava/io/InputStream;)V
    return-object v0
.end method

.method private static mime(Ljava/lang/String;)Ljava/lang/String;
    .registers 3
    invoke-virtual {p0}, Ljava/lang/String;->toLowerCase()Ljava/lang/String;
    move-result-object p0
    const-string v0, ".html"
    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :n1
    const-string v0, "text/html"
    return-object v0
    :n1
    const-string v0, ".js"
    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :n2
    const-string v0, "application/javascript"
    return-object v0
    :n2
    const-string v0, ".wasm"
    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :n3
    const-string v0, "application/wasm"
    return-object v0
    :n3
    const-string v0, ".swf"
    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :n4
    const-string v0, "application/x-shockwave-flash"
    return-object v0
    :n4
    const-string v0, ".xml"
    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :n5
    const-string v0, "text/xml"
    return-object v0
    :n5
    const-string v0, ".png"
    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :n6
    const-string v0, "image/png"
    return-object v0
    :n6
    const-string v0, ".jpg"
    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :n7
    const-string v0, "image/jpeg"
    return-object v0
    :n7
    const-string v0, ".mp3"
    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :n8
    const-string v0, "audio/mpeg"
    return-object v0
    :n8
    const-string v0, ".json"
    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :n9
    const-string v0, "application/json"
    return-object v0
    :n9
    const-string v0, ".txt"
    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :n10
    const-string v0, "text/plain"
    return-object v0
    :n10
    const-string v0, "application/octet-stream"
    return-object v0
.end method

.method public shouldInterceptRequest(Landroid/webkit/WebView;Landroid/webkit/WebResourceRequest;)Landroid/webkit/WebResourceResponse;
    .registers 12
    # locals v0..v8, params p0=v9 p1=v10 p2=v11
    invoke-interface {p2}, Landroid/webkit/WebResourceRequest;->getUrl()Landroid/net/Uri;
    move-result-object v0
    invoke-virtual {v0}, Landroid/net/Uri;->getHost()Ljava/lang/String;
    move-result-object v1
    const-string v2, "mole.local"
    invoke-virtual {v2, v1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v1
    if-nez v1, :local
    invoke-static {}, Lcom/molehero/offline/AssetClient;->notFound()Landroid/webkit/WebResourceResponse;
    move-result-object v0
    return-object v0

    :local
    invoke-virtual {v0}, Landroid/net/Uri;->getPath()Ljava/lang/String;
    move-result-object v8
    const/4 v3, 0x1
    if-eqz v8, :index
    invoke-virtual {v8}, Ljava/lang/String;->length()I
    move-result v2
    if-gt v2, v3, :strip
    :index
    const-string v8, "index.html"
    goto :open
    :strip
    invoke-virtual {v8, v3}, Ljava/lang/String;->substring(I)Ljava/lang/String;
    move-result-object v8

    :open
    :try_start
    iget-object v2, p0, Lcom/molehero/offline/AssetClient;->am:Landroid/content/res/AssetManager;
    new-instance v3, Ljava/lang/StringBuilder;
    invoke-direct {v3}, Ljava/lang/StringBuilder;-><init>()V
    const-string v4, "game/"
    invoke-virtual {v3, v4}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v3, v8}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v3}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v3
    invoke-virtual {v2, v3}, Landroid/content/res/AssetManager;->open(Ljava/lang/String;)Ljava/io/InputStream;
    move-result-object v7
    :try_end
    .catch Ljava/io/IOException; {:try_start .. :try_end} :missing

    # new WebResourceResponse(mime, null, 200, "OK", headers, stream) with v1..v7 contiguous
    invoke-static {v8}, Lcom/molehero/offline/AssetClient;->mime(Ljava/lang/String;)Ljava/lang/String;
    move-result-object v2
    const/4 v3, 0x0
    const/16 v4, 0xc8
    const-string v5, "OK"
    invoke-static {}, Lcom/molehero/offline/AssetClient;->headers()Ljava/util/Map;
    move-result-object v6
    new-instance v1, Landroid/webkit/WebResourceResponse;
    invoke-direct/range {v1 .. v7}, Landroid/webkit/WebResourceResponse;-><init>(Ljava/lang/String;Ljava/lang/String;ILjava/lang/String;Ljava/util/Map;Ljava/io/InputStream;)V
    return-object v1

    :missing
    move-exception v0
    invoke-static {}, Lcom/molehero/offline/AssetClient;->notFound()Landroid/webkit/WebResourceResponse;
    move-result-object v0
    return-object v0
.end method

.method public shouldOverrideUrlLoading(Landroid/webkit/WebView;Landroid/webkit/WebResourceRequest;)Z
    .registers 4
    # block any navigation away from the game page (e.g. navigateToURL to old websites)
    const/4 v0, 0x1
    return v0
.end method
