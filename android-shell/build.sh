#!/usr/bin/env bash
# 学习守护 · APK 构建脚本
#
# 复用学习守护目录下的便携工具链（JDK 17 + Android SDK + Gradle 8.9），
# 不需要系统装 Android Studio，也不污染全局环境。
#
# 引擎说明（2026-11-08 起）：
#   台电 X98 Air II 是 Android 5.0 + 原厂 WebView 内核 Chromium 37，
#   跑不了页面用到的 async/await（需 55+）与 CSS 变量（需 49+），旧壳白屏。
#   现在改用 GeckoView 自带引擎，版本死锁在 100.0.20220425210429：
#     - 101 起 Mozilla 不再发布 x86 32 位原生库，而这台平板是 x86（Baytrail）
#     - 100 还没有 session.evaluateJS，页面里想求值只能走标题或原生回调
#   ABI 只打 x86，APK 约 65MB（引擎 libxul 占大头），首次启动要解压约 30 秒。
#
# 用法：
#   ./build.sh                      # 打两个 release 包（孩子端 + 家长端）
#   ./build.sh assembleChildRelease # 只打孩子端
#   ./build.sh assembleParentDebug  # 家长端 debug
#   ./build.sh clean                # 清理
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TC="$HERE/../toolchain"

# gradle.bat 是 Windows 批处理，JAVA_HOME / SDK / keystore 路径必须是 Windows 形式，
# 传 MSYS 风格（/d/...）会报 "JAVA_HOME is set to an invalid directory"，
# 或者把 keystore 拼成 app/d/workbuddy/... 找不到文件。
w() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

export JAVA_HOME="$(w "$TC/tools/jdk17")"
export ANDROID_SDK_ROOT="$(w "$TC/android-sdk")"
export ANDROID_HOME="$(w "$TC/android-sdk")"
export GRADLE_USER_HOME="$(w "$TC/gradle-home")"

# 签名参数（与 app/build.gradle 里的默认值一致，可用环境变量覆盖）
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

# 没有参数时，默认两个端都打 release
TASKS=("$@")
if [ ${#TASKS[@]} -eq 0 ]; then
  TASKS=(assembleChildRelease assembleParentRelease)
fi

cd "$HERE"
"$TC/tools/gradle-8.9-dist/bin/gradle.bat" "${TASKS[@]}" --no-daemon --console=plain

echo
echo "== 产物 =="
find "$HERE/app/build/outputs/apk" -name "*.apk" -newermt "-2 hours" 2>/dev/null | sort | while read -r f; do
  SZ=$(stat -c%s "$f" 2>/dev/null || echo 0)
  awk -v n="$SZ" -v p="${f#$HERE/}" 'BEGIN{printf "  %s  %.2f MB\n", p, n/1048576}'
done
