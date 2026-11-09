#!/bin/bash
# Build the Mole Hero offline APK.
#
# Inputs (paths can be overridden with env vars):
#   ORIG_APK    original HARMAN AIR APK (only resources.arsc + res/ icon/theme are reused)
#   CLIENT_DIR  RecTaoMee_Hero/Client (game resources: SWF, configs, maps ...)
# Tools fetched from package registries: Ruffle (npm), smali + apksig (Maven Central).
# Output: out/mole-offline-<version>.apk (signed with the debug key in android/keystore)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${WORK:-$HERE/.build}
ORIG_APK=${ORIG_APK:?set ORIG_APK to the original base.apk}
CLIENT_DIR=${CLIENT_DIR:-$WORK/RecTaoMee_Hero/Client}
VERSION_CODE=${VERSION_CODE:-1}
VERSION_NAME=${VERSION_NAME:-0.1.0-offline}
RUFFLE_VERSION=${RUFFLE_VERSION:-0.8.0-nightly.2026.10.20}
mkdir -p "$WORK" "$HERE/out"

# 1. game resources
if [ ! -d "$CLIENT_DIR" ]; then
  GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/RecTaoMee/RecTaoMee_Hero "$WORK/RecTaoMee_Hero"
fi

# 2. Ruffle (web build) -> web/ruffle
if [ ! -f "$WORK/ruffle/node_modules/@ruffle-rs/ruffle/ruffle.js" ]; then
  mkdir -p "$WORK/ruffle" && (cd "$WORK/ruffle" && npm init -y >/dev/null && npm install --ignore-scripts "@ruffle-rs/ruffle@$RUFFLE_VERSION")
fi
ln -sfn "$WORK/ruffle/node_modules/@ruffle-rs/ruffle" "$HERE/web/ruffle"

# 3. Java tools (smali, apksig)
if [ ! -f "$WORK/mvn/lib/smali-2.5.2.jar" ]; then
  mkdir -p "$WORK/mvn" && cat > "$WORK/mvn/pom.xml" <<'EOF'
<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>
<groupId>x</groupId><artifactId>tools</artifactId><version>1</version><dependencies>
<dependency><groupId>org.smali</groupId><artifactId>smali</artifactId><version>2.5.2</version></dependency>
<dependency><groupId>com.android.tools.build</groupId><artifactId>apksig</artifactId><version>2.3.0</version></dependency>
</dependencies></project>
EOF
  (cd "$WORK/mvn" && mvn -q dependency:copy-dependencies -DoutputDirectory=lib)
fi
LIB=$WORK/mvn/lib
JAVA_EXPORTS="--add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED --add-exports java.base/sun.security.util=ALL-UNNAMED"

# 4. dex, manifest
java -cp "$LIB/*" org.jf.smali.Main assemble --api 24 -o "$WORK/classes.dex" "$HERE/android/smali"
python3 -I "$HERE/android/tools/make_manifest.py" "$WORK/AndroidManifest.xml" "$VERSION_CODE" "$VERSION_NAME" >/dev/null

# 5. pack, sign, verify
python3 -I "$HERE/android/tools/build_apk.py" "$WORK/unsigned.apk" "$WORK/classes.dex" "$WORK/AndroidManifest.xml" "$ORIG_APK" "$HERE/web" "$CLIENT_DIR"
mkdir -p "$WORK/signer"
javac -cp "$LIB/apksig-2.3.0.jar" -d "$WORK/signer" "$HERE/android/tools/Sign.java" "$HERE/android/tools/Verify.java"
OUT="$HERE/out/mole-offline-$VERSION_NAME.apk"
java $JAVA_EXPORTS -cp "$WORK/signer:$LIB/apksig-2.3.0.jar" Sign "$WORK/unsigned.apk" "$OUT" "$HERE/android/keystore/debug-offline.p12" moleoffline mole
java $JAVA_EXPORTS -cp "$WORK/signer:$LIB/apksig-2.3.0.jar" Verify "$OUT"
ls -la "$OUT"
