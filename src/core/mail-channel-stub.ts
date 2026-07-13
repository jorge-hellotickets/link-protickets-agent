/**
 * Stub for mail-channel primitives from host core / @fintmedia/agent-core.
 * replyToMessage and loadThreadMessages are executed by the core runtime
 * which owns the AgentMail client and inbox resolution.
 */
export async function replyToMessage(_args: any): Promise<void> {
  // no-op in standalone; host core performs the actual AgentMail call.
}

export async function loadThreadMessages(_config: any, _locale: string, _externalId: string): Promise<any[]> {
  return [];
}
