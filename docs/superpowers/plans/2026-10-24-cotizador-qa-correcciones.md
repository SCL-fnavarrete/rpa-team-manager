# Cotizador RPA — correcciones del QA manual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir los defectos críticos e importantes que el recorrido en navegador encontró en el Cotizador RPA, para que lo guardado coincida con lo mostrado, editar no destruya datos, "Convertir en Proyecto" funcione y el módulo respete los permisos de costos/márgenes.

**Architecture:** Tres tareas secuenciales: (A) backend — validación, permisos con saneamiento de costos internos, semántica de actualización con horas manuales persistidas, conversión a proyecto transaccional, tarifas por moneda; (B) frontend — formulario/estado del wizard (guardar y editar sin pérdida, monedas, errores visibles); (C) frontend — propuesta, impresión, textos, tema y visibilidad por rol.

**Tech Stack:** Node/Express/SQLite3/Jest (backend), React 18 + Ant Design v5 + Vitest (frontend).

**Spec:** `docs/superpowers/plans/2026-10-24-cotizador-qa-hallazgos.md` (hallazgos C1-C3, I1-I12, M1-M10 con repro y líneas) y el plan original `docs/plans/2026-09-30-rpa-scoping-estimator.md`. Los códigos (C1, I6…) de este plan remiten al documento de hallazgos: léelo completo antes de empezar.

## Global Constraints

- Decisión 7 del plan maestro: costos internos y márgenes solo los ve `team_lead`. Campos a ocultar a cualquier otro rol en respuestas y UI: `internal_cost_rate`, `project_internal_cost`, `projected_margin_pct` y los equivalentes dentro del resultado de `POST /calculate` (identifícalos en `ScopingCalculationResult`/`scopingService`). La tarifa de venta, precio propuesto, ROI y payback del cliente SÍ los ven todos.
- Roles reales: `team_lead`, `rpa_developer`, `rpa_operations`, `it_support`, `billing`. Crear proyectos exige `team_lead` o `rpa_operations` (igual que `POST /api/projects`).
- Mensajes de error y textos de UI en español; nada de errores SQL crudos al usuario.
- Frontend: `docs/UI_THEME_SPEC.md` (cero colores hex quemados, cero `bodyStyle`, `theme.useToken()`, Día y Noche), números con `frontend/src/utils/numberFormat.ts`. `npm run check:theme` debe seguir en 0 violaciones.
- El motor de cálculo NO se rediseña: los 3 niveles de horas (236/492/666) son el comportamiento aprobado (I1 se corrige solo en los textos, ver Task C). `backend/src/__tests__/services/scopingCalculationEngine.test.ts` debe seguir pasando sin cambios.
- Migraciones: nueva versión 48 (la 47 ya está aplicada y commiteada); nunca editar migraciones anteriores.
- Backend: los 563+ tests, `tsc --noEmit` y `npm run lint` (0 errores) en verde antes de cada commit. Frontend: tests afectados, `tsc --noEmit`, `check:theme` y lint.
- Commits en español, estilo `fix(cotizador): ...`, con la línea final `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Guardar un levantamiento sin visitar los pasos 2-4 guarda exactamente lo que el panel mostraba (C1) — test de payload en Task B.
2. Editar → Guardar sin cambios deja idénticos arquetipo, OCR/VDI, HH, semanas y precio (C2) — tests en Tasks A (API) y B (UI).
3. Fallo de conversión a proyecto no deja proyecto/tablero/columnas huérfanos (C3) — test de rollback en Task A.
4. Payload inválido (vacío, `null`, texto en numéricos, negativos, moneda "EUR") → 400 en español, nunca 200 con nulos ni 500 con texto interno (I5, I12) — Task A.
5. `rpa_developer`/`it_support`/`billing`: no ven costo interno ni margen, no borran ni convierten cotizaciones ajenas (I10) — Task A y Task C.

---

### Task A: Backend — validación, permisos, actualización fiel y conversión transaccional

**Files:**
- Modify: `backend/src/database/migrationList.ts` (migración 48: columna `custom_hours_json TEXT` en `scoping_quotations`, NULL = sin calibración manual)
- Modify: `backend/src/services/scopingService.ts`, `backend/src/services/scopingCalculationEngine.ts` (solo validación de entradas), `backend/src/controllers/scopingController.ts`, `backend/src/routes/scopingRoutes.ts`
- Modify/Create: esquema de validación de entrada para scoping, siguiendo el mecanismo `validate({ body })` + `backend/src/validation/schemas.ts` que ya usa el repo
- Test: `backend/src/__tests__/database/scopingMigration.test.ts` (ampliar), `backend/src/__tests__/routes/scopingRoutes.test.ts` (ampliar o crear `scopingService.test.ts` con SQLite real, molde de `backend/src/__tests__/controllers/projectController.financials.test.ts`)

**Interfaces:**
- Produces: respuesta de `GET /api/scopings`, `GET /api/scopings/:id`, `POST /calculate`, `POST /`, `PUT /:id` incluye `custom_hours: { lp?, crpa?, ar?, adv?, weeks? } | null` (parseado desde `custom_hours_json`) para que el frontend restaure la calibración manual. Para roles distintos de `team_lead` se omiten los campos de costo interno/margen listados en Global Constraints.
- Produces: `PUT /api/scopings/:id` admite cuerpo parcial: se fusiona sobre el registro existente y se recalcula con las entradas fusionadas; `custom_hours` ausente = conservar el guardado, `custom_hours: null` = limpiar, objeto = reemplazar. `process_archetype` ausente = conservar.
- Produces: `POST /:id/convert-to-project` → `{ data: { project_id, message } }`; 409 con mensaje en español si ya estaba convertida o si `viability_status` indica no viable; 403 si el rol no es `team_lead`/`rpa_operations`.
- Consumes (Task B/C): los campos anteriores.

- [ ] **Step 1: Escribir tests que fallan**
  - Migración 48: `agrega custom_hours_json nullable y conserva filas existentes con NULL`.
  - Validación (C/I5/I12): `calculate y create responden 400 en español ante cuerpo vacío, frecuencia inválida, volumen no numérico, horas negativas, campos null y moneda EUR; nunca 200 con nulos ni 500`.
  - Actualización (C2): `PUT parcial con solo client_name conserva arquetipo, OCR, horas y precio`; `PUT sin custom_hours conserva las horas manuales guardadas`; `PUT con custom_hours:null recalcula con los niveles del motor`; `crear con custom_hours persiste custom_hours_json y GET lo devuelve como objeto`.
  - Monedas (I2, M9): `crear en USD sin tarifas explícitas usa las tarifas por defecto de USD del backend (no las de CLP)` y lo mismo con UF; `hourly_labor_cost e internal_cost_rate se guardan en la moneda elegida`.
  - Permisos (I10): `rpa_developer no recibe internal_cost_rate, project_internal_cost ni projected_margin_pct en list/get/calculate; team_lead sí`; `rpa_developer no puede borrar ni editar la cotización de otro usuario (403) pero sí la propia; team_lead puede todo`; `convert-to-project responde 403 a rpa_developer, it_support y billing`.
  - Borrado (M9): `solo se pueden borrar cotizaciones en estado draft (409 en español si no)`.
  - Código (M4): `el código de una cotización nueva no reutiliza el de una borrada` (usar un contador monótono, p. ej. basado en `MAX(id)`/`sqlite_sequence`, no `MAX(code)+1`).
  - Conversión (C3): `convierte crea proyecto con created_by, client_id si el cliente existe por nombre, tablero con columnas de color válido, tareas con reporter_id y las fases del cálculo; marca la cotización como converted_to_project con converted_project_id`; `si falla la inserción de una tarea no queda proyecto, tablero ni columnas (rollback) y la cotización sigue en draft`; `convertir dos veces responde 409 sin crear un segundo proyecto`; `no viable responde 409`.
- [ ] **Step 2: Correr y ver el fallo**
  Run: `cd backend && npx jest src/__tests__/database/scopingMigration.test.ts src/__tests__/routes/scopingRoutes.test.ts`
  Expected: FAIL en los tests nuevos.
- [ ] **Step 3: Implementar** — migración 48; validación de entrada reutilizable por `/calculate`, `POST` y `PUT` (rechaza `null`, tipos erróneos, negativos, moneda fuera de `CLP|USD|UF`, mensajes en español); `update` fusionando sobre el registro; tarifas por moneda del backend usadas cuando el cliente no envía explícitas; función `sanitizeScopingForRole(row, role)` aplicada en todas las respuestas; propiedad (`created_by`) o `team_lead` para PUT/DELETE; `authorize(['team_lead','rpa_operations'])` en convert; borrado solo `draft`; `convertToProject` dentro de una transacción (BEGIN/COMMIT/ROLLBACK sobre el mismo `db`), usando `reporter_id`, colores válidos tomados del patrón que ya usan otros tableros por defecto (busca cómo crea las columnas `taskController`/`projectController`), `client_id` por coincidencia de nombre en `clients` si existe, y filas en `project_phases` si la tabla lo permite con los datos del cálculo; seguir el patrón de `createProjectFromQuote` en `projectController.ts` para los campos del proyecto (etapa comercial, fechas, `created_by`).
- [ ] **Step 4: Correr tests y suite**
  Run: `cd backend && npx jest src/__tests__/database/scopingMigration.test.ts src/__tests__/routes/scopingRoutes.test.ts src/__tests__/services/scopingCalculationEngine.test.ts && npm test && npx tsc --noEmit && npm run lint`
  Expected: todo PASS, sin errores de tsc ni lint.
- [ ] **Step 5: Commit** — `fix(cotizador): validación, permisos, actualización fiel y conversión transaccional a proyecto`

---

### Task B: Frontend — wizard fiel, edición sin pérdida y errores visibles

**Files:**
- Modify: `frontend/src/pages/scoping/ScopingPage.tsx`, `frontend/src/components/scoping/DiscoveryWizard.tsx`, `frontend/src/components/scoping/LiveScoringSidebar.tsx`, `frontend/src/components/scoping/MeetingTimerHeader.tsx`, `frontend/src/services/scopingService.ts`, `frontend/src/types/scoping.ts` (agregar `custom_hours` y manejo de campos de costo opcionales)
- Test: `frontend/src/__tests__/pages/ScopingPage.test.tsx` (crear), mismo molde que `PortfolioPage.test.tsx`/otros tests de páginas, con `scopingService` mockeado

**Interfaces:**
- Consumes: contrato de Task A (`custom_hours`, PUT parcial, 400 con `{ error }` en español).
- Produces: `ScopingPage` que siempre envía el conjunto completo de entradas (`{ ...DEFAULT_INPUTS, ...form.getFieldsValue(true) }`) tanto a `/calculate` como a create/update, sin convertir `undefined` en `false`.

- [ ] **Step 1: Escribir tests que fallan** (`ScopingPage.test.tsx`):
  - C1: `guardar sin visitar los pasos 2-4 envía las mismas entradas que se enviaron a calculate` (arquetipo Facturas + cliente; el payload de create incluye `requires_ocr` y volumen/AHT del arquetipo y `process_archetype` correcto).
  - C1: `escribir en Cliente no cambia las entradas enviadas a calculate respecto del arquetipo elegido`.
  - C2/I8: `editar un levantamiento restaura arquetipo, OCR/VDI y calibración manual (custom_hours) y NO abre el modal de propuesta`.
  - C2: `editar y guardar sin tocar nada envía arquetipo y custom_hours originales`.
  - I2: `cambiar moneda a USD reemplaza las tarifas por las de USD (no deja las de CLP)`; el rótulo de la moneda coincide con los montos.
  - I3: `los campos FTEs actuales, tasa de error y periodos punta muestran la leyenda "Solo referencia, no afecta el cálculo"` (o equivalente exacto elegido y probado).
  - I4: `si calculate falla se muestra un Alert de error en el panel y el panel indica carga mientras calcula`.
  - I5: `vaciar un campo de calibración manual no envía null (usa el valor calculado o bloquea Guardar con mensaje)` y un 400 del backend se muestra como mensaje legible.
  - M3: `la búsqueda del historial espera ~400 ms (debounce) antes de llamar a la API`.
  - M8: `Nuevo Levantamiento reinicia cronómetro, vuelve al Paso 1 y limpia el código mostrado`.
- [ ] **Step 2: Correr y ver el fallo**
  Run: `cd frontend && npx vitest run src/__tests__/pages/ScopingPage.test.tsx`
  Expected: FAIL.
- [ ] **Step 3: Implementar** — `forceRender` en las pestañas del wizard y lectura con `getFieldsValue(true)`; eliminar `Boolean(...)` sobre campos posiblemente indefinidos en `handleFormValuesChange` (`ScopingPage.tsx:156-199`); al editar cargar todos los valores del registro al formulario (arquetipo, interruptores, `custom_hours` → modo "Calibración manual") sin abrir la propuesta (`ScopingPage.tsx:358-360`); `loading` y error propagados a `LiveScoringSidebar` (`:28`) con `Alert`/`Spin` de Ant Design; al cambiar moneda aplicar tarifas por defecto de esa moneda (constantes en el frontend espejo de las del backend: CLP 36.000/14.000/18.000, USD 40, UF 0.95 — confirma los valores exactos leyendo `scopingCalculationEngine.ts`); leyenda de solo referencia en los 3 campos sin efecto; debounce de búsqueda con el patrón de `GlobalSearch` en `AppLayout`; reinicio completo en "Nuevo Levantamiento"; mostrar `error` del backend en `message.error`.
- [ ] **Step 4: Verificar**
  Run: `cd frontend && npx vitest run src/__tests__/pages/ScopingPage.test.tsx && npx tsc --noEmit && npm run check:theme && npm run lint`
  Expected: PASS y sin errores.
- [ ] **Step 5: Commit** — `fix(cotizador): wizard fiel al guardar y editar, monedas, errores visibles y debounce`

---

### Task C: Frontend — propuesta, impresión, textos, tema y visibilidad por rol

**Files:**
- Modify: `frontend/src/components/scoping/TechnicalEconomicProposalModal.tsx`, `frontend/src/components/scoping/LiveScoringSidebar.tsx`, `frontend/src/components/scoping/ScopingListTable.tsx`, `frontend/src/components/scoping/DiscoveryWizard.tsx` (etiquetas de pestañas y textos de multiplicadores), `frontend/src/pages/scoping/ScopingPage.tsx` (solo lo estrictamente necesario: código/fecha de la propuesta, visibilidad por rol, botón convertir)
- Test: `frontend/src/__tests__/components/TechnicalEconomicProposalModal.test.tsx` (crear) y ampliar `ScopingPage.test.tsx` de Task B si hace falta

**Interfaces:**
- Consumes: `ScopingQuotation`/resultado de cálculo con campos de costo interno opcionales (Task A los omite para no `team_lead`); `useAuthStore` para el rol (patrón ya usado en `AppLayout`).

- [ ] **Step 1: Escribir tests que fallan**:
  - I6: `proceso no viable muestra la leyenda en tono de error, oculta precio y ROI de la propuesta y deshabilita "Convertir en Proyecto"`.
  - I7: `la propuesta muestra el código y la fecha del levantamiento (no COT-2026-NUEVA ni la fecha de hoy), "Digital mixta/No digital" correcto, "2-3 aplicaciones" y frecuencia en español, rol con unidad "FTE"`.
  - I10: `un rpa_developer no ve costo interno, margen ni tarifa interna en panel, tabla ni propuesta; un team_lead sí`; `el botón Convertir solo aparece para team_lead y rpa_operations; Borrar solo en borradores propios o para team_lead`.
  - I11: `Imprimir marca solo la propuesta como área imprimible` (la hoja de estilos de impresión oculta el resto; test sobre la clase/atributo del área imprimible y sobre la presencia de la regla `@media print`).
  - I1: `los multiplicadores VDI/OCR se describen como aumento de dificultad (no como +60% de horas)` y la etiqueta "Factores Multiplicadores Detectados" solo aparece cuando el factor cambió el nivel de esfuerzo o el puntaje.
  - M1: `payback con ahorro 0 muestra "Sin retorno" y no "Inmediato"`.
  - M2: `el KPI de monto propuesto no mezcla monedas: se muestra por moneda o solo en CLP con rótulo explícito` y el KPI de porcentaje no muestra 0% sin resultados.
- [ ] **Step 2: Correr y ver el fallo**
  Run: `cd frontend && npx vitest run src/__tests__/components/TechnicalEconomicProposalModal.test.tsx`
  Expected: FAIL.
- [ ] **Step 3: Implementar** — banner de no viabilidad (token de error de `theme.useToken()`), código/fecha reales de la cotización, mapeo de etiquetas legibles, FTE vs FTE-mes, ocultar costos internos por rol, área imprimible con `@media print` en `index.css` o un módulo CSS existente (ocultar todo salvo el contenedor de la propuesta, sin recorte del modal), pestañas del wizard con etiquetas cortas ("1 Cliente", "2 Proceso", "3 Técnico", "4 Propuesta") o `tabBarGutter`/`size` que evite el menú "…" a 1440 px, reemplazo de `#fff7e6`, `#f9f0ff`, `#f6ffed` por tokens (`colorWarningBg`, `colorInfoBg`/`colorPrimaryBg`, `colorSuccessBg`), textos de multiplicadores honestos (I1), payback sin ahorro, KPI sin mezcla de monedas.
- [ ] **Step 4: Verificar**
  Run: `cd frontend && npx vitest run src/__tests__/components/TechnicalEconomicProposalModal.test.tsx src/__tests__/pages/ScopingPage.test.tsx && npx tsc --noEmit && npm run check:theme && npm run lint`
  Expected: PASS y sin errores.
- [ ] **Step 5: Commit** — `fix(cotizador): propuesta honesta, impresión, textos, tema y visibilidad de costos por rol`

---

## Self-Review

- **Cobertura:** C1/C2/I8/I2/I3/I4/I5/M3/M8 → Task B; C3/I10/I12/M4/M9 → Task A; I6/I7/I9/I11/I1/M1/M2/M10 y visibilidad por rol → Task C; I5/I12 backend → Task A.
- **Fuera de alcance a propósito:** rediseño del motor para que volumen/pasos modifiquen horas dentro de un nivel (I1, requiere decisión de producto), M5/M6/M7 (ajustes menores de layout; M7 es del layout global), asignar estados "Enviada/Aprobada/Rechazada" desde la UI, límite de intentos de login en desarrollo.
- **Consistencia:** `custom_hours` (objeto o null) definido en Task A y consumido en B; campos de costo interno opcionales definidos en Task A y consumidos en C.
