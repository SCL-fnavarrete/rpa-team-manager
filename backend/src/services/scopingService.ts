import { DatabaseManager } from '../database/database';
import { 
  ScopingCalculationEngine, 
  ScopingInputs, 
  ScopingCalculationResult 
} from './scopingCalculationEngine';
import { RPA_ARCHETYPES, RPAArchetype } from '../constants/rpaArchetypes';
import { logger } from '../utils/logger';

export interface ScopingRecord extends ScopingInputs {
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

  // Campos desglosados en tiempo de ejecución
  calculation?: ScopingCalculationResult;
}

export class ScopingService {
  private db: DatabaseManager;

  constructor() {
    this.db = DatabaseManager.getInstance();
  }

  /**
   * Obtiene todos los arquetipos de procesos disponibles
   */
  public getArchetypes(): RPAArchetype[] {
    return RPA_ARCHETYPES;
  }

  /**
   * Ejecuta el cálculo en memoria (simulación / preview en vivo)
   */
  public calculateDraft(inputs: ScopingInputs): ScopingCalculationResult {
    return ScopingCalculationEngine.calculate(inputs);
  }

  /**
   * Genera el siguiente código secuencial COT-YYYY-NNN
   */
  private async generateNextCode(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `COT-${year}-`;
    const row = await this.db.get(
      `SELECT MAX(code) as max_code FROM scoping_quotations WHERE code LIKE ?`,
      [`${prefix}%`]
    ) as { max_code: string | null } | undefined;

    let nextNumber = 1;
    if (row && row.max_code) {
      const parts = row.max_code.split('-');
      if (parts.length === 3) {
        const parsed = parseInt(parts[2], 10);
        if (!isNaN(parsed)) nextNumber = parsed + 1;
      }
    }
    return `${prefix}${String(nextNumber).padStart(3, '0')}`;
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

    const rows = await this.db.query(sql, params) as any[];

    // Calcular KPIs de resumen
    const totalCount = rows.length;
    const totalQuotedHours = rows.reduce((acc: number, r: any) => acc + (r.total_hours || 0), 0);
    const totalProposedPrice = rows.reduce((acc: number, r: any) => acc + (r.proposed_price || 0), 0);
    const viableCount = rows.filter((r: any) => r.viability_status === 'viable').length;

    return {
      items: rows,
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
    const row = await this.db.get(
      `SELECT s.*, u.full_name as author_name, p.name as project_name
       FROM scoping_quotations s
       LEFT JOIN users u ON s.created_by = u.id
       LEFT JOIN projects p ON s.converted_project_id = p.id
       WHERE s.id = ?`,
      [id]
    ) as any;

    if (!row) return null;

    // Reconstruir cálculo reactivo para obtener los desgloses de roles y fases
    const inputs: ScopingInputs = {
      data_input_type: row.data_input_type,
      rule_based_level: row.rule_based_level,
      process_stability: row.process_stability,
      application_stability: row.application_stability,
      frequency: row.frequency,
      volume_per_frequency: row.volume_per_frequency,
      aht_minutes: row.aht_minutes,
      current_ftes: row.current_ftes,
      error_rate_pct: row.error_rate_pct,
      peak_period: row.peak_period,
      process_steps_count: row.process_steps_count,
      decision_complexity: row.decision_complexity,
      applications_count: row.applications_count,
      uses_vdi: Boolean(row.uses_vdi),
      requires_ocr: Boolean(row.requires_ocr),
      structured_data_pct: row.structured_data_pct,
      exception_rate_pct: row.exception_rate_pct,
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

    const calc = ScopingCalculationEngine.calculate(inputs);

    return {
      ...row,
      uses_vdi: Boolean(row.uses_vdi),
      requires_ocr: Boolean(row.requires_ocr),
      calculation: calc
    };
  }

  /**
   * Crea un nuevo levantamiento / cotización
   */
  public async create(data: any, userId?: number): Promise<ScopingRecord> {
    const code = await this.generateNextCode();
    
    // Normalizar inputs y calcular
    const inputs: ScopingInputs = {
      data_input_type: data.data_input_type || 'digital_structured',
      rule_based_level: data.rule_based_level || 'rules_mostly',
      process_stability: data.process_stability || 'no_change',
      application_stability: data.application_stability || 'no_change',
      frequency: data.frequency || 'daily',
      volume_per_frequency: Number(data.volume_per_frequency) || 100,
      aht_minutes: Number(data.aht_minutes) || 10,
      current_ftes: data.current_ftes ? Number(data.current_ftes) : 1,
      error_rate_pct: data.error_rate_pct ? Number(data.error_rate_pct) : 5,
      peak_period: data.peak_period || 'regular_peak',
      process_steps_count: data.process_steps_count || '15_25',
      decision_complexity: data.decision_complexity || 'simple_yes_no',
      applications_count: data.applications_count || '2_3_apps',
      uses_vdi: Boolean(data.uses_vdi),
      requires_ocr: Boolean(data.requires_ocr),
      structured_data_pct: data.structured_data_pct || 'gte_80',
      exception_rate_pct: data.exception_rate_pct ? Number(data.exception_rate_pct) : 3,
      currency: data.currency || 'CLP',
      hourly_labor_cost: data.hourly_labor_cost ? Number(data.hourly_labor_cost) : undefined,
      target_hourly_rate: data.target_hourly_rate ? Number(data.target_hourly_rate) : undefined,
      internal_cost_rate: data.internal_cost_rate ? Number(data.internal_cost_rate) : undefined,
      custom_hours: data.custom_hours
    };

    const calc = ScopingCalculationEngine.calculate(inputs);

    const assumptionsDefault = data.assumptions || 
      '1. El cliente proporcionará credenciales y ambientes de prueba (QA) con antelación.\n' +
      '2. Accesos a través de VPN estables y sin autenticación biométrica o token físico no automatizable.\n' +
      '3. Disponibilidad del responsable del proceso para reuniones de validación y UAT.';

    const exclusionsDefault = data.exclusions ||
      '1. Modificaciones en el código fuente de los sistemas destino o ERP del cliente.\n' +
      '2. Migraciones mayores de bases de datos o sistemas durante el periodo de construcción.';

    const insertSql = `
      INSERT INTO scoping_quotations (
        code, client_name, client_contact, client_email,
        process_name, business_unit, process_archetype, created_by,
        data_input_type, rule_based_level, process_stability, application_stability,
        frequency, volume_per_frequency, aht_minutes, current_ftes, error_rate_pct, peak_period,
        process_steps_count, decision_complexity, applications_count, applications_detail,
        uses_vdi, requires_ocr, structured_data_pct, exception_rate_pct,
        viability_status, viability_score, complexity_score, difficulty_score,
        effort_level, benefit_level, annual_manual_hours, hours_saved_annual, ftes_released,
        error_reduction_pct, aht_reduction_pct,
        estimated_weeks, hours_pm, hours_consultant, hours_developer, hours_advisor, total_hours,
        currency, hourly_labor_cost, target_hourly_rate, internal_cost_rate,
        project_internal_cost, proposed_price, projected_margin_pct,
        client_annual_manual_cost, client_annual_savings, payback_months, roi_first_year_pct,
        assumptions, exclusions, notes, status
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `;

    const params = [
      code,
      data.client_name || 'Cliente sin nombre',
      data.client_contact || null,
      data.client_email || null,
      data.process_name || 'Proceso sin nombre',
      data.business_unit || null,
      data.process_archetype || 'custom',
      userId || null,

      inputs.data_input_type,
      inputs.rule_based_level,
      inputs.process_stability,
      inputs.application_stability,
      inputs.frequency,
      inputs.volume_per_frequency,
      inputs.aht_minutes,
      inputs.current_ftes,
      inputs.error_rate_pct,
      inputs.peak_period,
      inputs.process_steps_count,
      inputs.decision_complexity,
      inputs.applications_count,
      data.applications_detail || null,
      inputs.uses_vdi ? 1 : 0,
      inputs.requires_ocr ? 1 : 0,
      inputs.structured_data_pct,
      inputs.exception_rate_pct,

      calc.viability_status,
      calc.viability_score,
      calc.complexity_score,
      calc.difficulty_score,
      calc.effort_level,
      calc.benefit_level,
      calc.annual_manual_hours,
      calc.hours_saved_annual,
      calc.ftes_released,
      calc.error_reduction_pct,
      calc.aht_reduction_pct,

      calc.estimated_weeks,
      calc.hours_pm,
      calc.hours_consultant,
      calc.hours_developer,
      calc.hours_advisor,
      calc.total_hours,

      calc.currency,
      inputs.hourly_labor_cost ?? 14000,
      calc.target_hourly_rate,
      inputs.internal_cost_rate ?? 18000,
      calc.project_internal_cost,
      calc.proposed_price,
      calc.projected_margin_pct,
      calc.client_annual_manual_cost,
      calc.client_annual_savings,
      calc.payback_months,
      calc.roi_first_year_pct,

      assumptionsDefault,
      exclusionsDefault,
      data.notes || null,
      data.status || 'draft'
    ];

    const result = await this.db.run(insertSql, params);
    const newId = result.id!;
    logger.info(`Levantamiento/Cotización creada exitosamente con ID ${newId} y código ${code}`);

    const created = await this.getById(newId);
    return created!;
  }

  /**
   * Actualiza un levantamiento existente
   */
  public async update(id: number, data: any, userId?: number): Promise<ScopingRecord> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`Levantamiento con ID ${id} no encontrado.`);
    }

    const inputs: ScopingInputs = {
      data_input_type: data.data_input_type ?? existing.data_input_type,
      rule_based_level: data.rule_based_level ?? existing.rule_based_level,
      process_stability: data.process_stability ?? existing.process_stability,
      application_stability: data.application_stability ?? existing.application_stability,
      frequency: data.frequency ?? existing.frequency,
      volume_per_frequency: data.volume_per_frequency !== undefined ? Number(data.volume_per_frequency) : existing.volume_per_frequency,
      aht_minutes: data.aht_minutes !== undefined ? Number(data.aht_minutes) : existing.aht_minutes,
      current_ftes: data.current_ftes !== undefined ? Number(data.current_ftes) : existing.current_ftes,
      error_rate_pct: data.error_rate_pct !== undefined ? Number(data.error_rate_pct) : existing.error_rate_pct,
      peak_period: data.peak_period ?? existing.peak_period,
      process_steps_count: data.process_steps_count ?? existing.process_steps_count,
      decision_complexity: data.decision_complexity ?? existing.decision_complexity,
      applications_count: data.applications_count ?? existing.applications_count,
      uses_vdi: data.uses_vdi !== undefined ? Boolean(data.uses_vdi) : existing.uses_vdi,
      requires_ocr: data.requires_ocr !== undefined ? Boolean(data.requires_ocr) : existing.requires_ocr,
      structured_data_pct: data.structured_data_pct ?? existing.structured_data_pct,
      exception_rate_pct: data.exception_rate_pct !== undefined ? Number(data.exception_rate_pct) : existing.exception_rate_pct,
      currency: data.currency ?? existing.currency,
      hourly_labor_cost: data.hourly_labor_cost !== undefined ? Number(data.hourly_labor_cost) : existing.hourly_labor_cost,
      target_hourly_rate: data.target_hourly_rate !== undefined ? Number(data.target_hourly_rate) : existing.target_hourly_rate,
      internal_cost_rate: data.internal_cost_rate !== undefined ? Number(data.internal_cost_rate) : existing.internal_cost_rate,
      custom_hours: data.custom_hours
    };

    const calc = ScopingCalculationEngine.calculate(inputs);

    const updateSql = `
      UPDATE scoping_quotations SET
        client_name = ?, client_contact = ?, client_email = ?,
        process_name = ?, business_unit = ?, process_archetype = ?,
        data_input_type = ?, rule_based_level = ?, process_stability = ?, application_stability = ?,
        frequency = ?, volume_per_frequency = ?, aht_minutes = ?, current_ftes = ?, error_rate_pct = ?, peak_period = ?,
        process_steps_count = ?, decision_complexity = ?, applications_count = ?, applications_detail = ?,
        uses_vdi = ?, requires_ocr = ?, structured_data_pct = ?, exception_rate_pct = ?,
        viability_status = ?, viability_score = ?, complexity_score = ?, difficulty_score = ?,
        effort_level = ?, benefit_level = ?, annual_manual_hours = ?, hours_saved_annual = ?, ftes_released = ?,
        error_reduction_pct = ?, aht_reduction_pct = ?,
        estimated_weeks = ?, hours_pm = ?, hours_consultant = ?, hours_developer = ?, hours_advisor = ?, total_hours = ?,
        currency = ?, hourly_labor_cost = ?, target_hourly_rate = ?, internal_cost_rate = ?,
        project_internal_cost = ?, proposed_price = ?, projected_margin_pct = ?,
        client_annual_manual_cost = ?, client_annual_savings = ?, payback_months = ?, roi_first_year_pct = ?,
        assumptions = ?, exclusions = ?, notes = ?, status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    const params = [
      data.client_name ?? existing.client_name,
      data.client_contact ?? existing.client_contact,
      data.client_email ?? existing.client_email,
      data.process_name ?? existing.process_name,
      data.business_unit ?? existing.business_unit,
      data.process_archetype ?? existing.process_archetype,

      inputs.data_input_type,
      inputs.rule_based_level,
      inputs.process_stability,
      inputs.application_stability,
      inputs.frequency,
      inputs.volume_per_frequency,
      inputs.aht_minutes,
      inputs.current_ftes,
      inputs.error_rate_pct,
      inputs.peak_period,
      inputs.process_steps_count,
      inputs.decision_complexity,
      inputs.applications_count,
      data.applications_detail ?? existing.applications_detail,
      inputs.uses_vdi ? 1 : 0,
      inputs.requires_ocr ? 1 : 0,
      inputs.structured_data_pct,
      inputs.exception_rate_pct,

      calc.viability_status,
      calc.viability_score,
      calc.complexity_score,
      calc.difficulty_score,
      calc.effort_level,
      calc.benefit_level,
      calc.annual_manual_hours,
      calc.hours_saved_annual,
      calc.ftes_released,
      calc.error_reduction_pct,
      calc.aht_reduction_pct,

      calc.estimated_weeks,
      calc.hours_pm,
      calc.hours_consultant,
      calc.hours_developer,
      calc.hours_advisor,
      calc.total_hours,

      calc.currency,
      inputs.hourly_labor_cost ?? 14000,
      calc.target_hourly_rate,
      inputs.internal_cost_rate ?? 18000,
      calc.project_internal_cost,
      calc.proposed_price,
      calc.projected_margin_pct,
      calc.client_annual_manual_cost,
      calc.client_annual_savings,
      calc.payback_months,
      calc.roi_first_year_pct,

      data.assumptions ?? existing.assumptions,
      data.exclusions ?? existing.exclusions,
      data.notes ?? existing.notes,
      data.status ?? existing.status,
      id
    ];

    await this.db.run(updateSql, params);
    logger.info(`Levantamiento ID ${id} actualizado correctamente.`);

    const updated = await this.getById(id);
    return updated!;
  }

  /**
   * Elimina un levantamiento (solo permitido en borradores o rechazados)
   */
  public async delete(id: number): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`Levantamiento con ID ${id} no encontrado.`);
    }

    if (existing.status === 'converted_to_project') {
      throw new Error('No se puede eliminar un levantamiento que ya fue convertido a proyecto.');
    }

    await this.db.run(`DELETE FROM scoping_quotations WHERE id = ?`, [id]);
    logger.info(`Levantamiento ID ${id} eliminado.`);
    return true;
  }

  /**
   * Convierte una cotización aprobada en un Proyecto formal con tareas y fases automáticas
   */
  public async convertToProject(id: number, userId: number): Promise<{ project_id: number; message: string }> {
    const scoping = await this.getById(id);
    if (!scoping) {
      throw new Error(`Levantamiento con ID ${id} no encontrado.`);
    }

    if (scoping.converted_project_id) {
      throw new Error(`Este levantamiento ya fue convertido al proyecto ID ${scoping.converted_project_id}`);
    }

    // 1. Crear el proyecto en la tabla projects
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(startDate.getDate() + (scoping.estimated_weeks * 7));

    const projectInsertSql = `
      INSERT INTO projects (
        name, description, start_date, end_date, status, budget, created_by
      ) VALUES (?, ?, ?, ?, 'active', ?, ?)
    `;

    const projectDesc = `Proyecto RPA generado a partir del levantamiento ${scoping.code}.\n` +
      `Cliente: ${scoping.client_name}\n` +
      `Proceso: ${scoping.process_name}\n` +
      `Esfuerzo estimado: ${scoping.effort_level.toUpperCase()} (${scoping.total_hours} HH en ${scoping.estimated_weeks} semanas)\n` +
      `Precio Propuesto: ${scoping.currency} ${scoping.proposed_price.toLocaleString()}`;

    const projectResult = await this.db.run(projectInsertSql, [
      `RPA - ${scoping.process_name} (${scoping.client_name})`,
      projectDesc,
      startDate.toISOString().slice(0, 10),
      endDate.toISOString().slice(0, 10),
      scoping.proposed_price,
      userId
    ]);

    const projectId = projectResult.id!;

    // 2. Crear el tablero Kanban predeterminado
    const boardResult = await this.db.run(
      `INSERT INTO task_boards (project_id, name, description, is_default)
       VALUES (?, 'Tablero Principal RPA', 'Flujo de construcción y despliegue del robot', 1)`,
      [projectId]
    );
    const boardId = boardResult.id!;

    // Columnas estándar
    const columns = [
      { name: 'Por Hacer', pos: 0, color: '#gray' },
      { name: 'En Desarrollo', pos: 1, color: '#blue' },
      { name: 'Pruebas / QA', pos: 2, color: '#orange' },
      { name: 'Aceptación UAT', pos: 3, color: '#purple' },
      { name: 'Producción / Listo', pos: 4, color: '#green', is_done: 1 }
    ];

    let firstColId = 0;
    for (const col of columns) {
      const colRes = await this.db.run(
        `INSERT INTO task_columns (board_id, name, position, color, is_done_column)
         VALUES (?, ?, ?, ?, ?)`,
        [boardId, col.name, col.pos, col.color, col.is_done ? 1 : 0]
      );
      if (col.pos === 0) firstColId = colRes.id!;
    }

    // 3. Crear las tareas basadas en las 5 fases estándar de RPA
    if (scoping.calculation && scoping.calculation.phases_breakdown) {
      for (const phase of scoping.calculation.phases_breakdown) {
        await this.db.run(
          `INSERT INTO tasks (
            board_id, column_id, title, description, priority, estimated_hours, created_by
          ) VALUES (?, ?, ?, ?, 'medium', ?, ?)`,
          [
            boardId,
            firstColId,
            `Fase ${phase.phase_number}: ${phase.name}`,
            `${phase.description} (Semana ${phase.start_week} a ${phase.end_week})`,
            phase.hours,
            userId
          ]
        );
      }
    }

    // 4. Actualizar el scoping_quotations con status y converted_project_id
    await this.db.run(
      `UPDATE scoping_quotations 
       SET status = 'converted_to_project', converted_project_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [projectId, id]
    );

    logger.info(`Cotización ${scoping.code} convertida con éxito a proyecto ID ${projectId}`);

    return {
      project_id: projectId,
      message: `Proyecto creado exitosamente con ${scoping.calculation?.phases_breakdown.length || 5} tareas y fases asignadas.`
    };
  }
}
