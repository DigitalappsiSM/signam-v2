import { describe, it, expect } from 'vitest';
import { can } from './permissions';

describe('permisos por rol', () => {
  it('admin puede administrar usuarios y escribir catálogo', () => {
    expect(can('admin', 'users.manage')).toBe(true);
    expect(can('admin', 'catalog.write')).toBe(true);
    expect(can('admin', 'catalog.deactivate')).toBe(true);
  });

  it('operator importa y exporta pero no modifica el catálogo', () => {
    expect(can('operator', 'calendar.import')).toBe(true);
    expect(can('operator', 'export.csv')).toBe(true);
    expect(can('operator', 'catalog.write')).toBe(false);
    expect(can('operator', 'users.manage')).toBe(false);
  });

  it('viewer solo puede leer el catálogo', () => {
    expect(can('viewer', 'catalog.read')).toBe(true);
    expect(can('viewer', 'export.csv')).toBe(false);
    expect(can('viewer', 'calendar.import')).toBe(false);
  });

  it('seguimiento operativo: admin/operator escriben, viewer solo lee', () => {
    expect(can('admin', 'tracking.write')).toBe(true);
    expect(can('operator', 'tracking.write')).toBe(true);
    expect(can('viewer', 'tracking.write')).toBe(false);
    expect(can('admin', 'tracking.read')).toBe(true);
    expect(can('operator', 'tracking.read')).toBe(true);
    expect(can('viewer', 'tracking.read')).toBe(true);
  });
});
