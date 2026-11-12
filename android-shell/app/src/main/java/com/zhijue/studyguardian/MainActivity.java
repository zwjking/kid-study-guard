package com.zhijue.studyguardian;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoRuntimeSettings;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoView;

/**
 * 学习守护 · GeckoView 壳
 *
 * 为什么不用系统 WebView：
 *   台电 X98 Air II 是 Android 5.0 + 原厂 WebView 内核 Chromium 37，
 *   跑不了 async/await（需 55+）和 CSS 变量（需 49+），页面直接白屏。
 *   GeckoView 自带 Gecko 引擎（这里是 Firefox 100），跟系统内核无关。
 *   注意引擎版本锁在 100：GeckoView 从 101 起不再提供 x86 32 位原生库，
 *   而这台平板正是 x86（Baytrail）。
 *
 * 孩子端（flavor = child）：
 *   - 状态栏与导航栏照常显示（与原厂自带应用一致），内容不会被遮
 *   - 返回键不出 App，只在网页内后退
 *   - 连点左上角 7 次弹家长密码，输入正确才退出
 *
 * 家长端（flavor = parent）：
 *   - 同样显示系统栏，返回键走系统行为，可正常退出
 *
 * 页面统一加载线上地址，?role= 决定前端走孩子端还是家长端。
 * 不走本地 assets：云服务的登录校验要求 Origin 与发布域名一致。
 */
public class MainActivity extends Activity {

    /** 发布域名；平台要求带 sharecode 才能访问，缺了会返回「链接不完整」页 */
    private static final String BASE_URL =
            "https://YOUR_APP_HOST/?sharecode=YOUR_SHARECODE";

    /** 家长退出密码，与网页端默认密码一致 */
    private static final String EXIT_PIN = "123456";

    /** 连续点击次数与时间窗 */
    private static final int TAPS_TO_EXIT = 7;
    private static final long TAP_WINDOW_MS = 3000L;

    /** 引擎进程内只初始化一次，重复创建会白吃内存 */
    private static GeckoRuntime sRuntime;

    private GeckoView geckoView;
    private GeckoSession session;
    private TextView splash;
    private boolean canGoBack = false;
    private int taps = 0;
    private long lastTapAt = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#F4F6FA"));

        if (sRuntime == null) {
            GeckoRuntimeSettings settings = new GeckoRuntimeSettings.Builder()
                    .aboutConfigEnabled(false)
                    .build();
            sRuntime = GeckoRuntime.create(getApplicationContext(), settings);
        }

        session = new GeckoSession();
        session.open(sRuntime);

        geckoView = new GeckoView(this);
        geckoView.setSession(session);
        geckoView.setBackgroundColor(Color.parseColor("#F4F6FA"));

        root.addView(geckoView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        // 引擎首次启动要解压 50MB 的 libxul，给个遮罩免得看着像死机
        splash = new TextView(this);
        splash.setText("正在启动…");
        splash.setTextSize(18f);
        splash.setTextColor(Color.parseColor("#2A3566"));
        splash.setGravity(Gravity.CENTER);
        splash.setBackgroundColor(Color.parseColor("#F4F6FA"));
        root.addView(splash, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        // 孩子端：左上角一块无功能的透明热区，供家长退出
        if (BuildConfig.KIOSK) {
            View hotspot = new View(this);
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(64), dp(64));
            lp.gravity = Gravity.TOP | Gravity.START;
            hotspot.setLayoutParams(lp);
            hotspot.setOnClickListener(v -> onCornerTap());
            root.addView(hotspot);
        }

        // 平台访问码失效时会返回一张「链接不完整」页，别让孩子对着它发呆。
        // GeckoView 100 没有 evaluateJS，只能靠标题判断。
        session.setContentDelegate(new GeckoSession.ContentDelegate() {
            @Override
            public void onTitleChange(GeckoSession s, String title) {
                if (title != null && title.contains("链接不完整")) showLinkExpired();
            }

            @Override
            public void onCrash(GeckoSession s) {
                Toast.makeText(MainActivity.this, "页面崩了，正在重开", Toast.LENGTH_LONG).show();
                if (s != null) s.loadUri(BASE_URL + "&role=" + BuildConfig.APP_ROLE);
            }
        });

        session.setProgressDelegate(new GeckoSession.ProgressDelegate() {
            @Override
            public void onPageStop(GeckoSession s, boolean success) {
                if (success) hideSplash();
            }
        });

        // GeckoView 100 没有 session.canGoBack()，自己跟历史索引
        session.setHistoryDelegate(new GeckoSession.HistoryDelegate() {
            @Override
            public void onHistoryStateChange(GeckoSession s,
                                             GeckoSession.HistoryDelegate.HistoryList list) {
                canGoBack = list != null && list.size() > 1 && list.getCurrentIndex() > 0;
            }
        });

        setContentView(root);
        session.loadUri(BASE_URL + "&role=" + BuildConfig.APP_ROLE);
    }

    private void hideSplash() {
        if (splash != null && splash.getVisibility() == View.VISIBLE) {
            splash.setVisibility(View.GONE);
        }
    }

    /* ---------- 状态栏与导航栏：显示，不隐藏 ----------
     *
     * 2026-11-08 君哥定：这台平板的原厂自带应用都不隐藏系统栏，套壳也应该保持一致的观感。
     * 之前的做法（LAYOUT_FULLSCREEN + IMMERSIVE_STICKY + 按隐藏位加 padding）是在跟
     * 系统的沉浸模式搏斗：系统栏会掉、会回来、会压住标题和 Tab，三版才调平。
     *
     * 现在最省事的正解就是**不碰 systemUiVisibility**：
     * 系统栏照常显示，Window 的内容区本来就在状态栏下方、导航栏上方，
     * 不需要任何 padding，也不会遮挡 —— 这正是"原厂应用"的默认行为。
     *
     * 不要在这里加 SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN / HIDE_NAVIGATION，
     * 一加就得自己算 insets 补偿，又回到遮挡问题上。
     * 状态栏文字图标是白色的（Android 5.0 没有 LIGHT_STATUS_BAR），
     * 所以 statusBarColor 用深一些的品牌色，见 res/values/styles.xml。
     */

    /* ---------- 返回键 ---------- */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && BuildConfig.KIOSK) {
            if (session != null && canGoBack) {
                session.goBack();
            }
            return true;   // 吃掉事件，App 不退出
        }
        return super.onKeyDown(keyCode, event);
    }

    /* ---------- 家长退出 ---------- */
    private void onCornerTap() {
        long now = System.currentTimeMillis();
        if (now - lastTapAt > TAP_WINDOW_MS) taps = 0;
        lastTapAt = now;
        taps++;
        if (taps >= TAPS_TO_EXIT) {
            taps = 0;
            askExitPin();
        }
    }

    private void askExitPin() {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        input.setHint("家长密码");
        input.setGravity(Gravity.CENTER);

        new AlertDialog.Builder(this)
                .setTitle("退出学习守护")
                .setMessage("这一步是给家长用的。")
                .setView(input)
                .setPositiveButton("退出", (dialog, which) -> {
                    if (EXIT_PIN.equals(input.getText().toString().trim())) {
                        finish();
                    } else {
                        Toast.makeText(this, "密码不对", Toast.LENGTH_SHORT).show();
                    }
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private int dp(int v) {
        return Math.round(getResources().getDisplayMetrics().density * v);
    }

    /** 访问码失效的兜底提示 */
    private void showLinkExpired() {
        new AlertDialog.Builder(this)
                .setTitle("这个版本过期了")
                .setMessage("安装包里的访问码已失效，需要换一个最新的安装包。找家长要。")
                .setPositiveButton("知道了", null)
                .show();
    }

    @Override
    protected void onDestroy() {
        if (geckoView != null) {
            geckoView.releaseSession();
            geckoView = null;
        }
        if (session != null) {
            session.close();
            session = null;
        }
        splash = null;
        super.onDestroy();
    }
}
