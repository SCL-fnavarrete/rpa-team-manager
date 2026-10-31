# Fase 6G — Cartera de proyectos e informe de cierre Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar al `team_lead` (a) una página "Cartera de proyectos" con todos los proyectos, filtros, totales, cotizaciones en curso y ventas por comercial, y (b) un informe de cierre por proyecto (checklist de pendientes + resultados reales vs cotizado, descargable en PDF).

**Architecture:** Dos servicios backend nuevos (`portfolioService`, `closureReportService`) que **componen** los servicios existentes (`financeService.calculateProjectFinancials`, `projectHealthService.getProjectHealth`, tablas `invoices`/`payments`/`payment_milestones`/`project_quotes`); nunca recalculan costos por su cuenta. Un endpoint nuevo `GET /api/portfolio` y dos bajo `/api/commercial/projects/:projectId/closure-report`. Frontend: página `/portfolio` y modal "Informe de cierre" en la ficha del proyecto. El cierre real (`delivery-acceptance` y `financial-close` de `commercialController`) **no se modifica**.

**Tech Stack:** Node/Express/SQLite3/Jest (backend), `pdfkit` ya instalado (`pdfService.ts`), React 18 + Ant Design v5 + Vitest (frontend).

**Spec:** `C:\Users\nanon\.claude\plans\pasted-content-id-c56b-vamos-al-declarative-crane.md` sección "Sub-proyecto G — Dashboards" + decisiones del usuario del 2026-10-24: construir la cartera; cierre con revisión de pendientes e informe PDF final (resultados reales vs cotizado).

## Global Constraints

- Solo `team_lead` accede a cartera e informe de cierre (decisión 7 del plan: costos/márgenes solo `team_lead`). Cualquier otro rol → 403.
- Todos los montos de la cartera y del informe salen en CLP (lo que ya entrega `ProjectFinancials`; facturas/pagos/cotizaciones se convierten con `financeService.toCLP(amount, currency)`).
- Roles reales del sistema: `team_lead`, `rpa_developer`, `rpa_operations`, `it_support`, `billing`. No inventar otros.
- Mensajes de error y textos de UI en español.
- Frontend: cumplir `docs/UI_THEME_SPEC.md` (cero colores quemados, cero `bodyStyle`, `theme.useToken()`), números con `frontend/src/utils/numberFormat.ts`. Verificar con `npm run check:theme`.
- Tests de backend con SQLite real siguiendo el molde de `backend/src/__tests__/controllers/projectController.financials.test.ts`. Los tests existentes de backend (530) y `tsc --noEmit` en ambos paquetes deben seguir en verde.
- Un proyecto con datos incompletos no puede tumbar la cartera: si `calculateProjectFinancials` lanza para un proyecto, esa fila sale con `financials_error: true` y montos en 0, y el resto sigue.
- Commits en español, estilo `feat(cartera): ...`, terminando con la línea `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Cartera sin ningún proyecto → `rows: []`, totales en 0, sin error (cubierto en Task 1).
2. Proyecto sin cliente, sin comercial o sin área → aparece igual, agrupado como "Sin asignar" en ventas por comercial (Task 1).
3. Filtros que no devuelven nada, o `client_id` inexistente → lista vacía, no 404 (Task 1).
4. Margen % con venta 0 → 0, nunca `NaN`/`Infinity` en JSON ni en pantalla (Tasks 1 y 3).
5. Informe de cierre de proyecto sin horas, sin cotización, sin facturas → secciones vacías, PDF igualmente válido; y proyecto inexistente → 404 (Task 3).
6. Rol no autorizado (`rpa_developer`, `billing`, `rpa_operations`) → 403 en cartera e informe, incluida la ruta del PDF (Tasks 1 y 3).

---

### Task 1: Servicio y endpoint de cartera (backend)

**Files:**
- Create: `backend/src/services/portfolioService.ts`
- Create: `backend/src/controllers/portfolioController.ts`
- Create: `backend/src/routes/portfolioRoutes.ts`
- Modify: `backend/src/server.ts` (montar `/api/portfolio` junto a los demás `app.use('/api/...')`, línea ~160)
- Test: `backend/src/__tests__/controllers/portfolioController.test.ts`

**Interfaces:**
- Produces (`portfolioService.ts`):
  ```ts
  export interface PortfolioFilters { client_id?: number; sales_rep_id?: number; commercial_stage?: 'quoting' | 'approved' | 'lost'; area_id?: number }
  export interface PortfolioRow {
    project_id: number; project_name: string; status: string; commercial_stage: string;
    client_id: number | null; client_name: string | null;
    sales_rep_id: number | null; sales_rep_name: string | null;
    area_id: number | null; area_name: string | null;
    sale_price: number; real_cost: number; projected_cost: number;
    real_profit: number; projected_profit: number;
    real_margin_percentage: number; projected_margin_percentage: number;
    health_semaphore: 'green' | 'yellow' | 'red' | 'gray';
    invoiced_clp: number; collected_clp: number; pending_to_invoice_clp: number;
    financials_error: boolean;
  }
  export interface PortfolioResult {
    rows: PortfolioRow[];
    totals: { projects: number; sale_price: number; real_cost: number; projected_cost: number; projected_profit: number; invoiced_clp: number; collected_clp: number; pending_to_invoice_clp: number };
    pipeline: { project_id: number; project_name: string; client_name: string | null; sales_rep_name: string | null; last_quote_amount_clp: number; last_quote_version: number | null }[];
    sales_by_rep: { sales_rep_id: number | null; sales_rep_name: string; projects: number; sale_price: number }[];
  }
  export class PortfolioService { getPortfolio(filters?: PortfolioFilters): Promise<PortfolioResult> }
  export const portfolioService: PortfolioService
  ```
- Produces: `GET /api/portfolio?client_id=&sales_rep_id=&commercial_stage=&area_id=` → `{ data: PortfolioResult }`, solo `team_lead`.
- Consumes: `financeService.calculateProjectFinancials(projectId)` y `financeService.toCLP`, `projectHealthService.getProjectHealth(projectId)` (campo `semaphore`).

- [ ] **Step 1: Escribir tests que fallan** en `portfolioController.test.ts` (SQLite real; sembrar clientes, comercial, área, proyectos, cotizaciones, facturas y pagos con inserts directos):
  - `devuelve cartera vacía con totales en 0 cuando no hay proyectos`
  - `calcula por fila venta, costo real/proyectado, utilidad y margen desde financeService` (un proyecto aprobado con `project_financials.sale_price`)
  - `facturado = facturas no borrador/anuladas, cobrado = suma de pagos, por facturar = max(venta - facturado, 0)`, con una factura en USD o UF para verificar conversión a CLP
  - `pipeline lista solo proyectos en commercial_stage 'quoting' con el monto de su última cotización`
  - `sales_by_rep suma venta por comercial y agrupa los sin comercial como "Sin asignar"`
  - `los filtros client_id / sales_rep_id / commercial_stage / area_id acotan filas, totales y ventas por comercial; un client_id inexistente da lista vacía`
  - `un proyecto sin cliente ni área aparece con client_name y area_name null`
  - `venta 0 produce margen 0 (no NaN)`
  - `si calculateProjectFinancials falla para un proyecto, esa fila sale con financials_error=true y las demás siguen`
  - `rpa_developer, rpa_operations y billing reciben 403; team_lead recibe 200`
- [ ] **Step 2: Correr y ver el fallo**
  Run: `cd backend && npx jest src/__tests__/controllers/portfolioController.test.ts`
  Expected: FAIL (módulo no existe).
- [ ] **Step 3: Implementar `PortfolioService.getPortfolio`** — una query de proyectos con `LEFT JOIN` a `clients`, `sales_reps`, `business_areas` aplicando filtros con parámetros (nunca interpolar); por proyecto: finanzas + salud + facturado/cobrado; los totales y `sales_by_rep` se calculan en memoria sobre las filas ya filtradas; `sales_by_rep` excluye proyectos `lost`. `pipeline` ignora los filtros de etapa pero respeta cliente/comercial/área. Controller delgado: parsea querystring a número, devuelve `{ data }`.
- [ ] **Step 4: Rutas y montaje** — `router.use(authenticate)` y `authorize(['team_lead'])` en `GET /`; montar en `server.ts`.
- [ ] **Step 5: Correr tests**
  Run: `cd backend && npx jest src/__tests__/controllers/portfolioController.test.ts && npx tsc --noEmit`
  Expected: PASS y tsc sin errores.
- [ ] **Step 6: Commit** — `feat(cartera): servicio y endpoint de cartera de proyectos (Fase 6G)`

---

### Task 2: Página "Cartera de proyectos" (frontend)

**Files:**
- Create: `frontend/src/types/portfolio.ts` (espejo exacto de `PortfolioFilters`/`PortfolioRow`/`PortfolioResult` de Task 1)
- Create: `frontend/src/pages/portfolio/PortfolioPage.tsx`
- Modify: `frontend/src/services/api.ts` (método `getPortfolio(filters?: PortfolioFilters): Promise<PortfolioResult>` → `GET /portfolio`)
- Modify: `frontend/src/App.tsx` (ruta `portfolio`, protegida solo para `team_lead` igual que `/priorities`)
- Modify: `frontend/src/components/common/AppLayout.tsx` (ítem "Cartera de proyectos" solo para `team_lead`, en el grupo de control junto a "Centro PMO"; el ítem existente "Portafolio" → `/projects` NO se toca)
- Test: `frontend/src/__tests__/pages/PortfolioPage.test.tsx`

**Interfaces:**
- Consumes: `apiService.getPortfolio(filters)` de Task 1/este task; `PortfolioResult` de `types/portfolio.ts`; selectores de clientes/comerciales/áreas ya existentes en `api.ts` (buscar los métodos de `ClientsPage` para clientes y comerciales y el de áreas).
- Produces: ruta `/portfolio`.

- [ ] **Step 1: Escribir tests que fallan** — `PortfolioPage.test.tsx` con `apiService` mockeado, mismo molde que otros tests de páginas en `frontend/src/__tests__/pages/`:
  - `muestra tarjetas de totales y una fila por proyecto con venta, costo real, costo proyectado, utilidad y margen %`
  - `muestra estado vacío cuando rows está vacío`
  - `cambiar el filtro de cliente vuelve a llamar a getPortfolio con client_id`
  - `renderiza "Sin asignar" para ventas por comercial sin comercial y no muestra NaN`
  - `fila con financials_error muestra aviso "Datos incompletos" en vez de números`
- [ ] **Step 2: Correr y ver el fallo**
  Run: `cd frontend && npx vitest run src/__tests__/pages/PortfolioPage.test.tsx`
  Expected: FAIL.
- [ ] **Step 3: Implementar la página** — encabezado con filtros (cliente, comercial, etapa, área) con `Select allowClear`; tarjetas `Statistic` de totales; `Table` de proyectos (semáforo de salud como `Badge`/`Tag` con tokens, nombre enlaza a `/projects/:id`); segunda `Table` de pipeline; tercera de ventas por comercial. Montos con `numberFormat` en CLP. Estilo y estructura siguiendo `PMOControllerView.tsx` como referencia visual. Cargas con `Spin`, error con `Alert`.
- [ ] **Step 4: API, ruta y menú** según la lista de archivos.
- [ ] **Step 5: Verificar**
  Run: `cd frontend && npx vitest run src/__tests__/pages/PortfolioPage.test.tsx && npx tsc --noEmit && npm run check:theme && npm run lint`
  Expected: tests PASS; tsc, tema y lint sin errores.
- [ ] **Step 6: Commit** — `feat(cartera): página Cartera de proyectos con filtros, pipeline y ventas por comercial (Fase 6G)`

---

### Task 3: Informe de cierre — servicio, endpoints y PDF (backend)

**Files:**
- Create: `backend/src/services/closureReportService.ts`
- Modify: `backend/src/services/pdfService.ts` (agregar `generateClosureReport`)
- Modify: `backend/src/controllers/commercialController.ts` (dos handlers nuevos) y `backend/src/routes/commercialRoutes.ts`
- Test: `backend/src/__tests__/controllers/closureReport.test.ts`

**Interfaces:**
- Produces (`closureReportService.ts`):
  ```ts
  export interface ClosureChecklistItem { key: 'delivery_accepted' | 'payment_milestones' | 'invoices_paid' | 'timesheets_approved' | 'tasks_done' | 'required_documents'; label: string; ok: boolean; pending_count: number; blocking: boolean }
  export interface ClosureReport {
    project: { id: number; name: string; client_name: string | null; sales_rep_name: string | null; status: string; start_date: string | null; end_date: string | null; delivery_accepted_at: string | null; financial_closed_at: string | null };
    checklist: ClosureChecklistItem[];
    can_close_financials: boolean;
    quoted: { amount_clp: number; hours: number; estimated_cost_clp: number; margin_percent: number | null; version: number | null };
    actual: { sale_price: number; real_cost: number; real_profit: number; real_margin_percentage: number; approved_hours: number; planned_hours: number; variance_impact: number };
    team: { user_name: string; budgeted_hours: number; actual_hours: number }[];
    milestones: { name: string; amount: number; currency: string; status: string; planned_date: string | null }[];
    generated_at: string;
  }
  export class ClosureReportService { getReport(projectId: number): Promise<ClosureReport | null> }  // null si el proyecto no existe
  export const closureReportService: ClosureReportService
  ```
  `blocking: true` exactamente en `delivery_accepted`, `payment_milestones`, `invoices_paid`, `required_documents` (los mismos criterios que ya valida `closeFinancials`); `timesheets_approved` (horas con `approval_status <> 'approved'`) y `tasks_done` (tareas con `status <> 'done'` en tableros del proyecto) son solo advertencias (`blocking: false`). `can_close_financials` = todos los `blocking` en `ok`.
- Produces (`pdfService.ts`): `export function generateClosureReport(report: ClosureReport): Promise<Buffer>`.
- Produces (rutas, solo `team_lead`): `GET /api/commercial/projects/:projectId/closure-report` → `{ data: ClosureReport }`; `GET /api/commercial/projects/:projectId/closure-report.pdf` → `application/pdf` con `Content-Disposition: attachment; filename="informe-cierre-<id>.pdf"`. Proyecto inexistente → 404 con `{ error: 'Proyecto no encontrado' }`.
- Consumes: `financeService.calculateProjectFinancials`, `financeService.toCLP`; tablas `project_quotes`, `project_assignments`, `time_entries`, `payment_milestones`, `invoices`, `payments`, `project_commercial_documents`, `tasks`/`task_boards`.

- [ ] **Step 1: Escribir tests que fallan** (`closureReport.test.ts`, SQLite real):
  - `devuelve 404 para un proyecto inexistente`
  - `checklist marca delivery_accepted pendiente hasta que exista delivery_accepted_at`
  - `hitos de pago no pagados y facturas con saldo ponen ok=false y can_close_financials=false`
  - `horas sin aprobar y tareas sin terminar aparecen con blocking=false y no impiden can_close_financials`
  - `quoted viene de la última cotización aprobada; sin cotización queda en 0 y version null`
  - `actual y team salen de financeService y de horas aprobadas por persona`
  - `proyecto sin horas, cotización ni facturas devuelve secciones vacías sin NaN`
  - `rpa_developer y billing reciben 403 en el JSON y en el PDF`
  - `el PDF responde 200, content-type application/pdf y un buffer que empieza con "%PDF"`
- [ ] **Step 2: Correr y ver el fallo**
  Run: `cd backend && npx jest src/__tests__/controllers/closureReport.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implementar `ClosureReportService.getReport`** reutilizando las mismas consultas de pendientes que `closeFinancials` en `commercialController.ts:~262-270` (extraer a funciones del servicio solo si evita duplicar; no cambiar el comportamiento de `closeFinancials`).
- [ ] **Step 4: Implementar `generateClosureReport`** en `pdfService.ts` siguiendo el estilo de `generatePaymentStatement` (pdfkit, `formatCLP` existente): secciones Resumen, Cotizado vs Real (tabla de dos columnas con diferencia), Equipo (horas presupuestadas vs reales), Hitos de pago y Pendientes. Sin colores especiales; tildes funcionan con la fuente por defecto.
- [ ] **Step 5: Handlers y rutas** en `commercialController`/`commercialRoutes` con `authorize(['team_lead'])`; el PDF se genera sin escribir a disco.
- [ ] **Step 6: Correr tests**
  Run: `cd backend && npx jest src/__tests__/controllers/closureReport.test.ts && npx tsc --noEmit`
  Expected: PASS y tsc limpio.
- [ ] **Step 7: Commit** — `feat(cierre): informe de cierre con checklist y PDF final (Fase 6G)`

---

### Task 4: Modal "Informe de cierre" en la ficha del proyecto (frontend)

**Files:**
- Create: `frontend/src/types/closureReport.ts` (espejo de `ClosureReport`/`ClosureChecklistItem` de Task 3)
- Create: `frontend/src/components/projects/ProjectClosureReportModal.tsx`
- Modify: `frontend/src/services/api.ts` (`getClosureReport(projectId): Promise<ClosureReport>` y `downloadClosureReportPdf(projectId): Promise<Blob>` con `responseType: 'blob'`)
- Modify: `frontend/src/pages/projects/ProjectDetailPage.tsx` (botón "Informe de cierre" visible solo para `team_lead` en la cabecera del proyecto, junto al tag de "Cierre financiero completado", ~línea 235)
- Test: `frontend/src/__tests__/components/ProjectClosureReportModal.test.tsx`

**Interfaces:**
- Consumes: `ClosureReport` de Task 3. La descarga del PDF debe ser vía blob + `URL.createObjectURL` (no `href` directo: el endpoint exige el token de autenticación; mismo aprendizaje de la bitácora, commit `82cdac4`).
- Produces: componente `ProjectClosureReportModal({ projectId, open, onClose })`.

- [ ] **Step 1: Escribir tests que fallan**:
  - `muestra el checklist con ícono de ok/pendiente y la cantidad de pendientes por ítem`
  - `distingue visualmente los ítems bloqueantes de las advertencias`
  - `muestra cotizado vs real con la diferencia, sin NaN cuando todo es 0`
  - `el botón "Descargar PDF" llama a downloadClosureReportPdf y dispara la descarga`
  - `muestra Alert de error si getClosureReport falla`
- [ ] **Step 2: Correr y ver el fallo**
  Run: `cd frontend && npx vitest run src/__tests__/components/ProjectClosureReportModal.test.tsx`
  Expected: FAIL.
- [ ] **Step 3: Implementar el modal** — `Modal` ancho con `Steps`-less layout: bloque "Pendientes" (`List` con `CheckCircleOutlined`/`WarningOutlined` según token de éxito/advertencia), bloque "Cotizado vs Real" (`Descriptions`/tabla), bloque "Equipo" y pie con "Descargar PDF" y "Cerrar". Mensaje claro si `can_close_financials` es false: "Aún hay pendientes bloqueantes para el cierre financiero". Tokens vía `theme.useToken()`.
- [ ] **Step 4: Integrar en `ProjectDetailPage`** (estado `closureOpen`, botón solo `team_lead`).
- [ ] **Step 5: Verificar**
  Run: `cd frontend && npx vitest run src/__tests__/components/ProjectClosureReportModal.test.tsx && npx tsc --noEmit && npm run check:theme && npm run lint`
  Expected: PASS y sin errores.
- [ ] **Step 6: Commit** — `feat(cierre): modal de informe de cierre y descarga de PDF en la ficha del proyecto (Fase 6G)`

---

## Self-Review

- **Cobertura del spec:** cartera con tabla/filtros/totales/pipeline/ventas por comercial (Tasks 1-2); cierre con revisión de pendientes (hitos, facturas, horas) e informe PDF real vs cotizado (Tasks 3-4). Del "Dashboard del proyecto (pestaña Resumen)" del plan original no se agrega nada: costos/margen (`ProjectROICard`), salud (`ProjectHealthCard`), horas por dev (capacidad) y cobros (pestaña Facturación) ya existen y el informe de cierre los consolida.
- **Consistencia de tipos:** `PortfolioRow`/`PortfolioResult` (Task 1) se espejan en `types/portfolio.ts` (Task 2); `ClosureReport` (Task 3) se espeja en `types/closureReport.ts` (Task 4). Nombres de método de `api.ts`: `getPortfolio`, `getClosureReport`, `downloadClosureReportPdf`.
- **Alcance deliberadamente fuera:** exportar la cartera a Excel/PDF, gráficos, y cambiar las reglas de `closeFinancials`.
