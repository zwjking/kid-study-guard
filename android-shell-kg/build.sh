#!/usr/bin/env bash
# 知识图谱 · APK 构建脚本
#
# 复用 study-guardian 目录下的便携工具链（JDK 17 + Android SDK + Gradle 8.9），
# 不需要系统装 Android Studio，也不污染全局环境。
#
# 引擎说明（与「学习守护」壳同一套结论，详见
# D:/资料归档/06个人经验沉淀与规范/智能设备运维/06_老设备套壳APK手册_GeckoView.md）：
#   台电 X98 Air II 是 Android 5.0 + 原厂 WebView 内核 Chromium 37，跑不了现代前端。
#   GeckoView 版本死锁在 100.0.20220425210429：101 起 Mozilla 不再发布 x86 32 位原生库。
#   ABI 只打 x86，APK 约 65MB（引擎 libxul 占大头），首次启动要解压。
#
# 用法：
#   ./build.sh                      # 打 release 包（单 App，无 flavor）
#   ./build.sh assembleRelease      # 同上
#   ./build.sh assembleDebug        # debug 包
#   ./build.sh clean                # 清理
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TC="$HERE/../toolchain"

# gradle.bat 是 Windows 批处理，JAVA_HOME / SDK 路径必须是 Windows 形式（D:\...），
# 传 MSYS 风格（/d/...）会报 "JAVA_HOME is set to an invalid directory"。
w() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

export JAVA_HOME="$(w "$TC/tools/jdk17")"
export ANDROID_SDK_ROOT="$(w "$TC/android-sdk")"
export ANDROID_HOME="$(w "$TC/android-sdk")"
export GRADLE_USER_HOME="$(w "$TC/gradle-home")"

# 签名参数（与 app/build.gradle 里的默认值一致，可用环境变量覆盖）
# 路径必须是 Windows 形式，否则 Gradle 的 file() 会拼成 app/d/workbuddy/...
export SG_KEYSTORE="$(w "$HERE/studyguardian.jks")"
export SG_STORE_PASS="${SG_STORE_PASS:-study123456}"
export SG_KEY_ALIAS="${SG_KEY_ALIAS:-studyguardian}"
export SG_KEY_PASS="${SG_KEY_PASS:-study123456}"

# 沙箱出网走本地代理，端口每轮会变，从环境变量取，不要写死
PROXY="${HTTPS_PROXY:-${https_proxy:-}}"
if [ -n "$PROXY" ]; then
  HOSTPORT="${PROXY#*://}"
  HOSTPORT="${HOSTPORT%%/*}"
  PHOST="${HOSTPORT%%:*}"
  PPORT="${HOSTPORT##*:}"
  export GRADLE_OPTS="-Dhttp.proxyHost=$PHOST -Dhttp.proxyPort=$PPORT -Dhttps.proxyHost=$PHOST -Dhttps.proxyPort=$PPORT"
  echo "== gradle 代理: $PHOST:$PPORT"
else
  echo "== 无代理，直连"
fi

# 没有参数时默认打 release
TASKS=("$@")
if [ ${#TASKS[@]} -eq 0 ]; then
  TASKS=(assembleRelease)
fi

cd "$HERE"
"$TC/tools/gradle-8.9-dist/bin/gradle.bat" "${TASKS[@]}" --no-daemon --console=plain

echo
echo "== 产物 =="
find "$HERE/app/build/outputs/apk" -name "*.apk" -newermt "-2 hours" 2>/dev/null | sort | while read -r f; do
  SZ=$(stat -c%s "$f" 2>/dev/null || echo 0)
  awk -v n="$SZ" -v p="${f#$HERE/}" 'BEGIN{printf "  %s  %.2f MB\n", p, n/1048576}'
done
