package com.cxcodex.bridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TaskNotificationPolicyTest {
    @Test
    public void mapsRuntimeStatesToTruthfulTwoCharacterLabels() {
        assertEquals("执行", TaskNotificationPolicy.statusLabel("queued"));
        assertEquals("执行", TaskNotificationPolicy.statusLabel("running"));
        assertEquals("等待", TaskNotificationPolicy.statusLabel("waiting_permission"));
        assertEquals("同步", TaskNotificationPolicy.statusLabel("start_uncertain"));
        assertEquals("同步", TaskNotificationPolicy.statusLabel("stop_uncertain"));
        assertEquals("同步", TaskNotificationPolicy.statusLabel("stale"));
        assertEquals("完成", TaskNotificationPolicy.statusLabel("completed"));
        assertEquals("失败", TaskNotificationPolicy.statusLabel("failed"));
        assertEquals("停止", TaskNotificationPolicy.statusLabel("interrupted"));
        assertEquals("待命", TaskNotificationPolicy.statusLabel("idle"));
    }

    @Test
    public void exposesStopOnlyWhenAnActiveTurnCanBeAddressed() {
        assertTrue(TaskNotificationPolicy.canStop("running", "turn-1"));
        assertTrue(TaskNotificationPolicy.canStop("waiting_permission", "turn-1"));
        assertFalse(TaskNotificationPolicy.canStop("running", ""));
        assertFalse(TaskNotificationPolicy.canStop("stop_uncertain", "turn-1"));
        assertFalse(TaskNotificationPolicy.canStop("completed", "turn-1"));
    }

    @Test
    public void keepsReviewAndPlanPresetsReadOnly() {
        assertEquals("继续", TaskNotificationPolicy.presetPrompt(TaskNotificationPolicy.PRESET_CONTINUE));
        assertEquals(
            "审查刚才的任务结果，只报告问题、风险和遗漏，不要修改。",
            TaskNotificationPolicy.presetPrompt(TaskNotificationPolicy.PRESET_REVIEW)
        );
        assertEquals(
            "基于刚才的结果给出下一步计划，不要执行。",
            TaskNotificationPolicy.presetPrompt(TaskNotificationPolicy.PRESET_PLAN)
        );
    }
}
