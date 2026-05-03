/**
 * Common types for mcp-reverse
 */
/** Default noop logger */
export const noopLogger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
};
/** Minimal console logger */
export const consoleLogger = {
    debug: (...args) => console.debug('[mcp-reverse]', ...args),
    info: (...args) => console.info('[mcp-reverse]', ...args),
    warn: (...args) => console.warn('[mcp-reverse]', ...args),
    error: (...args) => console.error('[mcp-reverse]', ...args),
};
// ─── Connection State ────────────────────────────────────────────────
/** Connection state */
export var ConnectionState;
(function (ConnectionState) {
    ConnectionState["DISCONNECTED"] = "disconnected";
    ConnectionState["CONNECTING"] = "connecting";
    ConnectionState["CONNECTED"] = "connected";
    ConnectionState["RECONNECTING"] = "reconnecting";
    ConnectionState["CLOSED"] = "closed";
})(ConnectionState || (ConnectionState = {}));
//# sourceMappingURL=types.js.map