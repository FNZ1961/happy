import { describe, it, expect, vi } from 'vitest';

/**
 * Tests for RPC error message propagation in ApiSocket.
 *
 * Bug: sessionRPC and machineRPC throw generic 'RPC call failed' instead of
 * forwarding the server-provided error message from result.error.
 *
 * After the fix, when result.ok is false, the thrown Error should include
 * result.error if available.
 */

// We cannot easily instantiate ApiSocket in isolation because it depends on
// socket.io-client and Encryption. Instead, we mock the socket and encryption
// to test the error propagation path.

vi.mock('socket.io-client', () => ({
    io: vi.fn(),
}));

vi.mock('@/auth/tokenStorage', () => ({
    TokenStorage: {
        getCredentials: vi.fn().mockResolvedValue({ token: 'mock-token' }),
    },
}));

describe('ApiSocket RPC error propagation', () => {
    it('sessionRPC throws error with server-provided message when result.ok is false', async () => {
        // Dynamically import to get the singleton after mocks are set up
        const { apiSocket } = await import('./apiSocket');

        // Set up mock socket with emitWithAck that returns an error response
        const mockEmitWithAck = vi.fn().mockResolvedValue({
            ok: false,
            error: 'Session process exited unexpectedly',
        });

        // Access private socket field via any cast
        (apiSocket as any).socket = { emitWithAck: mockEmitWithAck } as any;

        // Set up mock encryption
        const mockEncryptRaw = vi.fn().mockResolvedValue('encrypted-params');
        const mockDecryptRaw = vi.fn();
        (apiSocket as any).encryption = {
            getSessionEncryption: vi.fn().mockReturnValue({
                encryptRaw: mockEncryptRaw,
                decryptRaw: mockDecryptRaw,
            }),
        };

        // The fix should cause this to throw with the server's error message,
        // not the generic 'RPC call failed'
        await expect(
            apiSocket.sessionRPC('session-123', 'archive', {})
        ).rejects.toThrow('Session process exited unexpectedly');
    });

    it('machineRPC throws error with server-provided message when result.ok is false', async () => {
        const { apiSocket } = await import('./apiSocket');

        const mockEmitWithAck = vi.fn().mockResolvedValue({
            ok: false,
            error: 'RPC method not available',
        });

        (apiSocket as any).socket = { emitWithAck: mockEmitWithAck } as any;

        const mockEncryptRaw = vi.fn().mockResolvedValue('encrypted-params');
        const mockDecryptRaw = vi.fn();
        (apiSocket as any).encryption = {
            getMachineEncryption: vi.fn().mockReturnValue({
                encryptRaw: mockEncryptRaw,
                decryptRaw: mockDecryptRaw,
            }),
        };

        await expect(
            apiSocket.machineRPC('machine-456', 'stop-daemon', {})
        ).rejects.toThrow('RPC method not available');
    });

    it('sessionRPC falls back to generic message when result.error is absent', async () => {
        const { apiSocket } = await import('./apiSocket');

        const mockEmitWithAck = vi.fn().mockResolvedValue({
            ok: false,
            // no error field
        });

        (apiSocket as any).socket = { emitWithAck: mockEmitWithAck } as any;

        const mockEncryptRaw = vi.fn().mockResolvedValue('encrypted-params');
        (apiSocket as any).encryption = {
            getSessionEncryption: vi.fn().mockReturnValue({
                encryptRaw: mockEncryptRaw,
            }),
        };

        await expect(
            apiSocket.sessionRPC('session-123', 'archive', {})
        ).rejects.toThrow('RPC call failed');
    });
});
