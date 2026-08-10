# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SIGNAM V2 is a browser-based web app that operates the screen-programming flow between
**Liverpool** and **Admira CSM**: import and validate the Liverpool campaign calendar,
maintain an editable catalog of Admira screens, cross campaigns against active screens,
**consolidate by resolution**, and generate the **Admira programming CSVs**. It also covers
operational tracking, low-occupancy alerts, a load dashboard, and per-campaign PPTX evidence
export. All business logic runs client-side; Firebase provides Auth/Firestore/Storage/Functions/Hosting.

Note: the repository (README, code comments, UI copy, domain terms) is written in **Spanish**.
Match the existing language when writing comments, UI strings, and commit messages.

## Commands

```bash
npm install
npm run dev            # Vite dev server → http://localhost:5173
npm run build          # tsc --noEmit (typecheck) + vite build
npm run typecheck      # tsc --noEmit only
npm run lint           # ESLint, --max-warnings=0 (zero warnings allowed)
npm run lint:fix       # ESLint with --fix
npm run format         # Prettier --write over src (run before committing)
npm run format:check   # Prettier --check (CI uses this; must pass)
npm run test           # Vitest run (once)
npm run test:watch     # Vitest watch mode
npm run test:coverage  # Vitest with v8 coverage
npm run emulators      # Firebase Emulator Suite
```

Run a single test file or a single test by name:

```bash
npx vitest run src/domain/csv.test.ts
npx vitest run -t "consolida por resolución"
```

**Before committing, the full gate is:** `npm run format:check && npm run lint && npm run typecheck && npm run test && npm run build`.
CI (`.github/workflows/ci.yml`) runs exactly this on every push to `main` and every PR, plus a separate Cloud Functions build.

Cloud Functions live in `functions/` with their **own** `package.json`/`tsconfig`:

```bash
cd functions && npm install && npm run build
```

Requires Node.js >= 20. Import `src/` via the `@/` alias (maps to `src/`, configured in both `vite.config.ts` and `tsconfig.json`). TypeScript is `strict` with `noUnusedLocals`, `noUnusedParameters`, and `noUncheckedIndexedAccess` on.

## Architecture

Layered so that domain rules stay framework-free and independently testable:

- **`src/domain/`** — Pure, framework-free models and rules with no React/Firebase imports. This is the
  authoritative implementation of the confirmed business rules (support classification, campaign naming,
  consolidation key, Admira CSV serialization, master headers). Re-exported through `src/domain/index.ts`.
  Changes here almost always have colocated `*.test.ts` and can affect CSV output — treat carefully.
- **`src/modules/`** — One folder per UI section, each a self-contained feature (page component + colocated
  pure helpers + tests). Business logic lives in plain `.ts` modules next to the page (e.g.
  `consolidation/consolidate.ts`, `liverpool-import/campaignParse.ts`, `operational-tracking/businessDays.ts`)
  so it is unit-testable without rendering. Modules: `dashboard`, `liverpool-import`, `admira-catalog`,
  `campaigns`, `consolidation`, `low-occupancy`, `operational-tracking`, `exports`, `audit`, `auth`, `users`.
- **`src/services/`** — External adapters (Firebase, environment). `firebase.ts` initializes lazily and only
  if `VITE_FIREBASE_*` env vars are present; without config the app boots in **degraded mode** (UI works, panel
  reports missing config — never invent credentials). One service file per Firestore collection
  (`campaigns.ts`, `screens.ts`, `campaignEkonLinks.ts`, `campaignOperationalTracking.ts`, etc.).
- **`src/app/`** — App composition: routing (`App.tsx`), route/nav metadata (`routes.ts`), UI permission
  matrix (`permissions.ts`), theme (`theme.ts`), and `providers/AuthProvider.tsx`.
- **`functions/src/`** — Cloud Functions grouped by concern (`imports`, `consolidation`, `exports`, `users`,
  `audit`). Structure is established; most business logic is still stubbed for later iterations.

**Data flow for imports/exports is client-side**: Excel is parsed in the browser (`xlsx`/`exceljs`),
diffed against stored state, the user confirms, then only accepted changes are written to Firestore
(see `services/campaigns.ts` → batched writes). Heavy generators (`pptxgenjs`, ECharts) are loaded via
**dynamic import** into their own chunks.

**Access control has two layers:** `src/app/permissions.ts` is a UI-only matrix (show/hide). The
**source of truth is `firestore.rules` / `storage.rules`**, keyed off custom-claim roles
(`request.auth.token.role`: `admin`, `operator`, `viewer`). If you change client permissions, update the
rules files too — hiding buttons is not access control. Note the app is pre-launch: rules currently permit
any authenticated user to write to most collections; role enforcement will be tightened before release.

## Domain invariants — do not change without a documented decision

`AGENTS.md` is the authoritative, detailed spec of these rules; read it before touching domain/consolidation/CSV
logic. The load-bearing ones:

- **Master headers** (`src/domain/constants.ts`): order and literal text are authoritative. The definitive
  header is `TIPO DE PASES`; the legacy `Pases` structure is **reported**, never silently corrected.
- **Consolidation key** is `Campaña + RESOLUCION` (`consolidationKey.ts`). Do **not** split by circuit, support,
  `ARTICULOS`, or `TIPO DE PASES`.
- **Admira campaign name**: `<Campaña>_ <ARTICULOS>` (space after `_`), multiple articles joined with a
  space-plus-space separator, deduped in order of appearance (`campaignName.ts`).
- **Admira CSV** (`csv.ts`): Admira ignores the first column, so **column A is a guard column** — empty in data
  rows, header `LIVERPOOL` in `A1`. Real columns start at B; row 1 is
  `LIVERPOOL,ARTICULOS,BRANDS,CENTROS,CIRCUITO,RESOLUCION,RETAILERS,Tipo de Pases`. `RETAILERS` is constant
  `LIVERPOOL`. The written header labels the last column `Tipo de Pases`, but the internal row key and master
  header stay `TIPO DE PASES`. RFC 4180 escaping, UTF-8 with optional BOM.
- **InStore Media supports** (`MUPPI'S`, `PENDON`): detected but **excluded** from consolidation/CSV at this stage
  (they still appear in the PPTX evidence and dashboard demand views).
- **SIGNAM metadata** (`active`, `createdAt`, `version`, …) is stored **separately** from original master fields
  and is never exported inside the master.
- **Campaign ↔ Ekon** and **operational tracking** are separate collections keyed by a `campaignKeyId` derived
  deterministically from `nameKey` (not the random `campaigns` doc id). Calendar import never touches them, and
  they never modify the imported campaign.
- **Guadalajara Galerías exception**: only store 78 + `VIDEO WALL CRIUS` (`GUADALAJARA_GALERIAS_EXCEPTION`).
- **Calendar ↔ catalog mapping**: cross on `Numero de Tienda` + `NORMALIZACION LIVERPOOL` (`calendarSupport`).
- Prefer **deactivating** screens over physical deletion (deletion exists but loses history; don't delete
  screens already referenced by exports).
- Dates are civil dates (no timezone offset), displayed `dd/mm/aaaa`.

If a decision that could change the data model or CSV output is missing, **ask before assuming it**.

## Conventions

- Keep the modular architecture — never collapse into a monolithic `index.html`. New business logic goes in a
  pure `.ts` module with a colocated `*.test.ts`, kept out of React components where possible.
- `.env` is gitignored; only `.env.example` is versioned. Never commit secrets, service accounts, or private keys.
- Tests use synthetic/anonymized fixtures — no real enterprise files (`Calendario de Campañas ISM.xlsx`,
  `MAESTRO.xlsx`) are committed.
- Stack: React 18 + TypeScript + Vite + React Router; Vitest + Testing Library (jsdom); ESLint flat config + Prettier;
  Apache ECharts (lazy). `git origin` should point to `DigitalappsiSM/signam-v2`.

## Further reading

- `AGENTS.md` — full domain invariants and working rules (read before domain/CSV changes).
- `README.md` — feature overview, scripts, env vars, Firebase/roles, emulator ports.
- `docs/SETUP.md` — Firebase project setup, env, emulators, roles.
- `src/modules/low-occupancy/README.md` — low-occupancy (Ratio 1 / Ratio 3) details.
