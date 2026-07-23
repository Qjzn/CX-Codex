package com.cxcodex.bridge;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

public final class MobileShellConfig {

    public static final String PREFS_NAME = "CxCodexMobileShell";
    public static final String PREF_SERVER_URL = "serverUrl";
    public static final String PREF_AUTH_KEY = "authKey";
    public static final String PREF_NOTIFICATION_AUTO_REQUESTED = "notificationAutoRequested";
    public static final String PREF_TASK_PET_ENABLED = "taskPetEnabled";
    public static final String PREF_TASK_PET_SERVER_URL = "taskPetServerUrl";
    public static final String PREF_TASK_PET_TASKS_JSON = "taskPetTasksJson";
    public static final String PREF_TASK_PET_ACTIVE_TASKS_JSON = "taskPetActiveTasksJson";
    public static final String PREF_TASK_PET_RECENT_THREADS_JSON = "taskPetRecentThreadsJson";
    public static final String PREF_TASK_PET_MONITOR_DIAGNOSTICS_JSON = "taskPetMonitorDiagnosticsJson";
    public static final String PREF_TASK_PET_PENDING_REPLY_RENDER_KEY = "taskPetPendingReplyRenderKey";
    public static final String PREF_TASK_PET_PENDING_REPLY_RENDER_EVENT_SEQ = "taskPetPendingReplyRenderEventSeq";
    public static final String PREF_TASK_PET_NO_PROGRESS_REVIEW_AT_MS = "taskPetNoProgressReviewAtMs";
    public static final String PREF_TASK_PET_PENDING_OPEN_THREAD_ID = "taskPetPendingOpenThreadId";
    public static final String PREF_TASK_PET_X = "taskPetX";
    public static final String PREF_TASK_PET_Y = "taskPetY";
    public static final String PREF_TASK_PET_MINIMIZED = "taskPetMinimized";
    public static final String PREF_TASK_PET_REPLY_CLIENT_ID = "taskPetReplyClientId";
    public static final String PREF_TASK_PET_REPLY_THREAD_ID = "taskPetReplyThreadId";
    public static final String PREF_TASK_PET_REPLY_MESSAGE = "taskPetReplyMessage";
    public static final String PREF_MOBILE_PUSH_TOKEN = "mobilePushToken";
    public static final String PREF_MOBILE_PUSH_APP_INSTANCE_ID = "mobilePushAppInstanceId";
    public static final String PREF_MOBILE_PUSH_DIAGNOSTICS_JSON = "mobilePushDiagnosticsJson";
    public static final String PREF_MOBILE_PUSH_EVENT_SEQS_JSON = "mobilePushEventSeqsJson";
    public static final String PREF_MOBILE_PUSH_PENDING_ACKS_JSON = "mobilePushPendingAcksJson";
    public static final String PREF_MOBILE_PUSH_ACKED_EVENT_SEQS_JSON = "mobilePushAckedEventSeqsJson";
    public static final String PREF_MOBILE_PUSH_LAST_REGISTRATION_SIGNATURE = "mobilePushLastRegistrationSignature";
    public static final String PREF_MOBILE_PUSH_LAST_REGISTRATION_AT_MS = "mobilePushLastRegistrationAtMs";
    public static final String PREF_MOBILE_PUSH_LAST_ATTEMPT_SIGNATURE = "mobilePushLastAttemptSignature";
    public static final String PREF_MOBILE_PUSH_LAST_ATTEMPT_AT_MS = "mobilePushLastAttemptAtMs";
    public static final String PREF_MOBILE_PUSH_LAST_TOKEN_ATTEMPT_AT_MS = "mobilePushLastTokenAttemptAtMs";

    private MobileShellConfig() {}

    public static String getBundledServerUrl(Context context) {
        return "";
    }

    public static SharedPreferences getPreferences(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE);
    }

    public static String getStoredServerUrl(Context context) {
        return normalizeServerUrl(getPreferences(context).getString(PREF_SERVER_URL, ""));
    }

    public static String getStoredAuthKey(Context context) {
        String value = getPreferences(context).getString(PREF_AUTH_KEY, "");
        return value == null ? "" : value.trim();
    }

    public static String resolveServerUrl(Context context, String configServerUrl) {
        return getStoredServerUrl(context);
    }

    public static boolean isUsingDefaultServerUrl(Context context, String configServerUrl) {
        return getStoredServerUrl(context).isEmpty();
    }

    public static String normalizeServerUrl(String value) {
        if (value == null) {
            return "";
        }
        String normalized = value.trim();
        int fragmentIndex = normalized.indexOf('#');
        if (fragmentIndex >= 0) {
            normalized = normalized.substring(0, fragmentIndex);
        }
        int queryIndex = normalized.indexOf('?');
        if (queryIndex >= 0) {
            normalized = normalized.substring(0, queryIndex);
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    public static String buildAppHashUrl(String serverUrl, String hashPath) {
        String normalizedServerUrl = normalizeServerUrl(serverUrl);
        String normalizedHashPath = hashPath == null ? "" : hashPath.trim();
        while (normalizedHashPath.startsWith("#")) {
            normalizedHashPath = normalizedHashPath.substring(1);
        }
        if (!normalizedHashPath.startsWith("/")) {
            normalizedHashPath = "/" + normalizedHashPath;
        }
        return normalizedServerUrl + "/#" + normalizedHashPath;
    }

    public static boolean shouldAcknowledgePendingTaskPetThreadOpen(
        String pendingThreadId,
        String openedThreadId
    ) {
        String pending = pendingThreadId == null ? "" : pendingThreadId.trim();
        String opened = openedThreadId == null ? "" : openedThreadId.trim();
        return !pending.isEmpty() && pending.equals(opened);
    }

    public static boolean isValidServerUrl(String value) {
        String normalized = normalizeServerUrl(value);
        if (normalized.isEmpty()) {
            return false;
        }
        try {
            URI uri = new URI(normalized);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null) {
                return false;
            }
            String normalizedScheme = scheme.toLowerCase(Locale.ROOT);
            if (!normalizedScheme.equals("http") && !normalizedScheme.equals("https")) {
                return false;
            }
            return true;
        } catch (URISyntaxException exception) {
            return false;
        }
    }
}
