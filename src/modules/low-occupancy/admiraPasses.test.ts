import { describe, expect, it } from 'vitest';
import type { AdmiraScreen } from '@/domain';
import {
  emptyOriginal,
  newScreenMetadata,
} from '@/modules/admira-catalog/screenFactory';
import {
  analyzeAdmiraPasses,
  parseAdmiraPassesGrid,
  type AdmiraPassRow,
  type AdmiraRatio,
} from './admiraPasses';

const HEADERS = [
  'Nombre',
  ' Nombre descriptivo',
  ' Criterios',
  ' DÃ­a ',
  'CampaÃ±a',
  ' Contenidos',
  ' Ratios',
  ' Nivel Ratio',
  ' Categoria',
  ' Horario',
  ' Distribuida',
  ' Pases/Slots Programados',
  ' Pases/Slots en uso',
  'Pases/Slots Totales',
];

function sourceRow(
  player: string,
  date: number,
  campaign: string,
  content: string,
  category: string,
  passes: number | string,
) {
  return [
    player,
    player,
    null,
    date,
    campaign,
    content,
    'Instore Liverpool',
    'Liverpool',
    category,
    '00:00 00:24',
    'Yes',
    'Ilimitados',
    passes,
    passes,
  ];
}

function screenOf(player: string): AdmiraScreen {
  return {
    id: player,
    original: {
      ...emptyOriginal(),
      'Nombre en plataforma': player,
      'Numero de Tienda': '37',
      'Nombre de tienda': 'L OAXACA',
      Modelo: 'CRIUS',
    },
    metadata: {
      ...newScreenMetadata({ uid: 'u', email: 'e@e.com' }, 0),
      active: true,
      calendarSupport: 'VIDEO WALL CRIUS',
    },
  };
}

function passRow(
  player: string,
  ratio: AdmiraRatio,
  campaign: string,
  passes: number,
): AdmiraPassRow {
  return {
    sourceRow: 2,
    player,
    descriptiveName: player,
    date: '2026-09-14',
    campaign,
    content: `Video ${campaign}`,
    ratio,
    schedule: '00:00 00:24',
    passes,
    passesMin: passes,
    passesMax: passes,
    passesRaw: String(passes),
  };
}

describe('parseAdmiraPassesGrid', () => {
  it('detecta encabezados con mojibake y conserva campaña y video literales', () => {
    const result = parseAdmiraPassesGrid([
      HEADERS,
      sourceRow(
        'ISM_CRIUS_OAXACA',
        46279,
        'CampaÃ±a de prueba',
        'Vídeo original',
        'Publicidad Tipo 1',
        '28|29',
      ),
    ]);

    expect(result.headerRow).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      player: 'ISM_CRIUS_OAXACA',
      date: '2026-09-14',
      campaign: 'Campaña de prueba',
      content: 'Vídeo original',
      ratio: 1,
      passes: 28.5,
      passesMin: 28,
      passesMax: 29,
    });
  });

  it('omite filas inválidas y reporta el número de fila', () => {
    const result = parseAdmiraPassesGrid([
      HEADERS,
      sourceRow('PLAYER', 46279, '', 'Video', 'Publicidad Tipo 1', 90),
    ]);
    expect(result.rows).toHaveLength(0);
    expect(result.issues[0]).toMatchObject({ row: 2, code: 'invalid-row' });
  });
});

describe('analyzeAdmiraPasses', () => {
  it('evalúa Ratio 1 sin permitir que Ratio 3 compense su repetición', () => {
    const player = 'PLAYER_R1';
    const rows = [
      passRow(player, 1, 'Pagada A', 180),
      passRow(player, 1, 'Pagada B', 180),
      passRow(player, 3, 'Institucional A', 72),
      passRow(player, 3, 'Institucional B', 72),
      passRow(player, 3, 'Institucional C', 72),
      passRow(player, 3, 'Institucional D', 72),
      passRow(player, 3, 'Institucional E', 72),
    ];
    const unit = analyzeAdmiraPasses(rows, [screenOf(player)]).units[0]!;
    expect(unit.evaluatedRatio).toBe(1);
    expect(unit.contentCount).toBe(2);
    expect(unit.level).toBe('critical');
  });

  it('considera saludable un player sin Ratio 1 y con cuatro contenidos equilibrados en Ratio 3', () => {
    const player = 'PLAYER_R3';
    const rows = ['A', 'B', 'C', 'D'].map((name) =>
      passRow(player, 3, name, 90),
    );
    const unit = analyzeAdmiraPasses(rows, [screenOf(player)]).units[0]!;
    expect(unit.evaluatedRatio).toBe(3);
    expect(unit.contentCount).toBe(4);
    expect(unit.maximumShare).toBe(0.25);
    expect(unit.level).toBe('healthy');
  });

  it('marca tres contenidos como alerta y cuatro desbalanceados como críticos', () => {
    const warning = analyzeAdmiraPasses(
      ['A', 'B', 'C'].map((name) => passRow('WARN', 1, name, 120)),
      [screenOf('WARN')],
    ).units[0]!;
    expect(warning.level).toBe('warning');

    const critical = analyzeAdmiraPasses(
      [180, 60, 60, 60].map((value, index) =>
        passRow('IMBALANCED', 1, String(index), value),
      ),
      [screenOf('IMBALANCED')],
    ).units[0]!;
    expect(critical.maximumShare).toBe(0.5);
    expect(critical.level).toBe('critical');
    expect(critical.reasons.join(' ')).toContain('50 %');
  });

  it('advierte entrega mínima y cruza el player de forma exacta', () => {
    const rows = [15, 15, 15, 15].map((value, index) =>
      passRow('LOW', 3, String(index), value),
    );
    const unit = analyzeAdmiraPasses(rows, [screenOf('LOW')]).units[0]!;
    expect(unit.level).toBe('warning');
    expect(unit.catalogMatch).toBe('exact');
    expect(unit.storeNumber).toBe('37');
    expect(unit.reasons.join(' ')).toContain('15 pases');
  });
});
