/**
 * Stub for loadAgentConfig from @fintmedia/agent-core (or host core).
 * The real implementation lives in the core package / host runtime.
 * This allows the agent package to compile standalone.
 */
export async function loadAgentConfig(_key: string): Promise<{ config: any; enabled: boolean } | null> {
  // In real usage the core registry + prisma Agent row provides this.
  return null;
}
