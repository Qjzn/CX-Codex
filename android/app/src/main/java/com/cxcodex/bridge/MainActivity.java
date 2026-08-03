package com.cxcodex.bridge;

import android.app.DownloadManager;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.content.Context;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import com.getcapacitor.CapConfig;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    private static final long CONNECTION_TIMEOUT_MS = 15000L;
    private static volatile boolean appForeground;
    private boolean initialCreateComplete;
    private boolean mainFrameLoadFailed;
    private LinearLayout connectionOverlay;
    private ProgressBar connectionProgress;
    private TextView connectionTitle;
    private TextView connectionMessage;
    private LinearLayout connectionActions;
    private final Handler connectionHandler = new Handler(Looper.getMainLooper());
    private final Runnable connectionTimeout = () -> {
        if (connectionOverlay != null && connectionOverlay.getVisibility() == View.VISIBLE) {
            showConnectionError("连接时间较长，请检查服务电脑是否在线，以及外网地址是否仍然有效。");
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(MobileShellPlugin.class);
        config = buildConfig();
        super.onCreate(savedInstanceState);
        initialCreateComplete = true;
        MobilePushRegistration.refreshToken(this);
        captureTaskPetThreadFromIntent(getIntent());

        if (MobileShellConfig.getStoredServerUrl(this).isEmpty()) {
            showServerSetupScreen();
        } else {
            installConnectionUi();
            configureWebViewDownloadListener();
            openPendingTaskPetThread();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureTaskPetThreadFromIntent(intent);
        if (initialCreateComplete) openPendingTaskPetThread();
    }

    @Override
    public void onResume() {
        super.onResume();
        configureWebViewDownloadListener();
        MobileShellPlugin.retryPendingApkInstall(this);
        captureTaskPetThreadFromIntent(getIntent());
        openPendingTaskPetThread();
    }

    @Override
    public void onStart() {
        super.onStart();
        appForeground = true;
        TaskPetOverlayService.refreshPresentation(this);
    }

    @Override
    public void onStop() {
        if (!isChangingConfigurations()) {
            appForeground = false;
            TaskPetOverlayService.refreshPresentation(this);
        }
        super.onStop();
    }

    static boolean isAppForeground() {
        return appForeground;
    }

    private void captureTaskPetThreadFromIntent(Intent intent) {
        if (intent == null || !intent.hasExtra(TaskPetOverlayService.EXTRA_THREAD_ID)) {
            return;
        }
        String threadId = intent.getStringExtra(TaskPetOverlayService.EXTRA_THREAD_ID);
        if (threadId == null || threadId.trim().isEmpty()) {
            return;
        }
        boolean saved = MobileShellConfig.getPreferences(this).edit()
            .putString(MobileShellConfig.PREF_TASK_PET_PENDING_OPEN_THREAD_ID, threadId.trim())
            .commit();
        if (saved) intent.removeExtra(TaskPetOverlayService.EXTRA_THREAD_ID);
    }

    private void openPendingTaskPetThread() {
        if (!initialCreateComplete) return;
        String threadId = MobileShellConfig.getPreferences(this)
            .getString(MobileShellConfig.PREF_TASK_PET_PENDING_OPEN_THREAD_ID, "");
        threadId = threadId == null ? "" : threadId.trim();
        if (threadId.isEmpty()) return;
        String serverUrl = MobileShellConfig.getStoredServerUrl(this);
        if (serverUrl.isEmpty()) {
            return;
        }
        String targetUrl = MobileShellConfig.buildAppHashUrl(
            serverUrl,
            "/thread/" + Uri.encode(threadId)
        );
        if (bridge != null && bridge.getWebView() != null) {
            WebView webView = bridge.getWebView();
            if (!MobileShellConfig.shouldLoadPendingAppRoute(webView.getUrl(), targetUrl)) {
                return;
            }
            webView.post(() -> {
                if (MobileShellConfig.shouldLoadPendingAppRoute(webView.getUrl(), targetUrl)) {
                    webView.loadUrl(targetUrl);
                }
            });
        }
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

    private void installConnectionUi() {
        if (bridge == null || bridge.getWebView() == null || connectionOverlay != null) {
            return;
        }

        WebView webView = bridge.getWebView();
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                mainFrameLoadFailed = false;
                showConnectionLoading();
                super.onPageStarted(view, url, favicon);
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                super.onPageCommitVisible(view, url);
                if (!mainFrameLoadFailed) {
                    hideConnectionUi();
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!mainFrameLoadFailed && view.getProgress() == 100) {
                    hideConnectionUi();
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) {
                    mainFrameLoadFailed = true;
                    showConnectionError("无法连接到 CX-Codex。请确认服务电脑正在运行，并核对连接地址。");
                }
            }

            @Override
            public void onReceivedHttpError(
                WebView view,
                WebResourceRequest request,
                WebResourceResponse errorResponse
            ) {
                super.onReceivedHttpError(view, request, errorResponse);
                if (request.isForMainFrame() && errorResponse.getStatusCode() >= 400) {
                    mainFrameLoadFailed = true;
                    showConnectionError("服务返回异常，请稍后重试；如果外网地址已变化，请修改连接地址。");
                }
            }
        });

        ViewGroup parent = (ViewGroup) webView.getParent();
        if (parent == null) return;

        connectionOverlay = new LinearLayout(this);
        connectionOverlay.setOrientation(LinearLayout.VERTICAL);
        connectionOverlay.setGravity(Gravity.CENTER);
        connectionOverlay.setPadding(dp(28), dp(28), dp(28), dp(28));
        connectionOverlay.setBackgroundColor(0xFFF8F6F0);
        connectionOverlay.setClickable(true);
        connectionOverlay.setFocusable(true);

        connectionProgress = new ProgressBar(this);
        connectionOverlay.addView(connectionProgress, new LinearLayout.LayoutParams(dp(42), dp(42)));

        connectionTitle = new TextView(this);
        connectionTitle.setTextColor(0xFF2D261F);
        connectionTitle.setTextSize(22);
        connectionTitle.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        titleParams.setMargins(0, dp(20), 0, 0);
        connectionOverlay.addView(connectionTitle, titleParams);

        connectionMessage = new TextView(this);
        connectionMessage.setTextColor(0xFF7B7062);
        connectionMessage.setTextSize(14);
        connectionMessage.setGravity(Gravity.CENTER);
        connectionMessage.setLineSpacing(0, 1.25f);
        LinearLayout.LayoutParams messageParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        messageParams.setMargins(0, dp(10), 0, 0);
        connectionOverlay.addView(connectionMessage, messageParams);

        connectionActions = new LinearLayout(this);
        connectionActions.setOrientation(LinearLayout.HORIZONTAL);
        connectionActions.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams actionsParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        actionsParams.setMargins(0, dp(20), 0, 0);

        Button retryButton = new Button(this);
        retryButton.setText("重试");
        retryButton.setOnClickListener((view) -> {
            String serverUrl = MobileShellConfig.getStoredServerUrl(this);
            if (serverUrl.isEmpty()) {
                showServerSetupScreen();
                return;
            }
            mainFrameLoadFailed = false;
            showConnectionLoading();
            webView.loadUrl(MobileShellConfig.resolveAppRetryUrl(serverUrl, webView.getUrl()));
        });
        LinearLayout.LayoutParams actionButtonParams = new LinearLayout.LayoutParams(
            0,
            LinearLayout.LayoutParams.WRAP_CONTENT,
            1
        );
        actionButtonParams.setMargins(0, 0, dp(6), 0);
        connectionActions.addView(retryButton, actionButtonParams);

        Button changeAddressButton = new Button(this);
        changeAddressButton.setText("修改地址");
        changeAddressButton.setOnClickListener((view) -> showServerSetupScreen());
        LinearLayout.LayoutParams changeAddressParams = new LinearLayout.LayoutParams(
            0,
            LinearLayout.LayoutParams.WRAP_CONTENT,
            1
        );
        changeAddressParams.setMargins(dp(6), 0, 0, 0);
        connectionActions.addView(changeAddressButton, changeAddressParams);
        connectionOverlay.addView(connectionActions, actionsParams);

        parent.addView(connectionOverlay, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        connectionOverlay.bringToFront();
        showConnectionLoading();
    }

    private void showConnectionLoading() {
        if (connectionOverlay == null) return;
        connectionHandler.removeCallbacks(connectionTimeout);
        connectionOverlay.setVisibility(View.VISIBLE);
        connectionOverlay.bringToFront();
        connectionProgress.setVisibility(View.VISIBLE);
        connectionActions.setVisibility(View.GONE);
        connectionTitle.setText("正在连接 CX-Codex");
        connectionMessage.setText("正在打开已保存的服务地址，请稍候…");
        connectionHandler.postDelayed(connectionTimeout, CONNECTION_TIMEOUT_MS);
    }

    private void showConnectionError(String message) {
        if (connectionOverlay == null) return;
        connectionHandler.removeCallbacks(connectionTimeout);
        connectionOverlay.setVisibility(View.VISIBLE);
        connectionOverlay.bringToFront();
        connectionProgress.setVisibility(View.GONE);
        connectionActions.setVisibility(View.VISIBLE);
        connectionTitle.setText("暂时无法连接");
        connectionMessage.setText(message);
    }

    private void hideConnectionUi() {
        connectionHandler.removeCallbacks(connectionTimeout);
        if (connectionOverlay != null) {
            connectionOverlay.setVisibility(View.GONE);
        }
    }

    private void showServerSetupScreen() {
        getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        connectionHandler.removeCallbacks(connectionTimeout);
        String storedServerUrl = MobileShellConfig.getStoredServerUrl(this);

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
        title.setText(storedServerUrl.isEmpty() ? "输入连接地址" : "修改连接地址");
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
        serverInput.setText(storedServerUrl);
        serverInput.setSelection(serverInput.getText().length());

        Button submitButton = new Button(this);
        submitButton.setText("保存并进入");
        submitButton.setEnabled(MobileShellConfig.isValidServerUrl(storedServerUrl));

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
        if (storedServerUrl.isEmpty()) {
            serverInput.postDelayed(() -> {
                InputMethodManager inputMethodManager = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                if (inputMethodManager != null) {
                    inputMethodManager.showSoftInput(serverInput, InputMethodManager.SHOW_IMPLICIT);
                }
            }, 250);
        }
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
