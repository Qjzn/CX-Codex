package com.cxcodex.bridge;

import android.animation.ValueAnimator;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.ImageDecoder;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.AnimatedImageDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.Interpolator;
import android.view.animation.PathInterpolator;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

public final class TaskPetOverlayService extends Service {

    public static final String EXTRA_THREAD_ID = "cx_task_pet_thread_id";

    private static final String ACTION_UPDATE = "com.cxcodex.bridge.taskpet.UPDATE";
    private static final String ACTION_MARK_THREAD_READ = "com.cxcodex.bridge.taskpet.MARK_THREAD_READ";
    private static final String EXTRA_SERVER_URL = "serverUrl";
    private static final String EXTRA_TASKS_JSON = "tasksJson";
    private static final String EXTRA_RECENT_THREADS_JSON = "recentThreadsJson";
    private static final String CHANNEL_ID = "cx_codex_task_pet";
    private static final String CHANNEL_NAME = "CX-Codex 任务宠物";
    private static final int FOREGROUND_NOTIFICATION_ID = 7421;
    private static final long ACTIVE_POLL_INTERVAL_MS = 3_000L;
    private static final long RETRY_POLL_INTERVAL_MS = 7_500L;
    private static final int ROOT_PADDING_DP = 6;
    private static final int PANEL_WIDTH_DP = 282;
    private static final int PANEL_CONTENT_WIDTH_DP = 258;
    private static final int MASCOT_WIDTH_DP = 72;
    private static final int MASCOT_HEIGHT_DP = 79;
    private static final int MINI_SIZE_DP = 48;
    private static final int TASK_ROW_HEIGHT_DP = 88;
    private static final AtomicBoolean RUNNING = new AtomicBoolean(false);
    private static final Interpolator EASE_OUT = new PathInterpolator(0.22f, 1f, 0.36f, 1f);

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final List<TaskItem> tasks = new ArrayList<>();
    private final List<RecentThreadItem> recentThreads = new ArrayList<>();
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private WindowManager windowManager;
    private WindowManager.LayoutParams windowParams;
    private LinearLayout overlayRoot;
    private LinearLayout taskPanel;
    private LinearLayout platformActions;
    private LinearLayout taskList;
    private LinearLayout recentSection;
    private LinearLayout recentList;
    private LinearLayout replyComposer;
    private LinearLayout closeConfirmPanel;
    private FrameLayout mascot;
    private FrameLayout miniMascot;
    private ImageView petImage;
    private ImageView miniPetImage;
    private TextView badge;
    private TextView miniBadge;
    private TextView petStatus;
    private TextView panelSummary;
    private TextView replyTitle;
    private EditText replyInput;
    private TextView replyStatus;
    private TextView replySendButton;
    private boolean expanded;
    private boolean minimized;
    private boolean anchoredRight;
    private boolean dragFramePending;
    private boolean pollInFlight;
    private boolean destroyed;
    private boolean sendingReply;
    private boolean closeConfirmationVisible;
    private int panelAnimationToken;
    private int pendingCollapsedPetX = -1;
    private int pendingCollapsedPetY = -1;
    private int lastForegroundActiveCount = -1;
    private String lastPetMode = "";
    private String lastRenderedTaskSignature = "";
    private String replyThreadId = "";
    private String replyThreadTitle = "";
    private String replyAttemptClientMessageId = "";
    private String replyAttemptThreadId = "";
    private String replyAttemptMessage = "";
    private String serverUrl = "";
    private int consecutivePollFailures;
    private ValueAnimator positionAnimator;

    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            pollRunningTasks();
        }
    };

    public static boolean isRunning() {
        return RUNNING.get();
    }

    public static void startOrUpdate(
        Context context,
        @Nullable String serverUrl,
        @Nullable String tasksJson,
        @Nullable String recentThreadsJson
    ) {
        Intent intent = new Intent(context, TaskPetOverlayService.class).setAction(ACTION_UPDATE);
        if (serverUrl != null) intent.putExtra(EXTRA_SERVER_URL, serverUrl);
        if (tasksJson != null) intent.putExtra(EXTRA_TASKS_JSON, tasksJson);
        if (recentThreadsJson != null) intent.putExtra(EXTRA_RECENT_THREADS_JSON, recentThreadsJson);
        if (isRunning()) {
            context.startService(intent);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(context, intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, TaskPetOverlayService.class));
    }

    public static void markThreadRead(Context context, String threadId) {
        String normalizedThreadId = threadId == null ? "" : threadId.trim();
        if (!isRunning() || normalizedThreadId.isEmpty()) return;
        Intent intent = new Intent(context, TaskPetOverlayService.class)
            .setAction(ACTION_MARK_THREAD_READ)
            .putExtra(EXTRA_THREAD_ID, normalizedThreadId);
        context.startService(intent);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        destroyed = false;
        RUNNING.set(true);
        restoreReplyAttempt();
        ensureNotificationChannel();
        startForeground(FOREGROUND_NOTIFICATION_ID, buildForegroundNotification(0));
        if (!android.provider.Settings.canDrawOverlays(this)) {
            stopSelf();
            return;
        }
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        createOverlay();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!android.provider.Settings.canDrawOverlays(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        String incomingServerUrl = intent == null ? null : intent.getStringExtra(EXTRA_SERVER_URL);
        String incomingTasksJson = intent == null ? null : intent.getStringExtra(EXTRA_TASKS_JSON);
        String incomingRecentThreadsJson = intent == null ? null : intent.getStringExtra(EXTRA_RECENT_THREADS_JSON);
        if (incomingServerUrl != null) {
            serverUrl = MobileShellConfig.normalizeServerUrl(incomingServerUrl);
        } else {
            serverUrl = MobileShellConfig.getPreferences(this)
                .getString(MobileShellConfig.PREF_TASK_PET_SERVER_URL, "");
        }
        if (tasks.isEmpty()) {
            String persistedTasksJson = MobileShellConfig.getPreferences(this)
                .getString(MobileShellConfig.PREF_TASK_PET_TASKS_JSON, "[]");
            replaceTasks(persistedTasksJson == null ? "[]" : persistedTasksJson);
        }
        if (incomingTasksJson != null) {
            replaceTasks(incomingTasksJson);
        } else {
            String latestActiveTasksJson = MobileShellConfig.getPreferences(this)
                .getString(MobileShellConfig.PREF_TASK_PET_ACTIVE_TASKS_JSON, "[]");
            replaceTasks(latestActiveTasksJson == null ? "[]" : latestActiveTasksJson);
        }
        if (incomingRecentThreadsJson != null) {
            replaceRecentThreads(incomingRecentThreadsJson);
        } else {
            String persistedRecentThreadsJson = MobileShellConfig.getPreferences(this)
                .getString(MobileShellConfig.PREF_TASK_PET_RECENT_THREADS_JSON, "[]");
            replaceRecentThreads(persistedRecentThreadsJson == null ? "[]" : persistedRecentThreadsJson);
        }
        if (intent != null && ACTION_MARK_THREAD_READ.equals(intent.getAction())) {
            clearCompletedThread(intent.getStringExtra(EXTRA_THREAD_ID));
        }
        renderTasks();
        schedulePoll(0L);
        return START_STICKY;
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        mainHandler.post(() -> {
            if (!RUNNING.get() || overlayRoot == null || windowManager == null) return;
            collapsePanelImmediately();
            snapPetToNearestEdge();
        });
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        mainHandler.removeCallbacks(pollRunnable);
        if (positionAnimator != null) positionAnimator.cancel();
        if (mascot != null) mascot.animate().cancel();
        if (miniMascot != null) miniMascot.animate().cancel();
        stopPetAnimation(petImage);
        stopPetAnimation(miniPetImage);
        if (taskPanel != null) taskPanel.animate().cancel();
        if (windowManager != null && overlayRoot != null) {
            try {
                windowManager.removeView(overlayRoot);
            } catch (Exception ignored) {
                // The system may already have detached the overlay.
            }
        }
        networkExecutor.shutdownNow();
        RUNNING.set(false);
        super.onDestroy();
    }

    private void createOverlay() {
        overlayRoot = new LinearLayout(this);
        overlayRoot.setOrientation(LinearLayout.VERTICAL);
        overlayRoot.setGravity(Gravity.START);
        overlayRoot.setPadding(dp(ROOT_PADDING_DP), dp(ROOT_PADDING_DP), dp(ROOT_PADDING_DP), dp(ROOT_PADDING_DP));

        taskPanel = new LinearLayout(this);
        taskPanel.setOrientation(LinearLayout.VERTICAL);
        taskPanel.setPadding(dp(12), dp(10), dp(12), dp(12));
        taskPanel.setBackground(rounded(Color.rgb(253, 253, 254), 16));
        taskPanel.setElevation(dp(8));
        taskPanel.setVisibility(View.GONE);

        LinearLayout panelHeader = new LinearLayout(this);
        panelHeader.setOrientation(LinearLayout.HORIZONTAL);
        panelHeader.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout panelHeading = new LinearLayout(this);
        panelHeading.setOrientation(LinearLayout.VERTICAL);
        panelHeading.setGravity(Gravity.CENTER_VERTICAL);
        TextView panelTitle = text("任务进展", 15, Color.rgb(28, 34, 46), Typeface.BOLD);
        panelSummary = text("实时同步", 10, Color.rgb(82, 100, 127), Typeface.NORMAL);
        panelHeading.addView(panelTitle, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(19)));
        panelHeading.addView(panelSummary, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(14)));
        panelHeader.addView(panelHeading, new LinearLayout.LayoutParams(0, dp(48), 1f));
        platformActions = buildPlatformActions();
        panelHeader.addView(platformActions, new LinearLayout.LayoutParams(dp(100), dp(48)));

        taskList = new LinearLayout(this);
        taskList.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams listParams = new LinearLayout.LayoutParams(dp(PANEL_CONTENT_WIDTH_DP), LinearLayout.LayoutParams.WRAP_CONTENT);
        listParams.topMargin = dp(6);
        taskPanel.addView(panelHeader, new LinearLayout.LayoutParams(dp(PANEL_CONTENT_WIDTH_DP), dp(48)));
        taskPanel.addView(taskList, listParams);
        recentSection = buildRecentSection();
        LinearLayout.LayoutParams recentParams = new LinearLayout.LayoutParams(
            dp(PANEL_CONTENT_WIDTH_DP),
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        recentParams.topMargin = dp(8);
        taskPanel.addView(recentSection, recentParams);
        replyComposer = buildReplyComposer();
        LinearLayout.LayoutParams composerParams = new LinearLayout.LayoutParams(
            dp(PANEL_CONTENT_WIDTH_DP),
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        composerParams.topMargin = dp(8);
        taskPanel.addView(replyComposer, composerParams);
        closeConfirmPanel = buildCloseConfirmPanel();
        LinearLayout.LayoutParams closeConfirmParams = new LinearLayout.LayoutParams(
            dp(PANEL_CONTENT_WIDTH_DP),
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        closeConfirmParams.topMargin = dp(8);
        taskPanel.addView(closeConfirmPanel, closeConfirmParams);
        overlayRoot.addView(taskPanel, new LinearLayout.LayoutParams(dp(PANEL_WIDTH_DP), LinearLayout.LayoutParams.WRAP_CONTENT));

        mascot = buildMascot();
        LinearLayout.LayoutParams mascotParams = new LinearLayout.LayoutParams(dp(MASCOT_WIDTH_DP), dp(MASCOT_HEIGHT_DP));
        mascotParams.topMargin = dp(2);
        overlayRoot.addView(mascot, mascotParams);
        attachDragAndClick(mascot, () -> setExpanded(!expanded));

        miniMascot = buildMiniMascot();
        LinearLayout.LayoutParams miniParams = new LinearLayout.LayoutParams(dp(MINI_SIZE_DP), dp(MINI_SIZE_DP));
        miniParams.topMargin = dp(2);
        overlayRoot.addView(miniMascot, miniParams);
        attachDragAndClick(miniMascot, () -> {
            setMinimized(false);
            if (tasks.isEmpty()) setExpanded(true);
        });

        minimized = true;
        mascot.setVisibility(minimized ? View.GONE : View.VISIBLE);
        miniMascot.setVisibility(minimized ? View.VISIBLE : View.GONE);

        int initialX = MobileShellConfig.getPreferences(this).getInt(MobileShellConfig.PREF_TASK_PET_X, dp(18));
        int initialY = MobileShellConfig.getPreferences(this).getInt(MobileShellConfig.PREF_TASK_PET_Y, dp(180));
        anchoredRight = initialX + dp(minimized ? MINI_SIZE_DP / 2 : MASCOT_WIDTH_DP / 2)
            >= getResources().getDisplayMetrics().widthPixels / 2;
        updateMascotGravity();
        windowParams = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        );
        windowParams.gravity = Gravity.TOP | Gravity.START;
        windowParams.x = initialX;
        windowParams.y = initialY;
        windowManager.addView(overlayRoot, windowParams);
    }

    private LinearLayout buildPlatformActions() {
        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);

        ImageView enter = new ImageView(this);
        enter.setImageResource(R.mipmap.ic_launcher_foreground);
        enter.setScaleType(ImageView.ScaleType.FIT_CENTER);
        enter.setPadding(dp(9), dp(9), dp(9), dp(9));
        enter.setBackground(touchBackground(Color.rgb(236, 243, 255), 999, Color.argb(30, 42, 114, 232)));
        enter.setClickable(true);
        enter.setFocusable(true);
        enter.setContentDescription("进入 CX-Codex 平台");
        enter.setOnClickListener(view -> {
            view.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP);
            openPlatform();
        });
        actions.addView(enter, new LinearLayout.LayoutParams(dp(48), dp(48)));

        TextView close = text("×", 24, Color.rgb(111, 119, 133), Typeface.NORMAL);
        close.setGravity(Gravity.CENTER);
        close.setClickable(true);
        close.setFocusable(true);
        close.setBackground(touchBackground(Color.rgb(247, 248, 251), 999, Color.argb(28, 159, 62, 57)));
        close.setContentDescription("关闭任务宠物浮窗");
        close.setOnClickListener(view -> {
            view.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP);
            showCloseConfirmation();
        });
        LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(dp(48), dp(48));
        closeParams.leftMargin = dp(4);
        actions.addView(close, closeParams);
        return actions;
    }

    private TextView panelAction(String label, int textColor, int backgroundColor) {
        TextView action = text(label, 12, textColor, Typeface.BOLD);
        action.setGravity(Gravity.CENTER);
        action.setClickable(true);
        action.setFocusable(true);
        action.setBackground(touchBackground(backgroundColor, 12, Color.argb(30, 42, 114, 232)));
        return action;
    }

    private LinearLayout buildRecentSection() {
        LinearLayout section = new LinearLayout(this);
        section.setOrientation(LinearLayout.VERTICAL);
        TextView heading = text("最近会话", 11, Color.rgb(82, 100, 127), Typeface.BOLD);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        section.addView(heading, new LinearLayout.LayoutParams(dp(PANEL_CONTENT_WIDTH_DP), dp(24)));
        recentList = new LinearLayout(this);
        recentList.setOrientation(LinearLayout.VERTICAL);
        section.addView(recentList, new LinearLayout.LayoutParams(
            dp(PANEL_CONTENT_WIDTH_DP),
            LinearLayout.LayoutParams.WRAP_CONTENT
        ));
        section.setVisibility(View.GONE);
        return section;
    }

    private LinearLayout buildCloseConfirmPanel() {
        LinearLayout confirm = new LinearLayout(this);
        confirm.setOrientation(LinearLayout.VERTICAL);
        confirm.setPadding(dp(12), dp(11), dp(12), dp(10));
        confirm.setBackground(rounded(Color.rgb(253, 240, 239), 12));
        confirm.setVisibility(View.GONE);

        TextView title = text("关闭任务宠物浮窗？", 13, Color.rgb(98, 42, 39), Typeface.BOLD);
        confirm.addView(title, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(24)));
        TextView detail = text("关闭后不再显示，但可随时在设置中重新开启。", 11, Color.rgb(126, 74, 70), Typeface.NORMAL);
        detail.setGravity(Gravity.CENTER_VERTICAL);
        confirm.addView(detail, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42)));

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        TextView cancel = panelAction("取消", Color.rgb(74, 88, 109), Color.WHITE);
        cancel.setOnClickListener(view -> hideCloseConfirmation());
        actions.addView(cancel, new LinearLayout.LayoutParams(0, dp(48), 1f));
        TextView close = panelAction("确认关闭", Color.WHITE, Color.rgb(179, 72, 66));
        close.setOnClickListener(view -> closeTaskPet());
        LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(0, dp(48), 1f);
        closeParams.leftMargin = dp(6);
        actions.addView(close, closeParams);
        confirm.addView(actions, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)));
        return confirm;
    }

    private LinearLayout buildReplyComposer() {
        LinearLayout composer = new LinearLayout(this);
        composer.setOrientation(LinearLayout.VERTICAL);
        composer.setPadding(dp(10), dp(9), dp(10), dp(9));
        composer.setBackground(rounded(Color.rgb(242, 245, 249), 12));
        composer.setVisibility(View.GONE);

        replyTitle = text("回复任务", 12, Color.rgb(30, 36, 48), Typeface.BOLD);
        replyTitle.setSingleLine(true);
        replyTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
        composer.addView(replyTitle, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(22)));

        replyInput = new EditText(this);
        replyInput.setTextSize(13);
        replyInput.setTextColor(Color.rgb(30, 36, 48));
        replyInput.setHintTextColor(Color.rgb(126, 137, 154));
        replyInput.setHint("输入回复内容…");
        replyInput.setGravity(Gravity.TOP | Gravity.START);
        replyInput.setPadding(dp(9), dp(7), dp(9), dp(7));
        replyInput.setSingleLine(false);
        replyInput.setMaxLines(4);
        replyInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        replyInput.setBackground(rounded(Color.WHITE, 9));
        composer.addView(replyInput, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(66)));

        LinearLayout footer = new LinearLayout(this);
        footer.setOrientation(LinearLayout.HORIZONTAL);
        footer.setGravity(Gravity.CENTER_VERTICAL | Gravity.END);
        replyStatus = text("", 10, Color.rgb(183, 72, 66), Typeface.NORMAL);
        TextView cancel = text("取消", 11, Color.rgb(74, 88, 109), Typeface.BOLD);
        cancel.setGravity(Gravity.CENTER);
        cancel.setClickable(true);
        cancel.setFocusable(true);
        cancel.setBackground(touchBackground(Color.TRANSPARENT, 999, Color.argb(24, 42, 114, 232)));
        cancel.setOnClickListener(view -> hideReplyComposer());
        replySendButton = text("发送", 11, Color.WHITE, Typeface.BOLD);
        replySendButton.setGravity(Gravity.CENTER);
        replySendButton.setClickable(true);
        replySendButton.setFocusable(true);
        replySendButton.setBackground(touchBackground(Color.rgb(42, 114, 232), 999, Color.argb(38, 255, 255, 255)));
        replySendButton.setOnClickListener(view -> sendReply());
        footer.addView(replyStatus, new LinearLayout.LayoutParams(0, dp(38), 1f));
        footer.addView(cancel, new LinearLayout.LayoutParams(dp(48), dp(38)));
        LinearLayout.LayoutParams sendParams = new LinearLayout.LayoutParams(dp(54), dp(38));
        sendParams.leftMargin = dp(6);
        footer.addView(replySendButton, sendParams);
        composer.addView(footer, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(38)));
        return composer;
    }

    private FrameLayout buildMascot() {
        FrameLayout root = new FrameLayout(this);
        root.setContentDescription("CX-Codex 任务宠物，点击查看任务进展");

        petImage = new ImageView(this);
        petImage.setImageResource(R.drawable.cx_pet_idle);
        petImage.setScaleType(ImageView.ScaleType.FIT_CENTER);
        FrameLayout.LayoutParams imageParams = new FrameLayout.LayoutParams(dp(70), dp(73), Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        root.addView(petImage, imageParams);

        petStatus = text("待命", 10, Color.rgb(53, 62, 78), Typeface.BOLD);
        petStatus.setGravity(Gravity.CENTER);
        petStatus.setBackground(rounded(Color.argb(238, 255, 255, 255), 999));
        FrameLayout.LayoutParams statusParams = new FrameLayout.LayoutParams(dp(44), dp(20), Gravity.BOTTOM | Gravity.START);
        statusParams.leftMargin = dp(1);
        root.addView(petStatus, statusParams);

        badge = text("", 11, Color.WHITE, Typeface.BOLD);
        badge.setGravity(Gravity.CENTER);
        badge.setBackground(rounded(Color.rgb(42, 114, 232), 999));
        badge.setElevation(dp(4));
        FrameLayout.LayoutParams badgeParams = new FrameLayout.LayoutParams(dp(24), dp(24), Gravity.TOP | Gravity.END);
        badgeParams.topMargin = dp(3);
        badgeParams.rightMargin = dp(1);
        root.addView(badge, badgeParams);
        return root;
    }

    private FrameLayout buildMiniMascot() {
        FrameLayout root = new FrameLayout(this);
        root.setContentDescription("已最小化的 CX-Codex 任务宠物，点击恢复");
        root.setBackground(touchBackground(Color.argb(242, 255, 255, 255), 999, Color.argb(32, 42, 114, 232)));
        root.setElevation(dp(5));

        miniPetImage = new ImageView(this);
        miniPetImage.setImageResource(R.drawable.cx_pet_idle);
        miniPetImage.setScaleType(ImageView.ScaleType.FIT_CENTER);
        FrameLayout.LayoutParams imageParams = new FrameLayout.LayoutParams(dp(36), dp(36), Gravity.CENTER);
        root.addView(miniPetImage, imageParams);

        miniBadge = text("", 9, Color.WHITE, Typeface.BOLD);
        miniBadge.setGravity(Gravity.CENTER);
        miniBadge.setBackground(rounded(Color.rgb(42, 114, 232), 999));
        miniBadge.setElevation(dp(2));
        FrameLayout.LayoutParams badgeParams = new FrameLayout.LayoutParams(dp(19), dp(19), Gravity.TOP | Gravity.END);
        badgeParams.topMargin = -dp(2);
        badgeParams.rightMargin = -dp(2);
        root.addView(miniBadge, badgeParams);
        return root;
    }

    private void renderTasks() {
        if (
            taskList == null || badge == null || miniBadge == null || petImage == null
                || miniPetImage == null || petStatus == null || recentList == null
        ) return;
        int activeCount = 0;
        int completedCount = 0;
        boolean waiting = false;
        for (TaskItem task : tasks) {
            if (!"completed".equals(task.state)) activeCount += 1;
            if ("completed".equals(task.state)) completedCount += 1;
            if ("waiting".equals(task.state)) waiting = true;
        }
        if (tasks.isEmpty() && !expanded && !minimized) {
            setMinimized(true);
        } else if (!tasks.isEmpty() && minimized) {
            setMinimized(false);
        }
        badge.setVisibility(tasks.isEmpty() ? View.GONE : View.VISIBLE);
        badge.setText(tasks.size() > 99 ? "99+" : String.valueOf(tasks.size()));
        badge.setBackground(rounded(waiting ? Color.rgb(214, 126, 28) : Color.rgb(42, 114, 232), 999));
        miniBadge.setVisibility(tasks.isEmpty() ? View.GONE : View.VISIBLE);
        miniBadge.setText(tasks.size() > 9 ? "9+" : String.valueOf(tasks.size()));
        miniBadge.setBackground(rounded(waiting ? Color.rgb(214, 126, 28) : Color.rgb(42, 114, 232), 999));
        String petMode = waiting ? "waiting" : activeCount > 0 ? "working" : completedCount > 0 ? "completed" : "idle";
        String stateLabel = waiting ? "待处理" : activeCount > 0 ? "工作中" : completedCount > 0 ? "已完成" : "待命";
        updatePetImage(petMode);
        petStatus.setText(stateLabel);
        String countLabel = tasks.isEmpty() ? "没有任务" : tasks.size() + " 个任务";
        mascot.setContentDescription("CX-Codex 任务宠物，" + stateLabel + "，" + countLabel + "，点击查看任务进展");
        miniMascot.setContentDescription("已最小化的 CX-Codex 任务宠物，" + stateLabel + "，" + countLabel + "，点击恢复");
        if (panelSummary != null) {
            panelSummary.setText(
                activeCount > 0
                    ? activeCount + " 个任务 · 最新回复实时更新"
                    : completedCount > 0
                        ? completedCount + " 条已完成 · 回复保留至查看"
                        : "当前空闲"
            );
        }
        if (activeCount != lastForegroundActiveCount) {
            lastForegroundActiveCount = activeCount;
            updateForegroundNotification(activeCount);
        }
        if (expanded) renderExpandedTaskListPreservingPet();
    }

    private void updatePetImage(String mode) {
        if (mode.equals(lastPetMode)) return;
        lastPetMode = mode;
        applyPetImage(mode, true);
    }

    private void applyPetImage(String mode, boolean animateTransition) {
        int animatedResourceId;
        int fallbackResourceId;
        switch (mode) {
            case "waiting":
                animatedResourceId = R.drawable.cx_pet_waiting_animated;
                fallbackResourceId = R.drawable.cx_pet_waiting;
                break;
            case "working":
                animatedResourceId = R.drawable.cx_pet_working_animated;
                fallbackResourceId = R.drawable.cx_pet_working;
                break;
            case "completed":
                animatedResourceId = R.drawable.cx_pet_completed_animated;
                fallbackResourceId = R.drawable.cx_pet_completed;
                break;
            case "dragging":
                animatedResourceId = R.drawable.cx_pet_dragging_animated;
                fallbackResourceId = R.drawable.cx_pet_dragging;
                break;
            default:
                animatedResourceId = R.drawable.cx_pet_idle_animated;
                fallbackResourceId = R.drawable.cx_pet_idle;
                break;
        }
        petImage.animate().cancel();
        miniPetImage.animate().cancel();
        stopPetAnimation(petImage);
        stopPetAnimation(miniPetImage);
        if (minimized) {
            petImage.setImageResource(fallbackResourceId);
            miniPetImage.setImageResource(fallbackResourceId);
        } else {
            petImage.setImageDrawable(loadPetDrawable(animatedResourceId, fallbackResourceId));
            startPetAnimation(petImage);
            miniPetImage.setImageResource(fallbackResourceId);
        }
        if (animateTransition) {
            ImageView visibleImage = minimized ? miniPetImage : petImage;
            visibleImage.setAlpha(0.72f);
            float startScale = mode.equals("completed") ? 0.88f : 0.94f;
            visibleImage.setScaleX(startScale);
            visibleImage.setScaleY(startScale);
            visibleImage.setTranslationY(mode.equals("working") ? dp(2) : 0f);
            visibleImage.setRotation(mode.equals("waiting") ? -3f : 0f);
            visibleImage.animate()
                .alpha(1f)
                .scaleX(1f)
                .scaleY(1f)
                .translationY(0f)
                .rotation(0f)
                .setDuration(minimized ? 150L : mode.equals("waiting") ? 220L : 180L)
                .setInterpolator(EASE_OUT)
                .start();
        }
    }

    private Drawable loadPetDrawable(int animatedResourceId, int fallbackResourceId) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                return ImageDecoder.decodeDrawable(ImageDecoder.createSource(getResources(), animatedResourceId));
            } catch (Exception ignored) {
                // Fall through to the matching still when a device cannot decode Animated WebP.
            }
        }
        Drawable fallback = ContextCompat.getDrawable(this, fallbackResourceId);
        if (fallback == null) throw new IllegalStateException("Missing CX task-pet drawable");
        return fallback;
    }

    private void startPetAnimation(@Nullable ImageView target) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P || target == null) return;
        Drawable drawable = target.getDrawable();
        if (drawable instanceof AnimatedImageDrawable) ((AnimatedImageDrawable) drawable).start();
    }

    private void stopPetAnimation(@Nullable ImageView target) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P || target == null) return;
        Drawable drawable = target.getDrawable();
        if (drawable instanceof AnimatedImageDrawable) ((AnimatedImageDrawable) drawable).stop();
    }

    private void renderTaskList() {
        taskList.removeAllViews();
        renderRecentThreads();
        int maxVisibleRows = getResources().getDisplayMetrics().heightPixels < dp(700) ? 2 : 3;
        if (!replyThreadId.isEmpty()) maxVisibleRows = 1;
        int visibleCount = Math.min(tasks.size(), maxVisibleRows);
        if (visibleCount == 0) {
            TextView empty = text("没有正在运行的任务", 13, Color.rgb(87, 98, 117), Typeface.NORMAL);
            empty.setGravity(Gravity.CENTER_VERTICAL);
            empty.setPadding(dp(10), dp(12), dp(10), dp(12));
            taskList.addView(empty, new LinearLayout.LayoutParams(dp(PANEL_CONTENT_WIDTH_DP), dp(48)));
        } else {
            for (int index = 0; index < visibleCount; index++) {
                TaskItem task = tasks.get(index);
                View row = buildTaskRow(task);
                LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(dp(PANEL_CONTENT_WIDTH_DP), dp(TASK_ROW_HEIGHT_DP));
                if (index > 0) rowParams.topMargin = dp(6);
                taskList.addView(row, rowParams);
            }
            if (tasks.size() > visibleCount) {
                TextView more = text("还有 " + (tasks.size() - visibleCount) + " 个任务", 12, Color.rgb(91, 103, 124), Typeface.NORMAL);
                more.setGravity(Gravity.CENTER);
                LinearLayout.LayoutParams moreParams = new LinearLayout.LayoutParams(dp(PANEL_CONTENT_WIDTH_DP), dp(28));
                moreParams.topMargin = dp(3);
                taskList.addView(more, moreParams);
            }
        }
        lastRenderedTaskSignature = taskListSignature();
    }

    private void renderRecentThreads() {
        if (recentList == null || recentSection == null) return;
        recentList.removeAllViews();
        recentSection.setVisibility(
            closeConfirmationVisible || recentThreads.isEmpty() ? View.GONE : View.VISIBLE
        );
        for (int index = 0; index < recentThreads.size(); index++) {
            RecentThreadItem thread = recentThreads.get(index);
            TextView row = text("", 12, Color.rgb(30, 36, 48), Typeface.NORMAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(dp(10), 0, dp(10), 0);
            row.setMaxLines(2);
            row.setEllipsize(android.text.TextUtils.TruncateAt.END);
            String replyHint = thread.projectName.isEmpty() ? "长按直接回复" : thread.projectName + " · 长按直接回复";
            row.setText(thread.title + "   ›\n" + replyHint);
            row.setContentDescription(thread.title + "，最近会话，点击打开，长按直接回复");
            row.setClickable(true);
            row.setFocusable(true);
            row.setBackground(touchBackground(Color.rgb(247, 248, 251), 10, Color.argb(26, 42, 114, 232)));
            row.setOnClickListener(view -> {
                view.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP);
                openThread(thread.threadId);
            });
            row.setOnLongClickListener(view -> {
                view.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS);
                showReplyComposer(thread.threadId, thread.title);
                return true;
            });
            LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                dp(PANEL_CONTENT_WIDTH_DP),
                dp(54)
            );
            if (index > 0) rowParams.topMargin = dp(4);
            recentList.addView(row, rowParams);
        }
    }

    private void renderExpandedTaskListPreservingPet() {
        if (taskListSignature().equals(lastRenderedTaskSignature)) return;
        int petY = windowParams.y + taskPanel.getHeight();
        renderTaskList();
        taskPanel.measure(
            View.MeasureSpec.makeMeasureSpec(dp(PANEL_WIDTH_DP), View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
        );
        int nextY = Math.max(0, petY - taskPanel.getMeasuredHeight());
        if (nextY != windowParams.y) {
            windowParams.y = nextY;
            windowManager.updateViewLayout(overlayRoot, windowParams);
        }
        taskList.setAlpha(0.72f);
        taskList.setTranslationY(dp(3));
        taskList.animate()
            .alpha(1f)
            .translationY(0f)
            .setDuration(140L)
            .setInterpolator(EASE_OUT)
            .start();
    }

    private View buildTaskRow(TaskItem task) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(10), dp(7), dp(9), dp(7));
        row.setBackground(touchBackground(Color.rgb(242, 245, 249), 11, Color.argb(28, 42, 114, 232)));
        row.setClickable(true);
        row.setFocusable(true);
        String replyPreview = task.latestReply.isEmpty()
            ? task.latestActivity.isEmpty() ? task.detail : task.latestActivity
            : task.latestReply;
        row.setContentDescription(replyPreview + "，" + task.title + "，点击打开会话");
        row.setOnClickListener(view -> {
            view.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP);
            openThread(task.threadId);
        });

        TextView dot = text("", 1, Color.TRANSPARENT, Typeface.NORMAL);
        int dotColor = "completed".equals(task.state)
            ? Color.rgb(45, 148, 91)
            : "waiting".equals(task.state)
                ? Color.rgb(214, 126, 28)
                : Color.rgb(42, 114, 232);
        dot.setBackground(rounded(dotColor, 999));
        row.addView(dot, new LinearLayout.LayoutParams(dp(8), dp(8)));

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        copy.setPadding(dp(9), 0, dp(5), 0);
        String context = task.detail;
        if (!task.projectName.isEmpty()) context += " · " + task.projectName;
        if (!task.title.isEmpty()) context += " · " + task.title;
        TextView contextView = text(context, 10, Color.rgb(91, 103, 124), Typeface.BOLD);
        contextView.setSingleLine(true);
        contextView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        TextView replyView = text(replyPreview, 12, Color.rgb(30, 36, 48), Typeface.NORMAL);
        replyView.setMaxLines(2);
        replyView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        replyView.setGravity(Gravity.CENTER_VERTICAL);
        TextView freshness = text(
            task.latestReply.isEmpty() ? "等待新的回复 · " + freshnessText(task) : "最新回复 · " + freshnessText(task),
            9,
            task.latestReply.isEmpty() ? Color.rgb(104, 114, 130) : Color.rgb(42, 103, 190),
            Typeface.NORMAL
        );
        freshness.setSingleLine(true);
        copy.addView(contextView, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(18)));
        copy.addView(replyView, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(38)));
        copy.addView(freshness, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(16)));
        row.addView(copy, new LinearLayout.LayoutParams(0, dp(72), 1f));

        TextView reply = text("回复", 11, Color.rgb(42, 103, 190), Typeface.BOLD);
        reply.setGravity(Gravity.CENTER);
        reply.setClickable(true);
        reply.setFocusable(true);
        reply.setContentDescription("直接回复" + task.title);
        reply.setBackground(touchBackground(Color.WHITE, 999, Color.argb(30, 42, 114, 232)));
        reply.setOnClickListener(view -> {
            view.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP);
            showReplyComposer(task);
        });
        row.addView(reply, new LinearLayout.LayoutParams(dp(44), dp(38)));
        return row;
    }

    private void showReplyComposer(TaskItem task) {
        showReplyComposer(task.threadId, task.title);
    }

    private void showReplyComposer(String threadId, String title) {
        if (replyComposer == null || replyInput == null || sendingReply) return;
        int petY = windowParams.y + taskPanel.getHeight();
        replyThreadId = threadId;
        replyThreadTitle = title;
        replyTitle.setText("回复 · " + title);
        replyStatus.setText("");
        replyInput.setText("");
        replyComposer.setVisibility(View.VISIBLE);
        setOverlayInputEnabled(true);
        relayoutExpandedPanel(petY);
        replyInput.requestFocus();
        replyInput.postDelayed(() -> {
            InputMethodManager keyboard = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.showSoftInput(replyInput, InputMethodManager.SHOW_IMPLICIT);
        }, 120L);
    }

    private void hideReplyComposer() {
        if (replyComposer == null || replyComposer.getVisibility() != View.VISIBLE || sendingReply) return;
        int petY = windowParams.y + taskPanel.getHeight();
        InputMethodManager keyboard = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (keyboard != null && replyInput != null) keyboard.hideSoftInputFromWindow(replyInput.getWindowToken(), 0);
        replyThreadId = "";
        replyThreadTitle = "";
        replyStatus.setText("");
        replyInput.setText("");
        replyComposer.setVisibility(View.GONE);
        setOverlayInputEnabled(false);
        relayoutExpandedPanel(petY);
    }

    private void relayoutExpandedPanel(int petY) {
        if (!expanded || taskPanel == null || windowManager == null) return;
        lastRenderedTaskSignature = "";
        renderTaskList();
        taskPanel.measure(
            View.MeasureSpec.makeMeasureSpec(dp(PANEL_WIDTH_DP), View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
        );
        windowParams.y = Math.max(0, petY - taskPanel.getMeasuredHeight());
        windowManager.updateViewLayout(overlayRoot, windowParams);
    }

    private void setOverlayInputEnabled(boolean enabled) {
        if (windowParams == null || windowManager == null || overlayRoot == null) return;
        int flags = WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
        if (!enabled) flags |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        windowParams.flags = flags;
        windowManager.updateViewLayout(overlayRoot, windowParams);
    }

    private void sendReply() {
        if (sendingReply || replyInput == null || replyThreadId.isEmpty()) return;
        String message = replyInput.getText() == null ? "" : replyInput.getText().toString().trim();
        if (message.isEmpty()) {
            replyStatus.setText("请输入内容");
            return;
        }
        if (serverUrl.isEmpty()) {
            replyStatus.setText("服务地址不可用");
            return;
        }
        String targetThreadId = replyThreadId;
        String clientMessageId = TaskPetRuntimePolicy.reuseOrCreateClientMessageId(
            replyAttemptClientMessageId,
            replyAttemptThreadId,
            replyAttemptMessage,
            targetThreadId,
            message,
            "task-pet-" + UUID.randomUUID()
        );
        rememberReplyAttempt(targetThreadId, message, clientMessageId);
        sendingReply = true;
        replyStatus.setText("正在发送…");
        replyInput.setEnabled(false);
        replySendButton.setEnabled(false);
        replySendButton.setAlpha(0.55f);
        networkExecutor.execute(() -> {
            ReplyResult result = sendReplyRequest(targetThreadId, message, clientMessageId);
            mainHandler.post(() -> {
                if (destroyed) return;
                finishReply(targetThreadId, message, result);
            });
        });
    }

    private ReplyResult sendReplyRequest(String threadId, String message, String clientMessageId) {
        HttpURLConnection connection = null;
        try {
            String endpoint = serverUrl + "/codex-api/runtime/send";
            MobileShellPlugin.ensureWebAuthCookie(this, endpoint);
            JSONObject textInput = new JSONObject()
                .put("type", "text")
                .put("text", message);
            JSONObject payload = new JSONObject()
                .put("threadId", threadId)
                .put("input", new JSONArray().put(textInput))
                .put("collaborationMode", "execute")
                .put("clientMessageId", clientMessageId);
            byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setConnectTimeout(5_000);
            connection.setReadTimeout(12_000);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("User-Agent", "CX-Codex-Android-TaskPet");
            connection.setUseCaches(false);
            connection.setDoOutput(true);
            String cookies = CookieManager.getInstance().getCookie(endpoint);
            if (cookies != null && !cookies.isEmpty()) connection.setRequestProperty("Cookie", cookies);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
            }
            int status = connection.getResponseCode();
            if (status == 200 || status == 202) {
                String runtimeStatus = "running";
                InputStream responseStream = connection.getInputStream();
                if (responseStream != null) {
                    JSONObject responsePayload = new JSONObject(readText(responseStream));
                    JSONObject data = responsePayload.optJSONObject("data");
                    if (data != null) runtimeStatus = clean(data.optString("status", "running"), 40);
                }
                if ("failed".equals(runtimeStatus)) {
                    return new ReplyResult(false, runtimeStatus, "发送失败，请重试");
                }
                return new ReplyResult(true, runtimeStatus, "");
            }
            InputStream errorStream = connection.getErrorStream();
            String errorMessage = "发送失败（" + status + "）";
            if (errorStream != null) {
                JSONObject errorPayload = new JSONObject(readText(errorStream));
                String serverMessage = clean(errorPayload.optString("message", errorPayload.optString("error")), 60);
                if (!serverMessage.isEmpty()) errorMessage = serverMessage;
            }
            return new ReplyResult(false, "failed", errorMessage);
        } catch (Exception ignored) {
            return new ReplyResult(false, "start_uncertain", "网络异常，请重试");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void finishReply(String threadId, String message, ReplyResult result) {
        if (destroyed || !RUNNING.get()) return;
        sendingReply = false;
        replyInput.setEnabled(true);
        replySendButton.setEnabled(true);
        replySendButton.setAlpha(1f);
        if (!result.success) {
            replyStatus.setText(result.message);
            replyInput.requestFocus();
            return;
        }
        boolean awaitingConfirmation = TaskPetRuntimePolicy.isAwaitingConfirmation(result.runtimeStatus);
        boolean alreadySettled = "completed".equals(result.runtimeStatus)
            || "stopped".equals(result.runtimeStatus)
            || "interrupted".equals(result.runtimeStatus);
        if (!awaitingConfirmation) clearReplyAttempt();
        String nextState = awaitingConfirmation ? "waiting" : alreadySettled ? "completed" : "running";
        String nextDetail = awaitingConfirmation
            ? "回复已提交 · 正在确认"
            : alreadySettled ? "回复已送达 · 已结束" : "已发送回复 · 处理中";
        TaskItem task = findTask(threadId);
        if (task == null) {
            RecentThreadItem recentThread = findRecentThread(threadId);
            String title = replyThreadTitle.isEmpty()
                ? recentThread == null ? "最近会话" : recentThread.title
                : replyThreadTitle;
            String projectName = recentThread == null ? "" : recentThread.projectName;
            task = new TaskItem(
                threadId,
                title,
                projectName,
                nextDetail,
                clean(message, 80),
                "",
                nextState,
                0L,
                System.currentTimeMillis()
            );
            tasks.add(0, task);
            if (tasks.size() > 8) tasks.remove(tasks.size() - 1);
        } else {
            task.state = nextState;
            task.detail = nextDetail;
            task.latestActivity = clean(message, 80);
            task.latestReply = "";
            task.lastUpdatedAtMs = System.currentTimeMillis();
        }
        persistTasks();
        hideReplyComposer();
        renderTasks();
        schedulePoll(0L);
        Toast.makeText(this, awaitingConfirmation ? "回复已提交，正在确认" : "回复已发送", Toast.LENGTH_SHORT).show();
    }

    private void restoreReplyAttempt() {
        android.content.SharedPreferences preferences = MobileShellConfig.getPreferences(this);
        replyAttemptClientMessageId = preferences.getString(MobileShellConfig.PREF_TASK_PET_REPLY_CLIENT_ID, "");
        replyAttemptThreadId = preferences.getString(MobileShellConfig.PREF_TASK_PET_REPLY_THREAD_ID, "");
        replyAttemptMessage = preferences.getString(MobileShellConfig.PREF_TASK_PET_REPLY_MESSAGE, "");
        if (replyAttemptClientMessageId == null) replyAttemptClientMessageId = "";
        if (replyAttemptThreadId == null) replyAttemptThreadId = "";
        if (replyAttemptMessage == null) replyAttemptMessage = "";
    }

    private void rememberReplyAttempt(String threadId, String message, String clientMessageId) {
        replyAttemptThreadId = threadId;
        replyAttemptMessage = message;
        replyAttemptClientMessageId = clientMessageId;
        MobileShellConfig.getPreferences(this).edit()
            .putString(MobileShellConfig.PREF_TASK_PET_REPLY_THREAD_ID, threadId)
            .putString(MobileShellConfig.PREF_TASK_PET_REPLY_MESSAGE, message)
            .putString(MobileShellConfig.PREF_TASK_PET_REPLY_CLIENT_ID, clientMessageId)
            .apply();
    }

    private void clearReplyAttempt() {
        replyAttemptThreadId = "";
        replyAttemptMessage = "";
        replyAttemptClientMessageId = "";
        MobileShellConfig.getPreferences(this).edit()
            .remove(MobileShellConfig.PREF_TASK_PET_REPLY_THREAD_ID)
            .remove(MobileShellConfig.PREF_TASK_PET_REPLY_MESSAGE)
            .remove(MobileShellConfig.PREF_TASK_PET_REPLY_CLIENT_ID)
            .apply();
    }

    private String taskListSignature() {
        StringBuilder signature = new StringBuilder();
        for (TaskItem task : tasks) {
            signature.append(task.threadId).append('|')
                .append(task.state).append('|')
                .append(task.detail).append('|')
                .append(task.latestActivity).append('|')
                .append(task.latestReply).append('|')
                .append(freshnessBucket(task)).append(';');
        }
        signature.append('#');
        for (RecentThreadItem thread : recentThreads) {
            signature.append(thread.threadId).append('|')
                .append(thread.title).append('|')
                .append(thread.projectName).append(';');
        }
        return signature.toString();
    }

    private int freshnessBucket(TaskItem task) {
        long ageMs = Math.max(0L, System.currentTimeMillis() - task.lastUpdatedAtMs);
        if (ageMs < 15_000L) return 0;
        if (ageMs < 60_000L) return 1;
        return 2 + (int) Math.min(59L, ageMs / 60_000L);
    }

    private String freshnessText(TaskItem task) {
        long ageMs = Math.max(0L, System.currentTimeMillis() - task.lastUpdatedAtMs);
        if (ageMs < 15_000L) return "刚刚";
        if (ageMs < 60_000L) return "1 分钟内";
        long minutes = Math.max(1L, ageMs / 60_000L);
        return Math.min(59L, minutes) + " 分钟前";
    }

    private void attachDragAndClick(View target, Runnable tapAction) {
        target.setOnTouchListener(new View.OnTouchListener() {
            float downRawX;
            float downRawY;
            int startX;
            int startY;
            boolean dragging;

            @Override
            public boolean onTouch(View view, MotionEvent event) {
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        if (positionAnimator != null) positionAnimator.cancel();
                        downRawX = event.getRawX();
                        downRawY = event.getRawY();
                        startX = windowParams.x;
                        startY = windowParams.y;
                        dragging = false;
                        view.animate().cancel();
                        view.animate()
                            .alpha(0.92f)
                            .scaleX(0.94f)
                            .scaleY(0.94f)
                            .setDuration(90L)
                            .setInterpolator(EASE_OUT)
                            .start();
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        float dx = event.getRawX() - downRawX;
                        float dy = event.getRawY() - downRawY;
                        if (!dragging && Math.hypot(dx, dy) > dp(4)) {
                            if (sendingReply) return true;
                            dragging = true;
                            applyPetImage("dragging", false);
                            view.performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK);
                            if (expanded) {
                                collapsePanelImmediately();
                                downRawX = event.getRawX();
                                downRawY = event.getRawY();
                                startX = windowParams.x;
                                startY = windowParams.y;
                                dx = 0f;
                                dy = 0f;
                            }
                        }
                        if (dragging) {
                            int maxX = Math.max(0, getResources().getDisplayMetrics().widthPixels - overlayRoot.getWidth());
                            int maxY = Math.max(0, getResources().getDisplayMetrics().heightPixels - overlayRoot.getHeight());
                            windowParams.x = Math.max(0, Math.min(maxX, startX + Math.round(dx)));
                            windowParams.y = Math.max(0, Math.min(maxY, startY + Math.round(dy)));
                            view.setRotation(Math.max(-5f, Math.min(5f, dx / Math.max(1f, dp(8)))));
                            scheduleDragLayoutUpdate();
                        }
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                    case MotionEvent.ACTION_UP:
                        view.animate().cancel();
                        view.animate()
                            .alpha(1f)
                            .scaleX(1f)
                            .scaleY(1f)
                            .rotation(0f)
                            .setDuration(160L)
                            .setInterpolator(EASE_OUT)
                            .start();
                        if (dragging) {
                            snapPetToNearestEdge();
                            applyPetImage(lastPetMode.isEmpty() ? "idle" : lastPetMode, false);
                        } else {
                            view.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP);
                            tapAction.run();
                        }
                        return true;
                    default:
                        return false;
                }
            }
        });
    }

    private void snapPetToNearestEdge() {
        int screenWidth = getResources().getDisplayMetrics().widthPixels;
        int screenHeight = getResources().getDisplayMetrics().heightPixels;
        int margin = dp(8);
        int maxX = Math.max(margin, screenWidth - overlayRoot.getWidth() - margin);
        int maxY = Math.max(margin, screenHeight - overlayRoot.getHeight() - margin);
        int centerX = windowParams.x + overlayRoot.getWidth() / 2;
        anchoredRight = centerX >= screenWidth / 2;
        updateMascotGravity();
        int targetX = anchoredRight ? maxX : margin;
        int targetY = Math.max(margin, Math.min(maxY, windowParams.y));
        animateWindowTo(targetX, targetY);
    }

    private void animateWindowTo(int targetX, int targetY) {
        if (positionAnimator != null) positionAnimator.cancel();
        int startX = windowParams.x;
        int startY = windowParams.y;
        positionAnimator = ValueAnimator.ofFloat(0f, 1f);
        positionAnimator.setDuration(220L);
        positionAnimator.setInterpolator(EASE_OUT);
        positionAnimator.addUpdateListener(animation -> {
            if (!RUNNING.get() || windowManager == null || overlayRoot == null) return;
            float progress = (float) animation.getAnimatedValue();
            windowParams.x = startX + Math.round((targetX - startX) * progress);
            windowParams.y = startY + Math.round((targetY - startY) * progress);
            windowManager.updateViewLayout(overlayRoot, windowParams);
        });
        positionAnimator.addListener(new android.animation.AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(android.animation.Animator animation) {
                persistPetPosition();
            }
        });
        positionAnimator.start();
    }

    private void persistPetPosition() {
        int petX = windowParams.x + (expanded && anchoredRight ? expandedAnchorOffset() : 0);
        int petY = windowParams.y + (expanded ? expandedPanelOffset() : 0);
        MobileShellConfig.getPreferences(this).edit()
            .putInt(MobileShellConfig.PREF_TASK_PET_X, petX)
            .putInt(MobileShellConfig.PREF_TASK_PET_Y, petY)
            .apply();
    }

    private void scheduleDragLayoutUpdate() {
        if (dragFramePending || overlayRoot == null) return;
        dragFramePending = true;
        overlayRoot.postOnAnimation(() -> {
            dragFramePending = false;
            if (!RUNNING.get() || windowManager == null || overlayRoot == null) return;
            windowManager.updateViewLayout(overlayRoot, windowParams);
        });
    }

    private void replaceTasks(String tasksJson) {
        List<TaskItem> next = new ArrayList<>();
        long now = System.currentTimeMillis();
        try {
            JSONArray rows = new JSONArray(tasksJson);
            for (int index = 0; index < rows.length() && next.size() < 8; index++) {
                JSONObject row = rows.optJSONObject(index);
                if (row == null) continue;
                String threadId = clean(row.optString("threadId"), 160);
                if (threadId.isEmpty()) continue;
                TaskItem previous = findTask(threadId);
                String incomingState = row.optString("state");
                String normalizedState = "completed".equals(incomingState)
                    ? "completed"
                    : "waiting".equals(incomingState) ? "waiting" : "running";
                TaskItem incoming = new TaskItem(
                    threadId,
                    clean(row.optString("title", "未命名会话"), 90),
                    clean(row.optString("projectName"), 50),
                    clean(row.optString("detail", "任务进行中"), 80),
                    clean(row.optString("latestActivity"), 140),
                    clean(row.optString("latestReply"), 1200),
                    normalizedState,
                    row.optLong("lastEventSeq", previous == null ? 0L : previous.lastEventSeq),
                    row.optLong("lastUpdatedAtMs", now)
                );
                if (
                    previous != null
                    && !TaskPetRuntimePolicy.shouldApplySnapshot(previous.lastEventSeq, incoming.lastEventSeq)
                ) {
                    next.add(previous);
                    continue;
                }
                if (previous != null && incoming.hasSameVisibleContent(previous)) {
                    incoming.lastUpdatedAtMs = previous.lastUpdatedAtMs;
                }
                next.add(incoming);
            }
        } catch (Exception ignored) {
            // Keep the existing records when a malformed snapshot arrives.
            return;
        }
        for (TaskItem existing : tasks) {
            boolean alreadyIncluded = false;
            for (TaskItem incoming : next) {
                if (incoming.threadId.equals(existing.threadId)) {
                    alreadyIncluded = true;
                    break;
                }
            }
            if (
                !alreadyIncluded
                && next.size() < 8
                && TaskPetRuntimePolicy.shouldRetainOmittedTask(existing.state)
            ) next.add(existing);
        }
        tasks.clear();
        tasks.addAll(next);
        persistTasks();
    }

    private void replaceRecentThreads(String recentThreadsJson) {
        List<RecentThreadItem> next = new ArrayList<>();
        try {
            JSONArray rows = new JSONArray(recentThreadsJson);
            for (int index = 0; index < rows.length() && next.size() < 2; index++) {
                JSONObject row = rows.optJSONObject(index);
                if (row == null) continue;
                String threadId = clean(row.optString("threadId"), 160);
                if (threadId.isEmpty()) continue;
                boolean duplicate = false;
                for (RecentThreadItem existing : next) {
                    if (existing.threadId.equals(threadId)) {
                        duplicate = true;
                        break;
                    }
                }
                if (duplicate) continue;
                next.add(new RecentThreadItem(
                    threadId,
                    clean(row.optString("title", "未命名会话"), 90),
                    clean(row.optString("projectName"), 50)
                ));
            }
        } catch (Exception ignored) {
            return;
        }
        recentThreads.clear();
        recentThreads.addAll(next);
    }

    private void persistTasks() {
        JSONArray rows = new JSONArray();
        try {
            for (TaskItem task : tasks) {
                rows.put(new JSONObject()
                    .put("threadId", task.threadId)
                    .put("title", task.title)
                    .put("projectName", task.projectName)
                    .put("detail", task.detail)
                    .put("latestActivity", task.latestActivity)
                    .put("latestReply", task.latestReply)
                    .put("state", task.state)
                    .put("lastEventSeq", task.lastEventSeq)
                    .put("lastUpdatedAtMs", task.lastUpdatedAtMs));
            }
            MobileShellConfig.getPreferences(this).edit()
                .putString(MobileShellConfig.PREF_TASK_PET_TASKS_JSON, rows.toString())
                .apply();
        } catch (Exception ignored) {
            // A failed local snapshot must not stop the floating pet.
        }
    }

    @Nullable
    private TaskItem findTask(String threadId) {
        for (TaskItem task : tasks) {
            if (task.threadId.equals(threadId)) return task;
        }
        return null;
    }

    @Nullable
    private RecentThreadItem findRecentThread(String threadId) {
        for (RecentThreadItem thread : recentThreads) {
            if (thread.threadId.equals(threadId)) return thread;
        }
        return null;
    }

    private void pollRunningTasks() {
        if (pollInFlight || serverUrl.isEmpty()) return;
        List<TaskItem> active = new ArrayList<>();
        for (TaskItem task : tasks) {
            if (!"completed".equals(task.state)) active.add(task.copy());
        }
        if (active.isEmpty()) return;
        pollInFlight = true;
        networkExecutor.execute(() -> {
            List<RuntimeResult> results = readRuntimeResults(active);
            mainHandler.post(() -> {
                if (destroyed || !RUNNING.get()) return;
                pollInFlight = false;
                if (results == null) {
                    consecutivePollFailures += 1;
                    if (consecutivePollFailures >= 2) markPollUnavailable();
                } else {
                    consecutivePollFailures = 0;
                    applyRuntimeResults(active, results);
                }
                schedulePoll(results == null ? RETRY_POLL_INTERVAL_MS : ACTIVE_POLL_INTERVAL_MS);
            });
        });
    }

    @Nullable
    private List<RuntimeResult> readRuntimeResults(List<TaskItem> active) {
        HttpURLConnection connection = null;
        try {
            StringBuilder encodedThreadIds = new StringBuilder();
            for (TaskItem task : active) {
                if (encodedThreadIds.length() > 0) encodedThreadIds.append(',');
                encodedThreadIds.append(Uri.encode(task.threadId));
            }
            String endpoint = serverUrl + "/codex-api/runtime/snapshots?threadIds=" + encodedThreadIds;
            MobileShellPlugin.ensureWebAuthCookie(this, endpoint);
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setConnectTimeout(5_000);
            connection.setReadTimeout(8_000);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "CX-Codex-Android-TaskPet");
            connection.setUseCaches(false);
            String cookies = CookieManager.getInstance().getCookie(endpoint);
            if (cookies != null && !cookies.isEmpty()) connection.setRequestProperty("Cookie", cookies);
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) return null;
            JSONObject payload = new JSONObject(readText(connection.getInputStream()));
            JSONArray snapshots = payload.optJSONArray("data");
            if (snapshots == null) return null;
            List<RuntimeResult> results = new ArrayList<>();
            for (int index = 0; index < snapshots.length(); index++) {
                JSONObject snapshot = snapshots.optJSONObject(index);
                if (snapshot == null) continue;
                String threadId = clean(snapshot.optString("threadId"), 160);
                if (threadId.isEmpty()) continue;
                JSONArray pendingRequests = snapshot.optJSONArray("pendingServerRequests");
                results.add(new RuntimeResult(
                    threadId,
                    snapshot.optBoolean("inProgress", false),
                    clean(snapshot.optString("executionState"), 40),
                    pendingRequests != null && pendingRequests.length() > 0,
                    snapshot.optBoolean("stale", false),
                    snapshot.optLong("lastEventSeq", 0L),
                    clean(snapshot.optString("latestReply"), 1200)
                ));
            }
            return results;
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void applyRuntimeResults(List<TaskItem> requestedTasks, List<RuntimeResult> results) {
        for (RuntimeResult result : results) {
            for (TaskItem task : tasks) {
                if (!task.threadId.equals(result.threadId)) continue;
                if (!TaskPetRuntimePolicy.shouldApplySnapshot(task.lastEventSeq, result.lastEventSeq)) break;
                String previousState = task.state;
                String previousDetail = task.detail;
                String previousReply = task.latestReply;
                if (result.lastEventSeq > task.lastEventSeq) {
                    task.lastEventSeq = result.lastEventSeq;
                    task.lastUpdatedAtMs = System.currentTimeMillis();
                }
                if (
                    result.stale
                    || "sync_degraded".equals(result.executionState)
                    || "start_uncertain".equals(result.executionState)
                ) {
                    task.state = "waiting";
                    task.detail = "状态待确认";
                } else if (!result.inProgress) {
                    boolean wasCompleted = "completed".equals(task.state);
                    task.state = "completed";
                    task.detail = "failed".equals(result.executionState)
                        ? "执行失败 · 打开会话后清理"
                        : "已完成 · 打开会话后清理";
                    if (!wasCompleted) notifyTaskCompleted(task);
                } else if (result.hasPendingRequest || "waiting_permission".equals(result.executionState)) {
                    task.state = "waiting";
                    task.detail = "等待处理";
                } else {
                    task.state = "running";
                    if (task.detail.isEmpty() || "状态同步中".equals(task.detail) || "等待处理".equals(task.detail)) {
                        task.detail = "任务进行中";
                    }
                }
                if (!result.latestReply.isEmpty()) task.latestReply = result.latestReply;
                if (
                    task.threadId.equals(replyAttemptThreadId)
                    && !TaskPetRuntimePolicy.isAwaitingConfirmation(result.executionState)
                    && !result.stale
                ) clearReplyAttempt();
                if (!previousState.equals(task.state) || !previousDetail.equals(task.detail) || !previousReply.equals(task.latestReply)) {
                    task.lastUpdatedAtMs = System.currentTimeMillis();
                }
                break;
            }
        }
        for (TaskItem requested : requestedTasks) {
            if (containsRuntimeResult(results, requested.threadId)) continue;
            TaskItem task = findTask(requested.threadId);
            if (task == null || "completed".equals(task.state)) continue;
            task.state = "waiting";
            task.detail = "暂时无法确认状态";
            task.lastUpdatedAtMs = System.currentTimeMillis();
        }
        persistTasks();
        renderTasks();
    }

    private boolean containsRuntimeResult(List<RuntimeResult> results, String threadId) {
        for (RuntimeResult result : results) {
            if (threadId.equals(result.threadId)) return true;
        }
        return false;
    }

    private void markPollUnavailable() {
        boolean changed = false;
        for (TaskItem task : tasks) {
            if ("completed".equals(task.state)) continue;
            if (!"waiting".equals(task.state) || !"网络中断，等待同步".equals(task.detail)) {
                task.state = "waiting";
                task.detail = "网络中断，等待同步";
                task.lastUpdatedAtMs = System.currentTimeMillis();
                changed = true;
            }
        }
        if (!changed) return;
        persistTasks();
        renderTasks();
    }

    private void schedulePoll(long delayMs) {
        mainHandler.removeCallbacks(pollRunnable);
        if (!hasActiveTasks() || serverUrl.isEmpty()) return;
        mainHandler.postDelayed(pollRunnable, Math.max(0L, delayMs));
    }

    private boolean hasActiveTasks() {
        for (TaskItem task : tasks) {
            if (!"completed".equals(task.state)) return true;
        }
        return false;
    }

    private void openPlatform() {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(launchIntent);
        setExpanded(false);
    }

    private void openThread(String threadId) {
        Intent launchIntent = createThreadIntent(threadId);
        startActivity(launchIntent);
        setExpanded(false);
    }

    private void showCloseConfirmation() {
        if (closeConfirmPanel == null || closeConfirmationVisible || sendingReply) return;
        if (replyComposer != null && replyComposer.getVisibility() == View.VISIBLE) hideReplyComposer();
        int petY = windowParams.y + taskPanel.getHeight();
        closeConfirmationVisible = true;
        platformActions.setVisibility(View.GONE);
        taskList.setVisibility(View.GONE);
        recentSection.setVisibility(View.GONE);
        closeConfirmPanel.setVisibility(View.VISIBLE);
        relayoutExpandedPanel(petY);
    }

    private void hideCloseConfirmation() {
        if (closeConfirmPanel == null || !closeConfirmationVisible) return;
        int petY = windowParams.y + taskPanel.getHeight();
        closeConfirmationVisible = false;
        closeConfirmPanel.setVisibility(View.GONE);
        platformActions.setVisibility(View.VISIBLE);
        taskList.setVisibility(View.VISIBLE);
        renderRecentThreads();
        relayoutExpandedPanel(petY);
    }

    private void closeTaskPet() {
        MobileShellConfig.getPreferences(this).edit()
            .putBoolean(MobileShellConfig.PREF_TASK_PET_ENABLED, false)
            .putBoolean(MobileShellConfig.PREF_TASK_PET_MINIMIZED, false)
            .commit();
        Toast.makeText(this, "浮窗已关闭，可在设置中重新开启", Toast.LENGTH_LONG).show();
        stopSelf();
    }

    private void clearCompletedThread(@Nullable String threadId) {
        if (threadId == null || threadId.trim().isEmpty()) return;
        TaskItem completedTask = findTask(threadId.trim());
        if (completedTask == null || !"completed".equals(completedTask.state)) return;
        tasks.remove(completedTask);
        if (completedTask.threadId.equals(replyAttemptThreadId)) clearReplyAttempt();
        persistTasks();
        NotificationManagerCompat.from(this).cancel(Math.abs(completedTask.threadId.hashCode()) + 10_000);
    }

    private int expandedPanelOffset() {
        if (taskPanel == null || taskPanel.getVisibility() != View.VISIBLE) return 0;
        return taskPanel.getHeight();
    }

    private int expandedAnchorOffset() {
        return dp(PANEL_WIDTH_DP - MASCOT_WIDTH_DP);
    }

    private int collapsedRootWidthDp(boolean minimizedState) {
        return (minimizedState ? MINI_SIZE_DP : MASCOT_WIDTH_DP) + ROOT_PADDING_DP * 2;
    }

    private int maxCollapsedX() {
        return Math.max(
            0,
            getResources().getDisplayMetrics().widthPixels - dp(collapsedRootWidthDp(minimized))
        );
    }

    private void updateMascotGravity() {
        updateChildGravity(mascot);
        updateChildGravity(miniMascot);
    }

    private void updateChildGravity(@Nullable View child) {
        if (child == null || !(child.getLayoutParams() instanceof LinearLayout.LayoutParams)) return;
        LinearLayout.LayoutParams params = (LinearLayout.LayoutParams) child.getLayoutParams();
        int gravity = anchoredRight ? Gravity.END : Gravity.START;
        if (params.gravity == gravity) return;
        params.gravity = gravity;
        child.setLayoutParams(params);
    }

    private void setMinimized(boolean nextMinimized) {
        if (minimized == nextMinimized || mascot == null || miniMascot == null || windowManager == null) return;
        if (sendingReply) {
            Toast.makeText(this, "回复正在发送", Toast.LENGTH_SHORT).show();
            return;
        }
        collapsePanelImmediately();
        int oldWidthDp = collapsedRootWidthDp(minimized);
        minimized = nextMinimized;
        int newWidthDp = collapsedRootWidthDp(minimized);
        MobileShellConfig.getPreferences(this).edit()
            .putBoolean(MobileShellConfig.PREF_TASK_PET_MINIMIZED, minimized)
            .apply();

        View incoming = minimized ? miniMascot : mascot;
        View outgoing = minimized ? mascot : miniMascot;
        outgoing.animate().cancel();
        outgoing.setVisibility(View.GONE);
        incoming.animate().cancel();
        incoming.setVisibility(View.VISIBLE);
        incoming.setAlpha(0f);
        incoming.setScaleX(0.78f);
        incoming.setScaleY(0.78f);
        applyPetImage(lastPetMode.isEmpty() ? "idle" : lastPetMode, false);
        updateMascotGravity();

        if (anchoredRight) windowParams.x += dp(oldWidthDp - newWidthDp);
        windowParams.x = Math.max(0, Math.min(maxCollapsedX(), windowParams.x));
        windowManager.updateViewLayout(overlayRoot, windowParams);
        incoming.animate()
            .alpha(1f)
            .scaleX(1f)
            .scaleY(1f)
            .setDuration(170L)
            .setInterpolator(EASE_OUT)
            .start();
        persistPetPosition();
    }

    private void setExpanded(boolean nextExpanded) {
        if (minimized) return;
        if (expanded == nextExpanded || taskPanel == null || windowManager == null) return;
        if (!nextExpanded && sendingReply) {
            Toast.makeText(this, "回复正在发送", Toast.LENGTH_SHORT).show();
            return;
        }
        if (!nextExpanded && replyComposer != null && replyComposer.getVisibility() == View.VISIBLE) {
            hideReplyComposer();
        }
        if (!nextExpanded && closeConfirmationVisible) hideCloseConfirmation();
        int animationToken = ++panelAnimationToken;
        taskPanel.animate().cancel();
        if (nextExpanded) {
            int petX = pendingCollapsedPetX >= 0 ? pendingCollapsedPetX : windowParams.x;
            int petY = pendingCollapsedPetY >= 0 ? pendingCollapsedPetY : windowParams.y;
            pendingCollapsedPetX = -1;
            pendingCollapsedPetY = -1;
            lastRenderedTaskSignature = "";
            renderTaskList();
            taskPanel.measure(
                View.MeasureSpec.makeMeasureSpec(dp(PANEL_WIDTH_DP), View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
            );
            int panelHeight = taskPanel.getMeasuredHeight();
            expanded = true;
            taskPanel.setVisibility(View.VISIBLE);
            taskPanel.setPivotY(panelHeight);
            taskPanel.setAlpha(0f);
            taskPanel.setScaleY(0.94f);
            taskPanel.setTranslationY(dp(5));
            int expandedWidth = dp(PANEL_WIDTH_DP + ROOT_PADDING_DP * 2);
            int maxExpandedX = Math.max(0, getResources().getDisplayMetrics().widthPixels - expandedWidth);
            windowParams.x = Math.max(0, Math.min(maxExpandedX, petX - (anchoredRight ? expandedAnchorOffset() : 0)));
            windowParams.y = Math.max(0, petY - panelHeight);
            windowManager.updateViewLayout(overlayRoot, windowParams);
            taskPanel.animate()
                .alpha(1f)
                .scaleY(1f)
                .translationY(0f)
                .setDuration(190L)
                .setInterpolator(EASE_OUT)
                .start();
            return;
        }

        int petX = windowParams.x + (anchoredRight ? expandedAnchorOffset() : 0);
        int petY = windowParams.y + expandedPanelOffset();
        pendingCollapsedPetX = petX;
        pendingCollapsedPetY = petY;
        expanded = false;
        taskPanel.animate()
            .alpha(0f)
            .scaleY(0.96f)
            .translationY(dp(3))
            .setDuration(130L)
            .setInterpolator(EASE_OUT)
            .withEndAction(() -> {
                if (animationToken != panelAnimationToken || expanded) return;
                taskPanel.setVisibility(View.GONE);
                taskPanel.setAlpha(1f);
                taskPanel.setScaleY(1f);
                taskPanel.setTranslationY(0f);
                windowParams.x = Math.max(0, Math.min(maxCollapsedX(), petX));
                windowParams.y = Math.max(0, petY);
                windowManager.updateViewLayout(overlayRoot, windowParams);
                pendingCollapsedPetX = -1;
                pendingCollapsedPetY = -1;
                if (tasks.isEmpty()) setMinimized(true);
            })
            .start();
    }

    private void collapsePanelImmediately() {
        if (!expanded || taskPanel == null || windowManager == null) return;
        if (sendingReply) return;
        if (replyComposer != null && replyComposer.getVisibility() == View.VISIBLE) hideReplyComposer();
        if (closeConfirmationVisible) hideCloseConfirmation();
        panelAnimationToken += 1;
        taskPanel.animate().cancel();
        int petX = windowParams.x + (anchoredRight ? expandedAnchorOffset() : 0);
        int petY = windowParams.y + expandedPanelOffset();
        expanded = false;
        taskPanel.setVisibility(View.GONE);
        taskPanel.setAlpha(1f);
        taskPanel.setScaleY(1f);
        taskPanel.setTranslationY(0f);
        windowParams.x = Math.max(0, Math.min(maxCollapsedX(), petX));
        windowParams.y = Math.max(0, petY);
        windowManager.updateViewLayout(overlayRoot, windowParams);
    }

    private Intent createThreadIntent(String threadId) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra(EXTRA_THREAD_ID, threadId);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return intent;
    }

    private PendingIntent createThreadPendingIntent(String threadId) {
        return PendingIntent.getActivity(
            this,
            Math.abs(threadId.hashCode()),
            createThreadIntent(threadId),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void notifyTaskCompleted(TaskItem task) {
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(task.title)
            .setContentText(task.detail)
            .setContentIntent(createThreadPendingIntent(task.threadId))
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try {
            NotificationManagerCompat.from(this).notify(Math.abs(task.threadId.hashCode()) + 10_000, builder.build());
        } catch (SecurityException ignored) {
            // The overlay stays usable even when notification permission is denied.
        }
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("保持任务宠物浮窗并提示任务完成");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private android.app.Notification buildForegroundNotification(int activeCount) {
        Intent launchIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            FOREGROUND_NOTIFICATION_ID,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        String body = activeCount > 0 ? activeCount + " 个任务正在进行" : "宠物正在待命";
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("CX-Codex 任务宠物")
            .setContentText(body)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void updateForegroundNotification(int activeCount) {
        try {
            NotificationManagerCompat.from(this).notify(
                FOREGROUND_NOTIFICATION_ID,
                buildForegroundNotification(activeCount)
            );
        } catch (SecurityException ignored) {
            // Android still exposes the foreground-service task manager entry.
        }
    }

    private TextView text(String value, float sizeSp, int color, int style) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        view.setTypeface(Typeface.create(Typeface.DEFAULT, style));
        view.setIncludeFontPadding(false);
        return view;
    }

    private GradientDrawable rounded(int color, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        return drawable;
    }

    private RippleDrawable touchBackground(int color, int radiusDp, int rippleColor) {
        return new RippleDrawable(
            ColorStateList.valueOf(rippleColor),
            rounded(color, radiusDp),
            rounded(Color.WHITE, radiusDp)
        );
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static String clean(String value, int maxLength) {
        String normalized = value == null ? "" : value.trim().replaceAll("[\\r\\n\\t]+", " ");
        return normalized.length() > maxLength ? normalized.substring(0, maxLength) : normalized;
    }

    private static String readText(InputStream inputStream) throws Exception {
        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) output.append(line);
        }
        return output.toString();
    }

    private static final class TaskItem {
        final String threadId;
        final String title;
        final String projectName;
        String detail;
        String latestActivity;
        String latestReply;
        String state;
        long lastEventSeq;
        long lastUpdatedAtMs;

        TaskItem(
            String threadId,
            String title,
            String projectName,
            String detail,
            String latestActivity,
            String latestReply,
            String state,
            long lastEventSeq,
            long lastUpdatedAtMs
        ) {
            this.threadId = threadId;
            this.title = title;
            this.projectName = projectName;
            this.detail = detail;
            this.latestActivity = latestActivity;
            this.latestReply = latestReply;
            this.state = state;
            this.lastEventSeq = lastEventSeq;
            this.lastUpdatedAtMs = lastUpdatedAtMs;
        }

        TaskItem copy() {
            return new TaskItem(
                threadId,
                title,
                projectName,
                detail,
                latestActivity,
                latestReply,
                state,
                lastEventSeq,
                lastUpdatedAtMs
            );
        }

        boolean hasSameVisibleContent(TaskItem other) {
            return title.equals(other.title)
                && projectName.equals(other.projectName)
                && detail.equals(other.detail)
                && latestActivity.equals(other.latestActivity)
                && latestReply.equals(other.latestReply)
                && state.equals(other.state);
        }
    }

    private static final class RecentThreadItem {
        final String threadId;
        final String title;
        final String projectName;

        RecentThreadItem(String threadId, String title, String projectName) {
            this.threadId = threadId;
            this.title = title;
            this.projectName = projectName;
        }
    }

    private static final class RuntimeResult {
        final String threadId;
        final boolean inProgress;
        final String executionState;
        final boolean hasPendingRequest;
        final boolean stale;
        final long lastEventSeq;
        final String latestReply;

        RuntimeResult(
            String threadId,
            boolean inProgress,
            String executionState,
            boolean hasPendingRequest,
            boolean stale,
            long lastEventSeq,
            String latestReply
        ) {
            this.threadId = threadId;
            this.inProgress = inProgress;
            this.executionState = executionState;
            this.hasPendingRequest = hasPendingRequest;
            this.stale = stale;
            this.lastEventSeq = lastEventSeq;
            this.latestReply = latestReply;
        }
    }

    private static final class ReplyResult {
        final boolean success;
        final String runtimeStatus;
        final String message;

        ReplyResult(boolean success, String runtimeStatus, String message) {
            this.success = success;
            this.runtimeStatus = runtimeStatus;
            this.message = message;
        }
    }
}
