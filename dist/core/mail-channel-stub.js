/**
 * Stub for mail-channel primitives from host core / @fintmedia/agent-core.
 * replyToMessage and loadThreadMessages are executed by the core runtime
 * which owns the AgentMail client and inbox resolution.
 */
export async function replyToMessage(_args) {
    // no-op in standalone; host core performs the actual AgentMail call.
}
export async function loadThreadMessages(_config, _locale, _externalId) {
    return [];
}
//# sourceMappingURL=mail-channel-stub.js.map