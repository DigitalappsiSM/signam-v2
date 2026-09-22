#!/usr/bin/env node
/**
 * Guardia de deriva entre código y documentación.
 *
 * La documentación de este repositorio no es decorativa: `CLAUDE.md` se carga
 * automáticamente en cada sesión de IA y `AGENTS.md` es la especificación
 * autoritativa de las reglas de negocio. Cuando el código cambia y esos
 * documentos no, la siguiente persona —o la siguiente IA— actúa sobre reglas
 * falsas. Ya ocurrió: la documentación afirmó durante días que el informe «no
 * extrapola» mientras el código extrapolaba.
 *
 * Este script no juzga el CONTENIDO de la documentación, que ninguna máquina
 * puede validar. Sólo exige que, al tocar código sensible, alguien haya abierto
 * el documento que le corresponde. Es un recordatorio con dientes, no una
 * prueba de corrección.
 *
 * Uso:
 *   node scripts/check-docs-freshness.mjs <base-ref> <head-ref>
 *   node scripts/check-docs-freshness.mjs            # contra origin/main
 *
 * Escape: incluir `[skip-docs]` en el cuerpo o el título del PR, que CI pasa
 * por la variable PR_BODY. Es deliberadamente explícito: queda escrito en el
 * PR quién decidió saltárselo.
 */

import { execFileSync } from 'node:child_process';

/**
 * Cada regla declara qué rutas de código obligan a revisar qué documentos.
 * `docs` es una lista de alternativas: basta con tocar una.
 */
const RULES = [
  {
    name: 'Reglas de dominio',
    code: [/^src\/domain\/[^/]+\.ts$/],
    docs: ['AGENTS.md', 'CLAUDE.md'],
    why: 'El dominio es la implementación autoritativa de las reglas de negocio confirmadas.',
  },
  {
    name: 'Informe de audiencia Quividi',
    code: [
      /^src\/modules\/exports\/quividiBrandReport\.ts$/,
      /^src\/modules\/exports\/quividiCampaignPdf\.ts$/,
      /^src\/modules\/exports\/quividiAuditSheet\.ts$/,
      /^src\/modules\/exports\/quividiPdfKit\.ts$/,
    ],
    docs: ['AGENTS.md', 'docs/QUIVIDI_PHASE_1.md', 'CLAUDE.md'],
    why: 'La cifra que se publica a marca depende de estas reglas; si cambian, la metodología documentada deja de describirlas.',
  },
  {
    name: 'Serialización del CSV de Admira',
    code: [/^src\/domain\/csv\.ts$/, /^src\/domain\/constants\.ts$/],
    docs: ['AGENTS.md', 'CLAUDE.md'],
    why: 'El formato del CSV y las cabeceras del maestro son invariantes documentados.',
  },
  {
    name: 'Integración Ekon',
    code: [/^src\/domain\/ekon\//],
    docs: ['AGENTS.md', 'docs/CONTEXTO.md'],
    why: 'Ekon vive en colecciones aisladas con reglas propias documentadas.',
  },
  {
    name: 'Operación Digital multirretailer',
    code: [/^src\/domain\/digital-operations\//],
    docs: [
      'AGENTS.md',
      'SIGNAM_V2_ALCANCE_OPERACION_DIGITAL_MULTIRRETAILER.md',
      'docs/CONTEXTO.md',
    ],
    why: 'La operación Digital no debe tocar el flujo Liverpool↔Admira; su alcance está documentado.',
  },
  {
    name: 'Control de acceso',
    code: [
      /^firestore\.rules$/,
      /^storage\.rules$/,
      /^src\/app\/permissions\.ts$/,
    ],
    docs: ['README.md', 'AGENTS.md', 'CLAUDE.md'],
    why: 'La matriz de permisos de la UI y las reglas de Firebase deben describirse juntas: ocultar botones no es control de acceso.',
  },
];

/** Las pruebas acompañan al código, pero cambiarlas no obliga a documentar. */
const IGNORED = [/\.test\.tsx?$/, /\.spec\.tsx?$/];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function changedFiles(base, head) {
  // `...` compara contra el ancestro común: sólo lo que aporta la rama.
  const range = head ? `${base}...${head}` : `${base}...HEAD`;
  const out = git(['diff', '--name-only', range]);
  return out ? out.split('\n').filter(Boolean) : [];
}

/**
 * Parte pura: decide qué reglas incumple un conjunto de archivos cambiados.
 * Se exporta para poder probarla sin git ni CI.
 */
export function evaluate(files, { skipMarker = '' } = {}) {
  if (skipMarker.includes('[skip-docs]')) return { skipped: true, failures: [] };

  const relevant = files.filter(
    (file) => !IGNORED.some((pattern) => pattern.test(file)),
  );
  const touchedDocs = new Set(files.filter((file) => file.endsWith('.md')));

  const failures = [];
  for (const rule of RULES) {
    const hits = relevant.filter((file) =>
      rule.code.some((pattern) => pattern.test(file)),
    );
    if (hits.length === 0) continue;
    if (rule.docs.some((doc) => touchedDocs.has(doc))) continue;
    failures.push({ rule, hits });
  }
  return { skipped: false, failures, reviewed: relevant.length };
}

function main() {
  const [base = 'origin/main', head] = process.argv.slice(2);

  let files;
  try {
    files = changedFiles(base, head);
  } catch (error) {
    console.error(
      `No se pudo comparar contra ${base}: ${error.message}\n` +
        'Asegúrate de que el checkout tiene historia suficiente (fetch-depth: 0).',
    );
    process.exit(2);
  }

  if (files.length === 0) {
    console.log('Sin cambios que revisar.');
    return;
  }

  const { skipped, failures, reviewed } = evaluate(files, {
    skipMarker: `${process.env.PR_BODY ?? ''} ${process.env.PR_TITLE ?? ''}`,
  });

  if (skipped) {
    console.log(
      'El PR declara [skip-docs]: se omite la comprobación de documentación.',
    );
    return;
  }

  if (failures.length === 0) {
    console.log(`Documentación al día para ${reviewed} archivo(s) cambiado(s).`);
    return;
  }

  console.error('\nDocumentación sin actualizar.\n');
  console.error(
    'Este repositorio carga su documentación en cada sesión de IA y la usa como\n' +
      'especificación de las reglas de negocio. Cambiar el código sin revisarla deja\n' +
      'instrucciones falsas en circulación.\n',
  );
  for (const { rule, hits } of failures) {
    console.error(`  ${rule.name}`);
    console.error(`    ${rule.why}`);
    console.error(`    Cambiaste: ${hits.join(', ')}`);
    console.error(`    Revisa y actualiza alguno de: ${rule.docs.join(', ')}\n`);
  }
  console.error(
    'Si el cambio de verdad no altera nada documentado, escribe [skip-docs] en el\n' +
      'cuerpo del PR. Queda registrado quién lo decidió.\n',
  );
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('check-docs-freshness.mjs')) {
  main();
}
