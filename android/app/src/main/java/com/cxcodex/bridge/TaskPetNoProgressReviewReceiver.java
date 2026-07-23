package com.cxcodex.bridge;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONArray;
import org.json.JSONObject;

public final class TaskPetNoProgressReviewReceiver extends BroadcastReceiver {
    static final long INITIAL_REMINDER_MS = 10 * 60_000L;
    static final long REVIEW_INTERVAL_MS = 20 * 60_000L;

    private static final String ACTION_REVIEW = "com.cxcodex.bridge.taskpet.NO_PROGRESS_REVIEW";
    private static final String CHANNEL_ID = "cx_codex_task_no_progress_v1";
    private static final String CHANNEL_NAME = "CX-Codex 长任务提醒";
    private static final int ALARM_REQUEST_CODE = 7422;
    private static final long MIN_SCHEDULE_DELAY_MS = 1_000L;

    @Override
    public void onReceive(Context context, Intent intent) {
        Context appContext = context.getApplicationContext();
        SharedPreferences preferences = MobileShellConfig.getPreferences(appContext);
        preferences.edit().remove(MobileShellConfig.PREF_TASK_PET_NO_PROGRESS_REVIEW_AT_MS).commit();
        if (TaskPetOverlayService.isRunning() && TaskPetOverlayService.requestNoProgressReview(appContext)) {
            return;
        }
        reviewPersistedTasks(appContext, preferences);
    }

    static void scheduleNext(Context context, String tasksJson) {
        Context appContext = context.getApplicationContext();
        SharedPreferences preferences = MobileShellConfig.getPreferences(appContext);
        long earliestReviewAtMs = findEarliestReviewAtMs(tasksJson);
        if (earliestReviewAtMs <= 0L) {
            cancel(appContext, preferences);
            return;
        }
        long nowMs = System.currentTimeMillis();
        long triggerAtMs = Math.max(earliestReviewAtMs, nowMs + MIN_SCHEDULE_DELAY_MS);
        long scheduledAtMs = preferences.getLong(
            MobileShellConfig.PREF_TASK_PET_NO_PROGRESS_REVIEW_AT_MS,
            0L
        );
        if (scheduledAtMs == triggerAtMs) return;
        AlarmManager alarmManager = (AlarmManager) appContext.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;
        PendingIntent pendingIntent = createAlarmPendingIntent(appContext);
        alarmManager.cancel(pendingIntent);
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent);
        preferences.edit()
            .putLong(MobileShellConfig.PREF_TASK_PET_NO_PROGRESS_REVIEW_AT_MS, triggerAtMs)
            .apply();
    }

    static void notifyNoProgress(
        Context context,
        String threadId,
        String notificationKey,
        String title,
        String detail,
        long lastProgressAtMs,
        long nowMs
    ) {
        ensureNotificationChannel(context);
        long silentMinutes = Math.max(10L, (nowMs - lastProgressAtMs) / 60_000L);
        String status = detail == null || detail.isEmpty() ? "任务仍在等待新的回复" : detail;
        String body = title + " · " + status + "。点此查看或继续回复";
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("任务已连续 " + silentMinutes + " 分钟无新进展")
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(createOpenPendingIntent(context, threadId, notificationKey))
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try {
            NotificationManagerCompat.from(context).notify(notificationId(notificationKey), builder.build());
        } catch (SecurityException ignored) {
            // The next review remains scheduled when notification permission is denied.
        }
    }

    static void cancelNotification(Context context, String notificationKey) {
        NotificationManagerCompat.from(context).cancel(notificationId(notificationKey));
    }

    private static void reviewPersistedTasks(Context context, SharedPreferences preferences) {
        String tasksJson = preferences.getString(MobileShellConfig.PREF_TASK_PET_TASKS_JSON, "[]");
        JSONArray rows;
        try {
            rows = new JSONArray(tasksJson == null ? "[]" : tasksJson);
        } catch (Exception ignored) {
            cancel(context, preferences);
            return;
        }
        long nowMs = System.currentTimeMillis();
        boolean changed = false;
        JSONArray dueRows = new JSONArray();
        for (int index = 0; index < rows.length(); index++) {
            JSONObject row = rows.optJSONObject(index);
            if (row == null) continue;
            String threadId = clean(row.optString("threadId"));
            String clientMessageId = clean(row.optString("clientMessageId"));
            String notificationKey = clientMessageId.isEmpty() ? threadId : clientMessageId;
            if (notificationKey.isEmpty()) continue;
            String state = clean(row.optString("state"));
            long lastProgressAtMs = row.optLong("lastUpdatedAtMs", 0L);
            long lastReminderAtMs = row.optLong("lastNoProgressReminderAtMs", 0L);
            if (!TaskPetRuntimePolicy.isActiveTaskState(state)) {
                cancelNotification(context, notificationKey);
                if (lastReminderAtMs > 0L) {
                    putLong(row, "lastNoProgressReminderAtMs", 0L);
                    changed = true;
                }
                continue;
            }
            if (lastReminderAtMs > 0L && lastProgressAtMs > lastReminderAtMs) {
                cancelNotification(context, notificationKey);
                lastReminderAtMs = 0L;
                putLong(row, "lastNoProgressReminderAtMs", 0L);
                changed = true;
            }
            if (!TaskPetRuntimePolicy.shouldNotifyNoProgress(
                state,
                lastProgressAtMs,
                lastReminderAtMs,
                nowMs,
                INITIAL_REMINDER_MS,
                REVIEW_INTERVAL_MS
            )) continue;
            putLong(row, "lastNoProgressReminderAtMs", nowMs);
            dueRows.put(row);
            changed = true;
        }
        String nextTasksJson = rows.toString();
        if (changed) {
            boolean persisted = preferences.edit()
                .putString(MobileShellConfig.PREF_TASK_PET_TASKS_JSON, nextTasksJson)
                .commit();
            if (!persisted) {
                scheduleNext(context, tasksJson);
                return;
            }
        }
        for (int index = 0; index < dueRows.length(); index++) {
            JSONObject row = dueRows.optJSONObject(index);
            if (row == null) continue;
            String threadId = clean(row.optString("threadId"));
            String clientMessageId = clean(row.optString("clientMessageId"));
            String notificationKey = clientMessageId.isEmpty() ? threadId : clientMessageId;
            notifyNoProgress(
                context,
                threadId,
                notificationKey,
                clean(row.optString("title", "未命名会话")),
                clean(row.optString("detail", "任务进行中")),
                row.optLong("lastUpdatedAtMs", 0L),
                nowMs
            );
        }
        scheduleNext(context, nextTasksJson);
    }

    private static long findEarliestReviewAtMs(String tasksJson) {
        long earliestReviewAtMs = 0L;
        try {
            JSONArray rows = new JSONArray(tasksJson == null ? "[]" : tasksJson);
            for (int index = 0; index < rows.length(); index++) {
                JSONObject row = rows.optJSONObject(index);
                if (row == null) continue;
                long nextReviewAtMs = TaskPetRuntimePolicy.nextNoProgressReviewAtMs(
                    row.optString("state"),
                    row.optLong("lastUpdatedAtMs", 0L),
                    row.optLong("lastNoProgressReminderAtMs", 0L),
                    INITIAL_REMINDER_MS,
                    REVIEW_INTERVAL_MS
                );
                if (nextReviewAtMs > 0L && (earliestReviewAtMs <= 0L || nextReviewAtMs < earliestReviewAtMs)) {
                    earliestReviewAtMs = nextReviewAtMs;
                }
            }
        } catch (Exception ignored) {
            return 0L;
        }
        return earliestReviewAtMs;
    }

    private static void cancel(Context context, SharedPreferences preferences) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager != null) alarmManager.cancel(createAlarmPendingIntent(context));
        preferences.edit().remove(MobileShellConfig.PREF_TASK_PET_NO_PROGRESS_REVIEW_AT_MS).apply();
    }

    private static PendingIntent createAlarmPendingIntent(Context context) {
        Intent intent = new Intent(context, TaskPetNoProgressReviewReceiver.class).setAction(ACTION_REVIEW);
        return PendingIntent.getBroadcast(
            context,
            ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static PendingIntent createOpenPendingIntent(
        Context context,
        String threadId,
        String notificationKey
    ) {
        Intent intent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (!threadId.isEmpty()) intent.putExtra(TaskPetOverlayService.EXTRA_THREAD_ID, threadId);
        String requestKey = threadId.isEmpty() ? notificationKey : threadId;
        return PendingIntent.getActivity(
            context,
            Math.abs(requestKey.hashCode()),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static void ensureNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("长任务静默 10 分钟首次提醒，之后约每 20 分钟复盘；省电模式下可能延后");
        channel.setShowBadge(true);
        manager.createNotificationChannel(channel);
    }

    private static int notificationId(String taskKey) {
        return (taskKey.hashCode() & 0x7fffffff) % 1_000_000 + 1_100_000;
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }

    private static void putLong(JSONObject row, String key, long value) {
        try {
            row.put(key, value);
        } catch (Exception ignored) {
            // JSONObject backed by the persisted array is mutable in normal operation.
        }
    }
}
