import type { ConversationProjection } from './types.js'

export const PLAN_IMPLEMENTATION_CONFIRMATION = '是的，执行此计划'

export function planImplementationKey(turnId: string, activityId: string): string {
  return JSON.stringify([turnId, activityId])
}

// Derive from the transcript, not a second browser cache. A completed progress
// checklist is not a proposed plan; the protocol's plan item carries proposal text.
export function derivePlanImplementationState(projection: ConversationProjection): {
  implementedPlanKeys: string[]
  actionablePlanKey: string | null
} {
  const implementedPlanKeys: string[] = []
  let actionablePlanKey: string | null = null
  for (const turn of projection.turns) {
    const opener = turn.opener
    const confirmsPlan = opener?.text.trim() === PLAN_IMPLEMENTATION_CONFIRMATION
    if (confirmsPlan && opener?.deliveryState === 'failed') continue
    if (actionablePlanKey && confirmsPlan && (!opener?.deliveryState || opener.deliveryState === 'sent')) {
      implementedPlanKeys.push(actionablePlanKey)
    }
    actionablePlanKey = null
    if (turn.state !== 'completed') continue
    for (const activity of turn.activities) {
      if (activity.activityType === 'plan' && activity.status === 'completed' && activity.text.trim()) {
        actionablePlanKey = planImplementationKey(turn.id, activity.id)
      }
    }
  }
  return { implementedPlanKeys, actionablePlanKey }
}
