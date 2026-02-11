import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runClaude } from './runClaude'
import type { Credentials } from '@/persistence'

const {
  apiCreateMock,
  getOrCreateMachineMock,
  getOrCreateSessionMock,
  sessionSyncClientMock,
  updateMetadataMock,
  extractSDKMetadataAsyncMock,
  startHappyServerMock,
  notifyDaemonSessionStartedMock,
  readSettingsMock,
  setBackendMock
} = vi.hoisted(() => ({
  apiCreateMock: vi.fn(),
  getOrCreateMachineMock: vi.fn(),
  getOrCreateSessionMock: vi.fn(),
  sessionSyncClientMock: vi.fn(),
  updateMetadataMock: vi.fn(),
  extractSDKMetadataAsyncMock: vi.fn(),
  startHappyServerMock: vi.fn(),
  notifyDaemonSessionStartedMock: vi.fn(),
  readSettingsMock: vi.fn(),
  setBackendMock: vi.fn()
}))

vi.mock('@/api/api', () => ({
  ApiClient: {
    create: apiCreateMock
  }
}))

vi.mock('@/persistence', () => ({
  readSettings: readSettingsMock
}))

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: vi.fn(),
    debugLargeJson: vi.fn(),
    infoDeveloper: vi.fn(),
    logFilePath: 'C:/tmp/happy.log'
  }
}))

vi.mock('@/ui/doctor', () => ({
  getEnvironmentInfo: vi.fn(() => ({}))
}))

vi.mock('@/configuration', () => ({
  configuration: {
    happyHomeDir: 'C:/Users/test/.happy'
  }
}))

vi.mock('@/daemon/run', () => ({
  initialMachineMetadata: {}
}))

vi.mock('@/daemon/controlClient', () => ({
  notifyDaemonSessionStarted: notifyDaemonSessionStartedMock
}))

vi.mock('@/claude/utils/startHappyServer', () => ({
  startHappyServer: startHappyServerMock
}))

vi.mock('@/claude/utils/startHookServer', () => ({
  startHookServer: vi.fn()
}))

vi.mock('@/claude/utils/generateHookSettings', () => ({
  generateHookSettingsFile: vi.fn(),
  cleanupHookSettingsFile: vi.fn()
}))

vi.mock('@/claude/loop', () => ({
  loop: vi.fn()
}))

vi.mock('@/utils/caffeinate', () => ({
  startCaffeinate: vi.fn(),
  stopCaffeinate: vi.fn()
}))

vi.mock('@/claude/sdk/metadataExtractor', () => ({
  extractSDKMetadataAsync: extractSDKMetadataAsyncMock
}))

vi.mock('@/parsers/specialCommands', () => ({
  parseSpecialCommand: vi.fn(() => ({ type: 'none' }))
}))

vi.mock('@/utils/serverConnectionErrors', () => ({
  connectionState: {
    setBackend: setBackendMock
  },
  startOfflineReconnection: vi.fn()
}))

vi.mock('@/utils/MessageQueue2', () => ({
  MessageQueue2: class {}
}))

vi.mock('@/utils/deterministicJson', () => ({
  hashObject: vi.fn(() => 'hash')
}))

vi.mock('./registerKillSessionHandler', () => ({
  registerKillSessionHandler: vi.fn()
}))

vi.mock('../projectPath', () => ({
  projectPath: vi.fn(() => 'D:/Projects/happy/packages/happy-cli')
}))

vi.mock('@/claude/claudeLocal', () => ({
  claudeLocal: vi.fn()
}))

vi.mock('@/claude/utils/sessionScanner', () => ({
  createSessionScanner: vi.fn()
}))

describe('runClaude metadata extraction gating', () => {
  const credentials: Credentials = {
    token: 'token',
    encryption: {
      type: 'legacy',
      secret: new Uint8Array([1, 2, 3])
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()

    readSettingsMock.mockResolvedValue({ machineId: 'machine-1' })
    getOrCreateMachineMock.mockResolvedValue(undefined)
    getOrCreateSessionMock.mockResolvedValue({
      id: 'session-1'
    })

    sessionSyncClientMock.mockReturnValue({
      id: 'session-1',
      updateMetadata: updateMetadataMock
    })

    apiCreateMock.mockResolvedValue({
      getOrCreateMachine: getOrCreateMachineMock,
      getOrCreateSession: getOrCreateSessionMock,
      sessionSyncClient: sessionSyncClientMock
    })

    notifyDaemonSessionStartedMock.mockResolvedValue({ ok: true })

    extractSDKMetadataAsyncMock.mockImplementation(() => {})

    // Throw here to stop execution immediately after metadata-gating branch.
    startHappyServerMock.mockRejectedValue(new Error('stop-after-metadata'))
  })

  it('should skip SDK metadata extraction in local mode', async () => {
    await expect(
      runClaude(credentials, {
        startingMode: 'local',
        claudeArgs: []
      })
    ).rejects.toThrow('stop-after-metadata')

    expect(extractSDKMetadataAsyncMock).not.toHaveBeenCalled()
  })

  it('should run SDK metadata extraction in remote mode', async () => {
    await expect(
      runClaude(credentials, {
        startingMode: 'remote',
        claudeArgs: []
      })
    ).rejects.toThrow('stop-after-metadata')

    expect(extractSDKMetadataAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('should treat undefined startingMode as local and skip extraction', async () => {
    await expect(
      runClaude(credentials, {
        claudeArgs: []
      })
    ).rejects.toThrow('stop-after-metadata')

    expect(extractSDKMetadataAsyncMock).not.toHaveBeenCalled()
  })
})
