import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  acceptedRows,
  aggregateOperationalItems,
  buildDigitalDashboard,
  cancelDigitalTracking,
  createDigitalTracking,
  detectConflicts,
  diffPlacementRows,
  digitalProgress,
  initialDigitalProfiles,
  matchProfile,
  parseDigitalWorkbook,
  reactivateDigitalTracking,
  resolveConflict,
  updateDigitalCheck,
} from '.';
const actor = { uid: 'u1', email: 'operator@example.test' },
  profiles = initialDigitalProfiles(actor, 1);
const headers = [
  'Comercial',
  'Cliente',
  'Anunciante',
  'Producto',
  'Cadena',
  'Periodo Id',
  'Periodo',
  'Artículo',
  'Nº Centros',
  'Nº Soportes',
  'Campaña',
  'Línea campaña',
  'Fecha Fijación',
  'Fecha Retirada',
  'Tipo Fijación',
  'Observaciones Fijación',
  'Observaciones Almacen',
  'Contrato Enviado',
  'Contrato Recibido',
  'Produce ISM/Cliente',
  'Creatividad Repartida',
  'Escandallos Repartidos',
  'Orden de Trabajo Generada',
  'Creatividad Id',
  'Creatividad Desc.',
  'Creatividad Título',
  'Creatividad Estado',
  'Material',
  'Total Unidades Material',
  'Fecha Material',
  'Proveedor',
  'Número Pedido',
  'Unidades Pedido',
  'Fecha Pedido',
  'Producción',
  'Cantidades Enviadas',
  'Número Albarán',
  'Unidades Albarán',
  'Fecha Albarán',
];
function row(overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    Cliente: 'Cliente',
    Anunciante: 'Anunciante',
    Producto: 'Producto',
    Cadena: 'CHEDRAUI',
    'Periodo Id': 'C17',
    Periodo: 'C17 - 11/08/2026 a 24/08/2026',
    Artículo: 'COPETE DIGITAL',
    'Nº Centros': 4,
    'Nº Soportes': 8,
    Campaña: 24498,
    'Línea campaña': 70,
    'Fecha Fijación': 46245,
    'Fecha Retirada': 46258,
    'Tipo Fijación': 'Fijación',
    'Creatividad Id': 62382,
    'Creatividad Título': 'Título',
    'Creatividad Estado': 'OK',
  };
  return headers.map((h) => ({ ...base, ...overrides })[h] ?? '');
}
function workbook(rows: unknown[][], name = 'Seguimiento Campañas') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([headers, ...rows]),
    name,
  );
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
describe('parser digital', () => {
  it('detecta la hoja, alias de título, seriales civiles e identificadores de texto', () => {
    const parsed = parseDigitalWorkbook(workbook([row()]), profiles);
    expect(parsed.sheetName).toBe('Seguimiento Campañas');
    expect(parsed.rows[0]!).toMatchObject({
      campaignNumber: '24498',
      lineNumber: '70',
      creativityId: '62382',
      placementMode: 'fixation',
    });
    expect(parsed.rows[0]!.fixationStart).toMatch(/^2026-/);
    expect(parsed.sourceHeaders).toContain('Creatividad Título');
  });
  it('permite única hoja compatible con advertencia', () => {
    expect(
      parseDigitalWorkbook(workbook([row()], 'Exportación'), profiles).warnings,
    ).toHaveLength(1);
  });
  it('rechaza periodos inconsistentes y clasificación desconocida', () => {
    const parsed = parseDigitalWorkbook(
      workbook([row({ 'Periodo Id': 'C18', 'Tipo Fijación': 'Otro' })]),
      profiles,
    );
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['invalid-period', 'unknown-fixation']),
    );
  });
});
describe('catálogo exacto', () => {
  it('solo acepta perfiles activos y coincidencia exacta normalizada', () => {
    expect(
      matchProfile(profiles, '  la cómer ', 'copete digital')?.retailerCode,
    ).toBe('LA_COMER');
    expect(matchProfile(profiles, 'LA COMER', 'COPETE MUPI')).toBeNull();
    expect(matchProfile(profiles, 'CHEDRAUI', 'STOPPER-MEDIA')).toBeNull();
    expect(
      matchProfile(
        profiles.map((p) => ({ ...p, active: false })),
        'CHEDRAUI',
        'COPETE DIGITAL',
      ),
    ).toBeNull();
  });
});
describe('resolución, agregación y diff', () => {
  const parsed = parseDigitalWorkbook(workbook([row(), row()]), profiles);
  it('detecta duplicado exacto y exige confirmación', () => {
    const groups = detectConflicts(parsed.rows);
    expect(groups[0]!).toMatchObject({
      kind: 'exact-duplicate',
      action: 'keep-one',
      confirmed: false,
    });
    expect(() => acceptedRows(parsed.rows, groups)).toThrow();
    const resolution = resolveConflict(
      groups[0]!,
      'keep-one',
      [0],
      parsed.rows,
      'b1',
      actor,
      10,
    );
    expect(acceptedRows(parsed.rows, [resolution])).toHaveLength(1);
    expect(resolution.resolvedByUid).toBe('u1');
  });
  it('nunca suma un duplicado colapsado y bloquea incompatibilidades', () => {
    const resolution = resolveConflict(
      detectConflicts(parsed.rows)[0]!,
      'keep-one',
      [0],
      parsed.rows,
      'b',
      actor,
    );
    expect(
      aggregateOperationalItems(
        acceptedRows(parsed.rows, [resolution]),
        profiles,
        'b',
      )[0]!.centers,
    ).toBe(4);
    const changed = {
      ...parsed.rows[1]!,
      fingerprint: 'different',
      client: 'Otro',
    };
    expect(() =>
      aggregateOperationalItems([parsed.rows[0]!, changed], profiles, 'b'),
    ).toThrow(/client/);
  });
  it('maneja modificación, ausencia acotada y restauración estable', () => {
    const old = { ...parsed.rows[0]!, id: 'stable', firstBatchId: 'first' };
    expect(
      diffPlacementRows(
        [old],
        [{ ...old, fingerprint: 'new' }],
        new Set(['C17']),
        'b',
      )[0]!.state,
    ).toBe('modificada');
    expect(diffPlacementRows([old], [], new Set(['C17']), 'b')[0]!.state).toBe(
      'no-incluida',
    );
    expect(diffPlacementRows([old], [], new Set(['C18']), 'b')).toHaveLength(0);
    expect(
      diffPlacementRows(
        [{ ...old, active: false }],
        [old],
        new Set(['C17']),
        'b',
      )[0],
    ).toMatchObject({ state: 'restaurada', after: { id: 'stable' } });
  });
});
describe('seguimiento y dashboard aislados', () => {
  it('usa exactamente tres checks, denominador tres y preserva estado', () => {
    let t = createDigitalTracking('i', actor, 1);
    expect(Object.keys(t.checks)).toEqual([
      'downloadLink',
      'retailerValidation',
      'cmsProgramming',
    ]);
    t = updateDigitalCheck(t, 'downloadLink', true, actor, 2);
    expect(digitalProgress(t)).toBe(1 / 3);
    const cancelled = cancelDigitalTracking(t, 'motivo', actor, 3);
    expect(digitalProgress(cancelled)).toBeNull();
    expect(() =>
      updateDigitalCheck(cancelled, 'cmsProgramming', true, actor),
    ).toThrow();
    expect(
      reactivateDigitalTracking(cancelled, actor, 4).checks.downloadLink
        .completed,
    ).toBe(true);
  });
  it('excluye canceladas del avance', () => {
    const parsed = parseDigitalWorkbook(workbook([row()]), profiles);
    const item = aggregateOperationalItems(parsed.rows, profiles, 'b')[0]!;
    const t = cancelDigitalTracking(
      createDigitalTracking(item.id, actor),
      '',
      actor,
    );
    expect(buildDigitalDashboard([item], [t])).toMatchObject({
      activeItems: 0,
      cancelledItems: 1,
      averageProgress: 0,
    });
  });
});
