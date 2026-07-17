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
    public static final String PREF_TASK_PET_ENABLED = "taskPetEnabled";
    public static final String PREF_TASK_PET_SERVER_URL = "taskPetServerUrl";
    public static final String PREF_TASK_PET_TASKS_JSON = "taskPetTasksJson";
    public static final String PREF_TASK_PET_X = "taskPetX";
    public static final String PREF_TASK_PET_Y = "taskPetY";

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
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
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
