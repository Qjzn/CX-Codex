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
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.Interpolator;
import android.view.animation.PathInterpolator;
import android.webkit.CookieManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

public final class TaskPetOverlayService extends Service {

    public static final String EXTRA_THREAD_ID = "cx_task_pet_thread_id";

    private static final String ACTION_UPDATE = "com.cxcodex.bridge.taskpet.UPDATE";
    private static final String EXTRA_SERVER_URL = "serverUrl";
    private static final String EXTRA_TASKS_JSON = "tasksJson";
    private static final String CHANNEL_ID = "cx_codex_task_pet";
    private static final String CHANNEL_NAME = "CX-Codex 任务宠物";
    private static final int FOREGROUND_NOTIFICATION_ID = 7421;
    private static final long ACTIVE_POLL_INTERVAL_MS = 3_000L;
    private static final long RETRY_POLL_INTERVAL_MS = 7_500L;
    private static final AtomicBoolean RUNNING = new AtomicBoolean(false);
    private static final Interpolator EASE_OUT = new PathInterpolator(0.22f, 1f, 0.36f, 1f);

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final List<TaskItem> tasks = new ArrayList<>();
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private WindowManager windowManager;
    private WindowManager.LayoutParams windowParams;
    private LinearLayout overlayRoot;
    private LinearLayout taskPanel;
    private LinearLayout taskList;
    private FrameLayout mascot;
    private TextView badge;
    private TextView face;
    private TextView petStatus;
    private TextView panelSummary;
    private boolean expanded;
    private boolean anchoredRight;
    private boolean dragFramePending;
    private boolean pollInFlight;
    private int panelAnimationToken;
    private int pendingCollapsedPetX = -1;
    private int pendingCollapsedPetY = -1;
    private int lastForegroundActiveCount = -1;
    private String lastRenderedTaskSignature = "";
    private String serverUrl = "";
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

    public static void startOrUpdate(Context context, @Nullable String serverUrl, @Nullable String tasksJson) {
        Intent intent = new Intent(context, TaskPetOverlayService.class).setAction(ACTION_UPDATE);
        if (serverUrl != null) intent.putExtra(EXTRA_SERVER_URL, serverUrl);
        if (tasksJson != null) intent.putExtra(EXTRA_TASKS_JSON, tasksJson);
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

    @Override
    public void onCreate() {
        super.onCreate();
        RUNNING.set(true);
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
        if (incomingServerUrl != null) {
            serverUrl = MobileShellConfig.normalizeServerUrl(incomingServerUrl);
        } else {
            serverUrl = MobileShellConfig.getPreferences(this)
                .getString(MobileShellConfig.PREF_TASK_PET_SERVER_URL, "");
        }
        if (incomingTasksJson != null || tasks.isEmpty()) {
            String tasksJson = incomingTasksJson != null
                ? incomingTasksJson
                : MobileShellConfig.getPreferences(this)
                    .getString(MobileShellConfig.PREF_TASK_PET_TASKS_JSON, "[]");
            replaceTasks(tasksJson == null ? "[]" : tasksJson);
            renderTasks();
        }
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
        mainHandler.removeCallbacks(pollRunnable);
        if (positionAnimator != null) positionAnimator.cancel();
        if (mascot != null) mascot.animate().cancel();
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
        overlayRoot.setPadding(dp(6), dp(6), dp(6), dp(6));

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
        TextView hideButton = text("隐藏", 12, Color.rgb(91, 103, 124), Typeface.NORMAL);
        hideButton.setGravity(Gravity.CENTER);
        hideButton.setPadding(dp(10), dp(5), dp(10), dp(5));
        hideButton.setBackground(rounded(Color.rgb(239, 242, 247), 999));
        hideButton.setContentDescription("关闭任务宠物");
        hideButton.setOnClickListener(view -> {
            MobileShellConfig.getPreferences(this).edit()
                .putBoolean(MobileShellConfig.PREF_TASK_PET_ENABLED, false)
                .apply();
            stopSelf();
        });
        panelHeader.addView(panelHeading, new LinearLayout.LayoutParams(0, dp(34), 1f));
        panelHeader.addView(hideButton, new LinearLayout.LayoutParams(dp(54), dp(32)));

        taskList = new LinearLayout(this);
        taskList.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams listParams = new LinearLayout.LayoutParams(dp(286), LinearLayout.LayoutParams.WRAP_CONTENT);
        listParams.topMargin = dp(6);
        taskPanel.addView(panelHeader, new LinearLayout.LayoutParams(dp(286), dp(34)));
        taskPanel.addView(taskList, listParams);
        overlayRoot.addView(taskPanel, new LinearLayout.LayoutParams(dp(310), LinearLayout.LayoutParams.WRAP_CONTENT));

        mascot = buildMascot();
        LinearLayout.LayoutParams mascotParams = new LinearLayout.LayoutParams(dp(104), dp(112));
        mascotParams.topMargin = dp(2);
        overlayRoot.addView(mascot, mascotParams);
        attachDragAndClick(mascot);

        int initialX = MobileShellConfig.getPreferences(this).getInt(MobileShellConfig.PREF_TASK_PET_X, dp(18));
        int initialY = MobileShellConfig.getPreferences(this).getInt(MobileShellConfig.PREF_TASK_PET_Y, dp(180));
        anchoredRight = initialX + dp(52) >= getResources().getDisplayMetrics().widthPixels / 2;
        updateMascotGravity();
        windowParams = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        );
        windowParams.gravity = Gravity.TOP | Gravity.START;
        windowParams.x = initialX;
        windowParams.y = initialY;
        windowManager.addView(overlayRoot, windowParams);
    }

    private FrameLayout buildMascot() {
        FrameLayout root = new FrameLayout(this);
        root.setContentDescription("CX-Codex 任务宠物，点击查看任务进展");

        TextView flame = text("🔥", 31, Color.WHITE, Typeface.NORMAL);
        flame.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams flameParams = new FrameLayout.LayoutParams(dp(42), dp(42), Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        flameParams.topMargin = dp(1);
        root.addView(flame, flameParams);

        FrameLayout robot = new FrameLayout(this);
        robot.setBackground(rounded(Color.rgb(242, 105, 37), 15));
        robot.setElevation(dp(3));
        FrameLayout.LayoutParams robotParams = new FrameLayout.LayoutParams(dp(76), dp(62), Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        robotParams.topMargin = dp(30);
        root.addView(robot, robotParams);

        face = text("• ᴗ •", 20, Color.rgb(35, 31, 28), Typeface.BOLD);
        face.setGravity(Gravity.CENTER);
        face.setBackground(rounded(Color.rgb(255, 218, 159), 11));
        FrameLayout.LayoutParams faceParams = new FrameLayout.LayoutParams(dp(58), dp(38), Gravity.CENTER);
        robot.addView(face, faceParams);

        TextView laptop = text(">_", 13, Color.WHITE, Typeface.BOLD);
        laptop.setGravity(Gravity.CENTER);
        laptop.setBackground(rounded(Color.rgb(54, 61, 73), 5));
        FrameLayout.LayoutParams laptopParams = new FrameLayout.LayoutParams(dp(48), dp(28), Gravity.BOTTOM | Gravity.END);
        laptopParams.rightMargin = dp(4);
        laptopParams.bottomMargin = dp(3);
        root.addView(laptop, laptopParams);

        petStatus = text("待命", 11, Color.rgb(53, 62, 78), Typeface.BOLD);
        petStatus.setGravity(Gravity.CENTER);
        petStatus.setBackground(rounded(Color.argb(238, 255, 255, 255), 999));
        FrameLayout.LayoutParams statusParams = new FrameLayout.LayoutParams(dp(54), dp(23), Gravity.BOTTOM | Gravity.START);
        statusParams.leftMargin = dp(1);
        root.addView(petStatus, statusParams);

        badge = text("", 12, Color.WHITE, Typeface.BOLD);
        badge.setGravity(Gravity.CENTER);
        badge.setBackground(rounded(Color.rgb(42, 114, 232), 999));
        badge.setElevation(dp(4));
        FrameLayout.LayoutParams badgeParams = new FrameLayout.LayoutParams(dp(26), dp(26), Gravity.TOP | Gravity.END);
        badgeParams.topMargin = dp(5);
        badgeParams.rightMargin = dp(1);
        root.addView(badge, badgeParams);
        return root;
    }

    private void renderTasks() {
        if (taskList == null || badge == null || face == null || petStatus == null) return;
        int activeCount = 0;
        boolean waiting = false;
        for (TaskItem task : tasks) {
            if (!"completed".equals(task.state)) activeCount += 1;
            if ("waiting".equals(task.state)) waiting = true;
        }
        badge.setVisibility(tasks.isEmpty() ? View.GONE : View.VISIBLE);
        badge.setText(tasks.size() > 99 ? "99+" : String.valueOf(tasks.size()));
        badge.setBackground(rounded(waiting ? Color.rgb(214, 126, 28) : Color.rgb(42, 114, 232), 999));
        face.setText(waiting ? "• ︵ •" : activeCount > 0 ? "• ᴗ •" : "• ‿ •");
        petStatus.setText(waiting ? "待处理" : activeCount > 0 ? "工作中" : "待命");
        if (panelSummary != null) {
            panelSummary.setText(activeCount > 0 ? activeCount + " 个任务 · 实时同步" : "当前空闲");
        }
        if (activeCount != lastForegroundActiveCount) {
            lastForegroundActiveCount = activeCount;
            updateForegroundNotification(activeCount);
        }
        if (expanded) renderExpandedTaskListPreservingPet();
    }

    private void renderTaskList() {
        taskList.removeAllViews();
        int maxVisibleRows = getResources().getDisplayMetrics().heightPixels < dp(600) ? 3 : 5;
        int visibleCount = Math.min(tasks.size(), maxVisibleRows);
        if (visibleCount == 0) {
            TextView empty = text("没有正在运行的任务", 13, Color.rgb(87, 98, 117), Typeface.NORMAL);
            empty.setGravity(Gravity.CENTER_VERTICAL);
            empty.setPadding(dp(10), dp(12), dp(10), dp(12));
            taskList.addView(empty, new LinearLayout.LayoutParams(dp(286), dp(48)));
        } else {
            for (int index = 0; index < visibleCount; index++) {
                TaskItem task = tasks.get(index);
                View row = buildTaskRow(task);
                LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(dp(286), dp(82));
                if (index > 0) rowParams.topMargin = dp(6);
                taskList.addView(row, rowParams);
            }
            if (tasks.size() > visibleCount) {
                TextView more = text("还有 " + (tasks.size() - visibleCount) + " 个任务", 12, Color.rgb(91, 103, 124), Typeface.NORMAL);
                more.setGravity(Gravity.CENTER);
                LinearLayout.LayoutParams moreParams = new LinearLayout.LayoutParams(dp(286), dp(28));
                moreParams.topMargin = dp(3);
                taskList.addView(more, moreParams);
            }
        }
        lastRenderedTaskSignature = taskListSignature();
    }

    private void renderExpandedTaskListPreservingPet() {
        if (taskListSignature().equals(lastRenderedTaskSignature)) return;
        int petY = windowParams.y + taskPanel.getHeight();
        renderTaskList();
        taskPanel.measure(
            View.MeasureSpec.makeMeasureSpec(dp(310), View.MeasureSpec.EXACTLY),
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
        String liveDetail = task.latestActivity.isEmpty() ? freshnessText(task) : task.latestActivity;
        row.setContentDescription(task.title + "，" + task.detail + "，" + liveDetail + "，点击打开会话");
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
        TextView title = text(task.title, 13, Color.rgb(30, 36, 48), Typeface.BOLD);
        title.setSingleLine(true);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        String subtitle = task.detail;
        if (!task.projectName.isEmpty()) subtitle += " · " + task.projectName;
        TextView detail = text(subtitle, 11, Color.rgb(91, 103, 124), Typeface.NORMAL);
        detail.setSingleLine(true);
        detail.setEllipsize(android.text.TextUtils.TruncateAt.END);
        TextView activity = text(
            task.latestActivity.isEmpty() ? "实时更新 · " + freshnessText(task) : "最新：" + task.latestActivity,
            10,
            task.latestActivity.isEmpty() ? Color.rgb(82, 100, 127) : Color.rgb(42, 103, 190),
            Typeface.NORMAL
        );
        activity.setSingleLine(true);
        activity.setEllipsize(android.text.TextUtils.TruncateAt.END);
        copy.addView(title, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(24)));
        copy.addView(detail, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(20)));
        copy.addView(activity, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(18)));
        row.addView(copy, new LinearLayout.LayoutParams(0, dp(62), 1f));

        TextView arrow = text("›", 22, Color.rgb(113, 124, 142), Typeface.NORMAL);
        arrow.setGravity(Gravity.CENTER);
        row.addView(arrow, new LinearLayout.LayoutParams(dp(20), dp(40)));
        return row;
    }

    private String taskListSignature() {
        StringBuilder signature = new StringBuilder();
        for (TaskItem task : tasks) {
            signature.append(task.threadId).append('|')
                .append(task.state).append('|')
                .append(task.detail).append('|')
                .append(task.latestActivity).append('|')
                .append(freshnessBucket(task)).append(';');
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

    private void attachDragAndClick(View target) {
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
                            dragging = true;
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
                        } else {
                            view.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP);
                            setExpanded(!expanded);
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
                TaskItem incoming = new TaskItem(
                    threadId,
                    clean(row.optString("title", "未命名会话"), 90),
                    clean(row.optString("projectName"), 50),
                    clean(row.optString("detail", "任务进行中"), 80),
                    clean(row.optString("latestActivity"), 140),
                    "waiting".equals(row.optString("state")) ? "waiting" : "running",
                    previous == null ? 0L : previous.lastEventSeq,
                    now
                );
                if (previous != null && incoming.hasSameVisibleContent(previous)) {
                    incoming.lastUpdatedAtMs = previous.lastUpdatedAtMs;
                }
                next.add(incoming);
            }
        } catch (Exception ignored) {
            // Keep an empty, usable overlay when a malformed snapshot arrives.
        }
        tasks.clear();
        tasks.addAll(next);
    }

    @Nullable
    private TaskItem findTask(String threadId) {
        for (TaskItem task : tasks) {
            if (task.threadId.equals(threadId)) return task;
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
                if (!RUNNING.get()) return;
                pollInFlight = false;
                if (results != null) applyRuntimeResults(results);
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
                    snapshot.optLong("lastEventSeq", 0L)
                ));
            }
            return results;
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void applyRuntimeResults(List<RuntimeResult> results) {
        for (RuntimeResult result : results) {
            for (TaskItem task : tasks) {
                if (!task.threadId.equals(result.threadId)) continue;
                String previousState = task.state;
                String previousDetail = task.detail;
                if (result.lastEventSeq > task.lastEventSeq) {
                    task.lastEventSeq = result.lastEventSeq;
                    task.lastUpdatedAtMs = System.currentTimeMillis();
                }
                if (result.stale || "sync_degraded".equals(result.executionState)) {
                    task.state = "running";
                    task.detail = "状态同步中";
                } else if (!result.inProgress) {
                    boolean wasCompleted = "completed".equals(task.state);
                    task.state = "completed";
                    task.detail = "failed".equals(result.executionState) ? "执行失败 · 点击查看" : "已完成 · 点击查看";
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
                if (!previousState.equals(task.state) || !previousDetail.equals(task.detail)) {
                    task.lastUpdatedAtMs = System.currentTimeMillis();
                }
                break;
            }
        }
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

    private void openThread(String threadId) {
        Intent launchIntent = createThreadIntent(threadId);
        startActivity(launchIntent);
        setExpanded(false);
    }

    private int expandedPanelOffset() {
        if (taskPanel == null || taskPanel.getVisibility() != View.VISIBLE) return 0;
        return taskPanel.getHeight();
    }

    private int expandedAnchorOffset() {
        return dp(310 - 104);
    }

    private void updateMascotGravity() {
        if (mascot == null || !(mascot.getLayoutParams() instanceof LinearLayout.LayoutParams)) return;
        LinearLayout.LayoutParams params = (LinearLayout.LayoutParams) mascot.getLayoutParams();
        int gravity = anchoredRight ? Gravity.END : Gravity.START;
        if (params.gravity == gravity) return;
        params.gravity = gravity;
        mascot.setLayoutParams(params);
    }

    private void setExpanded(boolean nextExpanded) {
        if (expanded == nextExpanded || taskPanel == null || windowManager == null) return;
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
                View.MeasureSpec.makeMeasureSpec(dp(310), View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
            );
            int panelHeight = taskPanel.getMeasuredHeight();
            expanded = true;
            taskPanel.setVisibility(View.VISIBLE);
            taskPanel.setPivotY(panelHeight);
            taskPanel.setAlpha(0f);
            taskPanel.setScaleY(0.94f);
            taskPanel.setTranslationY(dp(5));
            int expandedWidth = dp(310 + 12);
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
                int maxCollapsedX = Math.max(0, getResources().getDisplayMetrics().widthPixels - dp(104 + 12));
                windowParams.x = Math.max(0, Math.min(maxCollapsedX, petX));
                windowParams.y = Math.max(0, petY);
                windowManager.updateViewLayout(overlayRoot, windowParams);
                pendingCollapsedPetX = -1;
                pendingCollapsedPetY = -1;
            })
            .start();
    }

    private void collapsePanelImmediately() {
        if (!expanded || taskPanel == null || windowManager == null) return;
        panelAnimationToken += 1;
        taskPanel.animate().cancel();
        int petX = windowParams.x + (anchoredRight ? expandedAnchorOffset() : 0);
        int petY = windowParams.y + expandedPanelOffset();
        expanded = false;
        taskPanel.setVisibility(View.GONE);
        taskPanel.setAlpha(1f);
        taskPanel.setScaleY(1f);
        taskPanel.setTranslationY(0f);
        int maxCollapsedX = Math.max(0, getResources().getDisplayMetrics().widthPixels - dp(104 + 12));
        windowParams.x = Math.max(0, Math.min(maxCollapsedX, petX));
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
        String state;
        long lastEventSeq;
        long lastUpdatedAtMs;

        TaskItem(
            String threadId,
            String title,
            String projectName,
            String detail,
            String latestActivity,
            String state,
            long lastEventSeq,
            long lastUpdatedAtMs
        ) {
            this.threadId = threadId;
            this.title = title;
            this.projectName = projectName;
            this.detail = detail;
            this.latestActivity = latestActivity;
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
                && state.equals(other.state);
        }
    }

    private static final class RuntimeResult {
        final String threadId;
        final boolean inProgress;
        final String executionState;
        final boolean hasPendingRequest;
        final boolean stale;
        final long lastEventSeq;

        RuntimeResult(
            String threadId,
            boolean inProgress,
            String executionState,
            boolean hasPendingRequest,
            boolean stale,
            long lastEventSeq
        ) {
            this.threadId = threadId;
            this.inProgress = inProgress;
            this.executionState = executionState;
            this.hasPendingRequest = hasPendingRequest;
            this.stale = stale;
            this.lastEventSeq = lastEventSeq;
        }
    }
}
