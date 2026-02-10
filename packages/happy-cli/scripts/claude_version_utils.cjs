/**
 * Shared utilities for finding and resolving Claude Code CLI path
 * Used by both local and remote launchers
 *
 * Supports multiple installation methods:
 * 1. npm global: npm install -g @anthropic-ai/claude-code
 * 2. Homebrew: brew install claude-code
 * 3. Native installer:
 *    - macOS/Linux: curl -fsSL https://claude.ai/install.sh | bash
 *    - PowerShell:  irm https://claude.ai/install.ps1 | iex
 *    - Windows CMD: curl -fsSL https://claude.ai/install.cmd | cmd
 * 4. PATH fallback: bun, pnpm, or any other package manager
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EXEC_SYNC_TIMEOUT_MS = 5000;
const WINDOWS_UTF8_GUARD_INTERVAL_MS = 1500;
let windowsUtf8GuardInterval = null;

/**
 * Force active Windows console code page to UTF-8 (65001).
 */
function setWindowsUtf8CodePage() {
    if (process.platform !== 'win32') return;
    try {
        execSync('chcp 65001 >NUL', {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: process.env.ComSpec || 'cmd.exe',
            timeout: EXEC_SYNC_TIMEOUT_MS
        });
    } catch (e) {
        // Ignore if code page change is not allowed
    }
}

/**
 * Keep Windows console code page pinned to UTF-8 while interactive TTY is active.
 * @returns {() => void} Stop function
 */
function startWindowsUtf8CodePageGuard() {
    if (process.platform !== 'win32') return () => {};
    if (!process.stdin.isTTY || !process.stdout.isTTY) return () => {};
    if (windowsUtf8GuardInterval) {
        return () => {
            if (windowsUtf8GuardInterval) {
                clearInterval(windowsUtf8GuardInterval);
                windowsUtf8GuardInterval = null;
            }
        };
    }

    windowsUtf8GuardInterval = setInterval(() => {
        setWindowsUtf8CodePage();
    }, WINDOWS_UTF8_GUARD_INTERVAL_MS);

    if (typeof windowsUtf8GuardInterval.unref === 'function') {
        windowsUtf8GuardInterval.unref();
    }

    return () => {
        if (!windowsUtf8GuardInterval) return;
        clearInterval(windowsUtf8GuardInterval);
        windowsUtf8GuardInterval = null;
    };
}

/**
 * Safely resolve symlink or return path if it exists
 * @param {string} filePath - Path to resolve
 * @returns {string|null} Resolved path or null if not found
 */
function resolvePathSafe(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        return fs.realpathSync(filePath);
    } catch (e) {
        // Symlink resolution failed, return original path
        return filePath;
    }
}

/**
 * On Windows, prefer cli.js when a sibling exists next to an .exe path.
 * @param {string} candidatePath - Candidate executable path
 * @returns {string} Preferred path (cli.js on Windows when available, else original)
 */
function preferWindowsCliJsPath(candidatePath) {
    if (process.platform !== 'win32') return candidatePath;
    if (!candidatePath) return candidatePath;

    const normalized = candidatePath.toLowerCase();
    const looksLikeBinary = normalized.endsWith('.exe') || (!normalized.endsWith('.js') && !normalized.endsWith('.cjs'));
    if (!looksLikeBinary) return candidatePath;

    const siblingCliPath = path.join(path.dirname(candidatePath), 'cli.js');
    if (fs.existsSync(siblingCliPath)) {
        return siblingCliPath;
    }

    return candidatePath;
}

/**
 * Detect a valid Git Bash executable path on Windows.
 * @param {NodeJS.ProcessEnv} baseEnv - Base environment variables
 * @returns {string|null} Normalized Git Bash path or null
 */
function findWindowsGitBashPath(baseEnv = process.env) {
    if (process.platform !== 'win32') return null;

    const normalizeGitBashPath = (candidatePath) => {
        if (!candidatePath) return null;
        const normalizedPath = path.normalize(candidatePath);
        const lowerPath = normalizedPath.toLowerCase();
        if (!lowerPath.endsWith('bash.exe')) return null;
        if (!lowerPath.includes(`${path.sep}git${path.sep}`)) return null;
        return normalizedPath;
    };

    const candidates = [];
    const addCandidate = (candidatePath) => {
        const normalizedPath = normalizeGitBashPath(candidatePath);
        if (!normalizedPath) return;
        if (!candidates.includes(normalizedPath)) {
            candidates.push(normalizedPath);
        }
    };

    // 1) Respect existing env var first
    if (baseEnv.CLAUDE_CODE_GIT_BASH_PATH) {
        const existingPath = normalizeGitBashPath(baseEnv.CLAUDE_CODE_GIT_BASH_PATH);
        if (existingPath && fs.existsSync(existingPath)) {
            return existingPath;
        }
    }

    // 2) Common installation roots
    const candidateRoots = [
        baseEnv.ProgramFiles,
        baseEnv.ProgramW6432,
        baseEnv['ProgramFiles(x86)'],
        baseEnv.LOCALAPPDATA ? path.join(baseEnv.LOCALAPPDATA, 'Programs') : null
    ];

    for (const root of candidateRoots) {
        if (!root) continue;
        addCandidate(path.join(root, 'Git', 'bin', 'bash.exe'));
        addCandidate(path.join(root, 'Git', 'usr', 'bin', 'bash.exe'));
    }

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    // 3) Derive from where git
    try {
        const gitPaths = execSync('where git', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: EXEC_SYNC_TIMEOUT_MS
        }).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

        for (const gitPath of gitPaths) {
            const lowerGitPath = gitPath.toLowerCase();
            let gitRoot = null;

            if (lowerGitPath.endsWith('\\cmd\\git.exe')) {
                gitRoot = path.dirname(path.dirname(gitPath));
            } else if (lowerGitPath.endsWith('\\mingw64\\bin\\git.exe')) {
                gitRoot = path.dirname(path.dirname(path.dirname(gitPath)));
            } else {
                gitRoot = path.dirname(path.dirname(gitPath));
            }

            addCandidate(path.join(gitRoot, 'bin', 'bash.exe'));
            addCandidate(path.join(gitRoot, 'usr', 'bin', 'bash.exe'));
        }
    } catch (e) {
        // git not available
    }

    // 4) Derive from where bash (prefer Git Bash paths only)
    try {
        const bashPaths = execSync('where bash', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: EXEC_SYNC_TIMEOUT_MS
        }).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

        for (const bashPath of bashPaths) {
            addCandidate(bashPath);
        }
    } catch (e) {
        // bash not available
    }

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    return null;
}

/**
 * Ensure UTF-8 console and locale environment on Windows.
 * @param {NodeJS.ProcessEnv} baseEnv - Base environment variables
 * @returns {NodeJS.ProcessEnv} Environment with UTF-8 locale hints on Windows
 */
function ensureWindowsUtf8Env(baseEnv) {
    const env = { ...baseEnv };
    if (process.platform !== 'win32') return env;

    // Ensure UTF-8 code page for current interactive console.
    setWindowsUtf8CodePage();

    if (!env.LANG) env.LANG = 'C.UTF-8';
    if (!env.LC_ALL) env.LC_ALL = 'C.UTF-8';

    if (env.CLAUDE_CODE_GIT_BASH_PATH) {
        const normalizedBashPath = path.normalize(env.CLAUDE_CODE_GIT_BASH_PATH);
        if (fs.existsSync(normalizedBashPath)) {
            env.CLAUDE_CODE_GIT_BASH_PATH = normalizedBashPath;
        }
    } else {
        const detectedBashPath = findWindowsGitBashPath(env);
        if (detectedBashPath) {
            env.CLAUDE_CODE_GIT_BASH_PATH = detectedBashPath;
        }
    }

    return env;
}

/**
 * Find path to npm globally installed Claude Code CLI
 * @returns {string|null} Path to cli.js or null if not found
 */
function findNpmGlobalCliPath() {
    try {
        const globalRoot = execSync('npm root -g', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: EXEC_SYNC_TIMEOUT_MS
        }).trim();
        const globalCliPath = path.join(globalRoot, '@anthropic-ai', 'claude-code', 'cli.js');
        if (fs.existsSync(globalCliPath)) {
            return globalCliPath;
        }
    } catch (e) {
        // npm root -g failed
    }
    return null;
}

/**
 * Find Claude CLI using system PATH (which/where command)
 * Respects user's configuration and works across all platforms
 * @returns {{path: string, source: string}|null} Path and source, or null if not found
 */
function findClaudeInPath() {
    try {
        // Cross-platform: 'where' on Windows, 'which' on Unix
        const command = process.platform === 'win32' ? 'where claude' : 'which claude';
        // stdio suppression for cleaner execution (from tiann/PR#83)
        const result = execSync(command, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: EXEC_SYNC_TIMEOUT_MS
        }).trim();

        const claudePath = result.split('\n')[0].trim(); // Take first match
        if (!claudePath) return null;

        // Check existence BEFORE resolving (from tiann/PR#83)
        if (!fs.existsSync(claudePath)) return null;

        // Resolve with fallback to original path (from tiann/PR#83)
        const resolvedPath = resolvePathSafe(claudePath) || claudePath;
        const preferredPath = preferWindowsCliJsPath(resolvedPath);

        if (preferredPath) {
            // Detect source from BOTH original PATH entry and resolved path
            // Original path tells us HOW user accessed it (context)
            // Resolved path tells us WHERE it actually lives (content)
            const originalSource = detectSourceFromPath(claudePath);
            const resolvedSource = detectSourceFromPath(preferredPath);

            // Prioritize original PATH entry for context (e.g., bun vs npm access)
            // Fall back to resolved path for accurate location detection
            const source = originalSource !== 'PATH' ? originalSource : resolvedSource;

            return {
                path: preferredPath,
                source: source
            };
        }
    } catch (e) {
        // Command failed (claude not in PATH)
    }
    return null;
}

/**
 * Detect installation source from resolved path
 * Uses concrete path patterns, no assumptions
 * @param {string} resolvedPath - The resolved path to cli.js
 * @returns {string} Installation method/source
 */
function detectSourceFromPath(resolvedPath) {
    // Use path.normalize() with unified separators for cross-platform path checks
    const normalizedPath = path.normalize(resolvedPath).replace(/\\/g, '/').toLowerCase();

    // Bun: ~/.bun/bin/claude -> ../node_modules/@anthropic-ai/claude-code/cli.js
    // Works on Windows too: C:\Users\[user]\.bun\bin\claude
    if (normalizedPath.includes('.bun') && normalizedPath.includes('bin') ||
        (normalizedPath.includes('node_modules') && normalizedPath.includes('.bun'))) {
        return 'Bun';
    }

    // Homebrew cask: hashed directories like .claude-code-2DTsDk1V (NOT npm installations)
    // Must check before general Homebrew paths to distinguish from npm-through-Homebrew
    if (normalizedPath.includes('@anthropic-ai') && normalizedPath.includes('.claude-code-')) {
        return 'Homebrew';
    }

    // npm: clean claude-code directory (even through Homebrew's npm)
    // Windows: %APPDATA%\npm\node_modules\@anthropic-ai\claude-code
    if (normalizedPath.includes('node_modules') && normalizedPath.includes('@anthropic-ai') && normalizedPath.includes('claude-code') &&
        !normalizedPath.includes('.claude-code-')) {
        return 'npm';
    }

    // Windows-specific detection (detect by path patterns, not current platform)
    if (normalizedPath.includes('appdata') || normalizedPath.includes('program files') || normalizedPath.includes('/.claude/') || normalizedPath.endsWith('.exe')) {
        // Windows npm
        if (normalizedPath.includes('appdata') && normalizedPath.includes('npm') && normalizedPath.includes('node_modules')) {
            return 'npm';
        }

        // Windows native installer (any location ending with claude.exe)
        if (normalizedPath.endsWith('claude.exe')) {
            return 'native installer';
        }

        // Windows native installer cli.js under %USERPROFILE%/.claude/
        if (normalizedPath.includes('/.claude/') && normalizedPath.endsWith('/cli.js')) {
            return 'native installer';
        }

        // Windows native installer in AppData
        if (normalizedPath.includes('appdata') && normalizedPath.includes('claude')) {
            return 'native installer';
        }

        // Windows native installer in Program Files
        if (normalizedPath.includes('program files') && normalizedPath.includes('claude')) {
            return 'native installer';
        }
    }

    // Homebrew general paths (for non-npm installations like Cellar binaries)
    // Apple Silicon: /opt/homebrew/bin/claude
    // Intel Mac: /usr/local/bin/claude (ONLY on macOS, not Linux)
    // Linux Homebrew: /home/linuxbrew/.linuxbrew/bin/claude or ~/.linuxbrew/bin/claude
    if (normalizedPath.includes('opt/homebrew') ||
        normalizedPath.includes('usr/local/homebrew') ||
        normalizedPath.includes('home/linuxbrew') ||
        normalizedPath.includes('.linuxbrew') ||
        normalizedPath.includes('.homebrew') ||
        normalizedPath.includes('cellar') ||
        normalizedPath.includes('caskroom') ||
        (normalizedPath.includes('usr/local/bin/claude') && process.platform === 'darwin')) { // Intel Mac Homebrew default only on macOS
        return 'Homebrew';
    }

    // Native installer: standard Unix locations and ~/.local/bin
    // /usr/local/bin/claude on Linux should be native installer
    if (normalizedPath.includes('.local') && normalizedPath.includes('bin') ||
        normalizedPath.includes('.local') && normalizedPath.includes('share') && normalizedPath.includes('claude') ||
        (normalizedPath.includes('usr/local/bin/claude') && process.platform === 'linux')) { // Linux native installer
        return 'native installer';
    }

    // Default: we found it in PATH but can't determine source
    return 'PATH';
}

/**
 * Find path to Bun globally installed Claude Code CLI
 * FIX: Check bun's bin directory, not non-existent modules directory
 * @returns {string|null} Path to cli.js or null if not found
 */
function findBunGlobalCliPath() {
    // First check if bun command exists (cross-platform)
    try {
        const bunCheckCommand = process.platform === 'win32' ? 'where bun' : 'which bun';
        execSync(bunCheckCommand, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: EXEC_SYNC_TIMEOUT_MS
        });
    } catch (e) {
        return null; // bun not installed
    }

    // Check bun's binary directory (works on both Unix and Windows)
    const bunBin = path.join(os.homedir(), '.bun', 'bin', 'claude');
    const resolved = resolvePathSafe(bunBin);

    if (resolved && resolved.endsWith('cli.js') && fs.existsSync(resolved)) {
        return resolved;
    }

    return null;
}

/**
 * Find path to Homebrew installed Claude Code CLI
 * FIX: Handle hashed directory names like .claude-code-[hash]
 * @returns {string|null} Path to cli.js or binary, or null if not found
 */
function findHomebrewCliPath() {
    if (process.platform !== 'darwin' && process.platform !== 'linux') {
        return null;
    }

    const possiblePrefixes = [
        '/opt/homebrew',
        '/usr/local',
        path.join(os.homedir(), '.linuxbrew'),
        path.join(os.homedir(), '.homebrew')
    ].filter(fs.existsSync);

    for (const prefix of possiblePrefixes) {
        // Check for binary symlink first (most reliable)
        const binPath = path.join(prefix, 'bin', 'claude');
        const resolved = resolvePathSafe(binPath);
        if (resolved && fs.existsSync(resolved)) {
            return resolved;
        }

        // Fallback: check for hashed directories in node_modules
        const nodeModulesPath = path.join(prefix, 'lib', 'node_modules', '@anthropic-ai');
        if (fs.existsSync(nodeModulesPath)) {
            // Look for both claude-code and .claude-code-[hash]
            const entries = fs.readdirSync(nodeModulesPath);
            for (const entry of entries) {
                if (entry === 'claude-code' || entry.startsWith('.claude-code-')) {
                    const cliPath = path.join(nodeModulesPath, entry, 'cli.js');
                    if (fs.existsSync(cliPath)) {
                        return cliPath;
                    }
                }
            }
        }
    }

    return null;
}

/**
 * Find path to native installer Claude Code CLI
 * 
 * Installation locations:
 * - macOS/Linux: ~/.local/bin/claude (symlink) -> ~/.local/share/claude/versions/<version>
 * - Windows: %LOCALAPPDATA%\Claude\ or %USERPROFILE%\.claude\
 * - Legacy: ~/.claude/local/
 * 
 * @returns {string|null} Path to cli.js or binary, or null if not found
 */
function findNativeInstallerCliPath() {
    const homeDir = os.homedir();

    // Windows-specific locations
    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');

        // Check %LOCALAPPDATA%\Claude\
        const windowsClaudePath = path.join(localAppData, 'Claude');
        if (fs.existsSync(windowsClaudePath)) {
            // Check for cli.js directly first
            const cliPath = path.join(windowsClaudePath, 'cli.js');
            if (fs.existsSync(cliPath)) {
                return cliPath;
            }

            // Check for versions directory
            const versionsDir = path.join(windowsClaudePath, 'versions');
            if (fs.existsSync(versionsDir)) {
                const found = findLatestVersionBinary(versionsDir);
                if (found) return found;
            }

            // Check for claude.exe directly (fallback)
            const exePath = path.join(windowsClaudePath, 'claude.exe');
            if (fs.existsSync(exePath)) {
                return exePath;
            }
        }

        // Check %USERPROFILE%\.claude\ (alternative Windows location)
        const dotClaudePath = path.join(homeDir, '.claude');
        if (fs.existsSync(dotClaudePath)) {
            const cliPath = path.join(dotClaudePath, 'cli.js');
            if (fs.existsSync(cliPath)) {
                return cliPath;
            }

            const versionsDir = path.join(dotClaudePath, 'versions');
            if (fs.existsSync(versionsDir)) {
                const found = findLatestVersionBinary(versionsDir);
                if (found) return found;
            }

            const exePath = path.join(dotClaudePath, 'claude.exe');
            if (fs.existsSync(exePath)) {
                return exePath;
            }
        }
    }
    
    // Check ~/.local/bin/claude symlink (most common location on macOS/Linux)
    const localBinPath = path.join(homeDir, '.local', 'bin', 'claude');
    const resolvedLocalBinPath = resolvePathSafe(localBinPath);
    if (resolvedLocalBinPath) return resolvedLocalBinPath;
    
    // Check ~/.local/share/claude/versions/ (native installer location)
    const versionsDir = path.join(homeDir, '.local', 'share', 'claude', 'versions');
    if (fs.existsSync(versionsDir)) {
        const found = findLatestVersionBinary(versionsDir);
        if (found) return found;
    }
    
    // Check ~/.claude/local/ (older installation method)
    const nativeBasePath = path.join(homeDir, '.claude', 'local');
    if (fs.existsSync(nativeBasePath)) {
        // Look for the cli.js in the node_modules structure
        const cliPath = path.join(nativeBasePath, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
        if (fs.existsSync(cliPath)) {
            return cliPath;
        }
        
        // Alternative: direct cli.js in the installation
        const directCliPath = path.join(nativeBasePath, 'cli.js');
        if (fs.existsSync(directCliPath)) {
            return directCliPath;
        }
    }
    
    return null;
}

/**
 * Helper to find the latest version binary in a versions directory
 * @param {string} versionsDir - Path to versions directory
 * @param {string} [binaryName] - Optional binary name to look for inside version directory
 * @returns {string|null} Path to binary or null
 */
function findLatestVersionBinary(versionsDir, binaryName = null) {
    try {
        const entries = fs.readdirSync(versionsDir);
        if (entries.length === 0) return null;
        
        // Sort using semver comparison (descending)
        const sorted = entries.sort((a, b) => compareVersions(b, a));
        const latestVersion = sorted[0];
        const versionPath = path.join(versionsDir, latestVersion);
        
        // Check if it's a file (binary) or directory
        const stat = fs.statSync(versionPath);
        if (stat.isFile()) {
            return versionPath;
        } else if (stat.isDirectory()) {
            // If specific binary name provided, check for it
            if (binaryName) {
                const binaryPath = path.join(versionPath, binaryName);
                if (fs.existsSync(binaryPath)) {
                    return binaryPath;
                }
            }
            // On Windows, prefer cli.js first for better UTF-8 behavior.
            const cliPath = path.join(versionPath, 'cli.js');
            if (fs.existsSync(cliPath)) {
                return cliPath;
            }
            const exePath = path.join(versionPath, process.platform === 'win32' ? 'claude.exe' : 'claude');
            if (fs.existsSync(exePath)) {
                return exePath;
            }
        }
    } catch (e) {
        // Directory read failed
    }
    return null;
}

/**
 * Find path to globally installed Claude Code CLI
 * Priority: HAPPY_CLAUDE_PATH env var > PATH > npm > Bun > Homebrew > Native
 * @returns {{path: string, source: string}|null} Path and source, or null if not found
 */
function findGlobalClaudeCliPath() {
    // 1. Environment variable (explicit override)
    const envPath = process.env.HAPPY_CLAUDE_PATH;
    if (envPath && fs.existsSync(envPath)) {
        const resolved = resolvePathSafe(envPath) || envPath;
        return { path: resolved, source: 'HAPPY_CLAUDE_PATH' };
    }

    // 2. On Windows, prefer discoverers that can return cli.js before PATH fallback.
    if (process.platform === 'win32') {
        const npmPath = findNpmGlobalCliPath();
        if (npmPath) return { path: npmPath, source: 'npm' };

        const bunPath = findBunGlobalCliPath();
        if (bunPath) return { path: bunPath, source: 'Bun' };

        const nativePath = findNativeInstallerCliPath();
        if (nativePath) return { path: nativePath, source: 'native installer' };

        const pathResult = findClaudeInPath();
        if (pathResult) return pathResult;

        return null;
    }

    // 2. Non-Windows: keep existing priority
    const pathResult = findClaudeInPath();
    if (pathResult) return pathResult;

    // 3. Fall back to package manager detection
    const npmPath = findNpmGlobalCliPath();
    if (npmPath) return { path: npmPath, source: 'npm' };

    const bunPath = findBunGlobalCliPath();
    if (bunPath) return { path: bunPath, source: 'Bun' };

    const homebrewPath = findHomebrewCliPath();
    if (homebrewPath) return { path: homebrewPath, source: 'Homebrew' };

    const nativePath = findNativeInstallerCliPath();
    if (nativePath) return { path: nativePath, source: 'native installer' };

    return null;
}

/**
 * Get version from Claude Code package.json
 * @param {string} cliPath - Path to cli.js
 * @returns {string|null} Version string or null
 */
function getVersion(cliPath) {
    try {
        const pkgPath = path.join(path.dirname(cliPath), 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            return pkg.version;
        }
    } catch (e) {}
    return null;
}

/**
 * Compare semver versions
 * @param {string} a - First version
 * @param {string} b - Second version
 * @returns {number} 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a, b) {
    if (!a || !b) return 0;
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (partsA[i] > partsB[i]) return 1;
        if (partsA[i] < partsB[i]) return -1;
    }
    return 0;
}

/**
 * Get the CLI path to use (global installation)
 * @returns {string} Path to cli.js
 * @throws {Error} If no global installation found
 */
function getClaudeCliPath() {
    const result = findGlobalClaudeCliPath();
    if (!result) {
        console.error('\n\x1b[1m\x1b[33mClaude Code is not installed\x1b[0m\n');
        console.error('Please install Claude Code using one of these methods:\n');
        console.error('\x1b[1mOption 1 - npm (recommended, highest priority):\x1b[0m');
        console.error('  \x1b[36mnpm install -g @anthropic-ai/claude-code\x1b[0m\n');
        console.error('\x1b[1mOption 2 - Homebrew (macOS/Linux):\x1b[0m');
        console.error('  \x1b[36mbrew install claude-code\x1b[0m\n');
        console.error('\x1b[1mOption 3 - Native installer:\x1b[0m');
        console.error('  \x1b[90mmacOS/Linux:\x1b[0m  \x1b[36mcurl -fsSL https://claude.ai/install.sh | bash\x1b[0m');
        console.error('  \x1b[90mPowerShell:\x1b[0m   \x1b[36mirm https://claude.ai/install.ps1 | iex\x1b[0m');
        console.error('  \x1b[90mWindows CMD:\x1b[0m  \x1b[36mcurl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd\x1b[0m\n');
        console.error('\x1b[90mNote: If multiple installations exist, npm takes priority.\x1b[0m\n');
        process.exit(1);
    }

    const version = getVersion(result.path);
    const versionStr = version ? ` v${version}` : '';
    console.error(`\x1b[90mUsing Claude Code${versionStr} from ${result.source}\x1b[0m`);

    return result.path;
}

/**
 * Run Claude CLI, handling both JavaScript and binary files
 * @param {string} cliPath - Path to CLI (from getClaudeCliPath)
 */
function runClaudeCli(cliPath) {
    const { pathToFileURL } = require('url');
    const { spawn } = require('child_process');

    // Check if it's a JavaScript file (.js or .cjs) or a binary file
    const isJsFile = cliPath.endsWith('.js') || cliPath.endsWith('.cjs');
    const env = ensureWindowsUtf8Env(process.env);

    if (isJsFile) {
        // JavaScript file - use import to keep interceptors working
        const importUrl = pathToFileURL(cliPath).href;
        import(importUrl);
        return;
    }

    // Binary file (e.g., Homebrew/native installer) - spawn directly.
    // Do not run native binaries through node.exe on Windows.
    const args = process.argv.slice(2);
    const child = spawn(cliPath, args, {
        stdio: 'inherit',
        env
    });
    child.on('error', (error) => {
        console.error(`Failed to launch Claude CLI at ${cliPath}: ${error.message}`);
        process.exit(1);
    });
    child.on('exit', (code) => {
        process.exit(code || 0);
    });
}

module.exports = {
    findGlobalClaudeCliPath,
    findClaudeInPath,
    detectSourceFromPath,
    findNpmGlobalCliPath,
    findBunGlobalCliPath,
    findHomebrewCliPath,
    findNativeInstallerCliPath,
    getVersion,
    compareVersions,
    getClaudeCliPath,
    runClaudeCli,
    preferWindowsCliJsPath,
    ensureWindowsUtf8Env,
    findWindowsGitBashPath,
    setWindowsUtf8CodePage,
    startWindowsUtf8CodePageGuard,
};

