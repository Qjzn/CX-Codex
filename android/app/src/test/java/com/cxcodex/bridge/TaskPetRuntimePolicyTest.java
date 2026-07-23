package com.cxcodex.bridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TaskPetRuntimePolicyTest {
    @Test
    public void rejectsOlderNonZeroSnapshots() {
        assertFalse(TaskPetRuntimePolicy.shouldApplySnapshot(42L, 41L));
        assertTrue(TaskPetRuntimePolicy.shouldApplySnapshot(42L, 42L));
        assertTrue(TaskPetRuntimePolicy.shouldApplySnapshot(42L, 43L));
        assertTrue(TaskPetRuntimePolicy.shouldApplySnapshot(42L, 0L));
    }

    @Test
    public void preservesKnownReplyFromAnUnversionedOrOlderRecoveringFrontendSnapshot() {
        assertTrue(TaskPetRuntimePolicy.shouldPreserveKnownLatestReply(
            true, true, 42L, 42L, "known reply"
        ));
        assertTrue(TaskPetRuntimePolicy.shouldPreserveKnownLatestReply(
            true, true, 42L, 0L, "known reply"
        ));
        assertTrue(TaskPetRuntimePolicy.shouldPreserveKnownLatestReply(
            true, true, 42L, 41L, "known reply"
        ));
        assertFalse(TaskPetRuntimePolicy.shouldPreserveKnownLatestReply(
            false, true, 42L, 42L, "known reply"
        ));
        assertFalse(TaskPetRuntimePolicy.shouldPreserveKnownLatestReply(
            true, false, 42L, 42L, "known reply"
        ));
        assertFalse(TaskPetRuntimePolicy.shouldPreserveKnownLatestReply(
            true, true, 42L, 42L, ""
        ));
        assertFalse(TaskPetRuntimePolicy.shouldPreserveKnownLatestReply(
            true, true, 42L, 43L, "known reply"
        ));
    }

    @Test
    public void preventsRecoveringFrontendSnapshotsFromRevivingSettledTasks() {
        assertTrue(TaskPetRuntimePolicy.shouldPreserveNativeSettledState(
            true, true, "completed", "running"
        ));
        assertTrue(TaskPetRuntimePolicy.shouldPreserveNativeSettledState(
            true, true, "completed", "waiting"
        ));
        assertTrue(TaskPetRuntimePolicy.shouldPreserveNativeSettledState(
            true, true, "retry", "running"
        ));
        assertTrue(TaskPetRuntimePolicy.shouldPreserveNativeSettledState(
            true, true, "completed", "running"
        ));
        assertFalse(TaskPetRuntimePolicy.shouldPreserveNativeSettledState(
            false, true, "completed", "running"
        ));
        assertFalse(TaskPetRuntimePolicy.shouldPreserveNativeSettledState(
            true, false, "completed", "running"
        ));
        assertFalse(TaskPetRuntimePolicy.shouldPreserveNativeSettledState(
            true, true, "running", "waiting"
        ));
        assertFalse(TaskPetRuntimePolicy.shouldPreserveNativeSettledState(
            true, true, "completed", "completed"
        ));
        assertTrue(TaskPetRuntimePolicy.shouldPreserveNativeSettledState(
            true, true, "completed", "running"
        ));
        assertTrue(TaskPetRuntimePolicy.shouldPreserveNativeSettledState(
            true, true, "retry", "waiting"
        ));
    }

    @Test
    public void retainsKnownTasksUntilNativeRuntimeReconciliation() {
        assertTrue(TaskPetRuntimePolicy.shouldRetainOmittedTask("completed"));
        assertTrue(TaskPetRuntimePolicy.shouldRetainOmittedTask("running"));
        assertTrue(TaskPetRuntimePolicy.shouldRetainOmittedTask("waiting"));
        assertTrue(TaskPetRuntimePolicy.shouldRetainOmittedTask("retry"));
        assertFalse(TaskPetRuntimePolicy.shouldRetainOmittedTask("unknown"));
    }

    @Test
    public void excludesManualRetryRowsFromBackgroundMonitoring() {
        assertTrue(TaskPetRuntimePolicy.isActiveTaskState("running"));
        assertTrue(TaskPetRuntimePolicy.isActiveTaskState("waiting"));
        assertFalse(TaskPetRuntimePolicy.isActiveTaskState("retry"));
        assertFalse(TaskPetRuntimePolicy.isActiveTaskState("completed"));
    }

    @Test
    public void dropsOnlyOmittedThreadlessRequestsAfterRepeatedNotFoundResults() {
        assertFalse(TaskPetRuntimePolicy.shouldDropOmittedProvisional(false, false, 3, 3));
        assertFalse(TaskPetRuntimePolicy.shouldDropOmittedProvisional(true, true, 3, 3));
        assertFalse(TaskPetRuntimePolicy.shouldDropOmittedProvisional(true, false, 2, 3));
        assertTrue(TaskPetRuntimePolicy.shouldDropOmittedProvisional(true, false, 3, 3));
    }

    @Test
    public void isolatesDelayedPollResultsByTaskGeneration() {
        assertTrue(TaskPetRuntimePolicy.isSameTaskGeneration("activity-2", 200L, "activity-2", 200L));
        assertFalse(TaskPetRuntimePolicy.isSameTaskGeneration("activity-2", 200L, "activity-1", 100L));
        assertFalse(TaskPetRuntimePolicy.isSameTaskGeneration("", 200L, "", 100L));
        assertTrue(TaskPetRuntimePolicy.isSameTaskGeneration("", 0L, "", 0L));
    }

    @Test
    public void acceptsOnlyProvablyNewerDifferentGenerations() {
        assertTrue(TaskPetRuntimePolicy.shouldAcceptDifferentTaskGeneration(200L, 20L, 300L, 20L));
        assertFalse(TaskPetRuntimePolicy.shouldAcceptDifferentTaskGeneration(300L, 20L, 250L, 21L));
        assertFalse(TaskPetRuntimePolicy.shouldAcceptDifferentTaskGeneration(300L, 21L, 200L, 20L));
        assertFalse(TaskPetRuntimePolicy.shouldAcceptDifferentTaskGeneration(300L, 21L, 0L, 0L));
        assertTrue(TaskPetRuntimePolicy.shouldAcceptDifferentTaskGeneration(0L, 0L, 300L, 0L));
        assertTrue(TaskPetRuntimePolicy.shouldAcceptDifferentTaskGeneration(300L, 20L, 300L, 21L));
        assertFalse(TaskPetRuntimePolicy.shouldAcceptDifferentTaskGeneration(300L, 21L, 300L, 21L));
        assertTrue(TaskPetRuntimePolicy.shouldAcceptDifferentTaskGeneration(0L, 20L, 0L, 21L));
    }

    @Test
    public void filtersRealtimeWakeEventsAndPrioritizesTerminalSignals() {
        assertTrue(TaskPetRuntimePolicy.shouldWakeForRuntimeEvent("item/agentMessage/delta"));
        assertTrue(TaskPetRuntimePolicy.shouldWakeForRuntimeEvent("server/request"));
        assertTrue(TaskPetRuntimePolicy.shouldWakeForRuntimeEvent("turn/completed"));
        assertTrue(TaskPetRuntimePolicy.shouldWakeForRuntimeEvent("error"));
        assertFalse(TaskPetRuntimePolicy.shouldWakeForRuntimeEvent("bridge/heartbeat"));
        assertFalse(TaskPetRuntimePolicy.shouldWakeForRuntimeEvent("account/rateLimits/updated"));
        assertTrue(TaskPetRuntimePolicy.isTerminalRuntimeEvent("turn/completed"));
        assertTrue(TaskPetRuntimePolicy.isTerminalRuntimeEvent("thread/interrupted"));
        assertTrue(TaskPetRuntimePolicy.isTerminalRuntimeEvent("error"));
        assertFalse(TaskPetRuntimePolicy.isTerminalRuntimeEvent("turn/started"));
    }

    @Test
    public void schedulesATrailingReplyPollInsideTheThrottleWindow() {
        assertEquals(0L, TaskPetRuntimePolicy.nextEventDrivenPollDelayMs(false, 1_000L, 0L, 750L));
        assertEquals(650L, TaskPetRuntimePolicy.nextEventDrivenPollDelayMs(false, 1_100L, 1_000L, 750L));
        assertEquals(1L, TaskPetRuntimePolicy.nextEventDrivenPollDelayMs(false, 1_749L, 1_000L, 750L));
        assertEquals(0L, TaskPetRuntimePolicy.nextEventDrivenPollDelayMs(false, 1_750L, 1_000L, 750L));
        assertEquals(0L, TaskPetRuntimePolicy.nextEventDrivenPollDelayMs(true, 1_100L, 1_000L, 750L));
        assertEquals(0L, TaskPetRuntimePolicy.nextEventDrivenPollDelayMs(false, 900L, 1_000L, 750L));
    }

    @Test
    public void keepsMonitoringActiveTasksWithoutAnOverlay() {
        assertTrue(TaskPetRuntimePolicy.shouldKeepMonitorRunning(false, 1));
        assertTrue(TaskPetRuntimePolicy.shouldKeepMonitorRunning(true, 0));
        assertFalse(TaskPetRuntimePolicy.shouldKeepMonitorRunning(false, 0));
    }

    @Test
    public void holdsCpuWakeLockOnlyWhileTasksAreActive() {
        assertTrue(TaskPetRuntimePolicy.shouldHoldWakeLock(1));
        assertFalse(TaskPetRuntimePolicy.shouldHoldWakeLock(0));
    }

    @Test
    public void wakesOnlyForChangedKnownNetworkWhileTasksAreActive() {
        assertFalse(TaskPetRuntimePolicy.shouldWakeForDefaultNetworkChange(false, false, 1));
        assertFalse(TaskPetRuntimePolicy.shouldWakeForDefaultNetworkChange(true, true, 1));
        assertFalse(TaskPetRuntimePolicy.shouldWakeForDefaultNetworkChange(true, false, 0));
        assertTrue(TaskPetRuntimePolicy.shouldWakeForDefaultNetworkChange(true, false, 1));
    }

    @Test
    public void mobilePushWakesOnlyTrackedTerminalTasksWithinAndroidStartRules() {
        assertTrue(TaskPetRuntimePolicy.shouldWakeForMobilePush("task_terminal", true, true, false));
        assertTrue(TaskPetRuntimePolicy.shouldWakeForMobilePush("task_terminal", false, true, true));
        assertFalse(TaskPetRuntimePolicy.shouldWakeForMobilePush("task_terminal", false, true, false));
        assertFalse(TaskPetRuntimePolicy.shouldWakeForMobilePush("task_terminal", true, false, false));
        assertFalse(TaskPetRuntimePolicy.shouldWakeForMobilePush("task_progress", true, true, false));
    }

    @Test
    public void commitsMobilePushSequenceOnlyForNewerPositiveEvents() {
        assertTrue(TaskPetRuntimePolicy.isDuplicateMobilePushEvent(42L, 41L));
        assertTrue(TaskPetRuntimePolicy.isDuplicateMobilePushEvent(42L, 42L));
        assertFalse(TaskPetRuntimePolicy.isDuplicateMobilePushEvent(42L, 43L));
        assertFalse(TaskPetRuntimePolicy.isDuplicateMobilePushEvent(42L, 0L));
        assertTrue(TaskPetRuntimePolicy.shouldRestartClaimedMobilePush(true, false));
        assertFalse(TaskPetRuntimePolicy.shouldRestartClaimedMobilePush(true, true));
        assertFalse(TaskPetRuntimePolicy.shouldRestartClaimedMobilePush(false, false));
    }

    @Test
    public void keepsTerminalAcknowledgementWhenAClaimedPushLosesItsStoredToken() {
        assertTrue(TaskPetRuntimePolicy.shouldPersistMobilePushAcknowledgement(true, false, false));
        assertTrue(TaskPetRuntimePolicy.shouldPersistMobilePushAcknowledgement(false, true, false));
        assertTrue(TaskPetRuntimePolicy.shouldPersistMobilePushAcknowledgement(false, false, true));
        assertFalse(TaskPetRuntimePolicy.shouldPersistMobilePushAcknowledgement(false, false, false));
    }

    @Test
    public void changedMobilePushSubscriptionsBypassRetryThrottle() {
        long throttleMs = 30_000L;
        assertTrue(TaskPetRuntimePolicy.shouldThrottleMobilePushRegistration(
            false, true, 5_000L, throttleMs
        ));
        assertFalse(TaskPetRuntimePolicy.shouldThrottleMobilePushRegistration(
            false, false, 5_000L, throttleMs
        ));
        assertFalse(TaskPetRuntimePolicy.shouldThrottleMobilePushRegistration(
            false, true, throttleMs, throttleMs
        ));
        assertFalse(TaskPetRuntimePolicy.shouldThrottleMobilePushRegistration(
            true, true, 5_000L, throttleMs
        ));
        long refreshMs = 6 * 60 * 60_000L;
        assertTrue(TaskPetRuntimePolicy.shouldSkipFreshMobilePushRegistration(
            false, true, true, 5_000L, refreshMs
        ));
        assertFalse(TaskPetRuntimePolicy.shouldSkipFreshMobilePushRegistration(
            false, true, false, 5_000L, refreshMs
        ));
        assertFalse(TaskPetRuntimePolicy.shouldSkipFreshMobilePushRegistration(
            false, true, true, refreshMs, refreshMs
        ));
        assertFalse(TaskPetRuntimePolicy.shouldSkipFreshMobilePushRegistration(
            true, true, true, 5_000L, refreshMs
        ));
    }

    @Test
    public void retriesMissingMobilePushTokenWithoutOverlappingOrSpinning() {
        long throttleMs = 30_000L;
        assertTrue(TaskPetRuntimePolicy.shouldThrottleMobilePushTokenRefresh(
            true, throttleMs, throttleMs
        ));
        assertTrue(TaskPetRuntimePolicy.shouldThrottleMobilePushTokenRefresh(
            false, 5_000L, throttleMs
        ));
        assertFalse(TaskPetRuntimePolicy.shouldThrottleMobilePushTokenRefresh(
            false, throttleMs, throttleMs
        ));
        assertFalse(TaskPetRuntimePolicy.shouldThrottleMobilePushTokenRefresh(
            false, -1L, throttleMs
        ));
    }

    @Test
    public void refreshesVisibleReplyProgressFasterWithoutSpinningInBackground() {
        assertEquals(250L, TaskPetRuntimePolicy.eventStreamProgressThrottleMs(true));
        assertEquals(750L, TaskPetRuntimePolicy.eventStreamProgressThrottleMs(false));

        long lastPollAtMs = 1_000L;
        assertEquals(250L, TaskPetRuntimePolicy.nextEventDrivenPollDelayMs(
            false,
            lastPollAtMs,
            lastPollAtMs,
            TaskPetRuntimePolicy.eventStreamProgressThrottleMs(true)
        ));
        assertEquals(750L, TaskPetRuntimePolicy.nextEventDrivenPollDelayMs(
            false,
            lastPollAtMs,
            lastPollAtMs,
            TaskPetRuntimePolicy.eventStreamProgressThrottleMs(false)
        ));
        assertEquals(0L, TaskPetRuntimePolicy.nextEventDrivenPollDelayMs(
            true,
            lastPollAtMs,
            lastPollAtMs,
            TaskPetRuntimePolicy.eventStreamProgressThrottleMs(false)
        ));
    }

    @Test
    public void promotesTheNewestReplyIntoTheVisibleTaskRows() {
        assertTrue(TaskPetRuntimePolicy.shouldPreferReplyCandidate(0L, 0L));
        assertTrue(TaskPetRuntimePolicy.shouldPreferReplyCandidate(0L, 42L));
        assertTrue(TaskPetRuntimePolicy.shouldPreferReplyCandidate(42L, 42L));
        assertTrue(TaskPetRuntimePolicy.shouldPreferReplyCandidate(42L, 43L));
        assertFalse(TaskPetRuntimePolicy.shouldPreferReplyCandidate(43L, 42L));
        assertFalse(TaskPetRuntimePolicy.shouldPreferReplyCandidate(43L, 0L));
        assertTrue(TaskPetRuntimePolicy.compareTaskRecency(200L, 100L) < 0);
        assertTrue(TaskPetRuntimePolicy.compareTaskRecency(100L, 200L) > 0);
        assertEquals(0, TaskPetRuntimePolicy.compareTaskRecency(100L, 100L));
    }

    @Test
    public void commitsReplyRenderEvidenceOnlyAfterThePanelIsActuallyVisible() {
        assertTrue(TaskPetRuntimePolicy.shouldCommitReplyRender(true, true, 1f, true));
        assertFalse(TaskPetRuntimePolicy.shouldCommitReplyRender(false, true, 1f, true));
        assertFalse(TaskPetRuntimePolicy.shouldCommitReplyRender(true, false, 1f, true));
        assertFalse(TaskPetRuntimePolicy.shouldCommitReplyRender(true, true, 0f, true));
        assertFalse(TaskPetRuntimePolicy.shouldCommitReplyRender(true, true, 1f, false));
    }

    @Test
    public void commitsReplyRenderEvidenceWhenTheCompactPreviewIsActuallyVisible() {
        assertTrue(TaskPetRuntimePolicy.shouldCommitCompactReplyRender(false, false, true, 1f, true));
        assertFalse(TaskPetRuntimePolicy.shouldCommitCompactReplyRender(true, false, true, 1f, true));
        assertFalse(TaskPetRuntimePolicy.shouldCommitCompactReplyRender(false, true, true, 1f, true));
        assertFalse(TaskPetRuntimePolicy.shouldCommitCompactReplyRender(false, false, false, 1f, true));
        assertFalse(TaskPetRuntimePolicy.shouldCommitCompactReplyRender(false, false, true, 0f, true));
        assertFalse(TaskPetRuntimePolicy.shouldCommitCompactReplyRender(false, false, true, 1f, false));
    }

    @Test
    public void retainsAndNotifiesOnlyUnreadSettledTasks() {
        assertTrue(TaskPetRuntimePolicy.shouldRetainUnreadSettledTask(false));
        assertFalse(TaskPetRuntimePolicy.shouldRetainUnreadSettledTask(true));
    }

    @Test
    public void restoresOnlyTheExactPendingReplyAfterServiceRecreation() {
        assertTrue(TaskPetRuntimePolicy.shouldRestorePendingReplyRender(
            "thread-a", 42L, "thread-a", 42L, true
        ));
        assertTrue(TaskPetRuntimePolicy.shouldRestorePendingReplyRender(
            "thread-a", 42L, "thread-a", 43L, true
        ));
        assertFalse(TaskPetRuntimePolicy.shouldRestorePendingReplyRender(
            "thread-a", 42L, "thread-b", 43L, true
        ));
        assertFalse(TaskPetRuntimePolicy.shouldRestorePendingReplyRender(
            "thread-a", 42L, "thread-a", 41L, true
        ));
        assertFalse(TaskPetRuntimePolicy.shouldRestorePendingReplyRender(
            "thread-a", 0L, "thread-a", 42L, true
        ));
        assertFalse(TaskPetRuntimePolicy.shouldRestorePendingReplyRender(
            "thread-a", 42L, "thread-a", 42L, false
        ));
    }

    @Test
    public void remindsInitiallyThenAtBoundedReviewIntervals() {
        long thresholdMs = 10 * 60_000L;
        long repeatIntervalMs = 20 * 60_000L;
        long firstProgressAtMs = 1_000L;
        assertFalse(TaskPetRuntimePolicy.shouldNotifyNoProgress(
            "running", firstProgressAtMs, 0L, firstProgressAtMs + thresholdMs - 1L, thresholdMs, repeatIntervalMs
        ));
        assertTrue(TaskPetRuntimePolicy.shouldNotifyNoProgress(
            "running", firstProgressAtMs, 0L, firstProgressAtMs + thresholdMs, thresholdMs, repeatIntervalMs
        ));
        long firstReminderAtMs = firstProgressAtMs + thresholdMs;
        assertFalse(TaskPetRuntimePolicy.shouldNotifyNoProgress(
            "waiting", firstProgressAtMs, firstReminderAtMs,
            firstReminderAtMs + repeatIntervalMs - 1L, thresholdMs, repeatIntervalMs
        ));
        assertTrue(TaskPetRuntimePolicy.shouldNotifyNoProgress(
            "waiting", firstProgressAtMs, firstReminderAtMs,
            firstReminderAtMs + repeatIntervalMs, thresholdMs, repeatIntervalMs
        ));

        long nextProgressAtMs = firstReminderAtMs + 5 * 60_000L;
        assertTrue(TaskPetRuntimePolicy.shouldNotifyNoProgress(
            "waiting", nextProgressAtMs, firstReminderAtMs,
            nextProgressAtMs + thresholdMs, thresholdMs, repeatIntervalMs
        ));
        assertFalse(TaskPetRuntimePolicy.shouldNotifyNoProgress(
            "completed", nextProgressAtMs, 0L,
            nextProgressAtMs + thresholdMs, thresholdMs, repeatIntervalMs
        ));
    }

    @Test
    public void schedulesTheNextPersistedNoProgressReviewWithoutMovingTheTaskClock() {
        long thresholdMs = 10 * 60_000L;
        long repeatIntervalMs = 20 * 60_000L;
        long progressAtMs = 1_000L;
        long firstReviewAtMs = progressAtMs + thresholdMs;

        assertEquals(firstReviewAtMs, TaskPetRuntimePolicy.nextNoProgressReviewAtMs(
            "running", progressAtMs, 0L, thresholdMs, repeatIntervalMs
        ));
        assertEquals(firstReviewAtMs + repeatIntervalMs, TaskPetRuntimePolicy.nextNoProgressReviewAtMs(
            "waiting", progressAtMs, firstReviewAtMs, thresholdMs, repeatIntervalMs
        ));
        assertEquals(0L, TaskPetRuntimePolicy.nextNoProgressReviewAtMs(
            "completed", progressAtMs, firstReviewAtMs, thresholdMs, repeatIntervalMs
        ));
        assertEquals(0L, TaskPetRuntimePolicy.nextNoProgressReviewAtMs(
            "running", 0L, 0L, thresholdMs, repeatIntervalMs
        ));
    }

    @Test
    public void keepsDegradedDeliveryInConfirmationState() {
        assertTrue(TaskPetRuntimePolicy.isAwaitingConfirmation("start_uncertain"));
        assertTrue(TaskPetRuntimePolicy.isAwaitingConfirmation("sync_degraded"));
        assertFalse(TaskPetRuntimePolicy.isAwaitingConfirmation("running"));
    }

    @Test
    public void confirmsEveryNewClientRequestBeforePollingAnExistingThread() {
        assertTrue(TaskPetRuntimePolicy.shouldConfirmRuntimeRequest("request-1", false));
        assertFalse(TaskPetRuntimePolicy.shouldConfirmRuntimeRequest("request-1", true));
        assertFalse(TaskPetRuntimePolicy.shouldConfirmRuntimeRequest("", false));
    }

    @Test
    public void reusesIdOnlyForTheSameThreadAndMessage() {
        assertEquals("existing", TaskPetRuntimePolicy.reuseOrCreateClientMessageId(
            "existing", "thread-a", "hello", "thread-a", "hello", "generated"
        ));
        assertEquals("generated", TaskPetRuntimePolicy.reuseOrCreateClientMessageId(
            "existing", "thread-a", "hello", "thread-a", "changed", "generated"
        ));
        assertEquals("generated", TaskPetRuntimePolicy.reuseOrCreateClientMessageId(
            "existing", "thread-a", "hello", "thread-b", "hello", "generated"
        ));
    }

    @Test
    public void reconcilesOnlyThePersistedReplyThread() {
        assertTrue(TaskPetRuntimePolicy.shouldReconcileReplyAttempt("reply-1", "thread-a", "thread-a"));
        assertFalse(TaskPetRuntimePolicy.shouldReconcileReplyAttempt("", "thread-a", "thread-a"));
        assertFalse(TaskPetRuntimePolicy.shouldReconcileReplyAttempt("reply-1", "thread-a", "thread-b"));
    }

    @Test
    public void requiresManualReplyRetryOnlyAfterAuthoritativeFailureBoundary() {
        assertTrue(TaskPetRuntimePolicy.shouldRequireManualReplyRetry("failed", 0, 3));
        assertFalse(TaskPetRuntimePolicy.shouldRequireManualReplyRetry("not_found", 2, 3));
        assertTrue(TaskPetRuntimePolicy.shouldRequireManualReplyRetry("not_found", 3, 3));
        assertFalse(TaskPetRuntimePolicy.shouldRequireManualReplyRetry("start_uncertain", 3, 3));
    }
}
