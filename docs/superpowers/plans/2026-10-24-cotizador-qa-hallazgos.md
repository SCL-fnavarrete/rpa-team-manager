# Cotizador RPA — hallazgos del recorrido manual (2026-10-24)

QA en navegador real (Playwright) sobre la rama `feat/pmo-executive-control-suite`, con roles `team_lead` (admin), `rpa_developer` (dev1) y `rpa_operations` (ops1). Referencias de línea tomadas del código al 2026-10-24.

## Críticos

**C1. Lo guardado no coincide con lo que muestran el panel y la propuesta.** Los campos de los pasos 2-4 del formulario no se montan hasta visitar la pestaña; `form.getFieldsValue()` solo devuelve campos montados. `ScopingPage.tsx:156-161`, `171`, `194-199` usan `Boolean(valor)` sobre campos inexistentes y `process_archetype` cae a `'custom'`. Repro: elegir arquetipo "Contabilización de Facturas", escribir cliente, guardar sin visitar otros pasos → panel/propuesta muestran 492 HH y CLP 17.712.000, el registro guardado queda en 236 HH y CLP 8.496.000 (OCR=false, 100 transacciones, AHT 10). Variante: con "Recepción de OC", escribir una letra en Cliente baja el panel de 492 a 236 HH y quita la etiqueta OCR aunque el interruptor sigue en "sí". Origen probable: `handleFormValuesChange` convierte `undefined` en `false` y la pestaña no usa `forceRender`.

**C2. Editar y guardar sin tocar nada destruye el registro.** COT-2026-003 (Recepción de OC, 492 HH, OCR sí) → Editar → Guardar sin cambios → arquetipo `custom`, OCR false, 236 HH, precio CLP 17.712.000 → 8.496.000. Con calibración manual de 60 HH, queda en 236 HH y el precio se cuadruplica. El PUT envía solo los campos del paso 1; `scopingService.update` (línea ~398) toma `data.custom_hours` en vez de las horas existentes; `ScopingPage.tsx:199` pisa el arquetipo. La propuesta abierta sigue mostrando valores viejos.

**C3. "Convertir en Proyecto" falla siempre y deja datos huérfanos.** HTTP 400 `SQLITE_ERROR: table tasks has no column named created_by`: `scopingService.ts:~586` usa `created_by`, la tabla `tasks` tiene `reporter_id` NOT NULL. No hay transacción: antes del error ya creó proyecto, tablero y 5 columnas (cada reintento crea otro huérfano). Líneas ~564-568: colores de columna `'#gray'`, `'#blue'`… inválidos. No crea `project_phases`, `project_assignments`, `client_id` ni `pm_user_id` aunque el plan promete "tareas y fases".

## Importantes

- **I1.** Los multiplicadores VDI/OCR solo mueven el puntaje de dificultad (`scopingCalculationEngine.ts:309-330`), que elige entre 3 niveles fijos de horas (236/492/666); volumen, pasos y aplicaciones no modifican las HH dentro de un nivel. La UI dice "+60% esfuerzo (x1.6)" / "+20%", lo que no es cierto. En el caso base, activar VDI y OCR no cambia nada pero aparece "Factores Multiplicadores Detectados".
- **I2.** Cambiar la moneda a USD/UF conserva tarifas en CLP ("USD 36.000/h"); las tarifas por moneda del backend (USD 40, UF 0.95) nunca se usan porque el frontend siempre envía las de CLP (`DEFAULT_INPUTS`, `ScopingPage.tsx:64-67`).
- **I3.** "Colaboradores actuales (FTEs)", "Tasa de error humano" y "Periodos punta" no cambian ningún número.
- **I4.** `triggerCalculate` (`ScopingPage.tsx:144-153`) solo hace `console.error` si falla; el panel conserva números viejos sin aviso; `loading` se descarta en `LiveScoringSidebar.tsx:28`.
- **I5.** Vaciar un campo de calibración y guardar → toast `SQLITE_CONSTRAINT: NOT NULL constraint failed: scoping_quotations.hours_developer` (400). `engine:389-393` valida `!== undefined` pero llega `null`; la API no valida esquema.
- **I6.** `TechnicalEconomicProposalModal.tsx:210`: "NO SE PUEDE AUTOMATIZAR CON RPA" aparece en verde con precio y ROI; "Convertir en Proyecto" queda activo para procesos no viables.
- **I7.** Propuesta con datos mal mostrados: sin código guardado muestra `COT-2026-NUEVA` (`ScopingPage.tsx:89`) y tras "Nuevo Levantamiento" el del registro anterior; línea 224 "No digital…" sale como "Digital Mixta"; línea 221 "2 3_apps"; línea 230 "DAILY" en inglés; línea 196 la fecha es siempre hoy; columna de rol dice "FTE-mes" cuando es FTE.
- **I8.** "Editar" abre además el modal de propuesta (`ScopingPage.tsx:358-360`), no restaura el arquetipo en el selector ni el estado "Calibración manual".
- **I9.** Los pasos 3 y 4 quedan escondidos en el menú "…" de las pestañas a 1440 y 2560 px (etiquetas demasiado largas).
- **I10.** `scopingRoutes.ts` solo usa `authenticate`: un `rpa_developer` ve costo interno, tarifa interna (18.000) y margen, y pudo borrar la cotización de admin. Convertir a proyecto es accesible a cualquier rol aunque `POST /api/projects` exige `team_lead`/`rpa_operations`.
- **I11.** "Imprimir / Exportar PDF" hace `window.print()` de toda la página: imprime wizard de fondo, máscara gris y modal recortado a ~630 px; faltan ROI y supuestos.
- **I12.** `POST /api/scopings/calculate` acepta basura: cuerpo vacío, frecuencia inválida o volumen "abc" dan 200 con nulos; horas negativas dan precio negativo; moneda "EUR" da 400 con "Cannot read properties of undefined (reading 'labor')".

## Menores

- M1. Payback "Inmediato" cuando el ahorro es 0 (`LiveScoringSidebar.tsx:230`, modal ~337).
- M2. KPI "Monto Total Propuesto" suma monedas distintas con "$" (`scopingService.ts:145`, `ScopingListTable.tsx:319`); KPI muestran "0%" sin resultados.
- M3. Búsqueda sin debounce: una petición por tecla.
- M4. El código se reasigna tras borrar el último (`MAX(code)+1`) y puede duplicar el código de una propuesta ya enviada.
- M5. Layout 1440 px: "Cliente / Proceso" muy angosto parte palabras; código se parte; falta separador de miles en tarifas; selector de moneda salta de línea.
- M6. A 800 px la tabla del historial se desplaza horizontalmente con acciones fuera de vista y textos partidos; "$ 25.488.000" se sale de su tarjeta.
- M7. Título del encabezado colapsa a una letra por línea a 800 px (también en `/tasks`: es del layout global).
- M8. "Nuevo Levantamiento" no reinicia el cronómetro ni vuelve al Paso 1; el cronómetro cuenta ticks de `setInterval` (`MeetingTimerHeader.tsx:42-43`) y puede atrasarse con la pestaña en segundo plano.
- M9. Estados "Enviada", "Aprobada", "Rechazada" no se pueden asignar desde la UI; el borrado permite cualquier estado salvo "convertida" aunque el plan dice solo borradores; `hourly_labor_cost` e `internal_cost_rate` se persisten con 14000/18000 aunque la moneda sea otra (`scopingService.ts:342-344`, `470-472`).
- M10. Colores fijos pasteles `#fff7e6`, `#f9f0ff`, `#f6ffed` en modo Día que `check:theme` no detecta.

## Lo que funcionó bien

6 arquetipos cargan sin NaN; cronómetro cambia de fase a 4/8/12 min y se pone rojo a 15:00; modo Noche legible sin fondos blancos; consola limpia salvo los 400 de conversión y NOT NULL; los tres roles ven y usan el módulo; crear, listar, ver propuesta y borrar un borrador funcionan; filtros y estado vacío funcionan.

## No probado

Proyecto convertido con tareas y fases (la conversión falla); modo "Sistema" y paleta "Azul Cobalto"; PDF real de impresión; deriva del cronómetro en segundo plano; `it_support` y `billing` solo por código/API.
