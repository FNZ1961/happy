import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HappyError } from '@/utils/errors';

/**
 * Tests for useHappyAction error display logic.
 *
 * Bug: When a non-HappyError is thrown, the hook displays 'Unknown error'
 * instead of the actual Error.message. This means RPC failures that throw
 * standard Error('Session process exited') show as 'Unknown error'.
 *
 * After the fix, standard Error instances should display their .message.
 */

// Mock the Modal module
const mockAlert = vi.fn();
vi.mock('@/modal', () => ({
    Modal: {
        alert: (...args: any[]) => mockAlert(...args),
    },
}));

// Mock React hooks for testing outside of React render context
vi.mock('react', async () => {
    const actual = await vi.importActual('react');
    return {
        ...actual as any,
        useState: vi.fn((initial: any) => {
            let value = initial;
            return [value, (v: any) => { value = v; }];
        }),
        useRef: vi.fn((initial: any) => ({ current: initial })),
        useCallback: vi.fn((fn: any) => fn),
    };
});

describe('useHappyAction error handling', () => {
    beforeEach(() => {
        mockAlert.mockClear();
    });

    it('displays HappyError.message for HappyError instances', async () => {
        const { useHappyAction } = await import('./useHappyAction');

        const action = vi.fn().mockRejectedValue(new HappyError('Session already archived', false));
        const [, doAction] = useHappyAction(action);

        doAction();

        // Wait for the async action to resolve
        await vi.waitFor(() => {
            expect(mockAlert).toHaveBeenCalled();
        });

        expect(mockAlert).toHaveBeenCalledWith(
            'Error',
            'Session already archived',
            expect.any(Array)
        );
    });

    it('displays Error.message for standard Error instances (not Unknown error)', async () => {
        const { useHappyAction } = await import('./useHappyAction');

        const action = vi.fn().mockRejectedValue(new Error('Session process exited unexpectedly'));
        const [, doAction] = useHappyAction(action);

        doAction();

        await vi.waitFor(() => {
            expect(mockAlert).toHaveBeenCalled();
        });

        // After the fix, this should show the actual message, not 'Unknown error'
        expect(mockAlert).toHaveBeenCalledWith(
            'Error',
            'Session process exited unexpectedly',
            expect.any(Array)
        );
    });

    it('displays Unknown error for non-Error thrown values', async () => {
        const { useHappyAction } = await import('./useHappyAction');

        const action = vi.fn().mockRejectedValue('string error');
        const [, doAction] = useHappyAction(action);

        doAction();

        await vi.waitFor(() => {
            expect(mockAlert).toHaveBeenCalled();
        });

        // Non-Error values (strings, numbers, etc.) should still show 'Unknown error'
        expect(mockAlert).toHaveBeenCalledWith(
            'Error',
            'Unknown error',
            expect.any(Array)
        );
    });
});
