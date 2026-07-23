package com.cxcodex.bridge;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public final class TaskPetFirebaseMessagingService extends FirebaseMessagingService {
    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        MobilePushRegistration.onTokenRefreshed(this, token);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        Map<String, String> data = message.getData();
        String kind = clean(data.get("kind"), 80);
        String threadId = clean(data.get("threadId"), 160);
        long eventSeq = parseEventSeq(data.get("eventSeq"));
        boolean highPriority = message.getPriority() == RemoteMessage.PRIORITY_HIGH;
        boolean serviceRunning = TaskPetOverlayService.isRunning();
        boolean claimed = MobilePushRegistration.isPushEventClaimed(this, threadId, eventSeq);
        boolean pendingAcknowledgement = MobilePushRegistration.hasPendingPushAcknowledgement(
            this,
            threadId,
            eventSeq
        );
        boolean acknowledged = MobilePushRegistration.isPushEventAcknowledged(this, threadId, eventSeq);
        boolean trackedThread = MobilePushRegistration.isTrackedActiveThread(this, threadId)
            || claimed
            || pendingAcknowledgement
            || acknowledged;
        if (!TaskPetRuntimePolicy.shouldWakeForMobilePush(kind, highPriority, trackedThread, serviceRunning)) {
            MobilePushRegistration.recordPushResult(this, "ignored", highPriority, eventSeq);
            return;
        }
        if (acknowledged) {
            MobilePushRegistration.recordPushResult(this, "duplicate_ignored", highPriority, eventSeq);
            return;
        }
        if (pendingAcknowledgement) {
            MobilePushRegistration.retryPendingAcknowledgementAsync(this, threadId);
            MobilePushRegistration.recordPushResult(this, "ack_retry", highPriority, eventSeq);
            return;
        }
        if (claimed && !TaskPetRuntimePolicy.shouldRestartClaimedMobilePush(claimed, serviceRunning)) {
            MobilePushRegistration.recordPushResult(this, "duplicate_ignored", highPriority, eventSeq);
            return;
        }
        boolean started = TaskPetOverlayService.wakeFromMobilePush(this, threadId, eventSeq, highPriority);
        if (!started) {
            MobilePushRegistration.recordPushResult(this, "wake_failed", highPriority, eventSeq);
            return;
        }
        if (!claimed && !MobilePushRegistration.claimPushEvent(this, threadId, eventSeq)) {
            MobilePushRegistration.recordPushResult(this, "duplicate_ignored", highPriority, eventSeq);
            return;
        }
        MobilePushRegistration.recordPushResult(
            this,
            claimed ? "wake_restarted" : "wake_started",
            highPriority,
            eventSeq
        );
    }

    private static long parseEventSeq(String value) {
        if (value == null || value.trim().isEmpty()) return 0L;
        try {
            return Math.max(0L, Long.parseLong(value.trim()));
        } catch (NumberFormatException ignored) {
            return 0L;
        }
    }

    private static String clean(String value, int maxLength) {
        if (value == null) return "";
        String normalized = value.trim();
        return normalized.length() <= maxLength ? normalized : normalized.substring(0, maxLength);
    }
}
