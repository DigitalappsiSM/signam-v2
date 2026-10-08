import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getQuividiCampaignAvailability,
  type QuividiCampaignAvailability,
} from '@/services/quividi';
import { useCampaignAvailability } from './useCampaignAvailability';

vi.mock('@/services/quividi', () => ({
  getQuividiCampaignAvailability: vi.fn(),
}));
const item = (campaignId: string): QuividiCampaignAvailability => ({
  campaignId,
  available: true,
  totalPairs: 1,
  mappedPairs: 1,
  scopeOrigins: [],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.mocked(getQuividiCampaignAvailability)
    .mockReset()
    .mockImplementation(async (ids) => ids.map(item));
});

describe('cobertura progresiva de campañas', () => {
  it('consulta solo ids visibles y reutiliza resultados al volver de página', async () => {
    const { result, rerender } = renderHook(
      ({ ids }) => useCampaignAvailability(ids, true, 0),
      { initialProps: { ids: ['a'] } },
    );
    await waitFor(() =>
      expect(result.current.items.get('a')?.available).toBe(true),
    );
    rerender({ ids: ['b'] });
    await waitFor(() => expect(result.current.loaded('b')).toBe(true));
    rerender({ ids: ['a'] });
    expect(getQuividiCampaignAvailability).toHaveBeenCalledTimes(2);
    expect(getQuividiCampaignAvailability).toHaveBeenNthCalledWith(1, ['a']);
    expect(getQuividiCampaignAvailability).toHaveBeenNthCalledWith(2, ['b']);
  });

  it('una respuesta anterior no reemplaza la cobertura después de actualizar', async () => {
    const old = deferred<QuividiCampaignAvailability[]>();
    vi.mocked(getQuividiCampaignAvailability)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce([{ ...item('a'), available: false }]);
    const { result, rerender } = renderHook(
      ({ version }) => useCampaignAvailability(['a'], true, version),
      { initialProps: { version: 0 } },
    );
    rerender({ version: 1 });
    await waitFor(() =>
      expect(result.current.items.get('a')?.available).toBe(false),
    );
    await act(async () => old.resolve([item('a')]));
    expect(result.current.items.get('a')?.available).toBe(false);
  });

  it('no confunde errores con falta de cobertura y permite reintentar', async () => {
    vi.mocked(getQuividiCampaignAvailability).mockRejectedValueOnce(
      new Error('offline'),
    );
    const { result, rerender } = renderHook(
      ({ version }) => useCampaignAvailability(['a'], true, version),
      { initialProps: { version: 0 } },
    );
    await waitFor(() => expect(result.current.failed.has('a')).toBe(true));
    expect(result.current.items.has('a')).toBe(false);
    rerender({ version: 1 });
    await waitFor(() =>
      expect(result.current.items.get('a')?.available).toBe(true),
    );
    expect(result.current.failed.has('a')).toBe(false);
  });

  it('respeta permisos y no repite una petición pendiente al navegar', async () => {
    const pending = deferred<QuividiCampaignAvailability[]>();
    vi.mocked(getQuividiCampaignAvailability).mockReturnValueOnce(
      pending.promise,
    );
    const { result, rerender } = renderHook(
      ({ enabled, ids }) => useCampaignAvailability(ids, enabled, 0),
      { initialProps: { enabled: false, ids: ['a'] } },
    );
    expect(getQuividiCampaignAvailability).not.toHaveBeenCalled();
    rerender({ enabled: true, ids: ['a'] });
    rerender({ enabled: true, ids: [] });
    rerender({ enabled: true, ids: ['a'] });
    expect(getQuividiCampaignAvailability).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve([item('a')]));
    expect(result.current.loaded('a')).toBe(true);
  });
});
