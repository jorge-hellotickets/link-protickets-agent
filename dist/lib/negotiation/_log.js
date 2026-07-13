/**
 * Shared structured warn-logger for negotiation pipeline components.
 * Prefix convention: `[link-agent:<component>] <TAG> <extra?>`.
 */
export function makeLogFailure(component) {
    return function logFailure(tag, extra) {
        const suffix = extra ? ` ${extra}` : "";
        console.warn(`[link-agent:${component}] ${tag}${suffix}`);
    };
}
//# sourceMappingURL=_log.js.map