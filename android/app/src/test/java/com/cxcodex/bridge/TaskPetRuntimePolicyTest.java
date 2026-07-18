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
    public void retainsOnlyReadPendingCompletedRowsWhenSnapshotOmitsThem() {
        assertTrue(TaskPetRuntimePolicy.shouldRetainOmittedTask("completed"));
        assertFalse(TaskPetRuntimePolicy.shouldRetainOmittedTask("running"));
        assertFalse(TaskPetRuntimePolicy.shouldRetainOmittedTask("waiting"));
    }

    @Test
    public void keepsDegradedDeliveryInConfirmationState() {
        assertTrue(TaskPetRuntimePolicy.isAwaitingConfirmation("start_uncertain"));
        assertTrue(TaskPetRuntimePolicy.isAwaitingConfirmation("sync_degraded"));
        assertFalse(TaskPetRuntimePolicy.isAwaitingConfirmation("running"));
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
}
