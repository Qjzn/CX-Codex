package com.cxcodex.bridge;

final class TaskPetRuntimePolicy {
    private static final long VISIBLE_REPLY_PROGRESS_THROTTLE_MS = 250L;
    private static final long BACKGROUND_REPLY_PROGRESS_THROTTLE_MS = 750L;

    private TaskPetRuntimePolicy() {}

    static boolean shouldApplySnapshot(long currentEventSeq, long incomingEventSeq) {
        return currentEventSeq <= 0L || incomingEventSeq <= 0L || incomingEventSeq >= currentEventSeq;
    }

    static boolean shouldPreserveKnownLatestReply(
        boolean frontendSnapshot,
        boolean sameTaskGeneration,
        long currentReplyEventSeq,
        long incomingReplyEventSeq,
        String currentLatestReply
    ) {
        String currentReply = currentLatestReply == null ? "" : currentLatestReply.trim();
        return frontendSnapshot
            && sameTaskGeneration
            && !currentReply.isEmpty()
            && (incomingReplyEventSeq <= 0L || incomingReplyEventSeq <= currentReplyEventSeq);
    }

    static boolean shouldPreserveNativeSettledState(
        boolean frontendSnapshot,
        boolean sameTaskGeneration,
        String currentState,
        String incomingState
    ) {
        boolean currentSettled = "completed".equals(currentState) || "retry".equals(currentState);
        return frontendSnapshot
            && sameTaskGeneration
            && currentSettled
            && isActiveTaskState(incomingState);
    }

    static boolean shouldRetainOmittedTask(String state) {
        return "running".equals(state)
            || "waiting".equals(state)
            || "retry".equals(state)
            || "completed".equals(state);
    }

    static boolean isActiveTaskState(String state) {
        return "running".equals(state) || "waiting".equals(state);
    }

    static boolean shouldRetainUnreadSettledTask(boolean readAcknowledged) {
        return !readAcknowledged;
    }

    static boolean shouldDropOmittedProvisional(
        boolean omittedFromFrontend,
        boolean hasThreadId,
        int consecutiveMissingRequests,
        int missingRequestLimit
    ) {
        return omittedFromFrontend
            && !hasThreadId
            && missingRequestLimit > 0
            && consecutiveMissingRequests >= missingRequestLimit;
    }

    static boolean isSameTaskGeneration(
        String currentActivityId,
        long currentStartedAtMs,
        String incomingActivityId,
        long incomingStartedAtMs
    ) {
        String currentId = currentActivityId == null ? "" : currentActivityId.trim();
        String incomingId = incomingActivityId == null ? "" : incomingActivityId.trim();
        if (!currentId.isEmpty() && !incomingId.isEmpty()) return currentId.equals(incomingId);
        if (currentStartedAtMs > 0L && incomingStartedAtMs > 0L) {
            return currentStartedAtMs == incomingStartedAtMs;
        }
        return true;
    }

    static boolean shouldAcceptDifferentTaskGeneration(
        long currentStartedAtMs,
        long currentEventSeq,
        long incomingStartedAtMs,
        long incomingEventSeq
    ) {
        if (currentStartedAtMs > 0L && incomingStartedAtMs > 0L) {
            if (incomingStartedAtMs != currentStartedAtMs) {
                return incomingStartedAtMs > currentStartedAtMs;
            }
            return incomingEventSeq > 0L && incomingEventSeq > currentEventSeq;
        }
        if (incomingStartedAtMs > 0L) return currentStartedAtMs <= 0L;
        if (currentStartedAtMs > 0L) return false;
        return incomingEventSeq > 0L && incomingEventSeq > currentEventSeq;
    }

    static boolean shouldWakeForRuntimeEvent(String method) {
        String normalized = method == null ? "" : method.trim();
        return normalized.startsWith("turn/")
            || normalized.startsWith("thread/")
            || normalized.startsWith("server/request")
            || "item/agentMessage/delta".equals(normalized)
            || "item/completed".equals(normalized)
            || "error".equals(normalized)
            || normalized.endsWith("/failed")
            || normalized.endsWith("/error");
    }

    static boolean isTerminalRuntimeEvent(String method) {
        String normalized = method == null ? "" : method.trim();
        return normalized.endsWith("/completed")
            || normalized.endsWith("/interrupted")
            || normalized.endsWith("/failed")
            || normalized.endsWith("/error")
            || "error".equals(normalized);
    }

    static long nextEventDrivenPollDelayMs(
        boolean urgent,
        long nowMs,
        long lastPollAtMs,
        long throttleMs
    ) {
        if (urgent || throttleMs <= 0L || lastPollAtMs <= 0L || nowMs < lastPollAtMs) return 0L;
        return Math.max(0L, throttleMs - (nowMs - lastPollAtMs));
    }

    static long eventStreamProgressThrottleMs(boolean overlayExpanded) {
        return overlayExpanded
            ? VISIBLE_REPLY_PROGRESS_THROTTLE_MS
            : BACKGROUND_REPLY_PROGRESS_THROTTLE_MS;
    }

    static boolean shouldPreferReplyCandidate(long currentEventSeq, long incomingEventSeq) {
        if (currentEventSeq <= 0L) return true;
        return incomingEventSeq > 0L && incomingEventSeq >= currentEventSeq;
    }

    static int compareTaskRecency(long leftUpdatedAtMs, long rightUpdatedAtMs) {
        return Long.compare(rightUpdatedAtMs, leftUpdatedAtMs);
    }

    static boolean shouldCommitReplyRender(
        boolean overlayExpanded,
        boolean panelShown,
        float panelAlpha,
        boolean renderedTaskMatchesPendingReply
    ) {
        return overlayExpanded
            && panelShown
            && panelAlpha > 0f
            && renderedTaskMatchesPendingReply;
    }

    static boolean shouldCommitCompactReplyRender(
        boolean overlayExpanded,
        boolean overlayMinimized,
        boolean previewShown,
        float previewAlpha,
        boolean renderedTaskMatchesPendingReply
    ) {
        return !overlayExpanded
            && !overlayMinimized
            && previewShown
            && previewAlpha > 0f
            && renderedTaskMatchesPendingReply;
    }

    static boolean shouldRestorePendingReplyRender(
        String persistedTaskKey,
        long persistedEventSeq,
        String taskKey,
        long taskEventSeq,
        boolean hasLatestReply
    ) {
        return persistedTaskKey != null
            && !persistedTaskKey.isEmpty()
            && persistedTaskKey.equals(taskKey)
            && persistedEventSeq > 0L
            && taskEventSeq >= persistedEventSeq
            && hasLatestReply;
    }

    static boolean shouldKeepMonitorRunning(boolean shouldShowOverlay, int activeTaskCount) {
        return shouldShowOverlay || activeTaskCount > 0;
    }

    static boolean shouldHoldWakeLock(int activeTaskCount) {
        return activeTaskCount > 0;
    }

    static boolean shouldWakeForDefaultNetworkChange(
        boolean networkStateKnown,
        boolean sameNetwork,
        int activeTaskCount
    ) {
        return networkStateKnown && !sameNetwork && activeTaskCount > 0;
    }

    static boolean shouldWakeForMobilePush(
        String kind,
        boolean highPriority,
        boolean trackedThread,
        boolean serviceRunning
    ) {
        return "task_terminal".equals(kind)
            && trackedThread
            && (highPriority || serviceRunning);
    }

    static boolean isDuplicateMobilePushEvent(long claimedEventSeq, long incomingEventSeq) {
        return incomingEventSeq > 0L && incomingEventSeq <= claimedEventSeq;
    }

    static boolean shouldRestartClaimedMobilePush(boolean claimed, boolean serviceRunning) {
        return claimed && !serviceRunning;
    }

    static boolean shouldPersistMobilePushAcknowledgement(
        boolean hasStoredToken,
        boolean pushEventClaimed,
        boolean acknowledgementPending
    ) {
        return hasStoredToken || pushEventClaimed || acknowledgementPending;
    }

    static boolean shouldThrottleMobilePushRegistration(
        boolean force,
        boolean sameAttemptSignature,
        long elapsedSinceAttemptMs,
        long retryThrottleMs
    ) {
        return !force
            && sameAttemptSignature
            && elapsedSinceAttemptMs >= 0L
            && elapsedSinceAttemptMs < retryThrottleMs;
    }

    static boolean shouldThrottleMobilePushTokenRefresh(
        boolean refreshInFlight,
        long elapsedSinceAttemptMs,
        long retryThrottleMs
    ) {
        return refreshInFlight
            || (
                retryThrottleMs > 0L
                && elapsedSinceAttemptMs >= 0L
                && elapsedSinceAttemptMs < retryThrottleMs
            );
    }

    static boolean shouldSkipFreshMobilePushRegistration(
        boolean force,
        boolean sameSuccessfulSignature,
        boolean sameAttemptSignature,
        long elapsedSinceRegistrationMs,
        long refreshIntervalMs
    ) {
        return !force
            && sameSuccessfulSignature
            && sameAttemptSignature
            && elapsedSinceRegistrationMs >= 0L
            && elapsedSinceRegistrationMs < refreshIntervalMs;
    }

    static boolean shouldNotifyNoProgress(
        String state,
        long lastProgressAtMs,
        long lastReminderAtMs,
        long nowMs,
        long initialThresholdMs,
        long repeatIntervalMs
    ) {
        if (nowMs < lastProgressAtMs) return false;
        long nextReviewAtMs = nextNoProgressReviewAtMs(
            state,
            lastProgressAtMs,
            lastReminderAtMs,
            initialThresholdMs,
            repeatIntervalMs
        );
        return nextReviewAtMs > 0L && nowMs >= nextReviewAtMs;
    }

    static long nextNoProgressReviewAtMs(
        String state,
        long lastProgressAtMs,
        long lastReminderAtMs,
        long initialThresholdMs,
        long repeatIntervalMs
    ) {
        if (
            !isActiveTaskState(state)
            || lastProgressAtMs <= 0L
            || initialThresholdMs <= 0L
            || repeatIntervalMs <= 0L
        ) return 0L;
        boolean hasCurrentReminder = lastReminderAtMs >= lastProgressAtMs;
        long anchorMs = hasCurrentReminder ? lastReminderAtMs : lastProgressAtMs;
        long delayMs = hasCurrentReminder ? repeatIntervalMs : initialThresholdMs;
        return anchorMs > Long.MAX_VALUE - delayMs ? Long.MAX_VALUE : anchorMs + delayMs;
    }

    static boolean isAwaitingConfirmation(String status) {
        return "pending_start".equals(status)
            || "starting".equals(status)
            || "start_uncertain".equals(status)
            || "sync_degraded".equals(status);
    }

    static boolean shouldConfirmRuntimeRequest(String clientMessageId, boolean requestAccepted) {
        return clientMessageId != null && !clientMessageId.isEmpty() && !requestAccepted;
    }

    static boolean shouldReconcileReplyAttempt(
        String clientMessageId,
        String attemptThreadId,
        String taskThreadId
    ) {
        return clientMessageId != null
            && !clientMessageId.isEmpty()
            && attemptThreadId != null
            && !attemptThreadId.isEmpty()
            && attemptThreadId.equals(taskThreadId);
    }

    static boolean shouldRequireManualReplyRetry(
        String requestStatus,
        int consecutiveMissingRequests,
        int missingRequestLimit
    ) {
        if ("failed".equals(requestStatus)) return true;
        return "not_found".equals(requestStatus)
            && missingRequestLimit > 0
            && consecutiveMissingRequests >= missingRequestLimit;
    }

    static String reuseOrCreateClientMessageId(
        String currentId,
        String currentThreadId,
        String currentMessage,
        String nextThreadId,
        String nextMessage,
        String generatedId
    ) {
        if (
            currentId != null
            && !currentId.isEmpty()
            && nextThreadId.equals(currentThreadId)
            && nextMessage.equals(currentMessage)
        ) {
            return currentId;
        }
        return generatedId;
    }
}
