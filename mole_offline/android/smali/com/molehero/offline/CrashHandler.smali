.class public Lcom/molehero/offline/CrashHandler;
.super Ljava/lang/Object;
.source "CrashHandler.java"

.implements Ljava/lang/Thread$UncaughtExceptionHandler;

.field private final dir:Ljava/io/File;
.field private final prev:Ljava/lang/Thread$UncaughtExceptionHandler;

.method public constructor <init>(Ljava/io/File;Ljava/lang/Thread$UncaughtExceptionHandler;)V
    .registers 3
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    iput-object p1, p0, Lcom/molehero/offline/CrashHandler;->dir:Ljava/io/File;
    iput-object p2, p0, Lcom/molehero/offline/CrashHandler;->prev:Ljava/lang/Thread$UncaughtExceptionHandler;
    return-void
.end method

# static helper: stack trace of t as text
.method public static stackTrace(Ljava/lang/Throwable;)Ljava/lang/String;
    .registers 3
    new-instance v0, Ljava/io/StringWriter;
    invoke-direct {v0}, Ljava/io/StringWriter;-><init>()V
    new-instance v1, Ljava/io/PrintWriter;
    invoke-direct {v1, v0}, Ljava/io/PrintWriter;-><init>(Ljava/io/Writer;)V
    invoke-virtual {p0, v1}, Ljava/lang/Throwable;->printStackTrace(Ljava/io/PrintWriter;)V
    invoke-virtual {v1}, Ljava/io/PrintWriter;->flush()V
    invoke-virtual {v0}, Ljava/io/StringWriter;->toString()Ljava/lang/String;
    move-result-object v0
    return-object v0
.end method

# static helper: write text to dir/name (overwrite); never throws
.method public static writeText(Ljava/io/File;Ljava/lang/String;Ljava/lang/String;)V
    .registers 5
    :try_start
    new-instance v0, Ljava/io/FileOutputStream;
    new-instance v1, Ljava/io/File;
    invoke-direct {v1, p0, p1}, Ljava/io/File;-><init>(Ljava/io/File;Ljava/lang/String;)V
    invoke-direct {v0, v1}, Ljava/io/FileOutputStream;-><init>(Ljava/io/File;)V
    const-string v1, "UTF-8"
    invoke-virtual {p2, v1}, Ljava/lang/String;->getBytes(Ljava/lang/String;)[B
    move-result-object v1
    invoke-virtual {v0, v1}, Ljava/io/FileOutputStream;->write([B)V
    invoke-virtual {v0}, Ljava/io/FileOutputStream;->close()V
    :try_end
    .catch Ljava/lang/Throwable; {:try_start .. :try_end} :fail
    return-void
    :fail
    move-exception v0
    return-void
.end method

.method public uncaughtException(Ljava/lang/Thread;Ljava/lang/Throwable;)V
    .registers 6
    new-instance v0, Ljava/lang/StringBuilder;
    invoke-direct {v0}, Ljava/lang/StringBuilder;-><init>()V
    const-string v1, "Java 崩溃 (线程 "
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {p1}, Ljava/lang/Thread;->getName()Ljava/lang/String;
    move-result-object v1
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    const-string v1, ")\n"
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-static {p2}, Lcom/molehero/offline/CrashHandler;->stackTrace(Ljava/lang/Throwable;)Ljava/lang/String;
    move-result-object v1
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v0}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v0
    iget-object v1, p0, Lcom/molehero/offline/CrashHandler;->dir:Ljava/io/File;
    const-string v2, "last_crash.txt"
    invoke-static {v1, v2, v0}, Lcom/molehero/offline/CrashHandler;->writeText(Ljava/io/File;Ljava/lang/String;Ljava/lang/String;)V
    iget-object v0, p0, Lcom/molehero/offline/CrashHandler;->prev:Ljava/lang/Thread$UncaughtExceptionHandler;
    if-eqz v0, :done
    invoke-interface {v0, p1, p2}, Ljava/lang/Thread$UncaughtExceptionHandler;->uncaughtException(Ljava/lang/Thread;Ljava/lang/Throwable;)V
    :done
    return-void
.end method
