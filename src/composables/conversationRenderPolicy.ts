export type ConversationMessageIdentity = {
  id: string
}

export function haveSameConversationMessageStructure(
  previous: readonly ConversationMessageIdentity[],
  next: readonly ConversationMessageIdentity[],
): boolean {
  if (previous.length !== next.length) return false
  for (let index = 0; index < next.length; index += 1) {
    if (previous[index]?.id !== next[index]?.id) return false
  }
  return true
}
