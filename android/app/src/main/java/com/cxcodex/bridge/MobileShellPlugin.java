package com.cxcodex.bridge;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.provider.MediaStore;
import android.speech.SpeechRecognizer;
import android.util.Base64;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;

@CapacitorPlugin(
    name = "MobileShell",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class MobileShellPlugin extends Plugin {

    private static final int CONNECT_TIMEOUT_MS = 20_000;
    private static final int READ_TIMEOUT_MS = 90_000;
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 7420;
    private static final String TASK_NOTIFICATION_CHANNEL_ID = "cx_codex_tasks";
    private static final String TASK_NOTIFICATION_CHANNEL_NAME = "CX-Codex 任务";
    private static final String PREF_PENDING_APK_INSTALL_PATH = "pending_apk_install_path";
    private static final int DICTATION_MAX_DURATION_MS = 120_000;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private MediaRecorder dictationRecorder;
    private File dictationAudioFile;
    private PluginCall activeDictationCall;

    @PluginMethod
    public void getServerConfig(PluginCall call) {
        String bundledServerUrl = MobileShellConfig.getBundledServerUrl(getContext());
        String resolvedServerUrl = MobileShellConfig.resolveServerUrl(getContext(), bundledServerUrl);
        JSObject result = new JSObject();
        result.put("serverUrl", resolvedServerUrl);
        result.put("defaultServerUrl", bundledServerUrl);
        result.put("usingDefault", MobileShellConfig.isUsingDefaultServerUrl(getContext(), bundledServerUrl));
        call.resolve(result);
    }

    @PluginMethod
    public void setServerUrl(PluginCall call) {
        String serverUrl = MobileShellConfig.normalizeServerUrl(call.getString("serverUrl", ""));
        if (!MobileShellConfig.isValidServerUrl(serverUrl)) {
            call.reject("服务地址格式无效，请使用完整的 http(s)://host 地址");
            return;
        }

        MobileShellConfig.getPreferences(getContext())
            .edit()
            .putString(MobileShellConfig.PREF_SERVER_URL, serverUrl)
            .apply();

        String bundledServerUrl = MobileShellConfig.getBundledServerUrl(getContext());
        JSObject result = new JSObject();
        result.put("serverUrl", serverUrl);
        result.put("defaultServerUrl", bundledServerUrl);
        result.put("usingDefault", false);
        result.put("restartScheduled", true);
        call.resolve(result);
        scheduleRestart();
    }

    @PluginMethod
    public void resetServerUrl(PluginCall call) {
        MobileShellConfig.getPreferences(getContext())
            .edit()
            .remove(MobileShellConfig.PREF_SERVER_URL)
            .apply();

        String bundledServerUrl = MobileShellConfig.getBundledServerUrl(getContext());
        String resolvedServerUrl = MobileShellConfig.resolveServerUrl(getContext(), bundledServerUrl);
        JSObject result = new JSObject();
        result.put("serverUrl", resolvedServerUrl);
        result.put("defaultServerUrl", bundledServerUrl);
        result.put("usingDefault", true);
        result.put("restartScheduled", true);
        call.resolve(result);
        scheduleRestart();
    }

    @PluginMethod
    public void getAuthConfig(PluginCall call) {
        String authKey = MobileShellConfig.getStoredAuthKey(getContext());
        JSObject result = new JSObject();
        result.put("authKey", authKey);
        result.put("hasAuthKey", !authKey.isEmpty());
        call.resolve(result);
    }

    @PluginMethod
    public void setAuthKey(PluginCall call) {
        String authKey = call.getString("authKey", "");
        authKey = authKey == null ? "" : authKey.trim();
        if (authKey.isEmpty()) {
            call.reject("密钥不能为空");
            return;
        }

        MobileShellConfig.getPreferences(getContext())
            .edit()
            .putString(MobileShellConfig.PREF_AUTH_KEY, authKey)
            .apply();

        JSObject result = new JSObject();
        result.put("hasAuthKey", true);
        call.resolve(result);
    }

    @PluginMethod
    public void clearAuthKey(PluginCall call) {
        MobileShellConfig.getPreferences(getContext())
            .edit()
            .remove(MobileShellConfig.PREF_AUTH_KEY)
            .apply();

        JSObject result = new JSObject();
        result.put("hasAuthKey", false);
        call.resolve(result);
    }

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            PackageManager packageManager = getContext().getPackageManager();
            String packageName = getContext().getPackageName();
            PackageInfo packageInfo;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageInfo = packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0));
            } else {
                packageInfo = packageManager.getPackageInfo(packageName, 0);
            }

            long versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? packageInfo.getLongVersionCode()
                : packageInfo.versionCode;
            String appName = String.valueOf(packageManager.getApplicationLabel(getContext().getApplicationInfo()));
            boolean canRequestInstall = Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || packageManager.canRequestPackageInstalls();

            JSObject result = new JSObject();
            result.put("appName", appName);
            result.put("packageName", packageName);
            result.put("versionName", packageInfo.versionName == null ? "" : packageInfo.versionName);
            result.put("versionCode", versionCode);
            result.put("canRequestPackageInstalls", canRequestInstall);
            call.resolve(result);
        } catch (PackageManager.NameNotFoundException exception) {
            call.reject("读取 App 版本信息失败", exception);
        }
    }

    @PluginMethod
    public void getRuntimeInfo(PluginCall call) {
        JSObject result = new JSObject();
        NetworkSnapshot networkSnapshot = getNetworkSnapshot();
        result.put("connected", networkSnapshot.connected);
        result.put("validated", networkSnapshot.validated);
        result.put("metered", networkSnapshot.metered);
        result.put("transport", networkSnapshot.transport);
        result.put("powerSaveMode", isPowerSaveMode());
        result.put("sdkInt", Build.VERSION.SDK_INT);
        result.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        result.put("model", Build.MODEL == null ? "" : Build.MODEL);

        PackageInfo webViewPackage = getWebViewPackage();
        result.put("webViewPackage", webViewPackage == null ? "" : webViewPackage.packageName);
        result.put("webViewVersion", webViewPackage == null || webViewPackage.versionName == null ? "" : webViewPackage.versionName);
        call.resolve(result);
    }

    @PluginMethod
    public void getTaskPetStatus(PluginCall call) {
        boolean enabled = MobileShellConfig.getPreferences(getContext())
            .getBoolean(MobileShellConfig.PREF_TASK_PET_ENABLED, false);
        boolean canDrawOverlays = Settings.canDrawOverlays(getContext());
        if (enabled && canDrawOverlays && !TaskPetOverlayService.isRunning()) {
            TaskPetOverlayService.startOrUpdate(getContext(), null, null, null);
        }
        call.resolve(buildTaskPetStatus(enabled, canDrawOverlays));
    }

    @PluginMethod
    public void setTaskPetEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        String serverUrl = MobileShellConfig.normalizeServerUrl(call.getString("serverUrl", ""));
        String tasksJson = call.getString("tasksJson", "[]");
        if (tasksJson == null) tasksJson = "[]";
        String recentThreadsJson = call.getString("recentThreadsJson", "[]");
        if (recentThreadsJson == null) recentThreadsJson = "[]";

        MobileShellConfig.getPreferences(getContext()).edit()
            .putBoolean(MobileShellConfig.PREF_TASK_PET_ENABLED, enabled)
            .putString(MobileShellConfig.PREF_TASK_PET_SERVER_URL, serverUrl)
            .putString(MobileShellConfig.PREF_TASK_PET_ACTIVE_TASKS_JSON, tasksJson)
            .putString(MobileShellConfig.PREF_TASK_PET_RECENT_THREADS_JSON, recentThreadsJson)
            .apply();

        boolean canDrawOverlays = Settings.canDrawOverlays(getContext());
        if (!enabled) {
            TaskPetOverlayService.stop(getContext());
        } else if (canDrawOverlays) {
            TaskPetOverlayService.startOrUpdate(getContext(), serverUrl, tasksJson, recentThreadsJson);
        } else {
            try {
                Intent settingsIntent = new Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName())
                );
                settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(settingsIntent);
            } catch (Exception exception) {
                call.reject("无法打开悬浮窗权限设置", exception);
                return;
            }
        }
        call.resolve(buildTaskPetStatus(enabled, canDrawOverlays));
    }

    @PluginMethod
    public void updateTaskPet(PluginCall call) {
        String serverUrl = MobileShellConfig.normalizeServerUrl(call.getString("serverUrl", ""));
        String tasksJson = call.getString("tasksJson", "[]");
        if (tasksJson == null) tasksJson = "[]";
        String recentThreadsJson = call.getString("recentThreadsJson", "[]");
        if (recentThreadsJson == null) recentThreadsJson = "[]";
        MobileShellConfig.getPreferences(getContext()).edit()
            .putString(MobileShellConfig.PREF_TASK_PET_SERVER_URL, serverUrl)
            .putString(MobileShellConfig.PREF_TASK_PET_ACTIVE_TASKS_JSON, tasksJson)
            .putString(MobileShellConfig.PREF_TASK_PET_RECENT_THREADS_JSON, recentThreadsJson)
            .apply();

        boolean enabled = MobileShellConfig.getPreferences(getContext())
            .getBoolean(MobileShellConfig.PREF_TASK_PET_ENABLED, false);
        boolean canDrawOverlays = Settings.canDrawOverlays(getContext());
        if (enabled && canDrawOverlays) {
            TaskPetOverlayService.startOrUpdate(getContext(), serverUrl, tasksJson, recentThreadsJson);
        }
        call.resolve(buildTaskPetStatus(enabled, canDrawOverlays));
    }

    @PluginMethod
    public void markTaskPetThreadRead(PluginCall call) {
        String threadId = call.getString("threadId", "");
        if (threadId == null || threadId.trim().isEmpty()) {
            call.reject("缺少会话标识");
            return;
        }
        TaskPetOverlayService.markThreadRead(getContext(), threadId);
        call.resolve();
    }

    private JSObject buildTaskPetStatus(boolean enabled, boolean canDrawOverlays) {
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        result.put("showing", enabled && canDrawOverlays && TaskPetOverlayService.isRunning());
        result.put("canDrawOverlays", canDrawOverlays);
        result.put("permissionRequired", enabled && !canDrawOverlays);
        return result;
    }

    @PluginMethod
    public void getDictationStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_MICROPHONE));
        result.put("permissionGranted", getPermissionState("microphone") == PermissionState.GRANTED);
        result.put("speechServiceAvailable", SpeechRecognizer.isRecognitionAvailable(getContext()));
        result.put(
            "onDeviceAvailable",
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext())
        );
        call.resolve(result);
    }

    @PluginMethod
    public void startDictation(PluginCall call) {
        if (!getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_MICROPHONE)) {
            call.reject("此设备没有可用的麦克风");
            return;
        }
        if (activeDictationCall != null) {
            call.reject("语音听写正在进行中");
            return;
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "startDictationAfterPermission");
            return;
        }
        beginDictation(call);
    }

    @PermissionCallback
    private void startDictationAfterPermission(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("麦克风权限被拒绝");
            return;
        }
        beginDictation(call);
    }

    @PluginMethod
    public void stopDictation(PluginCall call) {
        mainHandler.post(() -> {
            if (dictationRecorder == null || activeDictationCall == null) {
                JSObject result = new JSObject();
                result.put("stopping", false);
                call.resolve(result);
                return;
            }
            JSObject result = new JSObject();
            result.put("stopping", true);
            call.resolve(result);
            finishDictationRecording();
        });
    }

    @PluginMethod
    public void cancelDictation(PluginCall call) {
        mainHandler.post(() -> {
            rejectActiveDictation("已取消听写");
            call.resolve();
        });
    }

    private void beginDictation(PluginCall call) {
        mainHandler.post(() -> {
            if (activeDictationCall != null) {
                call.reject("语音听写正在进行中");
                return;
            }
            if (!getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_MICROPHONE)) {
                call.reject("此设备没有可用的麦克风");
                return;
            }

            try {
                File audioFile = File.createTempFile("cx-codex-dictation-", ".m4a", getContext().getCacheDir());
                MediaRecorder recorder = new MediaRecorder();
                recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
                recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                recorder.setAudioEncodingBitRate(64_000);
                recorder.setMaxDuration(DICTATION_MAX_DURATION_MS);
                recorder.setOutputFile(audioFile.getAbsolutePath());
                recorder.setOnInfoListener((ignored, what, extra) -> {
                    if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) {
                        mainHandler.post(this::finishDictationRecording);
                    }
                });
                dictationRecorder = recorder;
                dictationAudioFile = audioFile;
                recorder.prepare();
                recorder.start();

                activeDictationCall = call;
            } catch (Exception exception) {
                releaseDictationRecorder(false);
                call.reject("麦克风录音启动失败：" + exception.getMessage(), exception);
            }
        });
    }

    private void finishDictationRecording() {
        PluginCall call = activeDictationCall;
        if (call == null) return;

        File audioFile = dictationAudioFile;
        try {
            if (dictationRecorder == null || audioFile == null) {
                throw new IOException("录音文件不可用");
            }
            dictationRecorder.stop();
            releaseDictationRecorder(true);
            if (!audioFile.isFile() || audioFile.length() <= 0) {
                throw new IOException("没有录到有效语音");
            }

            byte[] bytes = readFileBytes(audioFile);
            JSObject result = new JSObject();
            result.put("text", "");
            result.put("audioBase64", Base64.encodeToString(bytes, Base64.NO_WRAP));
            result.put("mimeType", "audio/mp4");
            result.put("fileName", "dictation.m4a");
            call.resolve(result);
        } catch (Exception exception) {
            releaseDictationRecorder(false);
            call.reject("录音结束失败，请重新说一次：" + exception.getMessage(), exception);
        } finally {
            activeDictationCall = null;
            if (audioFile != null) {
                audioFile.delete();
            }
        }
    }

    private void rejectActiveDictation(String message) {
        PluginCall call = activeDictationCall;
        activeDictationCall = null;
        releaseDictationRecorder(false);
        if (call != null) {
            call.reject(message);
        }
    }

    private void releaseDictationRecorder(boolean alreadyStopped) {
        if (dictationRecorder != null) {
            if (!alreadyStopped) {
                try {
                    dictationRecorder.reset();
                } catch (Exception ignored) {
                    // Best-effort cleanup for a recorder that failed during startup.
                }
            }
            dictationRecorder.release();
            dictationRecorder = null;
        }
        if (dictationAudioFile != null && dictationAudioFile.isFile() && !alreadyStopped) {
            dictationAudioFile.delete();
        }
        dictationAudioFile = null;
    }

    private static byte[] readFileBytes(File file) throws IOException {
        long length = file.length();
        if (length <= 0 || length > Integer.MAX_VALUE) {
            throw new IOException("录音文件大小异常");
        }
        byte[] bytes = new byte[(int) length];
        try (InputStream input = new java.io.FileInputStream(file)) {
            int offset = 0;
            while (offset < bytes.length) {
                int read = input.read(bytes, offset, bytes.length - offset);
                if (read < 0) break;
                offset += read;
            }
            if (offset != bytes.length) {
                throw new IOException("录音文件读取不完整");
            }
        }
        return bytes;
    }

    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        mainHandler.post(() -> {
            if (getActivity() == null) {
                call.reject("当前 Activity 不可用，无法更新屏幕保持策略");
                return;
            }

            Window window = getActivity().getWindow();
            if (enabled) {
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }

            JSObject result = new JSObject();
            result.put("enabled", enabled);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String incomingUrl = call.getString("url", "");
        String url = incomingUrl == null ? "" : incomingUrl.trim();
        if (!isValidOpenUrl(url)) {
            call.reject("链接地址无效");
            return;
        }

        mainHandler.post(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                JSObject result = new JSObject();
                result.put("opened", true);
                call.resolve(result);
            } catch (Exception exception) {
                call.reject("打开链接失败：" + exception.getMessage(), exception);
            }
        });
    }

    @PluginMethod
    public void performHapticFeedback(PluginCall call) {
        String style = call.getString("style", "light");
        mainHandler.post(() -> {
            if (getActivity() == null) {
                JSObject result = new JSObject();
                result.put("performed", false);
                result.put("style", style);
                call.resolve(result);
                return;
            }

            View decorView = getActivity().getWindow().getDecorView();
            boolean performed = decorView.performHapticFeedback(resolveHapticConstant(style));
            JSObject result = new JSObject();
            result.put("performed", performed);
            result.put("style", style);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void getNotificationPermissionStatus(PluginCall call) {
        call.resolve(buildNotificationPermissionResult(false));
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || hasNotificationPermission()) {
            call.resolve(buildNotificationPermissionResult(false));
            return;
        }

        if (getActivity() == null) {
            call.reject("当前 Activity 不可用，无法请求通知权限");
            return;
        }

        ActivityCompat.requestPermissions(
            getActivity(),
            new String[] { Manifest.permission.POST_NOTIFICATIONS },
            NOTIFICATION_PERMISSION_REQUEST_CODE
        );
        call.resolve(buildNotificationPermissionResult(true));
    }

    @PluginMethod
    public void showNotification(PluginCall call) {
        String title = normalizeNotificationText(call.getString("title", "CX-Codex"), "CX-Codex");
        String body = normalizeNotificationText(call.getString("body", ""), "");
        String type = normalizeNotificationText(call.getString("type", "status"), "status");
        Integer incomingId = call.getInt("notificationId");
        int notificationId = incomingId == null || incomingId <= 0
            ? (int) (System.currentTimeMillis() % Integer.MAX_VALUE)
            : incomingId;

        if (!hasNotificationPermission()) {
            JSObject result = new JSObject();
            result.put("shown", false);
            result.put("reason", "permission_denied");
            result.put("notificationId", notificationId);
            call.resolve(result);
            return;
        }

        try {
            ensureTaskNotificationChannel();
            Intent launchIntent = new Intent(getContext(), MainActivity.class);
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent contentIntent = PendingIntent.getActivity(
                getContext(),
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), TASK_NOTIFICATION_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setPriority(resolveNotificationPriority(type));

            NotificationManagerCompat.from(getContext()).notify(notificationId, builder.build());

            JSObject result = new JSObject();
            result.put("shown", true);
            result.put("reason", "");
            result.put("notificationId", notificationId);
            call.resolve(result);
        } catch (SecurityException exception) {
            JSObject result = new JSObject();
            result.put("shown", false);
            result.put("reason", "permission_denied");
            result.put("notificationId", notificationId);
            call.resolve(result);
        } catch (Exception exception) {
            call.reject("发送通知失败：" + exception.getMessage(), exception);
        }
    }

    @PluginMethod
    public void installApkFromUrl(PluginCall call) {
        String downloadUrl = MobileShellConfig.normalizeServerUrl(call.getString("url", ""));
        if (!isValidDownloadUrl(downloadUrl)) {
            call.reject("更新包地址无效，请检查 GitHub 发布配置");
            return;
        }

        if (!hasActiveNetworkConnection()) {
            call.reject("当前没有可用网络，请先连接互联网后再更新");
            return;
        }

        String fileName = sanitizeFileName(call.getString("fileName", ""));
        if (fileName.isEmpty()) {
            fileName = "cx-codex-update.apk";
        }
        if (!fileName.toLowerCase(Locale.ROOT).endsWith(".apk")) {
            fileName = fileName + ".apk";
        }

        final String resolvedFileName = fileName;
        new Thread(() -> downloadAndInstallApk(call, downloadUrl, resolvedFileName)).start();
    }

    @PluginMethod
    public void openFileFromUrl(PluginCall call) {
        String downloadUrl = MobileShellConfig.normalizeServerUrl(call.getString("url", ""));
        if (!isValidDownloadUrl(downloadUrl)) {
            call.reject("文件地址无效，请检查链接");
            return;
        }

        if (!hasActiveNetworkConnection()) {
            call.reject("当前没有可用网络，无法打开文件");
            return;
        }

        String mimeType = normalizeMimeType(call.getString("mimeType", ""));
        String operationId = normalizeOperationId(call.getString("operationId", ""));
        String fileName = sanitizeFileName(call.getString("fileName", ""));
        if (fileName.isEmpty()) {
            fileName = sanitizeFileName(URLUtil.guessFileName(downloadUrl, null, mimeType));
        }
        if (fileName.isEmpty()) {
            fileName = "cx-codex-file";
        }

        final String resolvedFileName = fileName;
        final String resolvedMimeType = mimeType;
        final String resolvedOperationId = operationId;
        JSObject result = new JSObject();
        result.put("status", "started");
        result.put("fileName", resolvedFileName);
        result.put("mimeType", resolvedMimeType);
        result.put("operationId", resolvedOperationId);
        call.resolve(result);
        mainHandler.post(() -> showToast("正在后台准备打开：" + resolvedFileName));
        new Thread(() -> downloadAndOpenFile(downloadUrl, resolvedFileName, resolvedMimeType, resolvedOperationId)).start();
    }

    @PluginMethod
    public void downloadFileFromUrl(PluginCall call) {
        String downloadUrl = MobileShellConfig.normalizeServerUrl(call.getString("url", ""));
        if (!isValidDownloadUrl(downloadUrl)) {
            call.reject("文件地址无效，请检查链接");
            return;
        }

        if (!hasActiveNetworkConnection()) {
            call.reject("当前没有可用网络，无法下载文件");
            return;
        }

        String mimeType = normalizeMimeType(call.getString("mimeType", ""));
        String operationId = normalizeOperationId(call.getString("operationId", ""));
        String fileName = sanitizeFileName(call.getString("fileName", ""));
        if (fileName.isEmpty()) {
            fileName = sanitizeFileName(URLUtil.guessFileName(downloadUrl, null, mimeType));
        }
        if (fileName.isEmpty()) {
            fileName = "cx-codex-file";
        }

        final String resolvedFileName = fileName;
        final String resolvedMimeType = mimeType;
        final String resolvedOperationId = operationId;
        JSObject result = new JSObject();
        result.put("status", "started");
        result.put("fileName", resolvedFileName);
        result.put("mimeType", resolvedMimeType);
        result.put("operationId", resolvedOperationId);
        call.resolve(result);
        mainHandler.post(() -> showToast("正在后台下载：" + resolvedFileName));
        new Thread(() -> downloadFileToDownloads(downloadUrl, resolvedFileName, resolvedMimeType, resolvedOperationId)).start();
    }

    private void downloadAndInstallApk(PluginCall call, String downloadUrl, String fileName) {
        HttpURLConnection connection = null;
        File targetDirectory = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (targetDirectory == null) {
            targetDirectory = new File(getContext().getFilesDir(), "updates");
        }
        if (!targetDirectory.exists() && !targetDirectory.mkdirs()) {
            File finalTargetDirectory = targetDirectory;
            mainHandler.post(() -> call.reject("下载更新失败：无法创建更新目录 " + finalTargetDirectory.getAbsolutePath()));
            return;
        }

        File targetFile = new File(targetDirectory, fileName);
        File tempFile = new File(targetDirectory, fileName + ".download");
        try {
            if (targetFile.exists() && !targetFile.delete()) {
                throw new IOException("无法覆盖旧的更新安装包");
            }
            if (tempFile.exists() && !tempFile.delete()) {
                throw new IOException("无法清理旧的临时更新包");
            }

            connection = (HttpURLConnection) new URL(downloadUrl).openConnection();
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive,application/octet-stream,*/*");
            connection.setRequestProperty("User-Agent", "CX-Codex-Android-Updater");
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(true);
            connection.connect();

            int statusCode = connection.getResponseCode();
            if (statusCode < 200 || statusCode >= 300) {
                throw new IOException("HTTP " + statusCode);
            }

            long expectedLength = connection.getContentLengthLong();
            long totalBytes = 0L;
            try (InputStream inputStream = connection.getInputStream();
                 OutputStream outputStream = new FileOutputStream(tempFile)) {
                byte[] buffer = new byte[16 * 1024];
                int readLength;
                while ((readLength = inputStream.read(buffer)) != -1) {
                    outputStream.write(buffer, 0, readLength);
                    totalBytes += readLength;
                }
                outputStream.flush();
            }

            if (totalBytes <= 0) {
                throw new IOException("下载内容为空");
            }
            if (expectedLength > 0 && totalBytes < expectedLength) {
                throw new IOException("更新包下载不完整");
            }
            if (!tempFile.renameTo(targetFile)) {
                throw new IOException("无法写入更新安装包");
            }

            File apkFile = targetFile;
            mainHandler.post(() -> {
                try {
                    if (requiresUnknownAppsPermission(getContext())) {
                        rememberPendingApkInstall(getContext(), apkFile);
                        openUnknownAppsSettings(getContext());
                        showToast("更新包已下载，请允许安装未知应用后返回 CX-Codex");
                        JSObject result = new JSObject();
                        result.put("status", "permission_required");
                        result.put("fileName", fileName);
                        result.put("savedPath", apkFile.getAbsolutePath());
                        call.resolve(result);
                        return;
                    }

                    openInstallIntent(getContext(), apkFile);
                    clearPendingApkInstall(getContext());
                    JSObject result = new JSObject();
                    result.put("status", "started");
                    result.put("fileName", fileName);
                    result.put("savedPath", apkFile.getAbsolutePath());
                    call.resolve(result);
                } catch (Exception exception) {
                    call.reject("拉起安装界面失败：" + exception.getMessage(), exception);
                }
            });
        } catch (Exception exception) {
            Exception resolvedException = exception instanceof Exception ? (Exception) exception : new Exception(exception);
            mainHandler.post(() -> call.reject("下载更新失败：" + resolvedException.getMessage(), resolvedException));
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private void downloadAndOpenFile(String downloadUrl, String fileName, String requestedMimeType, String operationId) {
        HttpURLConnection connection = null;
        File targetDirectory = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (targetDirectory == null) {
            targetDirectory = new File(getContext().getFilesDir(), "downloads");
        }
        if (!targetDirectory.exists() && !targetDirectory.mkdirs()) {
            File finalTargetDirectory = targetDirectory;
            mainHandler.post(() -> {
                emitFileOperationStatus(operationId, "open", "failed", "打开文件失败：无法创建下载目录 " + finalTargetDirectory.getAbsolutePath(), fileName);
                notifyFileOperationFailed("打开文件失败：无法创建下载目录 " + finalTargetDirectory.getAbsolutePath());
            });
            return;
        }

        File targetFile = new File(targetDirectory, fileName);
        File tempFile = new File(targetDirectory, fileName + ".download");
        try {
            if (targetFile.exists() && !targetFile.delete()) {
                throw new IOException("无法覆盖旧文件");
            }
            if (tempFile.exists() && !tempFile.delete()) {
                throw new IOException("无法清理旧临时文件");
            }

            connection = openVerifiedFileConnection(
                downloadUrl,
                buildFileAcceptHeader(requestedMimeType),
                "CX-Codex-Android-FileOpener",
                fileName,
                requestedMimeType
            );

            long expectedLength = connection.getContentLengthLong();
            long totalBytes = 0L;
            try (InputStream inputStream = connection.getInputStream();
                 OutputStream outputStream = new FileOutputStream(tempFile)) {
                byte[] buffer = new byte[16 * 1024];
                int readLength;
                while ((readLength = inputStream.read(buffer)) != -1) {
                    outputStream.write(buffer, 0, readLength);
                    totalBytes += readLength;
                }
                outputStream.flush();
            }

            if (totalBytes <= 0) {
                throw new IOException("下载内容为空");
            }
            if (expectedLength > 0 && totalBytes < expectedLength) {
                throw new IOException("文件下载不完整");
            }
            if (!tempFile.renameTo(targetFile)) {
                throw new IOException("无法写入下载文件");
            }

            String responseMimeType = normalizeMimeType(connection.getContentType());
            String resolvedMimeType = resolveFileMimeType(fileName, requestedMimeType, responseMimeType);
            File openedFile = targetFile;
            mainHandler.post(() -> {
                try {
                    openFileIntent(openedFile, resolvedMimeType);
                    showToast("已交给系统应用打开：" + fileName);
                    emitFileOperationStatus(operationId, "open", "completed", "已交给系统应用打开：" + fileName, fileName);
                } catch (ActivityNotFoundException exception) {
                    emitFileOperationStatus(operationId, "open", "failed", "没有找到可打开此文件的应用，文件已保存到：" + openedFile.getAbsolutePath(), fileName);
                    notifyFileOperationFailed("没有找到可打开此文件的应用，文件已保存到：" + openedFile.getAbsolutePath());
                } catch (Exception exception) {
                    emitFileOperationStatus(operationId, "open", "failed", "打开文件失败：" + exception.getMessage(), fileName);
                    notifyFileOperationFailed("打开文件失败：" + exception.getMessage());
                }
            });
        } catch (Exception exception) {
            Exception resolvedException = exception instanceof Exception ? (Exception) exception : new Exception(exception);
            mainHandler.post(() -> {
                emitFileOperationStatus(operationId, "open", "failed", "打开文件失败：" + resolvedException.getMessage(), fileName);
                notifyFileOperationFailed("打开文件失败：" + resolvedException.getMessage());
            });
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private void downloadFileToDownloads(String downloadUrl, String fileName, String requestedMimeType, String operationId) {
        HttpURLConnection connection = null;
        Uri mediaStoreUri = null;
        boolean mediaStorePending = false;
        File tempFile = null;
        try {
            connection = openVerifiedFileConnection(
                downloadUrl,
                buildFileAcceptHeader(requestedMimeType),
                "CX-Codex-Android-FileDownloader",
                fileName,
                requestedMimeType
            );

            long expectedLength = connection.getContentLengthLong();
            String responseMimeType = normalizeMimeType(connection.getContentType());
            String resolvedMimeType = resolveFileMimeType(fileName, requestedMimeType, responseMimeType);
            long totalBytes;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = getContext().getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                values.put(MediaStore.Downloads.MIME_TYPE, resolvedMimeType);
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                mediaStoreUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (mediaStoreUri == null) {
                    throw new IOException("无法创建系统下载文件");
                }
                mediaStorePending = true;
                try (InputStream inputStream = connection.getInputStream();
                     OutputStream outputStream = resolver.openOutputStream(mediaStoreUri)) {
                    if (outputStream == null) {
                        throw new IOException("无法写入系统下载文件");
                    }
                    totalBytes = copyStream(inputStream, outputStream);
                }
                verifyDownloadedBytes(totalBytes, expectedLength);
                ContentValues completeValues = new ContentValues();
                completeValues.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(mediaStoreUri, completeValues, null, null);
                mediaStorePending = false;
            } else {
                File targetDirectory = canWriteLegacyPublicDownloads()
                    ? Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    : getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (targetDirectory == null) {
                    targetDirectory = new File(getContext().getFilesDir(), "downloads");
                }
                if (!targetDirectory.exists() && !targetDirectory.mkdirs()) {
                    throw new IOException("无法创建下载目录 " + targetDirectory.getAbsolutePath());
                }
                File targetFile = createUniqueFile(targetDirectory, fileName);
                tempFile = new File(targetDirectory, targetFile.getName() + ".download");
                if (tempFile.exists() && !tempFile.delete()) {
                    throw new IOException("无法清理旧临时文件");
                }
                try (InputStream inputStream = connection.getInputStream();
                     OutputStream outputStream = new FileOutputStream(tempFile)) {
                    totalBytes = copyStream(inputStream, outputStream);
                }
                verifyDownloadedBytes(totalBytes, expectedLength);
                if (!tempFile.renameTo(targetFile)) {
                    throw new IOException("无法写入下载文件");
                }
            }

            mainHandler.post(() -> {
                showToast("已保存到下载目录：" + fileName);
                emitFileOperationStatus(operationId, "download", "completed", "已保存到下载目录：" + fileName, fileName);
                notifyFileOperationCompleted("已保存到下载目录", fileName);
            });
        } catch (Exception exception) {
            if (mediaStoreUri != null && mediaStorePending) {
                try {
                    getContext().getContentResolver().delete(mediaStoreUri, null, null);
                } catch (Exception ignored) {
                    // Best effort cleanup only.
                }
            }
            if (tempFile != null && tempFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                tempFile.delete();
            }
            Exception resolvedException = exception instanceof Exception ? (Exception) exception : new Exception(exception);
            mainHandler.post(() -> {
                emitFileOperationStatus(operationId, "download", "failed", "下载文件失败：" + resolvedException.getMessage(), fileName);
                notifyFileOperationFailed("下载文件失败：" + resolvedException.getMessage());
            });
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static long copyStream(InputStream inputStream, OutputStream outputStream) throws IOException {
        long totalBytes = 0L;
        byte[] buffer = new byte[16 * 1024];
        int readLength;
        while ((readLength = inputStream.read(buffer)) != -1) {
            outputStream.write(buffer, 0, readLength);
            totalBytes += readLength;
        }
        outputStream.flush();
        return totalBytes;
    }

    private static void verifyDownloadedBytes(long totalBytes, long expectedLength) throws IOException {
        if (totalBytes <= 0) {
            throw new IOException("下载内容为空");
        }
        if (expectedLength > 0 && totalBytes < expectedLength) {
            throw new IOException("文件下载不完整");
        }
    }

    private static File createUniqueFile(File directory, String fileName) {
        File candidate = new File(directory, fileName);
        if (!candidate.exists()) {
            return candidate;
        }

        String baseName = fileName;
        String extension = "";
        int dotIndex = fileName.lastIndexOf('.');
        if (dotIndex > 0 && dotIndex < fileName.length() - 1) {
            baseName = fileName.substring(0, dotIndex);
            extension = fileName.substring(dotIndex);
        }
        for (int index = 1; index < 1000; index += 1) {
            candidate = new File(directory, baseName + " (" + index + ")" + extension);
            if (!candidate.exists()) {
                return candidate;
            }
        }
        return new File(directory, baseName + "-" + System.currentTimeMillis() + extension);
    }

    private boolean canWriteLegacyPublicDownloads() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return true;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }
        return ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.WRITE_EXTERNAL_STORAGE)
            == PackageManager.PERMISSION_GRANTED;
    }

    private NetworkSnapshot getNetworkSnapshot() {
        ConnectivityManager connectivityManager =
            (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivityManager == null) {
            return new NetworkSnapshot(true, false, false, "unknown");
        }

        Network network = connectivityManager.getActiveNetwork();
        boolean metered = connectivityManager.isActiveNetworkMetered();
        if (network == null) {
            return new NetworkSnapshot(false, false, metered, "none");
        }

        NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(network);
        if (capabilities == null) {
            return new NetworkSnapshot(false, false, metered, "unknown");
        }

        boolean connected = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        boolean validated = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        return new NetworkSnapshot(connected, validated, metered, resolveTransport(capabilities));
    }

    private boolean hasActiveNetworkConnection() {
        ConnectivityManager connectivityManager =
            (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivityManager == null) {
            return true;
        }
        Network network = connectivityManager.getActiveNetwork();
        if (network == null) {
            return false;
        }
        NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(network);
        return capabilities != null
            && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private boolean isPowerSaveMode() {
        PowerManager powerManager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return powerManager != null && powerManager.isPowerSaveMode();
    }

    private JSObject buildNotificationPermissionResult(boolean requested) {
        JSObject result = new JSObject();
        result.put("granted", hasNotificationPermission());
        result.put("requested", requested);
        result.put("requiresRuntimePermission", Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU);
        result.put("notificationsEnabled", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        return result;
    }

    private boolean hasNotificationPermission() {
        if (!NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) {
            return false;
        }
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || getContext().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private void ensureTaskNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager notificationManager =
            (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationManager == null) {
            return;
        }

        NotificationChannel existing = notificationManager.getNotificationChannel(TASK_NOTIFICATION_CHANNEL_ID);
        if (existing != null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            TASK_NOTIFICATION_CHANNEL_ID,
            TASK_NOTIFICATION_CHANNEL_NAME,
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("任务完成、等待确认和异常提醒");
        notificationManager.createNotificationChannel(channel);
    }

    private static int resolveNotificationPriority(String type) {
        String normalizedType = type == null ? "status" : type.trim().toLowerCase(Locale.ROOT);
        if ("error".equals(normalizedType) || "request".equals(normalizedType)) {
            return NotificationCompat.PRIORITY_HIGH;
        }
        return NotificationCompat.PRIORITY_DEFAULT;
    }

    private static String normalizeNotificationText(String value, String fallback) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty()) {
            return fallback;
        }
        return normalized.length() > 240 ? normalized.substring(0, 240) : normalized;
    }

    private PackageInfo getWebViewPackage() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return null;
        }
        try {
            return WebView.getCurrentWebViewPackage();
        } catch (Exception exception) {
            return null;
        }
    }

    private static String resolveTransport(NetworkCapabilities capabilities) {
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "wifi";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "cellular";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "ethernet";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return "vpn";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH)) return "bluetooth";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_USB)) return "usb";
        return "unknown";
    }

    private static int resolveHapticConstant(String style) {
        String normalizedStyle = style == null ? "light" : style.trim().toLowerCase(Locale.ROOT);
        if ("heavy".equals(normalizedStyle)) return HapticFeedbackConstants.LONG_PRESS;
        if ("warning".equals(normalizedStyle)) {
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? HapticFeedbackConstants.REJECT
                : HapticFeedbackConstants.LONG_PRESS;
        }
        if ("success".equals(normalizedStyle)) {
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? HapticFeedbackConstants.CONFIRM
                : HapticFeedbackConstants.CONTEXT_CLICK;
        }
        if ("medium".equals(normalizedStyle)) return HapticFeedbackConstants.CONTEXT_CLICK;
        return HapticFeedbackConstants.KEYBOARD_TAP;
    }

    private static String buildFileAcceptHeader(String mimeType) {
        String normalizedMimeType = normalizeMimeType(mimeType);
        if (normalizedMimeType.isEmpty()) {
            return "application/octet-stream,*/*";
        }
        return normalizedMimeType + ",application/octet-stream,*/*";
    }

    private static String normalizeMimeType(String value) {
        String normalized = value == null ? "" : value.trim();
        int separatorIndex = normalized.indexOf(';');
        if (separatorIndex >= 0) {
            normalized = normalized.substring(0, separatorIndex).trim();
        }
        if (normalized.isEmpty() || normalized.equalsIgnoreCase("null")) {
            return "";
        }
        return normalized.toLowerCase(Locale.ROOT);
    }

    private static String resolveFileMimeType(String fileName, String requestedMimeType, String responseMimeType) {
        String requested = normalizeMimeType(requestedMimeType);
        if (!requested.isEmpty() && !requested.equals("application/octet-stream")) {
            return requested;
        }
        String response = normalizeMimeType(responseMimeType);
        if (!response.isEmpty() && !response.equals("application/octet-stream")) {
            return response;
        }

        String extension = "";
        int dotIndex = fileName == null ? -1 : fileName.lastIndexOf('.');
        if (dotIndex >= 0 && dotIndex < fileName.length() - 1) {
            extension = fileName.substring(dotIndex + 1).toLowerCase(Locale.ROOT);
        }
        switch (extension) {
            case "doc": return "application/msword";
            case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case "xls": return "application/vnd.ms-excel";
            case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            case "ppt": return "application/vnd.ms-powerpoint";
            case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
            case "pdf": return "application/pdf";
            case "rtf": return "application/rtf";
            case "txt": return "text/plain";
            case "md": return "text/markdown";
            default: return "application/octet-stream";
        }
    }

    private HttpURLConnection openVerifiedFileConnection(
        String downloadUrl,
        String acceptHeader,
        String userAgent,
        String fileName,
        String requestedMimeType
    ) throws IOException {
        ensureWebAuthCookie(downloadUrl);

        HttpURLConnection connection = openFileConnection(downloadUrl, acceptHeader, userAgent);
        verifyFileConnection(connection, fileName, requestedMimeType);
        if (!isUnexpectedHtmlFileResponse(connection, fileName, requestedMimeType)) {
            return connection;
        }

        connection.disconnect();
        if (performWebAuthLogin(downloadUrl)) {
            connection = openFileConnection(downloadUrl, acceptHeader, userAgent);
            verifyFileConnection(connection, fileName, requestedMimeType);
            if (!isUnexpectedHtmlFileResponse(connection, fileName, requestedMimeType)) {
                return connection;
            }
            connection.disconnect();
        }

        throw new IOException("登录状态已失效，请在 CX-Codex 内重新登录后再打开文件");
    }

    private HttpURLConnection openFileConnection(String downloadUrl, String acceptHeader, String userAgent) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(downloadUrl).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestProperty("Accept", acceptHeader);
        connection.setRequestProperty("User-Agent", userAgent);
        String cookies = CookieManager.getInstance().getCookie(downloadUrl);
        if (cookies != null && !cookies.isEmpty()) {
            connection.setRequestProperty("Cookie", cookies);
        }
        connection.setUseCaches(false);
        connection.setInstanceFollowRedirects(true);
        connection.connect();
        return connection;
    }

    private void verifyFileConnection(HttpURLConnection connection, String fileName, String requestedMimeType) throws IOException {
        int statusCode = connection.getResponseCode();
        if (statusCode == HttpURLConnection.HTTP_UNAUTHORIZED || statusCode == HttpURLConnection.HTTP_FORBIDDEN) {
            throw new IOException("登录状态已失效，请重新登录后再试");
        }
        if (statusCode < 200 || statusCode >= 300) {
            throw new IOException("HTTP " + statusCode);
        }
        if (isUnexpectedHtmlFileResponse(connection, fileName, requestedMimeType)) {
            return;
        }
    }

    private boolean isUnexpectedHtmlFileResponse(HttpURLConnection connection, String fileName, String requestedMimeType) {
        String responseMimeType = normalizeMimeType(connection.getContentType());
        if (!responseMimeType.contains("text/html")) {
            return false;
        }
        String expectedMimeType = resolveFileMimeType(fileName, requestedMimeType, "");
        return !expectedMimeType.equals("text/html") && !expectedMimeType.equals("application/octet-stream");
    }

    public static void ensureWebAuthCookie(Context context, String downloadUrl) {
        if (context == null) {
            return;
        }
        String cookies = CookieManager.getInstance().getCookie(downloadUrl);
        if (cookies != null && cookies.contains("codex_web_local_token=")) {
            return;
        }
        performWebAuthLogin(context, downloadUrl);
    }

    private void ensureWebAuthCookie(String downloadUrl) {
        ensureWebAuthCookie(getContext(), downloadUrl);
    }

    private boolean performWebAuthLogin(String downloadUrl) {
        return performWebAuthLogin(getContext(), downloadUrl);
    }

    private static boolean performWebAuthLogin(Context context, String downloadUrl) {
        if (context == null) {
            return false;
        }
        String authKey = MobileShellConfig.getStoredAuthKey(context);
        if (authKey.isEmpty()) {
            return false;
        }

        HttpURLConnection loginConnection = null;
        try {
            URL fileUrl = new URL(downloadUrl);
            String origin = fileUrl.getProtocol() + "://" + fileUrl.getHost();
            if (fileUrl.getPort() >= 0) {
                origin += ":" + fileUrl.getPort();
            }
            URL loginUrl = new URL(origin + "/auth/login");
            loginConnection = (HttpURLConnection) loginUrl.openConnection();
            loginConnection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            loginConnection.setReadTimeout(CONNECT_TIMEOUT_MS);
            loginConnection.setRequestMethod("POST");
            loginConnection.setDoOutput(true);
            loginConnection.setUseCaches(false);
            loginConnection.setInstanceFollowRedirects(false);
            loginConnection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            loginConnection.setRequestProperty("Accept", "application/json");
            loginConnection.setRequestProperty("User-Agent", "CX-Codex-Android-FileAuth");
            String payload = "{\"password\":\"" + escapeJson(authKey) + "\"}";
            byte[] payloadBytes = payload.getBytes(StandardCharsets.UTF_8);
            loginConnection.setFixedLengthStreamingMode(payloadBytes.length);
            try (OutputStream outputStream = loginConnection.getOutputStream()) {
                outputStream.write(payloadBytes);
                outputStream.flush();
            }
            int statusCode = loginConnection.getResponseCode();
            if (statusCode < 200 || statusCode >= 300) {
                return false;
            }
            String setCookie = loginConnection.getHeaderField("Set-Cookie");
            if (setCookie == null || setCookie.trim().isEmpty()) {
                return false;
            }
            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setCookie(origin, setCookie);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                cookieManager.flush();
            }
            return true;
        } catch (Exception exception) {
            return false;
        } finally {
            if (loginConnection != null) {
                loginConnection.disconnect();
            }
        }
    }

    private static String escapeJson(String value) {
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t");
    }

    private void openFileIntent(File file, String mimeType) {
        Uri fileUri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            file
        );

        Intent openIntent = new Intent(Intent.ACTION_VIEW);
        String normalizedMimeType = normalizeMimeType(mimeType);
        openIntent.setDataAndType(fileUri, normalizedMimeType.isEmpty() ? "application/octet-stream" : normalizedMimeType);
        openIntent.addCategory(Intent.CATEGORY_DEFAULT);
        openIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        grantUriReadPermissions(openIntent, fileUri);

        Intent chooserIntent = Intent.createChooser(openIntent, "打开文件");
        chooserIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Activity activity = getActivity();
        if (activity != null) {
            activity.startActivity(chooserIntent);
        } else {
            chooserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooserIntent);
        }
    }

    private void grantUriReadPermissions(Intent intent, Uri uri) {
        grantUriReadPermissions(getContext(), intent, uri);
    }

    private static void grantUriReadPermissions(Context context, Intent intent, Uri uri) {
        List<ResolveInfo> resolvedActivities = context
            .getPackageManager()
            .queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);
        for (ResolveInfo resolvedActivity : resolvedActivities) {
            context.grantUriPermission(
                resolvedActivity.activityInfo.packageName,
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            );
        }
    }

    private void showToast(String message) {
        if (getContext() == null) {
            return;
        }
        Toast.makeText(getContext(), message, Toast.LENGTH_SHORT).show();
    }

    private void notifyFileOperationCompleted(String title, String fileName) {
        showFileOperationNotification(title, fileName, "success");
    }

    private void notifyFileOperationFailed(String message) {
        showToast(message);
        showFileOperationNotification("文件处理失败", message, "error");
    }

    private void emitFileOperationStatus(String operationId, String action, String status, String message, String fileName) {
        if (operationId == null || operationId.isEmpty()) {
            return;
        }
        JSObject event = new JSObject();
        event.put("operationId", operationId);
        event.put("action", action);
        event.put("status", status);
        event.put("message", message);
        event.put("fileName", fileName);
        notifyListeners("fileOperationStatus", event);
    }

    private void showFileOperationNotification(String title, String body, String type) {
        if (!hasNotificationPermission()) {
            return;
        }
        try {
            ensureTaskNotificationChannel();
            Intent launchIntent = new Intent(getContext(), MainActivity.class);
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent contentIntent = PendingIntent.getActivity(
                getContext(),
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), TASK_NOTIFICATION_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(normalizeNotificationText(title, "CX-Codex"))
                .setContentText(normalizeNotificationText(body, ""))
                .setStyle(new NotificationCompat.BigTextStyle().bigText(normalizeNotificationText(body, "")))
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setPriority(resolveNotificationPriority(type));
            int notificationId = (int) (System.currentTimeMillis() % Integer.MAX_VALUE);
            NotificationManagerCompat.from(getContext()).notify(notificationId, builder.build());
        } catch (Exception ignored) {
            // Toast has already provided foreground feedback; notifications are best effort.
        }
    }

    public static void retryPendingApkInstall(Context context) {
        if (context == null || requiresUnknownAppsPermission(context)) {
            return;
        }

        String apkPath = MobileShellConfig.getPreferences(context).getString(PREF_PENDING_APK_INSTALL_PATH, "");
        if (apkPath == null || apkPath.trim().isEmpty()) {
            return;
        }

        File apkFile = new File(apkPath.trim());
        if (!apkFile.exists() || apkFile.length() <= 0) {
            clearPendingApkInstall(context);
            return;
        }

        try {
            openInstallIntent(context, apkFile);
            clearPendingApkInstall(context);
        } catch (Exception exception) {
            Toast.makeText(context, "打开更新安装包失败：" + exception.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private static void rememberPendingApkInstall(Context context, File apkFile) {
        MobileShellConfig.getPreferences(context)
            .edit()
            .putString(PREF_PENDING_APK_INSTALL_PATH, apkFile.getAbsolutePath())
            .apply();
    }

    private static void clearPendingApkInstall(Context context) {
        MobileShellConfig.getPreferences(context)
            .edit()
            .remove(PREF_PENDING_APK_INSTALL_PATH)
            .apply();
    }

    private static boolean requiresUnknownAppsPermission(Context context) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && !context.getPackageManager().canRequestPackageInstalls();
    }

    private static void openInstallIntent(Context context, File apkFile) {
        Uri apkUri = FileProvider.getUriForFile(
            context,
            context.getPackageName() + ".fileprovider",
            apkFile
        );

        Intent installIntent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
        installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        installIntent.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);
        installIntent.putExtra(Intent.EXTRA_RETURN_RESULT, false);
        grantUriReadPermissions(context, installIntent, apkUri);

        try {
            context.startActivity(installIntent);
        } catch (ActivityNotFoundException exception) {
            Intent fallbackIntent = new Intent(Intent.ACTION_VIEW);
            fallbackIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            fallbackIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            fallbackIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            grantUriReadPermissions(context, fallbackIntent, apkUri);
            context.startActivity(fallbackIntent);
        }
    }

    private static void openUnknownAppsSettings(Context context) {
        Intent settingsIntent = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + context.getPackageName())
        );
        settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(settingsIntent);
    }

    private void scheduleRestart() {
        mainHandler.postDelayed(() -> {
            if (getActivity() == null) {
                return;
            }
            Intent restartIntent = new Intent(getActivity(), MainActivity.class);
            restartIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            getActivity().startActivity(restartIntent);
            getActivity().finish();
        }, 180);
    }

    private static boolean isValidDownloadUrl(String value) {
        String normalized = value == null ? "" : value.trim();
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
            return normalizedScheme.equals("http") || normalizedScheme.equals("https");
        } catch (URISyntaxException exception) {
            return false;
        }
    }

    private static boolean isValidOpenUrl(String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty()) {
            return false;
        }
        try {
            URI uri = new URI(normalized);
            String scheme = uri.getScheme();
            if (scheme == null) {
                return false;
            }
            String normalizedScheme = scheme.toLowerCase(Locale.ROOT);
            return normalizedScheme.equals("http")
                || normalizedScheme.equals("https")
                || normalizedScheme.equals("mailto")
                || normalizedScheme.equals("tel");
        } catch (URISyntaxException exception) {
            return false;
        }
    }

    private static String sanitizeFileName(String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty()) {
            return "";
        }
        return normalized.replaceAll("[\\\\/:*?\"<>|]", "-");
    }

    private static String normalizeOperationId(String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.length() > 128) {
            return normalized.substring(0, 128);
        }
        return normalized;
    }

    private static class NetworkSnapshot {
        final boolean connected;
        final boolean validated;
        final boolean metered;
        final String transport;

        NetworkSnapshot(boolean connected, boolean validated, boolean metered, String transport) {
            this.connected = connected;
            this.validated = validated;
            this.metered = metered;
            this.transport = transport;
        }
    }
}
