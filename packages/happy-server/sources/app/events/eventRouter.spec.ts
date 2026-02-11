import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the storage/files module to avoid Minio client initialization at import time
vi.mock('@/storage/files', () => ({
    getPublicUrl: (path: string) => `https://mock-s3/${path}`,
    s3client: {},
    s3bucket: 'mock-bucket',
    s3host: 'mock-host',
    s3public: 'https://mock-s3',
}));

import {
    buildSessionActivityEphemeral,
    buildMachineActivityEphemeral,
    eventRouter,
} from './eventRouter';

// --- Test the builder functions ---

describe('buildSessionActivityEphemeral', () => {
    it('returns an ephemeral payload with active=true', () => {
        const payload = buildSessionActivityEphemeral('session-1', true, 1000, false);
        expect(payload).toEqual({
            type: 'activity',
            id: 'session-1',
            active: true,
            activeAt: 1000,
            thinking: false,
        });
    });

    it('returns an ephemeral payload with active=false', () => {
        const payload = buildSessionActivityEphemeral('session-1', false, 2000, false);
        expect(payload).toEqual({
            type: 'activity',
            id: 'session-1',
            active: false,
            activeAt: 2000,
            thinking: false,
        });
    });

    it('defaults thinking to false when undefined', () => {
        const payload = buildSessionActivityEphemeral('session-1', true, 1000);
        expect(payload.thinking).toBe(false);
    });
});

describe('buildMachineActivityEphemeral', () => {
    it('returns an ephemeral payload for machine activity', () => {
        const payload = buildMachineActivityEphemeral('machine-1', false, 3000);
        expect(payload).toEqual({
            type: 'machine-activity',
            id: 'machine-1',
            active: false,
            activeAt: 3000,
        });
    });
});

// --- Test EventRouter routing logic ---

describe('EventRouter', () => {
    // We use the singleton instance and clean up after each test.

    it('emits ephemeral to user-scoped connections when recipientFilter is user-scoped-only', () => {
        const userSocket = { emit: vi.fn() } as any;
        const sessionSocket = { emit: vi.fn() } as any;
        const machineSocket = { emit: vi.fn() } as any;

        const userId = 'test-user-1';

        const userConn = { connectionType: 'user-scoped' as const, socket: userSocket, userId };
        const sessionConn = { connectionType: 'session-scoped' as const, socket: sessionSocket, userId, sessionId: 'session-1' };
        const machineConn = { connectionType: 'machine-scoped' as const, socket: machineSocket, userId, machineId: 'machine-1' };

        eventRouter.addConnection(userId, userConn);
        eventRouter.addConnection(userId, sessionConn);
        eventRouter.addConnection(userId, machineConn);

        try {
            const payload = buildSessionActivityEphemeral('session-1', false, Date.now(), false);
            eventRouter.emitEphemeral({
                userId,
                payload,
                recipientFilter: { type: 'user-scoped-only' },
            });

            // Only user-scoped should receive the ephemeral
            expect(userSocket.emit).toHaveBeenCalledWith('ephemeral', payload);
            expect(sessionSocket.emit).not.toHaveBeenCalled();
            expect(machineSocket.emit).not.toHaveBeenCalled();
        } finally {
            eventRouter.removeConnection(userId, userConn);
            eventRouter.removeConnection(userId, sessionConn);
            eventRouter.removeConnection(userId, machineConn);
        }
    });

    it('emits to all connections when recipientFilter is all-user-authenticated-connections', () => {
        const userSocket = { emit: vi.fn() } as any;
        const sessionSocket = { emit: vi.fn() } as any;

        const userId = 'test-user-2';

        const userConn = { connectionType: 'user-scoped' as const, socket: userSocket, userId };
        const sessionConn = { connectionType: 'session-scoped' as const, socket: sessionSocket, userId, sessionId: 'session-2' };

        eventRouter.addConnection(userId, userConn);
        eventRouter.addConnection(userId, sessionConn);

        try {
            const payload = { type: 'activity' as const, id: 'session-2', active: true, activeAt: Date.now() };
            eventRouter.emitEphemeral({ userId, payload });

            expect(userSocket.emit).toHaveBeenCalled();
            expect(sessionSocket.emit).toHaveBeenCalled();
        } finally {
            eventRouter.removeConnection(userId, userConn);
            eventRouter.removeConnection(userId, sessionConn);
        }
    });

    it('removes connection and cleans up user entry when last connection removed', () => {
        const socket = { emit: vi.fn() } as any;
        const userId = 'test-user-3';
        const connection = { connectionType: 'user-scoped' as const, socket, userId };

        eventRouter.addConnection(userId, connection);
        expect(eventRouter.getConnections(userId)?.size).toBe(1);

        eventRouter.removeConnection(userId, connection);
        expect(eventRouter.getConnections(userId)).toBeUndefined();
    });
});
