package com.cxcodex.bridge;

import android.app.DownloadManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.text.Editable;
import android.text.TextWatcher;
import android.text.InputType;
import android.view.Gravity;
import android.view.inputmethod.InputMethodManager;
import android.content.Context;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import com.getcapacitor.CapConfig;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(MobileShellPlugin.class);
        config = buildConfig();
        super.onCreate(savedInstanceState);

        if (MobileShellConfig.getStoredServerUrl(this).isEmpty()) {
            showServerSetupScreen();
        } else {
            configureWebViewDownloadListener();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        configureWebViewDownloadListener();
        MobileShellPlugin.retryPendingApkInstall(this);
    }

    private void configureWebViewDownloadListener() {
        if (MobileShellConfig.getStoredServerUrl(this).isEmpty()) {
            return;
        }
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setDownloadListener(this::onWebViewDownloadRequested);
        }
    }

    private void onWebViewDownloadRequested(
        String url,
        String userAgent,
        String contentDisposition,
        String mimetype,
        long contentLength
    ) {
        new Thread(() -> {
            MobileShellPlugin.ensureWebAuthCookie(this, url);
            enqueueWebViewDownload(url, userAgent, contentDisposition, mimetype);
        }).start();
    }

    private void enqueueWebViewDownload(
        String url,
        String userAgent,
        String contentDisposition,
        String mimetype
    ) {
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            String resolvedMimeType = mimetype == null || mimetype.trim().isEmpty()
                ? "application/octet-stream"
                : mimetype.trim();
            String fileName = URLUtil.guessFileName(url, contentDisposition, resolvedMimeType);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null && !cookies.isEmpty()) {
                request.addRequestHeader("Cookie", cookies);
            }
            if (userAgent != null && !userAgent.isEmpty()) {
                request.addRequestHeader("User-Agent", userAgent);
            }
            request.setTitle(fileName);
            request.setDescription("正在下载文件");
            request.setMimeType(resolvedMimeType);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(true);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) {
                showToastOnUiThread("系统下载服务不可用", Toast.LENGTH_SHORT);
                return;
            }
            manager.enqueue(request);
            showToastOnUiThread("已开始下载：" + fileName, Toast.LENGTH_SHORT);
        } catch (Exception exception) {
            showToastOnUiThread("下载失败：" + exception.getMessage(), Toast.LENGTH_LONG);
        }
    }

    private void showToastOnUiThread(String message, int duration) {
        runOnUiThread(() -> Toast.makeText(this, message, duration).show());
    }

    private void showServerSetupScreen() {
        getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        int outerPadding = dp(24);
        int itemGap = dp(12);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(outerPadding, outerPadding, outerPadding, outerPadding);
        root.setBackgroundColor(0xFFF8F6F0);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(20), dp(20), dp(20), dp(20));
        card.setBackgroundColor(0xFFFFFDF8);

        TextView title = new TextView(this);
        title.setText("输入连接地址");
        title.setTextColor(0xFF2D261F);
        title.setTextSize(24);
        title.setGravity(Gravity.START);

        TextView subtitle = new TextView(this);
        subtitle.setText("地址会永久保存到本机 App，后续启动会自动进入。");
        subtitle.setTextColor(0xFF7B7062);
        subtitle.setTextSize(13);

        EditText serverInput = new EditText(this);
        serverInput.setSingleLine(true);
        serverInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        serverInput.setHint("https://your-codex-host.example.com");
        serverInput.setTextColor(0xFF2D261F);
        serverInput.setHintTextColor(0xFF9F9484);
        serverInput.setSelectAllOnFocus(false);

        Button submitButton = new Button(this);
        submitButton.setText("保存并进入");
        submitButton.setEnabled(false);

        TextView status = new TextView(this);
        status.setText("");
        status.setTextColor(0xFF7B7062);
        status.setTextSize(12);

        LinearLayout.LayoutParams fullWidth = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        LinearLayout.LayoutParams spaced = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        spaced.setMargins(0, itemGap, 0, 0);

        card.addView(title, fullWidth);
        card.addView(subtitle, spaced);
        card.addView(serverInput, spaced);
        card.addView(submitButton, spaced);
        card.addView(status, spaced);

        root.addView(card, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ));

        setContentView(root);

        serverInput.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                submitButton.setEnabled(MobileShellConfig.isValidServerUrl(s == null ? "" : s.toString()));
                status.setText("");
            }

            @Override
            public void afterTextChanged(Editable s) {}
        });

        submitButton.setOnClickListener((view) -> {
            String serverUrl = MobileShellConfig.normalizeServerUrl(serverInput.getText().toString());
            if (!MobileShellConfig.isValidServerUrl(serverUrl)) {
                status.setText("服务地址格式无效，请使用完整的 http(s)://host 地址");
                return;
            }

            boolean saved = MobileShellConfig.getPreferences(this)
                .edit()
                .putString(MobileShellConfig.PREF_SERVER_URL, serverUrl)
                .commit();
            if (!saved) {
                status.setText("保存失败，请重试");
                return;
            }

            restartActivity();
        });

        serverInput.requestFocus();
        serverInput.postDelayed(() -> {
            InputMethodManager inputMethodManager = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (inputMethodManager != null) {
                inputMethodManager.showSoftInput(serverInput, InputMethodManager.SHOW_IMPLICIT);
            }
        }, 250);
    }

    private void restartActivity() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(intent);
        finish();
        overridePendingTransition(0, 0);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private CapConfig buildConfig() {
        CapConfig defaultConfig = CapConfig.loadDefault(this);
        String serverUrl = MobileShellConfig.resolveServerUrl(this, defaultConfig.getServerUrl());
        boolean allowMixedContent = defaultConfig.isMixedContentAllowed() || serverUrl.startsWith("http://");

        CapConfig.Builder builder = new CapConfig.Builder(this)
            .setHTML5mode(defaultConfig.isHTML5Mode())
            .setErrorPath(defaultConfig.getErrorPath())
            .setHostname(defaultConfig.getHostname())
            .setStartPath(defaultConfig.getStartPath())
            .setAndroidScheme(defaultConfig.getAndroidScheme())
            .setAllowNavigation(defaultConfig.getAllowNavigation())
            .setOverriddenUserAgentString(defaultConfig.getOverriddenUserAgentString())
            .setAppendedUserAgentString(defaultConfig.getAppendedUserAgentString())
            .setBackgroundColor(defaultConfig.getBackgroundColor())
            .setAllowMixedContent(allowMixedContent)
            .setCaptureInput(defaultConfig.isInputCaptured())
            .setUseLegacyBridge(defaultConfig.isUsingLegacyBridge())
            .setResolveServiceWorkerRequests(defaultConfig.isResolveServiceWorkerRequests())
            .setWebContentsDebuggingEnabled(defaultConfig.isWebContentsDebuggingEnabled())
            .setZoomableWebView(defaultConfig.isZoomableWebView())
            .setLoggingEnabled(defaultConfig.isLoggingEnabled())
            .setInitialFocus(defaultConfig.isInitialFocus());

        if (!serverUrl.isEmpty()) {
            builder.setServerUrl(serverUrl);
        }

        return builder.create();
    }
}
