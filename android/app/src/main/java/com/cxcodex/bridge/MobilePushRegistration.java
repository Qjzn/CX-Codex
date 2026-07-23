package com.cxcodex.bridge;

import android.content.Context;
import android.webkit.CookieManager;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

final class MobilePushRegistration {
    private static final long REGISTRATION_REFRESH_MS = 6 * 60 * 60_000L;
    private static final long REGISTRATION_RETRY_THROTTLE_MS = 30_000L;
    private static final long TOKEN_RETRY_THROTTLE_MS = 30_000L;
    private static final int MAX_PENDING_ACKNOWLEDGEMENTS = 100;
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean TOKEN_REFRESH_IN_FLIGHT = new AtomicBoolean(false);
    private static final Set<String> ACKNOWLEDGEMENTS_IN_FLIGHT = Collections.synchronizedSet(
        new LinkedHashSet<>()
    );

    private MobilePushRegistration() {}

    static void refreshToken(Context context) {
        Context appContext = context.getApplicationContext();
        if (FirebaseApp.getApps(appContext).isEmpty()) {
            persistDiagnostics(appContext, "not_configured", "not_configured", 0, "");
            return;
        }
        android.content.SharedPreferences preferences = MobileShellConfig.getPreferences(appContext);
        long now = System.currentTimeMillis();
        long lastAttemptAtMs = preferences
            .getLong(MobileShellConfig.PREF_MOBILE_PUSH_LAST_TOKEN_ATTEMPT_AT_MS, 0L);
        if (TaskPetRuntimePolicy.shouldThrottleMobilePushTokenRefresh(
            TOKEN_REFRESH_IN_FLIGHT.get(),
            now - lastAttemptAtMs,
            TOKEN_RETRY_THROTTLE_MS
        )) return;
        if (!TOKEN_REFRESH_IN_FLIGHT.compareAndSet(false, true)) return;
        preferences.edit()
            .putLong(MobileShellConfig.PREF_MOBILE_PUSH_LAST_TOKEN_ATTEMPT_AT_MS, now)
            .apply();
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener((task) -> {
                try {
                    if (!task.isSuccessful() || task.getResult() == null || task.getResult().trim().isEmpty()) {
                        persistDiagnostics(appContext, "token_failed", "configured", 0, "token_unavailable");
                        return;
                    }
                    onTokenRefreshed(appContext, task.getResult());
                } finally {
                    TOKEN_REFRESH_IN_FLIGHT.set(false);
                }
            });
        } catch (RuntimeException ignored) {
            TOKEN_REFRESH_IN_FLIGHT.set(false);
            persistDiagnostics(appContext, "token_failed", "configured", 0, "token_unavailable");
        }
    }

    static void onTokenRefreshed(Context context, String token) {
        String normalizedToken = token == null ? "" : token.trim();
        if (normalizedToken.isEmpty()) return;
        MobileShellConfig.getPreferences(context).edit()
            .putString(MobileShellConfig.PREF_MOBILE_PUSH_TOKEN, normalizedToken)
            .remove(MobileShellConfig.PREF_MOBILE_PUSH_LAST_REGISTRATION_SIGNATURE)
            .apply();
        syncStoredTokenAsync(context, true);
    }

    static void syncStoredTokenAsync(Context context) {
        syncStoredTokenAsync(context, false);
    }

    static void ensureTokenAndSyncAsync(Context context) {
        Context appContext = context.getApplicationContext();
        if (FirebaseApp.getApps(appContext).isEmpty()) return;
        String token = MobileShellConfig.getPreferences(appContext)
            .getString(MobileShellConfig.PREF_MOBILE_PUSH_TOKEN, "");
        if (token == null || token.trim().isEmpty()) {
            refreshToken(appContext);
            return;
        }
        syncStoredTokenAsync(appContext);
    }

    static boolean isTrackedActiveThread(Context context, String threadId) {
        String normalizedThreadId = threadId == null ? "" : threadId.trim();
        if (normalizedThreadId.isEmpty()) return false;
        return readActiveThreadIds(context).contains(normalizedThreadId);
    }

    static synchronized boolean isPushEventClaimed(Context context, String threadId, long eventSeq) {
        String normalizedThreadId = threadId == null ? "" : threadId.trim();
        if (normalizedThreadId.isEmpty() || eventSeq <= 0L) return false;
        try {
            android.content.SharedPreferences preferences = MobileShellConfig.getPreferences(context);
            JSONObject previous = new JSONObject(
                preferences.getString(MobileShellConfig.PREF_MOBILE_PUSH_EVENT_SEQS_JSON, "{}")
            );
            return TaskPetRuntimePolicy.isDuplicateMobilePushEvent(
                previous.optLong(sha256(normalizedThreadId), 0L),
                eventSeq
            );
        } catch (Exception ignored) {
            // A dedupe cache failure must not suppress an authoritative snapshot refresh.
            return false;
        }
    }

    static synchronized boolean claimPushEvent(Context context, String threadId, long eventSeq) {
        String normalizedThreadId = threadId == null ? "" : threadId.trim();
        if (normalizedThreadId.isEmpty() || eventSeq <= 0L) return true;
        try {
            android.content.SharedPreferences preferences = MobileShellConfig.getPreferences(context);
            JSONObject previous = new JSONObject(
                preferences.getString(MobileShellConfig.PREF_MOBILE_PUSH_EVENT_SEQS_JSON, "{}")
            );
            String currentKey = sha256(normalizedThreadId);
            if (TaskPetRuntimePolicy.isDuplicateMobilePushEvent(previous.optLong(currentKey, 0L), eventSeq)) return false;
            JSONObject next = new JSONObject();
            for (String activeThreadId : readActiveThreadIds(context)) {
                String activeKey = sha256(activeThreadId);
                long activeSeq = previous.optLong(activeKey, 0L);
                if (activeSeq > 0L) next.put(activeKey, activeSeq);
            }
            next.put(currentKey, eventSeq);
            preferences.edit()
                .putString(MobileShellConfig.PREF_MOBILE_PUSH_EVENT_SEQS_JSON, next.toString())
                .commit();
            return true;
        } catch (Exception ignored) {
            // A dedupe cache failure must not suppress an authoritative snapshot refresh.
            return true;
        }
    }

    static synchronized boolean isPushEventAcknowledged(Context context, String threadId, long eventSeq) {
        return TaskPetRuntimePolicy.isDuplicateMobilePushEvent(
            readHashedEventSeq(
                context,
                MobileShellConfig.PREF_MOBILE_PUSH_ACKED_EVENT_SEQS_JSON,
                threadId
            ),
            eventSeq
        );
    }

    static synchronized boolean hasPendingPushAcknowledgement(
        Context context,
        String threadId,
        long eventSeq
    ) {
        return TaskPetRuntimePolicy.isDuplicateMobilePushEvent(
            readPendingAcknowledgementSeq(context, threadId),
            eventSeq
        );
    }

    static void acknowledgeTerminalAsync(Context context, String threadId, long observedEventSeq) {
        String normalizedThreadId = threadId == null ? "" : threadId.trim();
        if (normalizedThreadId.isEmpty() || observedEventSeq <= 0L) return;
        Context appContext = context.getApplicationContext();
        String token = MobileShellConfig.getPreferences(appContext)
            .getString(MobileShellConfig.PREF_MOBILE_PUSH_TOKEN, "");
        boolean hasStoredToken = token != null && !token.trim().isEmpty();
        boolean pushEventClaimed = isPushEventClaimed(
            appContext,
            normalizedThreadId,
            observedEventSeq
        );
        boolean acknowledgementPending = hasPendingPushAcknowledgement(
            appContext,
            normalizedThreadId,
            observedEventSeq
        );
        if (!TaskPetRuntimePolicy.shouldPersistMobilePushAcknowledgement(
            hasStoredToken,
            pushEventClaimed,
            acknowledgementPending
        )) return;
        persistPendingAcknowledgement(appContext, normalizedThreadId, observedEventSeq);
        submitPendingAcknowledgementAsync(appContext, normalizedThreadId, observedEventSeq);
    }

    static void retryPendingAcknowledgementAsync(Context context, String threadId) {
        String normalizedThreadId = threadId == null ? "" : threadId.trim();
        if (normalizedThreadId.isEmpty()) return;
        long eventSeq = readPendingAcknowledgementSeq(context, normalizedThreadId);
        if (eventSeq > 0L) submitPendingAcknowledgementAsync(context, normalizedThreadId, eventSeq);
    }

    static void recordPushResult(
        Context context,
        String state,
        boolean highPriority,
        long eventSeq
    ) {
        try {
            JSONObject diagnostics = readDiagnostics(context)
                .put("state", state)
                .put("lastPushHighPriority", highPriority)
                .put("lastPushEventSeq", eventSeq)
                .put("lastPushAtMs", System.currentTimeMillis());
            MobileShellConfig.getPreferences(context).edit()
                .putString(MobileShellConfig.PREF_MOBILE_PUSH_DIAGNOSTICS_JSON, diagnostics.toString())
                .apply();
        } catch (Exception ignored) {
            // Push diagnostics never participate in task state.
        }
    }

    private static void syncStoredTokenAsync(Context context, boolean force) {
        Context appContext = context.getApplicationContext();
        String token = MobileShellConfig.getPreferences(appContext)
            .getString(MobileShellConfig.PREF_MOBILE_PUSH_TOKEN, "");
        if (token == null || token.trim().isEmpty()) return;
        long now = System.currentTimeMillis();
        List<String> threadIds = readActiveThreadIds(appContext);
        Collections.sort(threadIds);
        String serverUrl = MobileShellConfig.normalizeServerUrl(
            MobileShellConfig.getPreferences(appContext)
                .getString(MobileShellConfig.PREF_TASK_PET_SERVER_URL, "")
        );
        if (serverUrl.isEmpty()) serverUrl = MobileShellConfig.getStoredServerUrl(appContext);
        if (serverUrl.isEmpty()) return;
        String signature = sha256(serverUrl + "\n" + token + "\n" + String.join("\n", threadIds));
        android.content.SharedPreferences preferences = MobileShellConfig.getPreferences(appContext);
        String lastAttemptSignature = preferences
            .getString(MobileShellConfig.PREF_MOBILE_PUSH_LAST_ATTEMPT_SIGNATURE, "");
        long lastAttemptAtMs = preferences
            .getLong(MobileShellConfig.PREF_MOBILE_PUSH_LAST_ATTEMPT_AT_MS, 0L);
        if (TaskPetRuntimePolicy.shouldThrottleMobilePushRegistration(
            force,
            signature.equals(lastAttemptSignature),
            now - lastAttemptAtMs,
            REGISTRATION_RETRY_THROTTLE_MS
        )) return;
        String lastSignature = preferences
            .getString(MobileShellConfig.PREF_MOBILE_PUSH_LAST_REGISTRATION_SIGNATURE, "");
        long lastRegisteredAtMs = preferences
            .getLong(MobileShellConfig.PREF_MOBILE_PUSH_LAST_REGISTRATION_AT_MS, 0L);
        if (TaskPetRuntimePolicy.shouldSkipFreshMobilePushRegistration(
            force,
            signature.equals(lastSignature),
            signature.equals(lastAttemptSignature),
            now - lastRegisteredAtMs,
            REGISTRATION_REFRESH_MS
        )) return;
        preferences.edit()
            .putString(MobileShellConfig.PREF_MOBILE_PUSH_LAST_ATTEMPT_SIGNATURE, signature)
            .putLong(MobileShellConfig.PREF_MOBILE_PUSH_LAST_ATTEMPT_AT_MS, now)
            .apply();
        final String resolvedServerUrl = serverUrl;
        final String resolvedToken = token.trim();
        EXECUTOR.execute(() -> register(appContext, resolvedServerUrl, resolvedToken, threadIds, signature));
    }

    private static void register(
        Context context,
        String serverUrl,
        String token,
        List<String> threadIds,
        String signature
    ) {
        HttpURLConnection connection = null;
        try {
            String endpoint = serverUrl + "/codex-api/mobile-push/register";
            MobileShellPlugin.ensureWebAuthCookie(context, endpoint);
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setConnectTimeout(8_000);
            connection.setReadTimeout(10_000);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setUseCaches(false);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "CX-Codex-Android-PushRegistration");
            String cookies = CookieManager.getInstance().getCookie(endpoint);
            if (cookies != null && !cookies.isEmpty()) connection.setRequestProperty("Cookie", cookies);
            JSONArray subscribedThreads = new JSONArray();
            for (String threadId : threadIds) subscribedThreads.put(threadId);
            JSONObject request = new JSONObject()
                .put("token", token)
                .put("platform", "android")
                .put("appInstanceId", getOrCreateAppInstanceId(context))
                .put("threadIds", subscribedThreads);
            byte[] body = request.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
                output.flush();
            }
            int statusCode = connection.getResponseCode();
            if (statusCode < 200 || statusCode >= 300) {
                persistDiagnostics(context, "registration_failed", "unknown", threadIds.size(), "http_" + statusCode);
                return;
            }
            JSONObject response = new JSONObject(readText(connection.getInputStream()));
            JSONObject data = response.optJSONObject("data");
            String configurationState = data == null ? "unknown" : data.optString("configurationState", "unknown");
            String state = "configured".equals(configurationState) ? "registered" : "server_not_configured";
            MobileShellConfig.getPreferences(context).edit()
                .putString(MobileShellConfig.PREF_MOBILE_PUSH_LAST_REGISTRATION_SIGNATURE, signature)
                .putLong(MobileShellConfig.PREF_MOBILE_PUSH_LAST_REGISTRATION_AT_MS, System.currentTimeMillis())
                .apply();
            persistDiagnostics(context, state, configurationState, threadIds.size(), "");
            retryAllPendingAcknowledgementsAsync(context);
        } catch (Exception ignored) {
            persistDiagnostics(context, "registration_failed", "unknown", threadIds.size(), "network_error");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static List<String> readActiveThreadIds(Context context) {
        Set<String> threadIds = new LinkedHashSet<>();
        android.content.SharedPreferences preferences = MobileShellConfig.getPreferences(context);
        collectActiveThreadIds(preferences.getString(MobileShellConfig.PREF_TASK_PET_TASKS_JSON, "[]"), threadIds);
        collectActiveThreadIds(preferences.getString(MobileShellConfig.PREF_TASK_PET_ACTIVE_TASKS_JSON, "[]"), threadIds);
        return new ArrayList<>(threadIds);
    }

    private static void collectActiveThreadIds(String tasksJson, Set<String> threadIds) {
        if (tasksJson == null || tasksJson.isEmpty()) return;
        try {
            JSONArray rows = new JSONArray(tasksJson);
            for (int index = 0; index < rows.length() && threadIds.size() < 100; index++) {
                JSONObject row = rows.optJSONObject(index);
                if (row == null) continue;
                String threadId = row.optString("threadId", "").trim();
                String state = row.optString("state", "").trim();
                if (!threadId.isEmpty() && TaskPetRuntimePolicy.isActiveTaskState(state)) threadIds.add(threadId);
            }
        } catch (Exception ignored) {
            // A malformed local snapshot must not remove the last server registration.
        }
    }

    private static String getOrCreateAppInstanceId(Context context) {
        android.content.SharedPreferences preferences = MobileShellConfig.getPreferences(context);
        String existing = preferences.getString(MobileShellConfig.PREF_MOBILE_PUSH_APP_INSTANCE_ID, "");
        if (existing != null && !existing.trim().isEmpty()) return existing.trim();
        String created = UUID.randomUUID().toString();
        preferences.edit().putString(MobileShellConfig.PREF_MOBILE_PUSH_APP_INSTANCE_ID, created).commit();
        return created;
    }

    private static String getExistingAppInstanceId(Context context) {
        String value = MobileShellConfig.getPreferences(context)
            .getString(MobileShellConfig.PREF_MOBILE_PUSH_APP_INSTANCE_ID, "");
        return value == null ? "" : value.trim();
    }

    private static synchronized long readHashedEventSeq(
        Context context,
        String preferenceKey,
        String threadId
    ) {
        String normalizedThreadId = threadId == null ? "" : threadId.trim();
        if (normalizedThreadId.isEmpty()) return 0L;
        try {
            String raw = MobileShellConfig.getPreferences(context).getString(preferenceKey, "{}");
            return Math.max(0L, new JSONObject(raw == null ? "{}" : raw)
                .optLong(sha256(normalizedThreadId), 0L));
        } catch (Exception ignored) {
            return 0L;
        }
    }

    private static synchronized void persistAcknowledgedEventSeq(
        Context context,
        String threadId,
        long eventSeq
    ) {
        if (eventSeq <= 0L) return;
        try {
            android.content.SharedPreferences preferences = MobileShellConfig.getPreferences(context);
            String raw = preferences.getString(MobileShellConfig.PREF_MOBILE_PUSH_ACKED_EVENT_SEQS_JSON, "{}");
            JSONObject values = new JSONObject(raw == null ? "{}" : raw);
            String key = sha256(threadId);
            values.put(key, Math.max(values.optLong(key, 0L), eventSeq));
            while (values.length() > MAX_PENDING_ACKNOWLEDGEMENTS) {
                JSONArray names = values.names();
                if (names == null || names.length() == 0) break;
                String oldestKey = names.optString(0);
                if (key.equals(oldestKey) && names.length() > 1) oldestKey = names.optString(1);
                values.remove(oldestKey);
            }
            preferences.edit()
                .putString(MobileShellConfig.PREF_MOBILE_PUSH_ACKED_EVENT_SEQS_JSON, values.toString())
                .commit();
        } catch (Exception ignored) {
            // A local acknowledgement cache failure may cause a harmless idempotent retry.
        }
    }

    private static synchronized void persistPendingAcknowledgement(
        Context context,
        String threadId,
        long eventSeq
    ) {
        try {
            android.content.SharedPreferences preferences = MobileShellConfig.getPreferences(context);
            String raw = preferences.getString(MobileShellConfig.PREF_MOBILE_PUSH_PENDING_ACKS_JSON, "{}");
            JSONObject values = new JSONObject(raw == null ? "{}" : raw);
            String key = sha256(threadId);
            JSONObject previous = values.optJSONObject(key);
            long previousSeq = previous == null ? 0L : previous.optLong("eventSeq", 0L);
            if (eventSeq <= previousSeq) return;
            values.put(key, new JSONObject().put("threadId", threadId).put("eventSeq", eventSeq));
            while (values.length() > MAX_PENDING_ACKNOWLEDGEMENTS) {
                JSONArray names = values.names();
                if (names == null || names.length() == 0) break;
                String oldestKey = names.optString(0);
                if (key.equals(oldestKey) && names.length() > 1) oldestKey = names.optString(1);
                values.remove(oldestKey);
            }
            preferences.edit()
                .putString(MobileShellConfig.PREF_MOBILE_PUSH_PENDING_ACKS_JSON, values.toString())
                .commit();
        } catch (Exception ignored) {
            // The server retains its outbox and will redeliver if this write fails.
        }
    }

    private static synchronized long readPendingAcknowledgementSeq(Context context, String threadId) {
        try {
            String raw = MobileShellConfig.getPreferences(context)
                .getString(MobileShellConfig.PREF_MOBILE_PUSH_PENDING_ACKS_JSON, "{}");
            JSONObject values = new JSONObject(raw == null ? "{}" : raw);
            JSONObject entry = values.optJSONObject(sha256(threadId));
            return entry == null ? 0L : Math.max(0L, entry.optLong("eventSeq", 0L));
        } catch (Exception ignored) {
            return 0L;
        }
    }

    private static synchronized void clearPendingAcknowledgements(
        Context context,
        String threadId,
        long acknowledgedEventSeq
    ) {
        try {
            android.content.SharedPreferences preferences = MobileShellConfig.getPreferences(context);
            String raw = preferences.getString(MobileShellConfig.PREF_MOBILE_PUSH_PENDING_ACKS_JSON, "{}");
            JSONObject values = new JSONObject(raw == null ? "{}" : raw);
            String key = sha256(threadId);
            JSONObject entry = values.optJSONObject(key);
            if (entry == null || entry.optLong("eventSeq", 0L) > acknowledgedEventSeq) return;
            values.remove(key);
            preferences.edit()
                .putString(MobileShellConfig.PREF_MOBILE_PUSH_PENDING_ACKS_JSON, values.toString())
                .commit();
        } catch (Exception ignored) {
            // A stale local row only causes another idempotent acknowledgement.
        }
    }

    private static void retryAllPendingAcknowledgementsAsync(Context context) {
        try {
            String raw = MobileShellConfig.getPreferences(context)
                .getString(MobileShellConfig.PREF_MOBILE_PUSH_PENDING_ACKS_JSON, "{}");
            JSONObject values = new JSONObject(raw == null ? "{}" : raw);
            JSONArray names = values.names();
            if (names == null) return;
            for (int index = 0; index < names.length(); index++) {
                JSONObject entry = values.optJSONObject(names.optString(index));
                if (entry == null) continue;
                String threadId = entry.optString("threadId", "").trim();
                long eventSeq = entry.optLong("eventSeq", 0L);
                if (!threadId.isEmpty() && eventSeq > 0L) {
                    submitPendingAcknowledgementAsync(context, threadId, eventSeq);
                }
            }
        } catch (Exception ignored) {
            // FCM redelivery remains the fallback retry trigger.
        }
    }

    private static void submitPendingAcknowledgementAsync(
        Context context,
        String threadId,
        long eventSeq
    ) {
        Context appContext = context.getApplicationContext();
        String key = sha256(threadId) + ":" + eventSeq;
        if (!ACKNOWLEDGEMENTS_IN_FLIGHT.add(key)) return;
        EXECUTOR.execute(() -> {
            try {
                acknowledge(appContext, threadId, eventSeq);
            } finally {
                ACKNOWLEDGEMENTS_IN_FLIGHT.remove(key);
            }
        });
    }

    private static void acknowledge(Context context, String threadId, long eventSeq) {
        String serverUrl = MobileShellConfig.normalizeServerUrl(
            MobileShellConfig.getPreferences(context)
                .getString(MobileShellConfig.PREF_TASK_PET_SERVER_URL, "")
        );
        if (serverUrl.isEmpty()) serverUrl = MobileShellConfig.getStoredServerUrl(context);
        String appInstanceId = getExistingAppInstanceId(context);
        if (serverUrl.isEmpty() || appInstanceId.isEmpty()) return;
        HttpURLConnection connection = null;
        try {
            String endpoint = serverUrl + "/codex-api/mobile-push/ack";
            MobileShellPlugin.ensureWebAuthCookie(context, endpoint);
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setConnectTimeout(8_000);
            connection.setReadTimeout(10_000);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setUseCaches(false);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "CX-Codex-Android-PushAcknowledgement");
            String cookies = CookieManager.getInstance().getCookie(endpoint);
            if (cookies != null && !cookies.isEmpty()) connection.setRequestProperty("Cookie", cookies);
            JSONObject request = new JSONObject()
                .put("appInstanceId", appInstanceId)
                .put("threadId", threadId)
                .put("eventSeq", eventSeq);
            byte[] body = request.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
                output.flush();
            }
            int statusCode = connection.getResponseCode();
            if (statusCode < 200 || statusCode >= 300) {
                recordPushAcknowledgementResult(context, "http_" + statusCode, eventSeq);
                return;
            }
            JSONObject response = new JSONObject(readText(connection.getInputStream()));
            JSONObject data = response.optJSONObject("data");
            if (data == null || !data.optBoolean("accepted", false)) {
                recordPushAcknowledgementResult(context, "registration_missing", eventSeq);
                syncStoredTokenAsync(context, true);
                return;
            }
            persistAcknowledgedEventSeq(context, threadId, eventSeq);
            clearPendingAcknowledgements(context, threadId, eventSeq);
            recordPushAcknowledgementResult(context, "acknowledged", eventSeq);
        } catch (Exception ignored) {
            recordPushAcknowledgementResult(context, "network_error", eventSeq);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static void recordPushAcknowledgementResult(Context context, String state, long eventSeq) {
        try {
            JSONObject diagnostics = readDiagnostics(context)
                .put("version", 2)
                .put("lastAcknowledgementState", state)
                .put("lastAcknowledgementEventSeq", eventSeq)
                .put("lastAcknowledgementAtMs", System.currentTimeMillis());
            MobileShellConfig.getPreferences(context).edit()
                .putString(MobileShellConfig.PREF_MOBILE_PUSH_DIAGNOSTICS_JSON, diagnostics.toString())
                .apply();
        } catch (Exception ignored) {
            // Acknowledgement diagnostics never participate in delivery state.
        }
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(digest.length * 2);
            for (byte item : digest) result.append(String.format("%02x", item));
            return result.toString();
        } catch (Exception ignored) {
            return Integer.toHexString(value.hashCode());
        }
    }

    private static void persistDiagnostics(
        Context context,
        String state,
        String configurationState,
        int subscriptionCount,
        String error
    ) {
        try {
            JSONObject diagnostics = readDiagnostics(context)
                .put("version", 2)
                .put("state", state)
                .put("configurationState", configurationState)
                .put("subscriptionCount", subscriptionCount)
                .put(
                    "lastTokenAttemptAtMs",
                    MobileShellConfig.getPreferences(context)
                        .getLong(MobileShellConfig.PREF_MOBILE_PUSH_LAST_TOKEN_ATTEMPT_AT_MS, 0L)
                )
                .put("lastRegistrationAtMs", System.currentTimeMillis())
                .put("lastError", error)
                .put("updatedAtMs", System.currentTimeMillis());
            MobileShellConfig.getPreferences(context).edit()
                .putString(MobileShellConfig.PREF_MOBILE_PUSH_DIAGNOSTICS_JSON, diagnostics.toString())
                .apply();
        } catch (Exception ignored) {
            // Diagnostics are best effort.
        }
    }

    private static JSONObject readDiagnostics(Context context) {
        String raw = MobileShellConfig.getPreferences(context)
            .getString(MobileShellConfig.PREF_MOBILE_PUSH_DIAGNOSTICS_JSON, "{}");
        try {
            return new JSONObject(raw == null ? "{}" : raw);
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private static String readText(InputStream inputStream) throws Exception {
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }
}
