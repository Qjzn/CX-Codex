package com.cxcodex.bridge;

final class WebViewResumeRecoveryPolicy {
    private int generation;
    private boolean awaitingResponse;

    int beginProbe() {
        generation += 1;
        awaitingResponse = true;
        return generation;
    }

    boolean markResponsive(int probeGeneration) {
        if (!awaitingResponse || probeGeneration != generation) return false;
        awaitingResponse = false;
        return true;
    }

    boolean shouldRecover(int probeGeneration) {
        if (!awaitingResponse || probeGeneration != generation) return false;
        awaitingResponse = false;
        return true;
    }

    boolean shouldRestoreExactRoute(boolean rendererCrashed) {
        return !rendererCrashed;
    }

    void cancel() {
        generation += 1;
        awaitingResponse = false;
    }
}
