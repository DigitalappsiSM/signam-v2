import { describe, expect, it } from 'vitest';
import { emptyOriginal } from '@/modules/admira-catalog/screenFactory';
import type { MasterRow } from '@/modules/admira-catalog/masterImport';
import { masterMetadataPatch } from './screens';

function row(
  calendarSupport: string,
  quividiCameraName: string,
  quividiCameraName2 = '',
  measurementPointCode = '',
  measurementPointCode2 = '',
): MasterRow {
  return {
    original: emptyOriginal(),
    sourceRow: 2,
    calendarSupport,
    quividiCameraName,
    quividiCameraName2,
    measurementPointCode,
    measurementPointCode2,
  };
}

describe('masterMetadataPatch', () => {
  it('preserva normalización existente si la columna no viene en el archivo', () => {
    expect(
      masterMetadataPatch(row('', 'CAM-01'), {
        calendarSupport: false,
        quividiCameraName: true,
        quividiCameraName2: false,
        measurementPointCode: false,
        measurementPointCode2: false,
      }),
    ).toEqual({ quividiCameraName: 'CAM-01' });
  });

  it('preserva cámara Quividi existente si la columna no viene en el archivo', () => {
    expect(
      masterMetadataPatch(row('MEGA MUPI DIGITAL', ''), {
        calendarSupport: true,
        quividiCameraName: false,
        quividiCameraName2: false,
        measurementPointCode: false,
        measurementPointCode2: false,
      }),
    ).toEqual({ calendarSupport: 'MEGA MUPI DIGITAL' });
  });

  it('permite limpiar explícitamente una columna presente con una celda vacía', () => {
    expect(
      masterMetadataPatch(row('', ''), {
        calendarSupport: true,
        quividiCameraName: true,
        quividiCameraName2: false,
        measurementPointCode: false,
        measurementPointCode2: false,
      }),
    ).toEqual({
      calendarSupport: '',
      quividiCameraName: '',
    });
  });

  it('captura la segunda cámara Quividi cuando el maestro trae esa columna', () => {
    expect(
      masterMetadataPatch(row('', 'CAM-01', 'CAM-02'), {
        calendarSupport: false,
        quividiCameraName: true,
        quividiCameraName2: true,
        measurementPointCode: false,
        measurementPointCode2: false,
      }),
    ).toEqual({ quividiCameraName: 'CAM-01', quividiCameraName2: 'CAM-02' });
  });
});
