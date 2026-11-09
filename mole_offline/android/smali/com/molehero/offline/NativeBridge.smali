.class public Lcom/molehero/offline/NativeBridge;
.super Ljava/lang/Object;
.source "NativeBridge.java"

# window.MoleNative in the page: load()/save(json) persist the offline save in the app's private
# files dir (files/mole_save.json, previous version kept as mole_save.json.bak).

.field private final dir:Ljava/io/File;

.method public constructor <init>(Ljava/io/File;)V
    .registers 2
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    iput-object p1, p0, Lcom/molehero/offline/NativeBridge;->dir:Ljava/io/File;
    return-void
.end method

.method private file(Ljava/lang/String;)Ljava/io/File;
    .registers 4
    new-instance v0, Ljava/io/File;
    iget-object v1, p0, Lcom/molehero/offline/NativeBridge;->dir:Ljava/io/File;
    invoke-direct {v0, v1, p1}, Ljava/io/File;-><init>(Ljava/io/File;Ljava/lang/String;)V
    return-object v0
.end method

.method public static readAll(Ljava/io/File;)Ljava/lang/String;
    .registers 6
    invoke-virtual {p0}, Ljava/io/File;->exists()Z
    move-result v0
    if-nez v0, :go
    const/4 v0, 0x0
    return-object v0
    :go
    :try_start
    new-instance v0, Ljava/io/FileInputStream;
    invoke-direct {v0, p0}, Ljava/io/FileInputStream;-><init>(Ljava/io/File;)V
    new-instance v1, Ljava/io/ByteArrayOutputStream;
    invoke-direct {v1}, Ljava/io/ByteArrayOutputStream;-><init>()V
    const/16 v2, 0x2000
    new-array v2, v2, [B
    :loop
    invoke-virtual {v0, v2}, Ljava/io/FileInputStream;->read([B)I
    move-result v3
    if-ltz v3, :eof
    const/4 v4, 0x0
    invoke-virtual {v1, v2, v4, v3}, Ljava/io/ByteArrayOutputStream;->write([BII)V
    goto :loop
    :eof
    invoke-virtual {v0}, Ljava/io/FileInputStream;->close()V
    const-string v2, "UTF-8"
    invoke-virtual {v1, v2}, Ljava/io/ByteArrayOutputStream;->toString(Ljava/lang/String;)Ljava/lang/String;
    move-result-object v0
    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :fail
    return-object v0
    :fail
    move-exception v0
    const/4 v0, 0x0
    return-object v0
.end method

.method public load()Ljava/lang/String;
    .registers 3
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    const-string v0, "mole_save.json"
    invoke-direct {p0, v0}, Lcom/molehero/offline/NativeBridge;->file(Ljava/lang/String;)Ljava/io/File;
    move-result-object v0
    invoke-static {v0}, Lcom/molehero/offline/NativeBridge;->readAll(Ljava/io/File;)Ljava/lang/String;
    move-result-object v1
    if-eqz v1, :bak
    return-object v1
    :bak
    const-string v0, "mole_save.json.bak"
    invoke-direct {p0, v0}, Lcom/molehero/offline/NativeBridge;->file(Ljava/lang/String;)Ljava/io/File;
    move-result-object v0
    invoke-static {v0}, Lcom/molehero/offline/NativeBridge;->readAll(Ljava/io/File;)Ljava/lang/String;
    move-result-object v1
    return-object v1
.end method

.method public save(Ljava/lang/String;)Z
    .registers 7
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    :try_start
    const-string v0, "mole_save.json.tmp"
    invoke-direct {p0, v0}, Lcom/molehero/offline/NativeBridge;->file(Ljava/lang/String;)Ljava/io/File;
    move-result-object v0
    new-instance v1, Ljava/io/FileOutputStream;
    invoke-direct {v1, v0}, Ljava/io/FileOutputStream;-><init>(Ljava/io/File;)V
    const-string v2, "UTF-8"
    invoke-virtual {p1, v2}, Ljava/lang/String;->getBytes(Ljava/lang/String;)[B
    move-result-object v2
    invoke-virtual {v1, v2}, Ljava/io/FileOutputStream;->write([B)V
    invoke-virtual {v1}, Ljava/io/FileOutputStream;->getFD()Ljava/io/FileDescriptor;
    move-result-object v2
    invoke-virtual {v2}, Ljava/io/FileDescriptor;->sync()V
    invoke-virtual {v1}, Ljava/io/FileOutputStream;->close()V

    const-string v2, "mole_save.json"
    invoke-direct {p0, v2}, Lcom/molehero/offline/NativeBridge;->file(Ljava/lang/String;)Ljava/io/File;
    move-result-object v2
    const-string v3, "mole_save.json.bak"
    invoke-direct {p0, v3}, Lcom/molehero/offline/NativeBridge;->file(Ljava/lang/String;)Ljava/io/File;
    move-result-object v3
    invoke-virtual {v2}, Ljava/io/File;->exists()Z
    move-result v4
    if-eqz v4, :nobak
    invoke-virtual {v3}, Ljava/io/File;->delete()Z
    invoke-virtual {v2, v3}, Ljava/io/File;->renameTo(Ljava/io/File;)Z
    :nobak
    invoke-virtual {v0, v2}, Ljava/io/File;->renameTo(Ljava/io/File;)Z
    move-result v4
    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :fail
    return v4
    :fail
    move-exception v0
    const-string v1, "MoleOffline"
    const-string v2, "save failed"
    invoke-static {v1, v2, v0}, Landroid/util/Log;->e(Ljava/lang/String;Ljava/lang/String;Ljava/lang/Throwable;)I
    const/4 v0, 0x0
    return v0
.end method

.method public log(Ljava/lang/String;)V
    .registers 7
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    const-string v0, "MoleOffline"
    invoke-static {v0, p1}, Landroid/util/Log;->i(Ljava/lang/String;Ljava/lang/String;)I
    :try_start
    const-string v0, "mole_log.txt"
    invoke-direct {p0, v0}, Lcom/molehero/offline/NativeBridge;->file(Ljava/lang/String;)Ljava/io/File;
    move-result-object v0
    invoke-virtual {v0}, Ljava/io/File;->length()J
    move-result-wide v1
    const-wide/32 v3, 0x80000
    cmp-long v1, v1, v3
    if-lez v1, :append
    # > 512 KB: keep the previous file as mole_log.old.txt
    const-string v1, "mole_log.old.txt"
    invoke-direct {p0, v1}, Lcom/molehero/offline/NativeBridge;->file(Ljava/lang/String;)Ljava/io/File;
    move-result-object v1
    invoke-virtual {v1}, Ljava/io/File;->delete()Z
    invoke-virtual {v0, v1}, Ljava/io/File;->renameTo(Ljava/io/File;)Z
    :append
    new-instance v1, Ljava/io/FileOutputStream;
    const/4 v2, 0x1
    invoke-direct {v1, v0, v2}, Ljava/io/FileOutputStream;-><init>(Ljava/io/File;Z)V
    new-instance v2, Ljava/lang/StringBuilder;
    invoke-direct {v2}, Ljava/lang/StringBuilder;-><init>()V
    invoke-virtual {v2, p1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    const-string v3, "\n"
    invoke-virtual {v2, v3}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v2}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v2
    const-string v3, "UTF-8"
    invoke-virtual {v2, v3}, Ljava/lang/String;->getBytes(Ljava/lang/String;)[B
    move-result-object v2
    invoke-virtual {v1, v2}, Ljava/io/FileOutputStream;->write([B)V
    invoke-virtual {v1}, Ljava/io/FileOutputStream;->close()V
    :try_end
    .catch Ljava/lang/Throwable; {:try_start .. :try_end} :fail
    return-void
    :fail
    move-exception v0
    return-void
.end method
