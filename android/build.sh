#!/usr/bin/env bash
# Compila el APK de R3 Puntos sin Gradle (herramientas: aapt, javac, dalvik-exchange, zipalign, apksigner).
# Uso: KEYSTORE=ruta.jks KS_PASS=clave ./build.sh   → genera build/R3-Puntos.apk
set -euo pipefail
cd "$(dirname "$0")"
SDK=${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
rm -rf build && mkdir -p build/gen build/obj
aapt package -f -m -J build/gen -M AndroidManifest.xml -S res -I "$SDK"
javac --release 8 -nowarn -encoding UTF-8 -classpath "$SDK" -d build/obj $(find src build/gen -name '*.java')
dalvik-exchange --dex --output=build/classes.dex build/obj
aapt package -f -M AndroidManifest.xml -S res -I "$SDK" -F build/unsigned.apk
(cd build && aapt add -f unsigned.apk classes.dex >/dev/null)
zipalign -f -p 4 build/unsigned.apk build/aligned.apk
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias r3puntos --out build/R3-Puntos.apk build/aligned.apk
apksigner verify --print-certs build/R3-Puntos.apk | head -3
echo "APK: $(pwd)/build/R3-Puntos.apk"
