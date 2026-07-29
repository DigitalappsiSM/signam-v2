/**
 * Constantes de dominio de SIGNAM V2.
 *
 * Estos valores provienen directamente de la especificación funcional y de los
 * archivos maestros de Liverpool / Admira. No deben modificarse sin una
 * decisión documentada, ya que afectan el modelo de datos y el resultado de
 * los CSV generados para Admira.
 */

/**
 * Encabezados oficiales del catálogo Admira CSM, en el orden autoritativo del
 * archivo MAESTRO (hoja `Consolidado`). El orden y el texto literal deben
 * conservarse: no se rediseñan ni se renombran.
 */
export const ADMIRA_CATALOG_HEADERS = [
  'TIPO DE pantallas',
  'CENTROS',
  'CIRCUITO',
  'RESOLUCION',
  'FORMATO',
  'Nombre en plataforma',
  'TIPO DE PASES',
  'Numero de Tienda',
  'Nombre de tienda',
  'Modelo',
  'ARTICULOS',
  'BRANDS',
] as const;

export type AdmiraCatalogHeader = (typeof ADMIRA_CATALOG_HEADERS)[number];

/**
 * Encabezado obligatorio definitivo. Una versión anterior usaba `Pases`; si se
 * detecta esa estructura debe informarse explícitamente y NO corregirse en
 * silencio.
 */
export const REQUIRED_PASES_HEADER = 'TIPO DE PASES' as const;
export const LEGACY_PASES_HEADER = 'Pases' as const;

/**
 * Layout confirmado del CSV de Admira. El orden de columnas es autoritativo.
 */
export const ADMIRA_CSV_COLUMNS = [
  'ARTICULOS',
  'BRANDS',
  'CENTROS',
  'CIRCUITO',
  'RESOLUCION',
  'RETAILERS',
  'TIPO DE PASES',
] as const;

export type AdmiraCsvColumn = (typeof ADMIRA_CSV_COLUMNS)[number];

/**
 * Valor constante de la columna `RETAILERS` en el CSV de Admira.
 * Decisión de negocio confirmada: siempre `LIVERPOOL`.
 */
export const RETAILERS_VALUE = 'LIVERPOOL' as const;

/**
 * Encabezados aceptados para la columna (opcional) del maestro que mapea cada
 * pantalla al soporte del Calendario de Liverpool. El oficial es
 * `NORMALIZACION LIVERPOOL`; se aceptan variantes por compatibilidad.
 */
export const CALENDAR_MAPPING_HEADERS = [
  'NORMALIZACION LIVERPOOL',
  'SOPORTE LIVERPOOL',
  'SOPORTE CALENDARIO',
  'SOPORTE ISM',
] as const;

/**
 * Soportes gestionados por InStore Media. En esta etapa se detectan y muestran
 * en el diagnóstico, pero se excluyen de la consolidación hasta definir su
 * lógica posterior. La comparación se realiza de forma normalizada
 * (mayúsculas, sin acentos, sin apóstrofes) — ver `support.ts`.
 */
export const INSTORE_MEDIA_SUPPORTS = ["MUPPI'S", 'PENDON'] as const;

/**
 * Excepción exclusiva de Guadalajara Galerías (ver `consolidation` posterior).
 * Solo aplica a la tienda 78 cuando el soporte solicitado es
 * `VIDEO WALL CRIUS`.
 */
export const GUADALAJARA_GALERIAS_EXCEPTION = {
  storeNumber: '78',
  storeName: 'L GUADALAJARA GALERIAS',
  requestedSupport: 'VIDEO WALL CRIUS',
  includedConfigurations: [
    { model: 'CRIUS', resolution: '914 x 908', articulos: 'VW 914x908' },
    { model: 'CUADRADA', resolution: '900 X 900', articulos: 'VW 900x900' },
  ],
} as const;

/** Roles de la aplicación. Las reglas de Firestore deben aplicar estos permisos. */
export const USER_ROLES = ['admin', 'operator', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];
