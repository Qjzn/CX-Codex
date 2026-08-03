export type RuntimeExecutionRecoveryEvidence = {
  executionActive: boolean
  sourceInProgress: boolean
  runtimeFreshActive: boolean
  hasRunningCommand: boolean
  hasPendingServerRequest: boolean
  hasFreshExecutionSignal: boolean
  pendingTurnAgeMs: number | null
  recoveryGraceMs: number
  hasActiveTurnId: boolean
  queueProcessing: boolean
}

export function isOptimisticOnlyExecutionEvidence(
  evidence: RuntimeExecutionRecoveryEvidence,
): boolean {
  if (!evidence.executionActive) return false
  if (evidence.sourceInProgress || evidence.runtimeFreshActive) return false
  if (evidence.hasRunningCommand || evidence.hasPendingServerRequest) return false
  if (evidence.hasFreshExecutionSignal) return false
  if (evidence.pendingTurnAgeMs !== null) {
    return evidence.pendingTurnAgeMs >= evidence.recoveryGraceMs
  }
  return evidence.hasActiveTurnId || evidence.queueProcessing
}
