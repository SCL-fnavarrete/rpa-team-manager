# RPA Scoping & Estimator (Protocolo de Levantamiento en 15 Minutos) Implementation Plan

> **For Claude / Antigravity:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Implementar en la plataforma un estándar y módulo integral de "Cotizador de RPA y Protocolo de Levantamiento en 15 Minutos" para que cualquier desarrollador o consultor del equipo ejecute reuniones de levantamiento con clientes con preguntas certeras, cubicación cuantitativa automática de esfuerzo (HH por rol y cronograma en semanas), cálculo de viabilidad técnica/complejidad (fórmulas del Scorecard RPA) y generación de propuesta técnico-económica con ROI para el cliente.

**Architecture:**
- **Backend**: Motor de cálculo matemático (`scopingCalculationEngine.ts`) que replica con exactitud los algoritmos de `Herramienta de Evaluación de Procesos para RPA.xlsx` y `CL - FACTURAS PROVEEDORES - Esfuerzo v0.3.xlsx`. Migración SQLite (versión 47) para persistir levantamientos (`scoping_quotations`). Controlador y servicio RESTful con soporte para plantillas de arquetipos (Facturas, Conciliaciones Bancarias, Órdenes de Compra, Portales Web, etc.) y conversión automática a proyecto con tareas y fases.
- **Frontend**: Módulo React 18 + AntD v5 con cumplimiento estricto de `UI_THEME_SPEC.md` (modo día/noche, tokens de AntD, cero colores quemados). Wizard interactivo "Protocolo de 15 Minutos" con cronómetro integrado de reunión, alertas de multiplicadores de riesgo (ej: VDI/Citrix x1.6, OCR x1.2), cubicador en vivo por perfiles (Líder Proyecto, Consultor/Arquitecto RPA, Automatizador SSR, Advisor/QA), vista ejecutiva de Propuesta Técnico-Económica con análisis de ROI y retornos, e historial de cotizaciones.

**Tech Stack:**
- React 18, TypeScript, Vite, Ant Design v5, `@ant-design/icons`
- Node.js, Express, SQLite3, Jest
- Date-fns, Lodash

---

### Task 1: Motor Matemático de Scoring y Cubicación de Esfuerzo (Backend Core)
**Files:**
- Create: `backend/src/services/scopingCalculationEngine.ts`
- Test: `backend/src/__tests__/services/scopingCalculationEngine.test.ts`

**Details:**
- Implementar la lógica del Scorecard de Viabilidad, Complejidad, Horas Manuales, Cubicación de HH y ROI:
  - Preguntas de eliminación (Reglas vs Subjetividad, Entrada Digital/Estructurada).
  - Estabilidad de proceso y aplicaciones.
  - Horas manuales anuales: `freq * volume * (aht / 60)`.
  - Multiplicadores de complejidad: `(0.1*stability + 0.1*apps + 0.1*steps + 0.3*logic + 0.4*input_data) * vdi_factor * ocr_factor`.
  - Cubicación de horas por rol (LP, CRPA, AR, ADV) y fases de proyecto.
  - Ahorros anuales y Payback en meses para el cliente.

### Task 2: Migración de Base de Datos y Repositorio de Cotizaciones/Levantamientos
**Files:**
- Modify: `backend/src/database/migrationList.ts` (Migration 47: `scoping_quotations`)
- Test: `backend/src/__tests__/database/scopingMigration.test.ts`

**Details:**
- Crear tabla `scoping_quotations` con todos los campos cualitativos, volumétricos, técnicos, cubicación, valores económicos y estados.
- Índices por `code`, `client_name`, `status`, `created_at`.

### Task 3: Arquetipos Preconfigurados de Procesos RPA
**Files:**
- Create: `backend/src/constants/rpaArchetypes.ts`
- Test: `backend/src/__tests__/services/scopingArchetypes.test.ts`

**Details:**
- Definir las plantillas de procesos estándar más frecuentes en la industria y en el equipo:
  1. *Contabilización de Facturas* (basado en el caso real analizado).
  2. *Conciliación Bancaria* (cartolas bancarias, match con ERP SAP/Dynamics/Softland, reglas de cuadratura).
  3. *Recepción y Emisión de Órdenes de Compra (OC)* (basado en el estándar Rocketbot del PDF).
  4. *Extracción y Descarga de Documentos desde Portales Web (SII, Tesorería, Bancos)*.
  5. *Carga Masiva de Datos e Integración de Sistemas*.
  6. *Proceso Personalizado*.

### Task 4: Servicio y Controlador de Cotizaciones y Levantamientos (Backend API)
**Files:**
- Create: `backend/src/services/scopingService.ts`
- Create: `backend/src/controllers/scopingController.ts`
- Create: `backend/src/routes/scopingRoutes.ts`
- Modify: `backend/src/server.ts` (montar `/api/scopings`)
- Test: `backend/src/__tests__/routes/scopingRoutes.test.ts`

**Details:**
- Endpoints:
  - `GET /api/scopings`: Listar levantamientos con filtros y KPIs resumidos.
  - `GET /api/scopings/archetypes`: Obtener plantillas predefinidas.
  - `GET /api/scopings/:id`: Detalle completo.
  - `POST /api/scopings/calculate`: Cálculo reactivo en memoria para feedback en tiempo real.
  - `POST /api/scopings`: Guardar nuevo levantamiento/cotización.
  - `PUT /api/scopings/:id`: Actualizar cotización.
  - `DELETE /api/scopings/:id`: Eliminar borrador.
  - `POST /api/scopings/:id/convert-to-project`: Convertir en proyecto formal del portafolio.

### Task 5: Cliente API en Frontend y Tipos TypeScript
**Files:**
- Create: `frontend/src/types/scoping.ts`
- Create: `frontend/src/services/scopingService.ts`

**Details:**
- Definir interfaces completas TypeScript para inputs, respuestas calculadas, arquetipos y cotizaciones guardadas.
- Métodos tipados para llamar a la API de backend.

### Task 6: Componentes de UI del Protocolo de 15 Minutos y Cubicación
**Files:**
- Create: `frontend/src/components/scoping/MeetingTimerHeader.tsx` (Asistente visual con cronómetro de los 15 min y fases).
- Create: `frontend/src/components/scoping/LiveScoringSidebar.tsx` (Badge de viabilidad, medidor de esfuerzo, resumen de HH y ROI en vivo).
- Create: `frontend/src/components/scoping/DiscoveryWizard.tsx` (Formulario guiado paso a paso con las preguntas certeras y explicaciones tácticas).
- Create: `frontend/src/components/scoping/TechnicalEconomicProposalModal.tsx` (Propuesta formal ejecutiva para presentar al cliente con As-Is/To-Be, horas por perfil, cronograma y ROI).
- Create: `frontend/src/components/scoping/ScopingListTable.tsx` (Tabla con historial, filtros, estadísticas y conversión a proyecto).

### Task 7: Vista Principal de Cotizaciones y Navegación
**Files:**
- Create: `frontend/src/pages/scoping/ScopingPage.tsx`
- Modify: `frontend/src/App.tsx` (Ruta `/cotizador`)
- Modify: `frontend/src/components/common/AppLayout.tsx` (Ítem de menú accesible a desarrolladores, operaciones y líderes)
- Modify: `frontend/src/pages/projects/ProjectsPage.tsx` (Acceso rápido "Nuevo Levantamiento / Cotización")

### Task 8: Validación de Theming Día/Noche, Auditoría y Pruebas Integrales
**Files:**
- Run: `npm run check:theme` en `frontend/`
- Run: `npm test` en `backend/`
- Run: `npx tsc --noEmit` en `frontend/` y `backend/`
