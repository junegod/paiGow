import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as localData from '@/local-data/localDataService'
import { useLocalPlayerData } from '@/local-data/useLocalPlayerData'
import { createSettledMatch } from '@/test/matchFixtures'

describe('本地积分写入失败传播', () => {
  beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('结算和离局扣分写入失败都必须拒绝，不能让上层继续导航', async () => {
    const failure = new Error('写入失败')
    vi.spyOn(localData, 'recordSettledRoundForUser').mockRejectedValue(failure)
    vi.spyOn(localData, 'recordAbandonedRoundPenaltyForUser').mockRejectedValue(failure)
    const match = createSettledMatch()
    const round = match.currentRound!
    const { result } = renderHook(useLocalPlayerData)
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await expect(result.current.recordSettledRound(match, round)).rejects.toThrow('写入失败')
      await expect(result.current.recordAbandonedRoundPenalty(match, round)).rejects.toThrow('写入失败')
    })
    expect(result.current.status).toBe('error')
    expect(result.current.errorMessage).toBe('写入失败')
  })
})
