package com.cxcodex.bridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class MobileShellConfigTest {
    @Test
    public void stripsBrowserRouteBeforePersistingServerUrl() {
        assertEquals(
            "http://127.0.0.1:7420",
            MobileShellConfig.normalizeServerUrl(" http://127.0.0.1:7420/#/ ")
        );
        assertEquals(
            "https://example.com/cx-codex",
            MobileShellConfig.normalizeServerUrl("https://example.com/cx-codex/?source=android#/thread/old")
        );
    }

    @Test
    public void buildsOneCanonicalHashRouteForAThread() {
        assertEquals(
            "http://127.0.0.1:7420/#/thread/thread-123",
            MobileShellConfig.buildAppHashUrl("http://127.0.0.1:7420/#/", "/thread/thread-123")
        );
        assertEquals(
            "https://example.com/cx-codex/#/thread/thread-123",
            MobileShellConfig.buildAppHashUrl("https://example.com/cx-codex/#/thread/old", "thread/thread-123")
        );
    }

    @Test
    public void acknowledgesOnlyThePendingNotificationThreadThatActuallyOpened() {
        assertTrue(MobileShellConfig.shouldAcknowledgePendingTaskPetThreadOpen(" thread-123 ", "thread-123"));
        assertFalse(MobileShellConfig.shouldAcknowledgePendingTaskPetThreadOpen("thread-123", "thread-456"));
        assertFalse(MobileShellConfig.shouldAcknowledgePendingTaskPetThreadOpen("", "thread-123"));
        assertFalse(MobileShellConfig.shouldAcknowledgePendingTaskPetThreadOpen(null, "thread-123"));
    }
}
