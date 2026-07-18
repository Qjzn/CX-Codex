package com.cxcodex.bridge;

final class TaskPetRuntimePolicy {
    private TaskPetRuntimePolicy() {}

    static boolean shouldApplySnapshot(long currentEventSeq, long incomingEventSeq) {
        return currentEventSeq <= 0L || incomingEventSeq <= 0L || incomingEventSeq >= currentEventSeq;
    }

    static boolean shouldRetainOmittedTask(String state) {
        return "completed".equals(state);
    }

    static boolean isAwaitingConfirmation(String status) {
        return "pending_start".equals(status)
            || "starting".equals(status)
            || "start_uncertain".equals(status)
            || "sync_degraded".equals(status);
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
