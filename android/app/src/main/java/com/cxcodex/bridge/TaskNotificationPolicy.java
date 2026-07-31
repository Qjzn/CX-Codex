package com.cxcodex.bridge;

final class TaskNotificationPolicy {
    static final String PRESET_CONTINUE = "continue";
    static final String PRESET_REVIEW = "review";
    static final String PRESET_PLAN = "plan";

    private TaskNotificationPolicy() {}

    static String statusLabel(String executionState) {
        String state = executionState == null ? "" : executionState.trim();
        switch (state) {
            case "waiting":
            case "waiting_permission":
                return "等待";
            case "start_uncertain":
            case "stopping":
            case "stop_uncertain":
            case "completed_pending_sync":
            case "sync_degraded":
            case "stale":
            case "pending_start":
                return "同步";
            case "completed":
                return "完成";
            case "failed":
            case "retry":
                return "失败";
            case "interrupted":
            case "stopped":
                return "停止";
            case "idle":
                return "待命";
            case "queued":
            case "starting":
            case "running":
            default:
                return "执行";
        }
    }

    static boolean canStop(String executionState, String activeTurnId) {
        if (activeTurnId == null || activeTurnId.trim().isEmpty()) return false;
        String state = executionState == null ? "" : executionState.trim();
        return "queued".equals(state)
            || "starting".equals(state)
            || "running".equals(state)
            || "waiting_permission".equals(state);
    }

    static String presetPrompt(String preset) {
        if (PRESET_CONTINUE.equals(preset)) return "继续";
        if (PRESET_REVIEW.equals(preset)) {
            return "审查刚才的任务结果，只报告问题、风险和遗漏，不要修改。";
        }
        if (PRESET_PLAN.equals(preset)) {
            return "基于刚才的结果给出下一步计划，不要执行。";
        }
        return "";
    }
}
