export type CodexBridgeRouteHandler = () => boolean | Promise<boolean>

export async function runCodexBridgeRouteHandlers(
  handlers: CodexBridgeRouteHandler[],
): Promise<boolean> {
  for (const handler of handlers) {
    if (await handler()) return true
  }
  return false
}
