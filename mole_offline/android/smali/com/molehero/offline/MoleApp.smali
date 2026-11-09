.class public Lcom/molehero/offline/MoleApp;
.super Landroid/app/Application;
.source "MoleApp.java"

# Installs a crash handler as early as possible so any Java crash is written to
# files/last_crash.txt and shown on the next start.

.method public constructor <init>()V
    .registers 1
    invoke-direct {p0}, Landroid/app/Application;-><init>()V
    return-void
.end method

.method public onCreate()V
    .registers 4
    invoke-super {p0}, Landroid/app/Application;->onCreate()V
    new-instance v0, Lcom/molehero/offline/CrashHandler;
    invoke-virtual {p0}, Landroid/app/Application;->getFilesDir()Ljava/io/File;
    move-result-object v1
    invoke-static {}, Ljava/lang/Thread;->getDefaultUncaughtExceptionHandler()Ljava/lang/Thread$UncaughtExceptionHandler;
    move-result-object v2
    invoke-direct {v0, v1, v2}, Lcom/molehero/offline/CrashHandler;-><init>(Ljava/io/File;Ljava/lang/Thread$UncaughtExceptionHandler;)V
    invoke-static {v0}, Ljava/lang/Thread;->setDefaultUncaughtExceptionHandler(Ljava/lang/Thread$UncaughtExceptionHandler;)V
    return-void
.end method
