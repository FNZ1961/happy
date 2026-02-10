// Intercept setTimeout for the Claude Code SDK
const originalSetTimeout = global.setTimeout;

global.setTimeout = function(callback, delay, ...args) {
    // Just wrap and call the original setTimeout
    return originalSetTimeout(callback, delay, ...args);
};

// Preserve setTimeout properties
Object.defineProperty(global.setTimeout, 'name', { value: 'setTimeout' });
Object.defineProperty(global.setTimeout, 'length', { value: originalSetTimeout.length });

// Import global Claude Code CLI
const {
    getClaudeCliPath,
    runClaudeCli,
    ensureWindowsUtf8Env,
    startWindowsUtf8CodePageGuard,
} = require('./claude_version_utils.cjs');

Object.assign(process.env, ensureWindowsUtf8Env(process.env));
startWindowsUtf8CodePageGuard();
runClaudeCli(getClaudeCliPath());