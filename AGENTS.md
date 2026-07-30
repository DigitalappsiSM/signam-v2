# Guía para agentes — SIGNAM V2

Lee este archivo antes de modificar el repositorio. Complementa al `README.md`.

## Reglas de trabajo

- Confirma que `origin` apunta a `DigitalappsiSM/signam-v2`.
- No construyas una app monolítica en un solo `index.html`: mantén la
  arquitectura modular (`src/modules`, `src/domain`, `src/services`).
- Todo cambio debe: estar documentado, tener pruebas, pasar
  `lint` + `typecheck` + `test` + `build`, ir en un commit claro y presentarse
  en un pull request.
- **No** incluyas contraseñas, tokens, cuentas de servicio ni llaves privadas.
  `.env` está en `.gitignore`; solo se versiona `.env.example`.
- Si falta una decisión que pueda cambiar el modelo de datos o el resultado de
  los CSV, **pregunta antes de asumirla**.

## Invariantes de dominio (no romper sin decisión documentada)

- **Encabezados del maestro** (`src/domain/constants.ts`): orden y texto literal
  autoritativos. El encabezado definitivo es `TIPO DE PASES`; la estructura
  antigua `Pases` se **reporta**, no se corrige en silencio.
- **Metadatos SIGNAM** (`active`, `createdAt`, `version`, etc.) se guardan
  **separados** de los campos originales del maestro y nunca se exportan dentro
  del maestro (ver `AdmiraScreen` en `src/domain/models.ts`).
- **Consolidación**: la llave es `Campaña + RESOLUCION`. No separar por circuito,
  soporte, `ARTICULOS` ni `TIPO DE PASES`.
- **Nombre de campaña Admira**: `<Campaña>_ <ARTICULOS>` (espacio tras `_`),
  varios artículos con ` + `, deduplicando en orden de aparición.
- **`TIPO DE PASES`**: informativo, va en cada fila del CSV; no divide campañas
  ni forma parte del nombre.
- **Soportes InStore Media** (`MUPPI'S`, `PENDON`): se detectan pero se excluyen
  de la consolidación en esta etapa.
- **CSV de Admira**: layout `ARTICULOS,BRANDS,CENTROS,CIRCUITO,RESOLUCION,`
  `RETAILERS,Tipo de Pases`. El título final distingue mayúsculas y debe salir
  exactamente como `Tipo de Pases`; la llave interna y el encabezado del maestro
  permanecen como `TIPO DE PASES`. `RETAILERS` es constante = `LIVERPOOL`
  (`RETAILERS_VALUE`).
- **Mapeo calendario↔catálogo**: columna del maestro `NORMALIZACION LIVERPOOL`
  (metadato `calendarSupport`); el cruce es por `Numero de Tienda` +
  `calendarSupport`.
- **Excepción de Guadalajara Galerías**: solo tienda 78 + `VIDEO WALL CRIUS`
  (ver `GUADALAJARA_GALERIAS_EXCEPTION`).
- Pantallas inactivas: permanecen con su historial pero no consolidan ni generan
  filas de CSV; una campaña que las solicite produce una incidencia explícita.
- Eliminación física de pantallas: existe en el catálogo (`deleteScreen`) para
  limpiar registros de prueba o cargados por error. **Inactivar es la acción
  preferida** (conserva historial); no se deben eliminar pantallas ya
  referenciadas por exportaciones. Antes de liberar se restringirá a admin.

## Comandos

```bash
npm run lint && npm run typecheck && npm run test && npm run build
npm run format        # antes de commitear
```

Cloud Functions (`functions/`) tienen su propio `package.json` y `tsconfig`:

```bash
cd functions && npm install && npm run build
```

## Seguridad

Las reglas de Firestore/Storage son la fuente de verdad del control de acceso.
`src/app/permissions.ts` es solo para la UI. Si cambias permisos en el cliente,
actualiza también `firestore.rules` / `storage.rules`.
