/**
 * Shared structured warn-logger for negotiation pipeline components.
 * Prefix convention: `[link-agent:<component>] <TAG> <extra?>`.
 */
export function makeLogFailure(component: string) {
  return function logFailure(tag: string, extra?: string): void {
    const suffix = extra ? ` ${extra}` : "";
    console.warn(`[link-agent:${component}] ${tag}${suffix}`);
  };
}
