import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { db } from '../database/database';
import { logger } from '../utils/logger';
import { financeService } from '../services/financeService';
import { notificationService } from '../services/notificationService';
import { selectWritableColumns } from '../utils/columnWhitelist';

// Columnas que un cliente puede escribir en los PUT de esta API; el resto (id, project_id, template_id, user_id,
// resolved_by, created_by, created_at, updated_at) las fija el servidor. Nunca se interpola una clave del cuerpo en el SQL.
const PHASE_TEMPLATE_UPDATABLE_COLUMNS = [
  'name', 'description', 'phase_order', 'is_billable', 'is_mandatory', 'estimated_duration_days', 'category', 'color'
] as const;
const PROJECT_PHASE_UPDATABLE_COLUMNS = [
  'name', 'description', 'phase_order', 'status', 'planned_start_date', 'planned_end_date', 'estimated_hours', 'actual_start_date',
  'actual_end_date', 'actual_hours', 'responsibility', 'blocking_reason', 'waiting_for', 'is_billable', 'budgeted_cost', 'actual_cost',
  'client_charge', 'variance_days', 'variance_hours', 'efficiency_percentage', 'is_critical_path', 'completion_percentage'
] as const;
const PHASE_ACTIVITY_UPDATABLE_COLUMNS = [
  'activity_type', 'description', 'start_datetime', 'end_datetime', 'duration_minutes', 'calculated_hours', 'is_productive',
  'is_billable', 'is_internal', 'responsibility', 'notes', 'tags', 'has_evidence', 'evidence_description'
] as const;
const PROJECT_DELAY_UPDATABLE_COLUMNS = [
  'phase_id', 'delay_type', 'description', 'responsible_party', 'contact_person', 'delay_start_date', 'delay_end_date',
  'delay_days', 'financial_impact', 'resolution', 'has_evidence', 'evidence_notes'
] as const;

async function notifyProjectStakeholders(projectId: number, eventKey: 'project_delay_created' | 'scope_change_pending_approval', title: string, message: string, link: string, senderId?: number): Promise<void> {
  const recipients = await db.query(`
    SELECT id AS user_id FROM users WHERE role = 'team_lead' AND is_active = 1
    UNION SELECT pm_user_id AS user_id FROM projects WHERE id = ? AND pm_user_id IS NOT NULL
    UNION SELECT created_by AS user_id FROM projects WHERE id = ? AND created_by IS NOT NULL
    UNION SELECT user_id FROM project_assignments WHERE project_id = ? AND is_active = 1
  `, [projectId, projectId, projectId]);
  for (const recipient of recipients) await notificationService.notify({
    userId: recipient.user_id, eventKey, title, message, type: eventKey === 'project_delay_created' ? 'warning' : 'info',
    entityType: 'project', entityId: projectId, senderId, link, dedupe: true
  });
}

// ========================================
// PHASE TEMPLATES
// ========================================

export const getPhaseTemplates = async (req: Request, res: Response) => {
  try {
    const templates = await db.query(`
      SELECT * FROM project_phase_templates
      ORDER BY phase_order ASC
    `);

    return res.json(templates);
  } catch (error: any) {
    logger.error('Error getting phase templates:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const getPhaseTemplate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const template = await db.get(`
      SELECT * FROM project_phase_templates WHERE id = ?
    `, [id]);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    return res.json(template);
  } catch (error: any) {
    logger.error('Error getting phase template:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const createPhaseTemplate = async (req: Request, res: Response) => {
  try {
    const { name, description, phase_order, is_billable, is_mandatory, estimated_duration_days, category, color } = req.body;

    const result = await db.run(`
      INSERT INTO project_phase_templates
      (name, description, phase_order, is_billable, is_mandatory, estimated_duration_days, category, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [name, description, phase_order, is_billable ? 1 : 0, is_mandatory ? 1 : 0, estimated_duration_days, category, color]);

    const template = await db.get('SELECT * FROM project_phase_templates WHERE id = ?', [result.id]);
    return res.status(201).json(template);
  } catch (error: any) {
    logger.error('Error creating phase template:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const updatePhaseTemplate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const selection = selectWritableColumns(req.body, PHASE_TEMPLATE_UPDATABLE_COLUMNS);
    if ('error' in selection) return res.status(400).json({ error: selection.error });
    if (!selection.columns.length) return res.status(400).json({ error: 'No hay campos para actualizar' });

    await db.run(`
      UPDATE project_phase_templates
      SET ${selection.columns.map(column => `${column} = ?`).join(', ')}
      WHERE id = ?
    `, [...selection.values, id]);

    const template = await db.get('SELECT * FROM project_phase_templates WHERE id = ?', [id]);
    return res.json(template);
  } catch (error: any) {
    logger.error('Error updating phase template:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const deletePhaseTemplate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await db.run('DELETE FROM project_phase_templates WHERE id = ?', [id]);
    return res.json({ message: 'Template deleted successfully' });
  } catch (error: any) {
    logger.error('Error deleting phase template:', error);
    return res.status(500).json({ error: error.message });
  }
};

// ========================================
// PROJECT PHASES
// ========================================

export const getProjectPhases = async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    const phases = await db.query(`
      SELECT
        pp.*,
        ppt.category,
        ppt.color
      FROM project_phases pp
      JOIN project_phase_templates ppt ON pp.template_id = ppt.id
      WHERE pp.project_id = ?
      ORDER BY pp.phase_order ASC
    `, [projectId]);

    // Get activities for each phase
    for (const phase of phases) {
      const activities = await db.query(`
        SELECT
          pa.*,
          u.full_name as user_full_name
        FROM phase_activities pa
        JOIN users u ON pa.user_id = u.id
        WHERE pa.phase_id = ?
        ORDER BY pa.created_at DESC
      `, [phase.id]);

      phase.activities = activities;
    }

    return res.json(phases);
  } catch (error: any) {
    logger.error('Error getting project phases:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const createProjectPhase = async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const {
      template_id, name, description, phase_order, planned_start_date, planned_end_date,
      estimated_hours, responsibility, is_billable, budgeted_cost
    } = req.body;

    const result = await db.run(`
      INSERT INTO project_phases
      (project_id, template_id, name, description, phase_order, planned_start_date, planned_end_date,
       estimated_hours, responsibility, is_billable, budgeted_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, template_id, name, description, phase_order, planned_start_date, planned_end_date,
      estimated_hours, responsibility, is_billable ? 1 : 0, budgeted_cost
    ]);

    const phase = await db.get(`
      SELECT pp.*, ppt.category, ppt.color
      FROM project_phases pp
      JOIN project_phase_templates ppt ON pp.template_id = ppt.id
      WHERE pp.id = ?
    `, [result.id]);

    return res.status(201).json(phase);
  } catch (error: any) {
    logger.error('Error creating project phase:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const initializeProjectPhases = async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { template_ids } = req.body;

    // Get templates (all or specific ones)
    let templates;
    if (template_ids && template_ids.length > 0) {
      const placeholders = template_ids.map(() => '?').join(',');
      templates = await db.query(`
        SELECT * FROM project_phase_templates
        WHERE id IN (${placeholders})
        ORDER BY phase_order ASC
      `, template_ids);
    } else {
      templates = await db.query(`
        SELECT * FROM project_phase_templates
        WHERE is_mandatory = 1
        ORDER BY phase_order ASC
      `);
    }

    // Create phases from templates
    const createdPhases = [];
    for (const template of templates) {
      const result = await db.run(`
        INSERT INTO project_phases
        (project_id, template_id, name, description, phase_order, estimated_hours,
         is_billable, responsibility)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        projectId,
        template.id,
        template.name,
        template.description,
        template.phase_order,
        template.estimated_duration_days ? template.estimated_duration_days * 8 : 0, // Convert days to hours (8h/day)
        template.is_billable,
        'internal'
      ]);

      const phase = await db.get(`
        SELECT pp.*, ppt.category, ppt.color
        FROM project_phases pp
        JOIN project_phase_templates ppt ON pp.template_id = ppt.id
        WHERE pp.id = ?
      `, [result.id]);

      createdPhases.push(phase);
    }

    return res.status(201).json(createdPhases);
  } catch (error: any) {
    logger.error('Error initializing project phases:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const updateProjectPhase = async (req: Request, res: Response) => {
  try {
    const { phaseId } = req.params;

    // Los nombres de columna salen siempre de la lista blanca, nunca de las claves que envía el cliente
    const selection = selectWritableColumns(req.body, PROJECT_PHASE_UPDATABLE_COLUMNS);
    if ('error' in selection) return res.status(400).json({ error: selection.error });
    if (!selection.columns.length) return res.status(400).json({ error: 'No hay campos para actualizar' });

    await db.run(`
      UPDATE project_phases
      SET ${selection.columns.map(column => `${column} = ?`).join(', ')}
      WHERE id = ?
    `, [...selection.values, phaseId]);

    const phase = await db.get(`
      SELECT pp.*, ppt.category, ppt.color
      FROM project_phases pp
      JOIN project_phase_templates ppt ON pp.template_id = ppt.id
      WHERE pp.id = ?
    `, [phaseId]);

    return res.json(phase);
  } catch (error: any) {
    logger.error('Error updating project phase:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const deleteProjectPhase = async (req: Request, res: Response) => {
  try {
    const { phaseId } = req.params;

    await db.run('DELETE FROM project_phases WHERE id = ?', [phaseId]);
    return res.json({ message: 'Phase deleted successfully' });
  } catch (error: any) {
    logger.error('Error deleting project phase:', error);
    return res.status(500).json({ error: error.message });
  }
};

// ========================================
// PHASE ACTIVITIES
// ========================================

export const getPhaseActivities = async (req: Request, res: Response) => {
  try {
    const { phaseId } = req.params;

    const activities = await db.query(`
      SELECT
        pa.*,
        u.full_name as user_full_name
      FROM phase_activities pa
      JOIN users u ON pa.user_id = u.id
      WHERE pa.phase_id = ?
      ORDER BY pa.created_at DESC
    `, [phaseId]);

    return res.json(activities);
  } catch (error: any) {
    logger.error('Error getting phase activities:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const createPhaseActivity = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { phaseId } = req.params;
    const {
      activity_type, description, start_datetime, end_datetime, duration_minutes,
      is_productive, is_billable, is_internal, responsibility, notes, tags,
      has_evidence, evidence_description
    } = req.body;

    // The phase and authenticated session are the source of truth for these
    // required foreign keys; the activity form does not submit either value.
    const phase = await db.get(
      'SELECT project_id FROM project_phases WHERE id = ?',
      [phaseId]
    );
    if (!phase) {
      return res.status(404).json({ error: 'Project phase not found' });
    }
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const result = await db.run(`
      INSERT INTO phase_activities
      (phase_id, project_id, activity_type, description, start_datetime, end_datetime,
       duration_minutes, user_id, is_productive, is_billable, is_internal, responsibility,
       notes, tags, has_evidence, evidence_description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      phaseId, phase.project_id, activity_type, description, start_datetime, end_datetime,
      duration_minutes, req.user.id, is_productive ? 1 : 0, is_billable ? 1 : 0,
      is_internal ? 1 : 0, responsibility, notes, tags, has_evidence ? 1 : 0,
      evidence_description
    ]);

    const activity = await db.get(`
      SELECT pa.*, u.full_name as user_full_name
      FROM phase_activities pa
      JOIN users u ON pa.user_id = u.id
      WHERE pa.id = ?
    `, [result.id]);

    return res.status(201).json(activity);
  } catch (error: any) {
    logger.error('Error creating phase activity:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const updatePhaseActivity = async (req: Request, res: Response) => {
  try {
    const { activityId } = req.params;

    const selection = selectWritableColumns(req.body, PHASE_ACTIVITY_UPDATABLE_COLUMNS);
    if ('error' in selection) return res.status(400).json({ error: selection.error });
    if (!selection.columns.length) return res.status(400).json({ error: 'No hay campos para actualizar' });

    await db.run(`
      UPDATE phase_activities
      SET ${selection.columns.map(column => `${column} = ?`).join(', ')}
      WHERE id = ?
    `, [...selection.values, activityId]);

    const activity = await db.get(`
      SELECT pa.*, u.full_name as user_full_name
      FROM phase_activities pa
      JOIN users u ON pa.user_id = u.id
      WHERE pa.id = ?
    `, [activityId]);

    return res.json(activity);
  } catch (error: any) {
    logger.error('Error updating phase activity:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const deletePhaseActivity = async (req: Request, res: Response) => {
  try {
    const { activityId } = req.params;

    await db.run('DELETE FROM phase_activities WHERE id = ?', [activityId]);
    return res.json({ message: 'Activity deleted successfully' });
  } catch (error: any) {
    logger.error('Error deleting phase activity:', error);
    return res.status(500).json({ error: error.message });
  }
};

// ========================================
// PROJECT DELAYS
// ========================================

export const getProjectDelays = async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    const delays = await db.query(`
      SELECT
        pd.*,
        pp.name as phase_name,
        u1.full_name as created_by_name,
        u2.full_name as resolved_by_name
      FROM project_delays pd
      LEFT JOIN project_phases pp ON pd.phase_id = pp.id
      JOIN users u1 ON pd.created_by = u1.id
      LEFT JOIN users u2 ON pd.resolved_by = u2.id
      WHERE pd.project_id = ?
      ORDER BY pd.delay_start_date DESC
    `, [projectId]);

    return res.json(delays);
  } catch (error: any) {
    logger.error('Error getting project delays:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const createProjectDelay = async (req: Request, res: Response) => {
  try {
    const {
      project_id, phase_id, delay_type, description, responsible_party, contact_person,
      delay_start_date, delay_end_date, financial_impact, has_evidence, evidence_notes
    } = req.body;

    const userId = (req as any).user?.id;

    const result = await db.run(`
      INSERT INTO project_delays
      (project_id, phase_id, delay_type, description, responsible_party, contact_person,
       delay_start_date, delay_end_date, financial_impact, has_evidence, evidence_notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      project_id, phase_id, delay_type, description, responsible_party, contact_person,
      delay_start_date, delay_end_date, financial_impact, has_evidence ? 1 : 0,
      evidence_notes, userId
    ]);

    const delay = await db.get(`
      SELECT
        pd.*,
        pp.name as phase_name,
        u.full_name as created_by_name
      FROM project_delays pd
      LEFT JOIN project_phases pp ON pd.phase_id = pp.id
      JOIN users u ON pd.created_by = u.id
      WHERE pd.id = ?
    `, [result.id]);

    const responsibility = responsible_party === 'client' ? 'atribuida al cliente' : responsible_party === 'internal' ? 'atribuida al equipo' : 'registrada';
    await notifyProjectStakeholders(project_id, 'project_delay_created', 'Nuevo desvío de proyecto', `Demora ${responsibility}: ${description}`, `/projects/${project_id}?tab=lifecycle`, userId);

    return res.status(201).json(delay);
  } catch (error: any) {
    logger.error('Error creating project delay:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const updateProjectDelay = async (req: Request, res: Response) => {
  try {
    const { delayId } = req.params;

    const selection = selectWritableColumns(req.body, PROJECT_DELAY_UPDATABLE_COLUMNS);
    if ('error' in selection) return res.status(400).json({ error: selection.error });
    if (!selection.columns.length) return res.status(400).json({ error: 'No hay campos para actualizar' });

    await db.run(`
      UPDATE project_delays
      SET ${selection.columns.map(column => `${column} = ?`).join(', ')}
      WHERE id = ?
    `, [...selection.values, delayId]);

    const delay = await db.get(`
      SELECT
        pd.*,
        pp.name as phase_name,
        u1.full_name as created_by_name,
        u2.full_name as resolved_by_name
      FROM project_delays pd
      LEFT JOIN project_phases pp ON pd.phase_id = pp.id
      JOIN users u1 ON pd.created_by = u1.id
      LEFT JOIN users u2 ON pd.resolved_by = u2.id
      WHERE pd.id = ?
    `, [delayId]);

    return res.json(delay);
  } catch (error: any) {
    logger.error('Error updating project delay:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const deleteProjectDelay = async (req: Request, res: Response) => {
  try {
    const { delayId } = req.params;

    await db.run('DELETE FROM project_delays WHERE id = ?', [delayId]);
    return res.json({ message: 'Delay deleted successfully' });
  } catch (error: any) {
    logger.error('Error deleting project delay:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const resolveProjectDelay = async (req: Request, res: Response) => {
  try {
    const { delayId } = req.params;
    const { resolution, delay_end_date } = req.body;
    const userId = (req as any).user?.id;

    await db.run(`
      UPDATE project_delays
      SET resolution = ?, delay_end_date = ?, resolved_by = ?
      WHERE id = ?
    `, [resolution, delay_end_date, userId, delayId]);

    const delay = await db.get(`
      SELECT
        pd.*,
        pp.name as phase_name,
        u1.full_name as created_by_name,
        u2.full_name as resolved_by_name
      FROM project_delays pd
      LEFT JOIN project_phases pp ON pd.phase_id = pp.id
      JOIN users u1 ON pd.created_by = u1.id
      LEFT JOIN users u2 ON pd.resolved_by = u2.id
      WHERE pd.id = ?
    `, [delayId]);

    return res.json(delay);
  } catch (error: any) {
    logger.error('Error resolving project delay:', error);
    return res.status(500).json({ error: error.message });
  }
};

// ========================================
// SCOPE CHANGES
// ========================================

export const getProjectScopeChanges = async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    const changes = await db.query(`
      SELECT
        psc.*,
        pp.name as phase_name,
        u1.full_name as created_by_name,
        u2.full_name as approved_by_name
      FROM project_scope_changes psc
      LEFT JOIN project_phases pp ON psc.phase_id = pp.id
      JOIN users u1 ON psc.created_by = u1.id
      LEFT JOIN users u2 ON psc.approved_by = u2.id
      WHERE psc.project_id = ?
      ORDER BY psc.created_at DESC
    `, [projectId]);

    return res.json(changes);
  } catch (error: any) {
    logger.error('Error getting scope changes:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const createScopeChange = async (req: Request, res: Response) => {
  try {
    const {
      project_id, phase_id, change_type, description, reason, requested_by,
      hours_impact, cost_impact, timeline_impact_days, requires_re_quote, new_quote_amount
    } = req.body;

    const userId = (req as any).user?.id;

    const result = await db.run(`
      INSERT INTO project_scope_changes
      (project_id, phase_id, change_type, description, reason, requested_by,
       hours_impact, cost_impact, timeline_impact_days, requires_re_quote,
       new_quote_amount, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      project_id, phase_id, change_type, description, reason, requested_by,
      hours_impact, cost_impact, timeline_impact_days, requires_re_quote ? 1 : 0,
      new_quote_amount, userId
    ]);

    const change = await db.get(`
      SELECT
        psc.*,
        pp.name as phase_name,
        u.full_name as created_by_name
      FROM project_scope_changes psc
      LEFT JOIN project_phases pp ON psc.phase_id = pp.id
      JOIN users u ON psc.created_by = u.id
      WHERE psc.id = ?
    `, [result.id]);

    if (requires_re_quote) await notifyProjectStakeholders(project_id, 'scope_change_pending_approval', 'Cambio de alcance requiere nueva cotización', description, `/projects/${project_id}?tab=lifecycle`, userId);

    return res.status(201).json(change);
  } catch (error: any) {
    logger.error('Error creating scope change:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const updateScopeChange = async (req: Request, res: Response) => {
  try {
    const { changeId } = req.params;
    const updates = req.body;
    const allowedFields = ['phase_id', 'change_type', 'description', 'reason', 'requested_by', 'hours_impact', 'cost_impact', 'timeline_impact_days', 'requires_re_quote', 'new_quote_amount'];
    const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
    if (!fields.length) return res.status(400).json({ error: 'No hay campos válidos para actualizar' });
    const setClauses = fields.map(key => `${key} = ?`).join(', ');
    const values = fields.map(key => updates[key]);

    await db.run(`
      UPDATE project_scope_changes
      SET ${setClauses}
      WHERE id = ?
    `, [...values, changeId]);

    const change = await db.get(`
      SELECT
        psc.*,
        pp.name as phase_name,
        u1.full_name as created_by_name,
        u2.full_name as approved_by_name
      FROM project_scope_changes psc
      LEFT JOIN project_phases pp ON psc.phase_id = pp.id
      JOIN users u1 ON psc.created_by = u1.id
      LEFT JOIN users u2 ON psc.approved_by = u2.id
      WHERE psc.id = ?
    `, [changeId]);

    return res.json(change);
  } catch (error: any) {
    logger.error('Error updating scope change:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const deleteScopeChange = async (req: Request, res: Response) => {
  try {
    const { changeId } = req.params;

    await db.run('DELETE FROM project_scope_changes WHERE id = ?', [changeId]);
    return res.json({ message: 'Scope change deleted successfully' });
  } catch (error: any) {
    logger.error('Error deleting scope change:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const approveScopeChange = async (req: Request, res: Response) => {
  try {
    const { changeId } = req.params;
    const userId = (req as any).user?.id;

    const pendingChange = await db.get('SELECT requires_re_quote, quote_approved FROM project_scope_changes WHERE id = ?', [changeId]);
    if (!pendingChange) return res.status(404).json({ error: 'Scope change not found' });
    if (pendingChange.requires_re_quote && !pendingChange.quote_approved) {
      return res.status(409).json({ error: 'Aprueba una nueva versión de cotización para este cambio antes de autorizar su ejecución' });
    }

    await db.run(`
      UPDATE project_scope_changes
      SET status = 'approved', approved_by = ?, approval_date = DATE('now')
      WHERE id = ?
    `, [userId, changeId]);

    const change = await db.get(`
      SELECT
        psc.*,
        pp.name as phase_name,
        u1.full_name as created_by_name,
        u2.full_name as approved_by_name
      FROM project_scope_changes psc
      LEFT JOIN project_phases pp ON psc.phase_id = pp.id
      JOIN users u1 ON psc.created_by = u1.id
      LEFT JOIN users u2 ON psc.approved_by = u2.id
      WHERE psc.id = ?
    `, [changeId]);

    return res.json(change);
  } catch (error: any) {
    logger.error('Error approving scope change:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const rejectScopeChange = async (req: Request, res: Response) => {
  try {
    const { changeId } = req.params;
    const { reason } = req.body;
    const userId = (req as any).user?.id;

    await db.run(`
      UPDATE project_scope_changes
      SET status = 'rejected', approved_by = ?, approval_date = DATE('now'), reason = ?
      WHERE id = ?
    `, [userId, reason, changeId]);

    const change = await db.get(`
      SELECT
        psc.*,
        pp.name as phase_name,
        u1.full_name as created_by_name,
        u2.full_name as approved_by_name
      FROM project_scope_changes psc
      LEFT JOIN project_phases pp ON psc.phase_id = pp.id
      JOIN users u1 ON psc.created_by = u1.id
      LEFT JOIN users u2 ON psc.approved_by = u2.id
      WHERE psc.id = ?
    `, [changeId]);

    return res.json(change);
  } catch (error: any) {
    logger.error('Error rejecting scope change:', error);
    return res.status(500).json({ error: error.message });
  }
};

// ========================================
// ANALYTICS & REPORTING
// ========================================

export const getProjectROIAnalysis = async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    // Get all phases with their hours
    const phases = await db.query(`
      SELECT
        pp.*,
        ppt.category,
        ppt.is_billable as template_is_billable
      FROM project_phases pp
      JOIN project_phase_templates ppt ON pp.template_id = ppt.id
      WHERE pp.project_id = ?
    `, [projectId]);

    // Get project financials
    const financials = await db.get(`
      SELECT * FROM project_financials WHERE project_id = ?
    `, [projectId]);

    const salePrice = financials?.sale_price || 0;

    // Costo por hora combinado real del equipo asignado (financeService), no un valor fijo
    const { hourlyCostCLP: avgHourlyRate } = await financeService.getBlendedHourlyCostCLP(parseInt(projectId));

    const breakdown = phases.map(phase => ({
      phase_name: phase.name,
      actual_hours: phase.actual_hours,
      cost: phase.actual_hours * avgHourlyRate,
      is_billable: phase.is_billable === 1,
      category: phase.category
    }));

    const totalHours = breakdown.reduce((sum, p) => sum + p.actual_hours, 0);
    const billableHours = breakdown.filter(p => p.is_billable).reduce((sum, p) => sum + p.actual_hours, 0);
    const nonBillableHours = totalHours - billableHours;

    const totalCost = breakdown.reduce((sum, p) => sum + p.cost, 0);
    const billableCost = breakdown.filter(p => p.is_billable).reduce((sum, p) => sum + p.cost, 0);

    const apparentROI = billableCost > 0 ? ((salePrice - billableCost) / billableCost * 100) : 0;
    const realROI = totalCost > 0 ? ((salePrice - totalCost) / totalCost * 100) : 0;

    return res.json({
      apparent_roi: apparentROI.toFixed(1),
      real_roi: realROI.toFixed(1),
      total_hours_real: totalHours,
      billable_hours: billableHours,
      non_billable_hours: nonBillableHours,
      non_billable_percentage: totalHours > 0 ? ((nonBillableHours / totalHours) * 100).toFixed(0) : 0,
      breakdown
    });
  } catch (error: any) {
    logger.error('Error getting ROI analysis:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const getProjectLifecycleMetrics = async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    const phases = await db.query(`
      SELECT pp.*, ppt.category
      FROM project_phases pp
      JOIN project_phase_templates ppt ON pp.template_id = ppt.id
      WHERE pp.project_id = ?
    `, [projectId]);

    const totalPlannedHours = phases.reduce((sum, p) => sum + (p.estimated_hours || 0), 0);
    const totalActualHours = phases.reduce((sum, p) => sum + (p.actual_hours || 0), 0);
    const billableHours = phases.filter(p => p.is_billable).reduce((sum, p) => sum + (p.actual_hours || 0), 0);
    const nonBillableHours = totalActualHours - billableHours;

    // Get client waiting days
    const delays = await db.query(`
      SELECT * FROM project_delays
      WHERE project_id = ? AND responsible_party = 'client'
    `, [projectId]);

    const clientWaitingDays = delays.reduce((sum, d) => sum + (d.delay_days || 0), 0);
    const totalVarianceDays = phases.reduce((sum, p) => sum + (p.variance_days || 0), 0);

    const efficiency = totalPlannedHours > 0 ? (totalPlannedHours / totalActualHours * 100) : 100;

    return res.json({
      totalPlannedHours,
      totalActualHours,
      billableHours,
      nonBillableHours,
      clientWaitingDays,
      totalVarianceDays,
      efficiency: efficiency.toFixed(1)
    });
  } catch (error: any) {
    logger.error('Error getting lifecycle metrics:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const getProjectLifecycleSummary = async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    // Get all data in parallel
    const [phases, delays, scopeChanges] = await Promise.all([
      db.query(`
        SELECT pp.*, ppt.category, ppt.color
        FROM project_phases pp
        JOIN project_phase_templates ppt ON pp.template_id = ppt.id
        WHERE pp.project_id = ?
        ORDER BY pp.phase_order ASC
      `, [projectId]),

      db.query(`
        SELECT pd.*, pp.name as phase_name
        FROM project_delays pd
        LEFT JOIN project_phases pp ON pd.phase_id = pp.id
        WHERE pd.project_id = ?
        ORDER BY pd.delay_start_date DESC
      `, [projectId]),

      db.query(`
        SELECT psc.*, pp.name as phase_name
        FROM project_scope_changes psc
        LEFT JOIN project_phases pp ON psc.phase_id = pp.id
        WHERE psc.project_id = ?
        ORDER BY psc.created_at DESC
      `, [projectId])
    ]);

    return res.json({
      phases,
      delays,
      scope_changes: scopeChanges,
      summary: {
        total_phases: phases.length,
        completed_phases: phases.filter(p => p.status === 'completed').length,
        blocked_phases: phases.filter(p => p.status === 'blocked').length,
        total_delays: delays.length,
        active_delays: delays.filter(d => !d.delay_end_date).length,
        scope_changes: scopeChanges.length,
        pending_approvals: scopeChanges.filter(sc => sc.status === 'pending').length
      }
    });
  } catch (error: any) {
    logger.error('Error getting lifecycle summary:', error);
    return res.status(500).json({ error: error.message });
  }
};
