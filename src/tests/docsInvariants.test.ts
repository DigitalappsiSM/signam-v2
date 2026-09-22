import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ADMIRA_CSV_TITLE,
  LEGACY_PASES_HEADER,
  REQUIRED_PASES_HEADER,
  RETAILERS_VALUE,
  buildAdmiraCampaignName,
  serializeAdmiraCsv,
} from '@/domain';

/**
 * Ata la documentación a las constantes del código.
 *
 * `CLAUDE.md` se carga automáticamente en cada sesión de IA y `AGENTS.md` es la
 * especificación autoritativa de las reglas de negocio: cuando uno de los dos
 * describe mal un literal, el error se propaga a todo lo que se construya
 * después. El guardia de CI obliga a *abrir* el documento al tocar el código;
 * estas pruebas comprueban lo que sí es comprobable: que los literales
 * documentados sean exactamente los que el código produce.
 *
 * Existen porque la deriva ya había ocurrido. Tres de los cuatro documentos que
 * describían el separador de artículos decían «con `+`», que se lee como
 * `A+B`, cuando el código une con espacio-más-espacio.
 *
 * Cubren sólo literales load-bearing. Una prueba que exigiera frases concretas
 * sería ruido: la redacción puede y debe cambiar.
 */

/** Los dos documentos normativos: el autoritativo y el que se carga solo. */
const NORMATIVE = ['AGENTS.md', 'CLAUDE.md'] as const;

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

/**
 * La fila 1 tal y como la escribe el serializador, no reensamblada aquí: si
 * alguien cambia cómo se compone, esta prueba lo nota.
 */
function csvHeaderRow(): string {
  const [header = ''] = serializeAdmiraCsv([], { withBom: false }).split(
    '\r\n',
  );
  return header;
}

describe('la documentación normativa coincide con el código', () => {
  it('publica la fila de encabezado del CSV de Admira tal cual se escribe', () => {
    const header = csvHeaderRow();
    // Comprobación de cordura: el literal sale del serializador, no de la prueba.
    expect(header.startsWith(`${ADMIRA_CSV_TITLE},`)).toBe(true);

    for (const file of NORMATIVE) {
      expect(read(file), `${file} no documenta la fila 1 del CSV`).toContain(
        header,
      );
    }
  });

  it('nombra el encabezado definitivo y el heredado', () => {
    for (const file of NORMATIVE) {
      const text = read(file);
      expect(text, `${file} no nombra el encabezado definitivo`).toContain(
        REQUIRED_PASES_HEADER,
      );
      expect(text, `${file} no nombra la estructura heredada`).toContain(
        LEGACY_PASES_HEADER,
      );
    }
  });

  it('documenta el valor constante de RETAILERS', () => {
    for (const file of NORMATIVE) {
      expect(read(file)).toContain(RETAILERS_VALUE);
    }
  });

  /**
   * El separador de artículos es el literal que más veces se documentó mal.
   * En lugar de describirlo con palabras, los documentos llevan un ejemplo que
   * esta prueba regenera desde el código y exige verbatim.
   */
  it('muestra un ejemplo de nombre de campaña generado por el código', () => {
    const example = buildAdmiraCampaignName('Nike Verano', [
      'ARTICULO 1',
      'ARTICULO 2',
    ]);
    expect(example).toBe('Nike Verano_ ARTICULO 1 + ARTICULO 2');

    for (const file of NORMATIVE) {
      expect(
        read(file),
        `${file} debe incluir el ejemplo «${example}» para que el separador no se describa de oídas`,
      ).toContain(example);
    }
  });

  it('mantiene una única fuente normativa: los demás documentos enlazan', () => {
    // README y CONTEXTO describen qué hace la app, no dictan las reglas. Si
    // vuelven a copiar un literal normativo, el siguiente cambio tendrá que
    // acordarse de cuatro sitios y alguno quedará atrás. Ya pasó.
    const header = csvHeaderRow();
    for (const file of ['README.md', 'docs/CONTEXTO.md']) {
      expect(
        read(file),
        `${file} vuelve a copiar la fila del CSV; debe enlazar a AGENTS.md`,
      ).not.toContain(header);
    }
  });
});
