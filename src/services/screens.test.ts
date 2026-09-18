import { describe, expect, it } from 'vitest';
import { emptyOriginal } from '@/modules/admira-catalog/screenFactory';
import type { MasterRow } from '@/modules/admira-catalog/masterImport';
import { masterMetadataPatch } from './screens';

function row(
  calendarSupport: string,
  quividiCameraName: string,
): MasterRow {
  return {
    original: emptyOriginal(),
    sourceRow: 2,
    calendarSupport,
    quividiCameraName,
  };
}

describe('masterMetadataPatch', () => {
  it('preserva normalización existente si la columna no viene en el archivo', () => {
    expect(
      masterMetadataPatch(row('', 'CAM-01'), {
        calendarSupport: false,
        quividiCameraName: true,
      }),
    ).toEqual({ quividiCameraName: 'CAM-01' });
  });

  it('preserva cámara Quividi existente si la columna no viene en el archivo', () => {
    expect(
      masterMetadataPatch(row('MEGA MUPI DIGITAL', ''), {
        calendarSupport: true,
        quividiCameraName: false,
      }),
    ).toEqual({ calendarSupport: 'MEGA MUPI DIGITAL' });
  });

  it('permite limpiar explícitamente una columna presente con una celda vacía', () => {
    expect(
      masterMetadataPatch(row('', ''), {
        calendarSupport: true,
        quividiCameraName: true,
      }),
    ).toEqual({
      calendarSupport: '',
      quividiCameraName: '',
    });
  });
});
