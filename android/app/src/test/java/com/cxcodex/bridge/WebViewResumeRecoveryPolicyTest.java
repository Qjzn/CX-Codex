package com.cxcodex.bridge;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class WebViewResumeRecoveryPolicyTest {
    @Test
    public void onlyTheLatestUnansweredProbeMayRecoverTheWebView() {
        WebViewResumeRecoveryPolicy policy = new WebViewResumeRecoveryPolicy();
        int staleGeneration = policy.beginProbe();
        int currentGeneration = policy.beginProbe();

        assertFalse(policy.shouldRecover(staleGeneration));
        assertTrue(policy.shouldRecover(currentGeneration));
        assertFalse(policy.shouldRecover(currentGeneration));
    }

    @Test
    public void aResponsiveRendererCancelsThePendingRecovery() {
        WebViewResumeRecoveryPolicy policy = new WebViewResumeRecoveryPolicy();
        int generation = policy.beginProbe();

        assertTrue(policy.markResponsive(generation));
        assertFalse(policy.shouldRecover(generation));
    }

    @Test
    public void aStaleCallbackCannotCancelANewerProbe() {
        WebViewResumeRecoveryPolicy policy = new WebViewResumeRecoveryPolicy();
        int staleGeneration = policy.beginProbe();
        int currentGeneration = policy.beginProbe();

        assertFalse(policy.markResponsive(staleGeneration));
        assertTrue(policy.shouldRecover(currentGeneration));
    }

    @Test
    public void aRendererCrashMustNotReloadTheSameRoute() {
        WebViewResumeRecoveryPolicy policy = new WebViewResumeRecoveryPolicy();

        assertFalse(policy.shouldRestoreExactRoute(true));
        assertTrue(policy.shouldRestoreExactRoute(false));
    }
}
