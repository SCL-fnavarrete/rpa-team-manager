import { randomUUID } from 'crypto';
import { db } from '../database/database';
import {
  ScopingCalculationEngine,
  ScopingInputs,
  ScopingCalculationResult,
  CustomHours
} from './scopingCalculationEngine';
import { RPA_ARCHETYPES, RPAArchetype } from '../constants/rpaArchetypes';
import { activityLogService } from './activityLogService';
import { financeService } from './financeService';
import { UserRole } from '../types/auth';
import { APIError, AuthorizationError, ConflictError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface ScopingRecord extends Omit<ScopingInputs, 'custom_hours'> {
  id: number;
  code: string;
  client_name: string;
  client_contact?: string;
  client_email?: string;
  process_name: string;
  business_unit?: string;
  process_archetype: string;
  applications_detail?: string;
  created_by?: number;
  created_at: string;
  updated_at: string;

  viability_status: string;
  viability_score: number;
  complexity_score: number;
  difficulty_score: number;
  effort_level: string;
  benefit_level: string;
  annual_manual_hours: number;
  hours_saved_annual: number;
  ftes_released: number;
  error_reduction_pct: number;
  aht_reduction_pct: number;

  estimated_weeks: number;
  hours_pm: number;
  hours_consultant: number;
  hours_developer: number;
  hours_advisor: number;
  total_hours: number;

  currency: 'CLP' | 'USD' | 'UF';
  hourly_labor_cost: number;
  target_hourly_rate: number;
  internal_cost_rate: number;
  project_internal_cost: number;
  proposed_price: number;
  projected_margin_pct: number;
  client_annual_manual_cost: number;
  client_annual_savings: number;
  payback_months: number;
  roi_first_year_pct: number;

  assumptions?: string;
  exclusions?: string;
  notes?: string;
  status: 'draft' | 'sent_to_client' | 'approved' | 'rejected' | 'converted_to_project';
  converted_project_id?: number | null;

  // Calibración manual persistida; null = el motor usa los niveles de esfuerzo
  custom_hours: CustomHours | null;

  // Campos desglosados en tiempo de ejecución
  calculation?: ScopingCalculationResult;
}

// Entradas aceptadas por el cálculo en memoria; custom_hours null/ausente = sin calibración manual
export type ScopingDraftInputs = Omit<ScopingInputs, 'custom_hours'> & { custom_hours?: CustomHours | null };
export type ScopingCalculationDraft = ScopingCalculationResult & { custom_hours: CustomHours | null };

export interface ScopingActor {
  id: number;
  role: UserRole;
}

type ScopingStatus = ScopingRecord['status'];
type ColumnValue = string | number | null;

// Cuerpo de la solicitud fusionado con el registro guardado, listo para calcular y persistir
interface ResolvedScoping {
  details: {
    client_name: string;
    client_contact: string | null;
    client_email: string | null;
    process_name: string;
    business_unit: string | null;
    process_archetype: string;
    applications_detail: string | null;
    assumptions: string | null;
    exclusions: string | null;
    notes: string | null;
    status: ScopingStatus;
  };
  inputs: ScopingInputs;
  customHours: CustomHours | null;
}

// Decisión 7: costo interno y margen solo los ve team_lead. Tarifa de venta, precio, ROI y payback los ven todos.
const INTERNAL_COST_FIELDS = ['internal_cost_rate', 'project_internal_cost', 'projected_margin_pct'] as const;
const CUSTOM_HOURS_KEYS = ['lp', 'crpa', 'ar', 'adv', 'weeks'] as const;

// Plantilla del ciclo de vida (project_phase_templates) que representa cada una de las 5 fases del cálculo
const PHASE_TEMPLATE_NAMES = [
  'PDD Creation',
  'Development - Core Logic',
  'Integration Testing',
  'UAT Execution',
  'Production Deployment'
];

// Columnas del tablero Kanban de un proyecto convertido; colores hex válidos como los del resto de tableros
const CONVERSION_COLUMNS = [
  { name: 'Por Hacer', color: '#f5f5f5', isDone: 0 },
  { name: 'En Desarrollo', color: '#e6f7ff', isDone: 0 },
  { name: 'Pruebas / QA', color: '#fff2e6', isDone: 0 },
  { name: 'Aceptación UAT', color: '#f9f0ff', isDone: 0 },
  { name: 'Producción / Listo', color: '#f6ffed', isDone: 1 }
];

const DEFAULT_ASSUMPTIONS =
  '1. El cliente proporcionará credenciales y ambientes de prueba (QA) con antelación.\n' +
  '2. Accesos a través de VPN estables y sin autenticación biométrica o token físico no automatizable.\n' +
  '3. Disponibilidad del responsable del proceso para reuniones de validación y UAT.';

const DEFAULT_EXCLUSIONS =
  '1. Modificaciones en el código fuente de los sistemas destino o ERP del cliente.\n' +
  '2. Migraciones mayores de bases de datos o sistemas durante el periodo de construcción.';

/**
 * Quita de la respuesta los campos de costo interno y margen para cualquier rol distinto de team_lead.
 * Vale para un registro, su `calculation` anidada o un resultado de /calculate.
 */
export function sanitizeScopingForRole<T extends object>(value: T, role: UserRole | undefined): T {
  if (role === 'team_lead') return value;
  const copy: Record<string, any> = { ...value };
  for (const field of INTERNAL_COST_FIELDS) delete copy[field];
  if (copy.calculation && typeof copy.calculation === 'object') {
    copy.calculation = { ...copy.calculation };
    for (const field of INTERNAL_COST_FIELDS) delete copy.calculation[field];
  }
  return copy as T;
}

// Solo conserva las claves que traen valor; un objeto sin claves equivale a "sin calibración"
function normalizeCustomHours(value: CustomHours | null | undefined): CustomHours | null {
  if (!value) return null;
  const entries = CUSTOM_HOURS_KEYS.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]);
  return entries.length > 0 ? (Object.fromEntries(entries) as CustomHours) : null;
}

function parseCustomHours(raw: string | null | undefined): CustomHours | null {
  if (!raw) return null;
  try {
    return normalizeCustomHours(JSON.parse(raw));
  } catch {
    return null;
  }
}

const notFound = (): APIError => new APIError('Levantamiento no encontrado', 404, 'NOT_FOUND_ERROR');

const addDays = (date: Date, days: number): Date => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};

// Fecha local (no UTC): de noche en Chile toISOString() ya marcaría el día siguiente
const toDateOnly = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export class ScopingService {
  /**
   * Obtiene todos los arquetipos de procesos disponibles
   */
  public getArchetypes(): RPAArchetype[] {
    return RPA_ARCHETYPES;
  }

  /**
   * Ejecuta el cálculo en memoria (simulación / preview en vivo)
   */
  public calculateDraft(inputs: ScopingDraftInputs): ScopingCalculationDraft {
    const customHours = normalizeCustomHours(inputs.custom_hours);
    const result = ScopingCalculationEngine.calculate({ ...inputs, custom_hours: customHours ?? undefined });
    return { ...result, custom_hours: customHours };
  }

  /**
   * Lista todos los levantamientos con filtros y métricas globales
   */
  public async getAll(filters: { client?: string; status?: string; archetype?: string; search?: string } = {}) {
    let sql = `
      SELECT s.*, u.full_name as author_name, p.name as project_name
      FROM scoping_quotations s
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN projects p ON s.converted_project_id = p.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (filters.status) {
      sql += ` AND s.status = ?`;
      params.push(filters.status);
    }
    if (filters.archetype) {
      sql += ` AND s.process_archetype = ?`;
      params.push(filters.archetype);
    }
    if (filters.client) {
      sql += ` AND s.client_name LIKE ?`;
      params.push(`%${filters.client}%`);
    }
    if (filters.search) {
      sql += ` AND (s.process_name LIKE ? OR s.client_name LIKE ? OR s.code LIKE ?)`;
      params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
    }

    sql += ` ORDER BY s.created_at DESC`;

    const rows = await db.query(sql, params) as any[];

    // Calcular KPIs de resumen
    const totalCount = rows.length;
    const totalQuotedHours = rows.reduce((acc: number, r: any) => acc + (r.total_hours || 0), 0);
    const totalProposedPrice = rows.reduce((acc: number, r: any) => acc + (r.proposed_price || 0), 0);
    const viableCount = rows.filter((r: any) => r.viability_status === 'viable').length;

    const items = rows.map(({ custom_hours_json, ...row }) => ({
      ...row,
      custom_hours: parseCustomHours(custom_hours_json)
    }));

    return {
      items,
      kpis: {
        total_scopings: totalCount,
        viable_percentage: totalCount > 0 ? Math.round((viableCount / totalCount) * 100) : 0,
        total_quoted_hours: totalQuotedHours,
        total_proposed_amount: totalProposedPrice
      }
    };
  }

  /**
   * Obtiene un levantamiento por ID con detalle completo de cálculo
   */
  public async getById(id: number): Promise<ScopingRecord | null> {
    const row = await db.get(
      `SELECT s.*, u.full_name as author_name, p.name as project_name
       FROM scoping_quotations s
       LEFT JOIN users u ON s.created_by = u.id
       LEFT JOIN projects p ON s.converted_project_id = p.id
       WHERE s.id = ?`,
      [id]
    ) as any;

    if (!row) return null;

    const { custom_hours_json, ...record } = row;

    // Reconstruir cálculo reactivo para obtener los desgloses de roles y fases. Las horas guardadas mandan:
    // la propuesta muestra lo que se cotizó aunque después cambien los niveles del motor.
    const inputs: ScopingInputs = {
      data_input_type: row.data_input_type,
      rule_based_level: row.rule_based_level,
      process_stability: row.process_stability,
      application_stability: row.application_stability,
      frequency: row.frequency,
      volume_per_frequency: row.volume_per_frequency,
      aht_minutes: row.aht_minutes,
      current_ftes: row.current_ftes ?? undefined,
      error_rate_pct: row.error_rate_pct ?? undefined,
      peak_period: row.peak_period ?? undefined,
      process_steps_count: row.process_steps_count,
      decision_complexity: row.decision_complexity,
      applications_count: row.applications_count,
      uses_vdi: Boolean(row.uses_vdi),
      requires_ocr: Boolean(row.requires_ocr),
      structured_data_pct: row.structured_data_pct,
      exception_rate_pct: row.exception_rate_pct ?? undefined,
      currency: row.currency,
      hourly_labor_cost: row.hourly_labor_cost,
      target_hourly_rate: row.target_hourly_rate,
      internal_cost_rate: row.internal_cost_rate,
      custom_hours: {
        weeks: row.estimated_weeks,
        lp: row.hours_pm,
        crpa: row.hours_consultant,
        ar: row.hours_developer,
        adv: row.hours_advisor
      }
    };

    // Una fila con datos dañados debe poder verse, repararse (PUT) o borrarse: sin cálculo reconstruido, pero sin error
    let calculation: ScopingCalculationResult | undefined;
    try {
      calculation = ScopingCalculationEngine.calculate(inputs);
    } catch (error) {
      logger.warn(`Levantamiento ${row.id}: sus datos guardados no permiten reconstruir el cálculo`, error);
    }

    return {
      ...record,
      uses_vdi: Boolean(row.uses_vdi),
      requires_ocr: Boolean(row.requires_ocr),
      custom_hours: parseCustomHours(custom_hours_json),
      calculation
    };
  }

  /**
   * Crea un nuevo levantamiento / cotización
   */
  public async create(data: Record<string, any>, actor: ScopingActor): Promise<ScopingRecord> {
    const resolved = this.resolveFields(data, actor);
    this.assertStatusAssignable(resolved.details.status);

    const calc = ScopingCalculationEngine.calculate(resolved.inputs);
    // El código COT-YYYY-NNN se deriva del id que asigna la base (AUTOINCREMENT: nunca se repite, ni siquiera
    // tras borrar el último). Se inserta con un código temporal único y se corrige en seguida, sin leer antes un
    // correlativo que otra creación simultánea podría tomar.
    const columns = {
      code: `TMP-${randomUUID()}`,
      created_by: actor.id,
      ...this.buildColumns(resolved, calc)
    };
    const names = Object.keys(columns);

    const result = await db.run(
      `INSERT INTO scoping_quotations (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
      Object.values(columns)
    );
    const newId = result.id!;
    const code = `COT-${new Date().getFullYear()}-${String(newId).padStart(3, '0')}`;
    try {
      await db.run('UPDATE scoping_quotations SET code = ? WHERE id = ?', [code, newId]);
    } catch (error) {
      // No dejar un levantamiento con código temporal
      await db.run('DELETE FROM scoping_quotations WHERE id = ?', [newId])
        .catch((cleanupError) => logger.error('No se pudo limpiar el levantamiento sin código definitivo:', cleanupError));
      throw error;
    }
    logger.info(`Levantamiento/Cotización creada exitosamente con ID ${newId} y código ${code}`);

    return (await this.getById(newId))!;
  }

  /**
   * Actualiza un levantamiento existente. El cuerpo es parcial: lo que no llega se conserva del registro
   * guardado (incluida la calibración manual de horas) y el resultado se recalcula con las entradas fusionadas.
   */
  public async update(id: number, data: Record<string, any>, actor: ScopingActor): Promise<ScopingRecord> {
    const existing = await this.requireModifiable(id, actor);
    if (existing.status === 'converted_to_project') {
      throw new ConflictError('No se puede modificar un levantamiento que ya fue convertido a proyecto');
    }

    const resolved = this.resolveFields(data, actor, existing);
    this.assertStatusAssignable(resolved.details.status, existing.status);

    const calc = ScopingCalculationEngine.calculate(resolved.inputs);
    const columns = this.buildColumns(resolved, calc);

    await db.run(
      `UPDATE scoping_quotations SET ${Object.keys(columns).map((name) => `${name} = ?`).join(', ')},
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...Object.values(columns), id]
    );
    logger.info(`Levantamiento ID ${id} actualizado correctamente.`);

    return (await this.getById(id))!;
  }

  /**
   * Elimina un levantamiento (solo borradores; solo su autor o team_lead)
   */
  public async delete(id: number, actor: ScopingActor): Promise<void> {
    const existing = await this.requireModifiable(id, actor);
    if (existing.status !== 'draft') {
      throw new ConflictError('Solo se pueden eliminar levantamientos en estado borrador');
    }

    await db.run(`DELETE FROM scoping_quotations WHERE id = ?`, [id]);
    logger.info(`Levantamiento ID ${id} eliminado.`);
  }

  /**
   * Convierte un levantamiento viable en un Proyecto con tablero Kanban, tareas y fases del cálculo.
   * Todo ocurre en una transacción: si algo falla no queda proyecto, tablero ni columnas a medias.
   */
  public async convertToProject(id: number, actor: ScopingActor): Promise<{ project_id: number; message: string }> {
    const scoping = await this.getById(id);
    if (!scoping) throw notFound();

    if (scoping.status === 'converted_to_project' || scoping.converted_project_id) {
      throw new ConflictError(
        scoping.converted_project_id
          ? `Este levantamiento ya fue convertido al proyecto ID ${scoping.converted_project_id}`
          : 'Este levantamiento ya fue convertido a proyecto'
      );
    }

    const calc = scoping.calculation;
    if (!calc) {
      throw new ConflictError('Los datos guardados del levantamiento no son válidos: corrígelos antes de convertirlo en proyecto');
    }
    if (scoping.viability_status !== 'viable') {
      throw new ConflictError(`No se puede convertir a proyecto un levantamiento no viable (${calc.viability_label})`);
    }

    const phases = calc.phases_breakdown;
    const client = await db.get(
      `SELECT id FROM clients WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND is_active = 1 ORDER BY id LIMIT 1`,
      [scoping.client_name]
    ) as { id: number } | undefined;
    const templates = await db.query(
      `SELECT id, name FROM project_phase_templates WHERE name IN (${PHASE_TEMPLATE_NAMES.map(() => '?').join(', ')})`,
      PHASE_TEMPLATE_NAMES
    ) as Array<{ id: number; name: string }>;

    // El sistema entero asume costos en pesos (formulario del proyecto, aprobación de versiones, financeService):
    // el costo interno del levantamiento viene en la moneda de la cotización y se convierte aquí.
    const costClp = await financeService.toCLP(scoping.project_internal_cost, scoping.currency);

    const startDate = new Date();
    const endDate = addDays(startDate, scoping.estimated_weeks * 7 - 1);
    const projectDescription = `Proyecto RPA generado a partir del levantamiento ${scoping.code}.\n` +
      `Cliente: ${scoping.client_name}\n` +
      `Proceso: ${scoping.process_name}\n` +
      `Esfuerzo estimado: ${calc.effort_label} (${scoping.total_hours} HH en ${scoping.estimated_weeks} semanas)\n` +
      `Precio propuesto: ${scoping.currency} ${scoping.proposed_price.toLocaleString('es-CL')}`;

    await db.beginTransaction('IMMEDIATE');
    let projectId: number;
    let phasesCreated = 0;
    try {
      // Mismos campos que un proyecto comercial nuevo: queda en cotización hasta que el cliente apruebe
      const project = await db.run(
        `INSERT INTO projects (
          name, description, status, priority, budget, start_date, end_date, created_by,
          client_id, project_type, currency, commercial_stage
        ) VALUES (?, ?, 'on_hold', 'medium', ?, ?, ?, ?, ?, 'commercial', ?, 'quoting')`,
        [
          `RPA - ${scoping.process_name} (${scoping.client_name})`,
          projectDescription,
          costClp,
          toDateOnly(startDate),
          toDateOnly(endDate),
          actor.id,
          client?.id ?? null,
          scoping.currency
        ]
      );
      projectId = project.id!;

      await db.run(
        `INSERT INTO project_financials (
          project_id, budgeted_cost, budgeted_cost_currency, sale_price, sale_price_currency, budgeted_hours
        ) VALUES (?, ?, 'CLP', ?, ?, ?)`,
        [projectId, costClp, scoping.proposed_price, scoping.currency, scoping.total_hours]
      );

      // Versión 1 de la cotización, ya enviada: el equipo solo la aprueba, sin reescribir monto, moneda ni horas.
      // El costo va en la MISMA moneda que el monto: approveQuote lo convierte con la moneda de la versión.
      await db.run(
        `INSERT INTO project_quotes (
          project_id, version, pricing_model, amount, currency, hours, estimated_cost, margin_percent,
          status, notes, created_by
        ) VALUES (?, 1, 'fixed', ?, ?, ?, ?, ?, 'sent', ?, ?)`,
        [
          projectId,
          scoping.proposed_price,
          scoping.currency,
          scoping.total_hours,
          scoping.project_internal_cost,
          scoping.projected_margin_pct,
          `Generada desde ${scoping.code}`,
          actor.id
        ]
      );

      const board = await db.run(
        `INSERT INTO task_boards (project_id, name, description, board_type, is_default)
         VALUES (?, 'Tablero Principal RPA', 'Flujo de construcción y despliegue del robot', 'kanban', 1)`,
        [projectId]
      );
      const boardId = board.id!;

      let firstColumnId = 0;
      for (const [index, column] of CONVERSION_COLUMNS.entries()) {
        const created = await db.run(
          `INSERT INTO task_columns (board_id, name, position, color, is_done_column)
           VALUES (?, ?, ?, ?, ?)`,
          [boardId, column.name, index + 1, column.color, column.isDone]
        );
        if (index === 0) firstColumnId = created.id!;
      }

      for (const [index, phase] of phases.entries()) {
        const plannedStart = toDateOnly(addDays(startDate, (phase.start_week - 1) * 7));
        const plannedEnd = toDateOnly(addDays(startDate, phase.end_week * 7 - 1));

        await db.run(
          `INSERT INTO tasks (
            board_id, column_id, title, description, status, priority, position,
            estimated_hours, start_date, due_date, reporter_id
          ) VALUES (?, ?, ?, ?, 'todo', 'medium', ?, ?, ?, ?, ?)`,
          [
            boardId,
            firstColumnId,
            `Fase ${phase.phase_number}: ${phase.name}`,
            `${phase.description} (Semana ${phase.start_week} a ${phase.end_week})`,
            index,
            phase.hours,
            plannedStart,
            plannedEnd,
            actor.id
          ]
        );

        const template = templates.find((t) => t.name === PHASE_TEMPLATE_NAMES[index]);
        if (template) {
          await db.run(
            `INSERT INTO project_phases (
              project_id, template_id, name, description, phase_order,
              planned_start_date, planned_end_date, estimated_hours, is_billable, responsibility
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'internal')`,
            [projectId, template.id, phase.name, phase.description, phase.phase_number, plannedStart, plannedEnd, phase.hours]
          );
          phasesCreated++;
        } else {
          logger.warn(`Plantilla de ciclo de vida "${PHASE_TEMPLATE_NAMES[index]}" no encontrada: la fase ${phase.phase_number} se crea solo como tarea`);
        }
      }

      // La condición evita que dos conversiones simultáneas dejen dos proyectos para el mismo levantamiento
      const marked = await db.run(
        `UPDATE scoping_quotations
         SET status = 'converted_to_project', converted_project_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND converted_project_id IS NULL AND status <> 'converted_to_project'`,
        [projectId, id]
      );
      if (!marked.changes) {
        throw new ConflictError('Este levantamiento ya fue convertido a proyecto');
      }

      await db.commit();
    } catch (error) {
      try {
        await db.rollback();
      } catch (rollbackError) {
        logger.error('No se pudo revertir la conversión del levantamiento:', rollbackError);
      }
      throw error;
    }

    await activityLogService.logActivity(actor.id, 'project', projectId, 'created_from_scoping', null, {
      scoping_id: id,
      scoping_code: scoping.code,
      tasks_count: phases.length,
      phases_count: phasesCreated
    });
    logger.info(`Levantamiento ${scoping.code} convertido con éxito a proyecto ID ${projectId}`);

    return {
      project_id: projectId,
      message: `Proyecto creado exitosamente con ${phases.length} tareas y ${phasesCreated} fases asignadas.`
    };
  }

  // Carga el levantamiento y exige que quien lo modifica sea su autor o team_lead
  private async requireModifiable(id: number, actor: ScopingActor): Promise<ScopingRecord> {
    const existing = await this.getById(id);
    if (!existing) throw notFound();

    if (actor.role !== 'team_lead' && existing.created_by !== actor.id) {
      throw new AuthorizationError('Solo el autor del levantamiento o la jefatura pueden modificarlo');
    }
    return existing;
  }

  // "Convertida a proyecto" solo se asigna convirtiendo: un PUT o POST no puede dejar ese estado sin proyecto
  private assertStatusAssignable(next: ScopingStatus, current?: ScopingStatus): void {
    if (next === 'converted_to_project' && current !== 'converted_to_project') {
      throw new ConflictError('El estado "convertida a proyecto" solo se asigna al convertir el levantamiento en proyecto');
    }
  }

  /**
   * Une el cuerpo recibido con el registro guardado (si existe): lo ausente se conserva, null limpia
   * campos opcionales. Al cambiar de moneda sin enviar tarifas, se usan las tarifas por defecto de la nueva moneda.
   * La tarifa interna solo la fija team_lead (el resto de los roles ni siquiera la ve): si la envía otro rol se
   * ignora y rige la guardada, o la por defecto de la moneda al crear.
   */
  private resolveFields(data: Record<string, any>, actor: ScopingActor, existing?: ScopingRecord): ResolvedScoping {
    const current = existing as Record<string, any> | undefined;
    const pick = (key: string, fallback?: any) => (data[key] !== undefined ? data[key] : current ? current[key] : fallback);
    const optional = (key: string, fallback?: any) => pick(key, fallback) ?? undefined;
    const text = (key: string) => pick(key, null) ?? null;

    const currency = pick('currency', 'CLP');
    const currencyChanged = current !== undefined && currency !== current.currency;
    const rate = (key: string, writable = true) => {
      if (writable && data[key] !== undefined) return data[key];
      return current && !currencyChanged ? current[key] ?? undefined : undefined;
    };
    const customHours = data.custom_hours !== undefined ? normalizeCustomHours(data.custom_hours) : (existing?.custom_hours ?? null);

    const inputs: ScopingInputs = {
      data_input_type: pick('data_input_type'),
      rule_based_level: pick('rule_based_level'),
      process_stability: pick('process_stability'),
      application_stability: pick('application_stability'),
      frequency: pick('frequency'),
      volume_per_frequency: pick('volume_per_frequency'),
      aht_minutes: pick('aht_minutes'),
      current_ftes: optional('current_ftes', 1),
      error_rate_pct: optional('error_rate_pct', 5),
      peak_period: optional('peak_period', 'regular_peak'),
      process_steps_count: pick('process_steps_count'),
      decision_complexity: pick('decision_complexity'),
      applications_count: pick('applications_count'),
      uses_vdi: pick('uses_vdi'),
      requires_ocr: pick('requires_ocr'),
      structured_data_pct: pick('structured_data_pct'),
      exception_rate_pct: optional('exception_rate_pct', 3),
      currency,
      hourly_labor_cost: rate('hourly_labor_cost'),
      target_hourly_rate: rate('target_hourly_rate'),
      internal_cost_rate: rate('internal_cost_rate', actor.role === 'team_lead'),
      custom_hours: customHours ?? undefined
    };

    const details = {
      client_name: pick('client_name', 'Cliente sin nombre') as string,
      client_contact: text('client_contact') as string | null,
      client_email: text('client_email') as string | null,
      process_name: pick('process_name', 'Proceso sin nombre') as string,
      business_unit: text('business_unit') as string | null,
      process_archetype: (pick('process_archetype', 'custom') || 'custom') as string,
      applications_detail: text('applications_detail') as string | null,
      assumptions: (current ? text('assumptions') : data.assumptions || DEFAULT_ASSUMPTIONS) as string | null,
      exclusions: (current ? text('exclusions') : data.exclusions || DEFAULT_EXCLUSIONS) as string | null,
      notes: text('notes') as string | null,
      status: pick('status', 'draft') as ScopingStatus
    };

    return { details, inputs, customHours };
  }

  // Columnas editables del levantamiento: las comparten INSERT y UPDATE para que nunca se desalineen
  private buildColumns(
    { details, inputs, customHours }: ResolvedScoping,
    calc: ScopingCalculationResult
  ): Record<string, ColumnValue> {
    // Las tarifas se guardan en la moneda elegida: las explícitas del cliente o, si no hay, las de esa moneda
    const defaultRates = ScopingCalculationEngine.getDefaultRates(calc.currency);

    return {
      client_name: details.client_name,
      client_contact: details.client_contact,
      client_email: details.client_email,
      process_name: details.process_name,
      business_unit: details.business_unit,
      process_archetype: details.process_archetype,

      data_input_type: inputs.data_input_type,
      rule_based_level: inputs.rule_based_level,
      process_stability: inputs.process_stability,
      application_stability: inputs.application_stability,
      frequency: inputs.frequency,
      volume_per_frequency: inputs.volume_per_frequency,
      aht_minutes: inputs.aht_minutes,
      current_ftes: inputs.current_ftes ?? null,
      error_rate_pct: inputs.error_rate_pct ?? null,
      peak_period: inputs.peak_period ?? null,
      process_steps_count: inputs.process_steps_count,
      decision_complexity: inputs.decision_complexity,
      applications_count: inputs.applications_count,
      applications_detail: details.applications_detail,
      uses_vdi: inputs.uses_vdi ? 1 : 0,
      requires_ocr: inputs.requires_ocr ? 1 : 0,
      structured_data_pct: inputs.structured_data_pct,
      exception_rate_pct: inputs.exception_rate_pct ?? null,

      viability_status: calc.viability_status,
      viability_score: calc.viability_score,
      complexity_score: calc.complexity_score,
      difficulty_score: calc.difficulty_score,
      effort_level: calc.effort_level,
      benefit_level: calc.benefit_level,
      annual_manual_hours: calc.annual_manual_hours,
      hours_saved_annual: calc.hours_saved_annual,
      ftes_released: calc.ftes_released,
      error_reduction_pct: calc.error_reduction_pct,
      aht_reduction_pct: calc.aht_reduction_pct,

      estimated_weeks: calc.estimated_weeks,
      hours_pm: calc.hours_pm,
      hours_consultant: calc.hours_consultant,
      hours_developer: calc.hours_developer,
      hours_advisor: calc.hours_advisor,
      total_hours: calc.total_hours,

      currency: calc.currency,
      hourly_labor_cost: inputs.hourly_labor_cost ?? defaultRates.labor,
      target_hourly_rate: calc.target_hourly_rate,
      internal_cost_rate: inputs.internal_cost_rate ?? defaultRates.internal,
      project_internal_cost: calc.project_internal_cost,
      proposed_price: calc.proposed_price,
      projected_margin_pct: calc.projected_margin_pct,
      client_annual_manual_cost: calc.client_annual_manual_cost,
      client_annual_savings: calc.client_annual_savings,
      payback_months: calc.payback_months,
      roi_first_year_pct: calc.roi_first_year_pct,

      assumptions: details.assumptions,
      exclusions: details.exclusions,
      notes: details.notes,
      status: details.status,
      custom_hours_json: customHours ? JSON.stringify(customHours) : null
    };
  }
}
