import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { db } from '../database/database';
import { notificationService } from '../services/notificationService';
import { financeService, Currency } from '../services/financeService';
import { activityLogService } from '../services/activityLogService';
import { closureReportService } from '../services/closureReportService';
import { generateClosureReport } from '../services/pdfService';
import { logger } from '../utils/logger';

const canManage = (role?: string) => role === 'team_lead' || role === 'rpa_operations';
const canSeeFinancials = (role?: string) => role === 'team_lead';
const canSeeCommercialQuotes = (role?: string) => role === 'team_lead' || role === 'rpa_operations';

export class CommercialController {
  private async projectExists(projectId: number): Promise<boolean> {
    return Boolean(await db.get('SELECT id FROM projects WHERE id = ?', [projectId]));
  }

  private async checkProjectAccess(req: AuthenticatedRequest, projectId: number): Promise<'missing' | 'denied' | 'allowed'> {
    const project = await db.get('SELECT id, assigned_to, created_by FROM projects WHERE id = ?', [projectId]);
    if (!project) return 'missing';
    if (req.user?.role !== 'rpa_developer') return 'allowed';
    if (project.assigned_to === req.user.id || project.created_by === req.user.id) return 'allowed';
    const assignment = await db.get('SELECT id FROM project_assignments WHERE project_id = ? AND user_id = ? AND is_active = 1', [projectId, req.user.id]);
    return assignment ? 'allowed' : 'denied';
  }

  private respondAccess(res: Response, access: 'missing' | 'denied' | 'allowed'): boolean {
    if (access === 'missing') { res.status(404).json({ error: 'Proyecto no encontrado' }); return false; }
    if (access === 'denied') { res.status(403).json({ error: 'No tienes acceso a este proyecto' }); return false; }
    return true;
  }

  getMeetings = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const projectId = Number(req.params.projectId);
    if (!this.respondAccess(res, await this.checkProjectAccess(req, projectId))) return;
    const rows = await db.query(`SELECT m.*, u.full_name AS created_by_name FROM project_meetings m LEFT JOIN users u ON u.id = m.created_by WHERE m.project_id = ? ORDER BY m.meeting_date, m.id`, [projectId]);
    res.json({ data: rows, meeting_count: rows.length, needs_pdd_or_proposal: !rows.some((row: any) => row.has_pdd || row.has_technical_commercial_proposal) });
  };

  createMeeting = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!canManage(req.user?.role)) { res.status(403).json({ error: 'No tienes permiso para registrar reuniones' }); return; }
    const projectId = Number(req.params.projectId);
    const { meeting_date, summary, escalation_reason, next_commitment, has_pdd = false, has_technical_commercial_proposal = false, evidence_file_id, evidence_reference } = req.body;
    if (!summary?.trim() || !meeting_date) { res.status(400).json({ error: 'La fecha y el resumen de la reunión son obligatorios' }); return; }
    if ((has_pdd || has_technical_commercial_proposal) && !evidence_file_id && !String(evidence_reference ?? '').trim()) { res.status(400).json({ error: 'Indica la referencia o archivo del PDD o de la propuesta obtenida' }); return; }
    if (!await this.projectExists(projectId)) { res.status(404).json({ error: 'Proyecto no encontrado' }); return; }
    const currentProject = await db.get('SELECT commercial_stage FROM projects WHERE id = ?', [projectId]);
    if (currentProject?.commercial_stage !== 'quoting') { res.status(409).json({ error: 'Solo se registran reuniones durante la etapa de cotización' }); return; }
    const previousMeetings = await db.get('SELECT COUNT(*) AS count FROM project_meetings WHERE project_id = ?', [projectId]);
    const existingArtifact = await db.get(`SELECT id FROM project_commercial_documents WHERE project_id = ? AND document_type IN ('pdd', 'technical_commercial_proposal') LIMIT 1`, [projectId]);
    if (!existingArtifact && !has_pdd && !has_technical_commercial_proposal && Number(previousMeetings?.count ?? 0) + 1 >= 2 && (!String(escalation_reason ?? '').trim() || !String(next_commitment ?? '').trim())) {
      res.status(400).json({ error: 'Desde la segunda reunión registra el motivo de seguimiento y el próximo compromiso' }); return;
    }
    const result = await db.run(`INSERT INTO project_meetings (project_id, meeting_date, summary, escalation_reason, next_commitment, has_pdd, has_technical_commercial_proposal, evidence_reference, evidence_file_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [projectId, meeting_date, summary.trim(), escalation_reason ?? null, next_commitment ?? null, has_pdd ? 1 : 0, has_technical_commercial_proposal ? 1 : 0, evidence_reference ?? null, evidence_file_id ?? null, req.user?.id ?? null]);
    if (has_pdd || has_technical_commercial_proposal) {
      const documentType = has_pdd ? 'pdd' : 'technical_commercial_proposal';
      await db.run(`INSERT INTO project_commercial_documents (project_id, document_type, reference_number, file_id, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)`, [projectId, documentType, evidence_reference ?? null, evidence_file_id ?? null, `Entregable registrado en reunión ${meeting_date}`, req.user?.id ?? null]);
    }
    const countRow = await db.get('SELECT COUNT(*) AS count FROM project_meetings WHERE project_id = ?', [projectId]);
    const hasArtifact = Boolean(await db.get(`SELECT id FROM project_commercial_documents WHERE project_id = ? AND document_type IN ('pdd', 'technical_commercial_proposal') LIMIT 1`, [projectId]));
    const meetingCount = Number(countRow?.count ?? 0);
    if (currentProject?.commercial_stage === 'quoting' && !hasArtifact && (meetingCount === 2 || meetingCount === 3)) {
      const recipients = await db.query(`SELECT DISTINCT user_id AS id FROM project_assignments WHERE project_id = ? AND is_active = 1 UNION SELECT pm_user_id AS id FROM projects WHERE id = ? AND pm_user_id IS NOT NULL UNION SELECT created_by AS id FROM projects WHERE id = ? AND created_by IS NOT NULL`, [projectId, projectId, projectId]);
      const project = await db.get('SELECT name FROM projects WHERE id = ?', [projectId]);
      for (const recipient of recipients) {
        await notificationService.notify({ userId: recipient.id, eventKey: meetingCount >= 3 ? 'commercial_meeting_escalation' : 'commercial_meeting_followup', title: meetingCount >= 3 ? 'Escalación: falta PDD o propuesta' : 'Registrar PDD o propuesta técnico comercial', message: `Reunión ${meetingCount} de ${project?.name}. ${escalation_reason || 'Sin causa registrada.'} Próximo compromiso: ${next_commitment || 'pendiente'}.`, type: meetingCount >= 3 ? 'error' : 'warning', entityType: 'project', entityId: projectId, link: `/projects/${projectId}?tab=commercial`, dedupe: true });
      }
    }
    res.status(201).json({ data: await db.get('SELECT * FROM project_meetings WHERE id = ?', [result.id]), meeting_count: meetingCount, escalation: !hasArtifact && meetingCount >= 3 });
  };

  getQuotes = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const projectId = Number(req.params.projectId);
    if (!this.respondAccess(res, await this.checkProjectAccess(req, projectId))) return;
    const rows = await db.query(`SELECT q.*, internal_approval.full_name AS internal_approver_name,
      project.client_approved_at, client_approval.reference_number AS client_approval_reference,
      client_approval.created_at AS client_approval_recorded_at
      FROM project_quotes q JOIN projects project ON project.id = q.project_id
      LEFT JOIN users internal_approval ON internal_approval.id = q.approved_by
      LEFT JOIN project_commercial_documents client_approval ON client_approval.project_id = q.project_id AND client_approval.document_type = 'client_approval'
      WHERE q.project_id = ? ORDER BY q.version DESC`, [projectId]);
    const data = rows.map((row: any) => {
      const safe = { ...row };
      if (!canSeeCommercialQuotes(req.user?.role)) {
        delete safe.amount;
        delete safe.hourly_rate;
      }
      if (!canSeeFinancials(req.user?.role)) {
        delete safe.estimated_cost;
        delete safe.margin_percent;
      }
      return safe;
    });
    res.json({ data });
  };

  createQuote = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!canManage(req.user?.role)) { res.status(403).json({ error: 'No tienes permiso para crear cotizaciones' }); return; }
    const projectId = Number(req.params.projectId);
    const { pricing_model = 'fixed', amount, currency = 'CLP', hours, hourly_rate, estimated_cost, file_id, notes, scope_change_id } = req.body;
    if (!Number.isFinite(Number(amount)) || Number(amount) < 0) { res.status(400).json({ error: 'El monto de la cotización debe ser válido' }); return; }
    if (!['CLP', 'UF', 'USD'].includes(currency)) { res.status(400).json({ error: 'Moneda no válida' }); return; }
    const project = await db.get('SELECT commercial_stage FROM projects WHERE id = ?', [projectId]);
    if (!project) { res.status(404).json({ error: 'Proyecto no encontrado' }); return; }
    if (project.commercial_stage === 'lost') { res.status(409).json({ error: 'No se puede cotizar un proyecto perdido' }); return; }
    const next = await db.get('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM project_quotes WHERE project_id = ?', [projectId]);
    const amountNumber = Number(amount);
    const costNumber = Number(estimated_cost || 0);
    const margin = amountNumber > 0 && estimated_cost !== undefined && estimated_cost !== null
      ? ((amountNumber - costNumber) / amountNumber) * 100 : null;
    if (scope_change_id) {
      const scopeChange = await db.get('SELECT id, project_id, requires_re_quote FROM project_scope_changes WHERE id = ?', [scope_change_id]);
      if (!scopeChange || scopeChange.project_id !== projectId || !scopeChange.requires_re_quote) { res.status(400).json({ error: 'El cambio de alcance seleccionado no requiere una nueva cotización para este proyecto' }); return; }
    }
    const quoteFile = file_id ? null : await db.get(`SELECT file_id FROM file_associations WHERE entity_type = 'project' AND entity_id = ? AND association_type = ? ORDER BY created_at DESC LIMIT 1`, [projectId, `quote_v${next.version}`]);
    const result = await db.run(`INSERT INTO project_quotes (project_id, version, pricing_model, amount, currency, hours, hourly_rate, estimated_cost, margin_percent, scope_change_id, file_id, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [projectId, next.version, pricing_model, amountNumber, currency, hours ?? null, hourly_rate ?? null, estimated_cost ?? null, margin, scope_change_id ?? null, file_id ?? quoteFile?.file_id ?? null, notes ?? null, req.user?.id ?? null]);
    if (file_id) {
      await db.run(`INSERT INTO file_associations (file_id, entity_type, entity_id, association_type, created_by)
        SELECT ?, 'project', ?, ?, ? WHERE NOT EXISTS (
          SELECT 1 FROM file_associations WHERE file_id = ? AND entity_type = 'project' AND entity_id = ? AND association_type = ?
        )`, [file_id, projectId, `quote_v${next.version}`, req.user?.id ?? null, file_id, projectId, `quote_v${next.version}`]);
    }
    const created = await db.get('SELECT * FROM project_quotes WHERE id = ?', [result.id]);
    await activityLogService.logActivity(req.user?.id, 'quote', Number(result.id), 'version_created', null, created);
    await activityLogService.logActivity(req.user?.id, 'project', projectId, 'quote_version_created', null, { quote_id: result.id, version: next.version, amount: amountNumber, currency, status: created.status });
    if (!canSeeFinancials(req.user?.role)) {
      const safe = { ...created };
      if (!canSeeCommercialQuotes(req.user?.role)) {
        delete safe.amount;
        delete safe.hourly_rate;
      }
      delete safe.estimated_cost;
      delete safe.margin_percent;
      res.status(201).json({ data: safe });
      return;
    }
    res.status(201).json({ data: created });
  };

  approveQuote = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.role === 'team_lead' ? req.user.id : undefined;
    if (!userId) { res.status(403).json({ error: 'Solo la jefatura puede aprobar una cotización' }); return; }
    const quoteId = Number(req.params.quoteId);
    const quote = await db.get('SELECT * FROM project_quotes WHERE id = ?', [quoteId]);
    if (!quote) { res.status(404).json({ error: 'Cotización no encontrada' }); return; }
    if (quote.status !== 'sent') { res.status(409).json({ error: 'Solo se pueden aprobar versiones enviadas al cliente' }); return; }
    if (quote.scope_change_id && !String(req.body.approval_reference ?? '').trim() && !req.body.evidence_file_id) { res.status(400).json({ error: 'La nueva cotización requiere una referencia de aprobación del cliente' }); return; }
    await db.beginTransaction();
    try {
      await db.run(`UPDATE project_quotes SET status = 'replaced' WHERE project_id = ? AND status IN ('sent', 'approved') AND id <> ?`, [quote.project_id, quoteId]);
      await db.run(`UPDATE project_quotes SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?`, [userId, quoteId]);
      if (quote.scope_change_id) {
        await db.run(`INSERT INTO project_commercial_documents (project_id, document_type, reference_number, file_id, notes, created_by) VALUES (?, 'client_approval', ?, ?, ?, ?)`, [quote.project_id, req.body.approval_reference ?? null, req.body.evidence_file_id ?? null, req.body.approval_notes ?? null, userId]);
        await db.run('UPDATE project_scope_changes SET quote_approved = 1 WHERE id = ?', [quote.scope_change_id]);
      }
      const financials = await db.get('SELECT id FROM project_financials WHERE project_id = ?', [quote.project_id]);
      const costCLP = quote.estimated_cost == null ? 0 : await financeService.toCLP(Number(quote.estimated_cost), quote.currency as Currency);
      const updates = { sale_price: quote.amount, sale_price_currency: quote.currency, budgeted_hours: quote.hours ?? 0, budgeted_cost: costCLP };
      // El costo se guarda ya convertido a pesos, así que la columna de su moneda debe decir CLP: si conservara
      // 'UF'/'USD' (p. ej. de una versión anterior) financeService lo convertiría por segunda vez.
      if (financials) await db.run(`UPDATE project_financials SET sale_price = ?, sale_price_currency = ?, budgeted_hours = ?, budgeted_cost = ?, budgeted_cost_currency = 'CLP', updated_at = datetime('now') WHERE project_id = ?`, [updates.sale_price, updates.sale_price_currency, updates.budgeted_hours, updates.budgeted_cost, quote.project_id]);
      else await db.run(`INSERT INTO project_financials (project_id, sale_price, sale_price_currency, budgeted_hours, budgeted_cost, budgeted_cost_currency) VALUES (?, ?, ?, ?, ?, 'CLP')`, [quote.project_id, updates.sale_price, updates.sale_price_currency, updates.budgeted_hours, updates.budgeted_cost]);
      await db.commit();
    } catch (error) { await db.rollback(); throw error; }
    await activityLogService.logActivity(userId, 'quote', quoteId, 'internally_approved', { status: quote.status }, { status: 'approved', approved_by: userId, approved_at: new Date().toISOString() });
    await activityLogService.logActivity(req.user?.id, 'project', Number(quote.project_id), 'quote_internally_approved', null, { quote_id: quoteId });
    res.json({ data: await db.get('SELECT * FROM project_quotes WHERE id = ?', [quoteId]) });
  };

  rejectQuote = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (req.user?.role !== 'team_lead') { res.status(403).json({ error: 'Solo la jefatura puede rechazar una cotización' }); return; }
    const reason = String(req.body.reason ?? '').trim();
    if (!reason) { res.status(400).json({ error: 'Registra el motivo del rechazo' }); return; }
    const quoteId = Number(req.params.quoteId);
    const quote = await db.get('SELECT * FROM project_quotes WHERE id = ?', [quoteId]);
    if (!quote) { res.status(404).json({ error: 'Cotización no encontrada' }); return; }
    if (quote.status !== 'sent') { res.status(409).json({ error: 'Solo se pueden rechazar versiones enviadas al cliente' }); return; }
    const combinedNotes = quote.notes ? `${quote.notes} | Rechazada: ${reason}` : `Rechazada: ${reason}`;
    await db.run(`UPDATE project_quotes SET status = 'rejected', notes = ? WHERE id = ?`, [combinedNotes, quoteId]);
    await activityLogService.logActivity(req.user.id, 'quote', quoteId, 'rejected', { status: 'sent' }, { status: 'rejected', reason });
    res.json({ data: await db.get('SELECT * FROM project_quotes WHERE id = ?', [quoteId]) });
  };

  approveClient = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.role === 'team_lead' ? req.user.id : undefined;
    if (!userId) { res.status(403).json({ error: 'Solo la jefatura puede registrar la aprobación comercial' }); return; }
    const projectId = Number(req.params.projectId);
    const project = await db.get('SELECT require_purchase_order, commercial_stage FROM projects WHERE id = ?', [projectId]);
    if (!project) { res.status(404).json({ error: 'Proyecto no encontrado' }); return; }
    if (project.commercial_stage !== 'quoting') { res.status(409).json({ error: 'Esta oportunidad ya salió de la etapa de cotización' }); return; }
    const approvedQuote = await db.get(`SELECT id FROM project_quotes WHERE project_id = ? AND status = 'approved'`, [projectId]);
    if (!approvedQuote) { res.status(409).json({ error: 'Aprueba una versión de cotización antes de confirmar el proyecto' }); return; }
    const { approval_reference, approval_notes, evidence_file_id } = req.body;
    if (!String(approval_reference ?? approval_notes ?? '').trim() && !evidence_file_id) { res.status(400).json({ error: 'Registra la referencia o evidencia de aprobación del cliente' }); return; }
    await db.beginTransaction();
    try {
      await db.run(`INSERT INTO project_commercial_documents (project_id, document_type, reference_number, file_id, notes, created_by) VALUES (?, 'client_approval', ?, ?, ?, ?)`, [projectId, approval_reference ?? null, evidence_file_id ?? null, approval_notes ?? null, userId]);
      await db.run(`UPDATE projects SET commercial_stage = 'approved', client_approved_at = datetime('now'), status = CASE WHEN require_purchase_order = 1 AND NOT EXISTS (SELECT 1 FROM project_commercial_documents WHERE project_id = projects.id AND document_type = 'purchase_order') THEN 'on_hold' ELSE 'active' END WHERE id = ?`, [projectId]);
      await db.commit();
    } catch (error) { await db.rollback(); throw error; }
    await activityLogService.logActivity(userId, 'project', projectId, 'client_approval_recorded', null, { quote_id: approvedQuote.id, approval_reference: approval_reference ?? null, evidence_file_id: evidence_file_id ?? null });
    res.json({ data: await db.get('SELECT id, commercial_stage, client_approved_at FROM projects WHERE id = ?', [projectId]) });
  };

  markLost = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (req.user?.role !== 'team_lead') { res.status(403).json({ error: 'Solo la jefatura puede cerrar una oportunidad como perdida' }); return; }
    const reason = String(req.body.reason ?? '').trim();
    if (!reason) { res.status(400).json({ error: 'Registra el motivo para cerrar la oportunidad' }); return; }
    const projectId = Number(req.params.projectId);
    const result = await db.run(`UPDATE projects SET commercial_stage = 'lost', loss_reason = ? WHERE id = ? AND commercial_stage = 'quoting'`, [reason, projectId]);
    if (!result.changes) { res.status(409).json({ error: 'Solo se pueden cerrar como perdidas las oportunidades en cotización' }); return; }
    await activityLogService.logActivity(req.user?.id, 'project', projectId, 'opportunity_lost', null, { reason });
    res.json({ data: await db.get('SELECT id, commercial_stage, loss_reason FROM projects WHERE id = ?', [Number(req.params.projectId)]) });
  };

  updateRequirements = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!canManage(req.user?.role)) { res.status(403).json({ error: 'No tienes permiso para cambiar los requisitos del proyecto' }); return; }
    const { require_purchase_order, require_service_acceptance } = req.body;
    await db.run(`UPDATE projects SET require_purchase_order = COALESCE(?, require_purchase_order), require_service_acceptance = COALESCE(?, require_service_acceptance) WHERE id = ?`, [require_purchase_order === undefined ? null : Number(Boolean(require_purchase_order)), require_service_acceptance === undefined ? null : Number(Boolean(require_service_acceptance)), Number(req.params.projectId)]);
    res.json({ data: await db.get('SELECT id, require_purchase_order, require_service_acceptance FROM projects WHERE id = ?', [Number(req.params.projectId)]) });
  };

  addDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!canManage(req.user?.role)) { res.status(403).json({ error: 'No tienes permiso para registrar documentos' }); return; }
    const { document_type, reference_number, document_date, file_id, notes } = req.body;
    const allowed = ['purchase_order', 'service_acceptance', 'client_approval', 'pdd', 'technical_commercial_proposal'];
    if (!allowed.includes(document_type)) { res.status(400).json({ error: 'Tipo de documento no válido' }); return; }
    const associatedFile = file_id ? null : await db.get(`SELECT file_id FROM file_associations WHERE entity_type = 'project' AND entity_id = ? AND association_type = ? ORDER BY created_at DESC LIMIT 1`, [Number(req.params.projectId), document_type]);
    const evidenceFileId = file_id ?? associatedFile?.file_id ?? null;
    if (!String(reference_number ?? '').trim() && !evidenceFileId) { res.status(400).json({ error: 'Agrega un número de referencia o adjunta evidencia del documento' }); return; }
    const projectId = Number(req.params.projectId);
    const result = await db.run(`INSERT INTO project_commercial_documents (project_id, document_type, reference_number, document_date, file_id, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`, [projectId, document_type, reference_number ?? null, document_date ?? null, evidenceFileId, notes ?? null, req.user?.id ?? null]);
    await activityLogService.logActivity(req.user?.id, 'project', projectId, 'commercial_document_registered', null, { document_id: result.id, document_type, reference_number: reference_number ?? null });
    res.status(201).json({ data: await db.get('SELECT * FROM project_commercial_documents WHERE id = ?', [result.id]) });
  };

  getDocuments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!this.respondAccess(res, await this.checkProjectAccess(req, Number(req.params.projectId)))) return;
    const rows = await db.query(`SELECT d.*, f.original_filename FROM project_commercial_documents d LEFT JOIN files f ON f.id = d.file_id WHERE d.project_id = ? ORDER BY d.created_at DESC`, [Number(req.params.projectId)]);
    res.json({ data: rows });
  };

  acceptDelivery = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!canManage(req.user?.role)) { res.status(403).json({ error: 'No tienes permiso para cerrar la entrega' }); return; }
    const projectId = Number(req.params.projectId);
    const project = await db.get('SELECT require_purchase_order, require_service_acceptance, delivery_accepted_at FROM projects WHERE id = ?', [projectId]);
    if (!project) { res.status(404).json({ error: 'Proyecto no encontrado' }); return; }
    const document = await db.get(`SELECT id FROM project_commercial_documents WHERE project_id = ? AND document_type = 'client_approval' LIMIT 1`, [projectId]);
    if (!document && !req.body.evidence_file_id) { res.status(409).json({ error: 'Registra la aprobación o evidencia del cliente antes de cerrar la entrega' }); return; }
    if (project.require_purchase_order && !await db.get(`SELECT id FROM project_commercial_documents WHERE project_id = ? AND document_type = 'purchase_order' LIMIT 1`, [projectId])) { res.status(409).json({ error: 'Registra la orden de compra obligatoria antes de cerrar la entrega' }); return; }
    if (project.require_service_acceptance && !await db.get(`SELECT id FROM project_commercial_documents WHERE project_id = ? AND document_type = 'service_acceptance' LIMIT 1`, [projectId])) { res.status(409).json({ error: 'Registra la HES o aceptación de servicio obligatoria antes de cerrar la entrega' }); return; }
    await db.run(`UPDATE projects SET delivery_accepted_at = datetime('now'), delivery_accepted_by = ?, status = 'completed', actual_end_date = COALESCE(actual_end_date, date('now')) WHERE id = ?`, [req.user?.id ?? null, projectId]);
    if (req.body.evidence_file_id) await db.run(`INSERT INTO project_commercial_documents (project_id, document_type, file_id, notes, created_by) VALUES (?, 'client_approval', ?, ?, ?)`, [projectId, req.body.evidence_file_id, req.body.notes ?? null, req.user?.id ?? null]);
    res.json({ data: await db.get('SELECT id, delivery_accepted_at, financial_closed_at FROM projects WHERE id = ?', [projectId]) });
  };

  startExecution = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!canManage(req.user?.role)) { res.status(403).json({ error: 'No tienes permiso para iniciar el proyecto' }); return; }
    const projectId = Number(req.params.projectId);
    const project = await db.get('SELECT commercial_stage, require_purchase_order FROM projects WHERE id = ?', [projectId]);
    if (!project) { res.status(404).json({ error: 'Proyecto no encontrado' }); return; }
    if (project.commercial_stage !== 'approved') { res.status(409).json({ error: 'El cliente debe aprobar la cotización antes de iniciar la ejecución' }); return; }
    if (project.require_purchase_order && !await db.get(`SELECT id FROM project_commercial_documents WHERE project_id = ? AND document_type = 'purchase_order' LIMIT 1`, [projectId])) { res.status(409).json({ error: 'Registra la orden de compra antes de iniciar la ejecución' }); return; }
    const oldProject = await db.get('SELECT id, status, actual_start_date FROM projects WHERE id = ?', [projectId]);
    await db.run(`UPDATE projects SET status = 'active', actual_start_date = COALESCE(actual_start_date, date('now')) WHERE id = ?`, [projectId]);
    await activityLogService.logActivity(req.user?.id, 'project', projectId, 'execution_started', oldProject, await db.get('SELECT id, status, actual_start_date FROM projects WHERE id = ?', [projectId]));
    res.json({ data: await db.get('SELECT id, status, actual_start_date FROM projects WHERE id = ?', [projectId]) });
  };

  closeFinancials = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (req.user?.role !== 'team_lead') { res.status(403).json({ error: 'Solo la jefatura puede cerrar las finanzas del proyecto' }); return; }
    const projectId = Number(req.params.projectId);
    const project = await db.get('SELECT delivery_accepted_at, require_purchase_order, require_service_acceptance FROM projects WHERE id = ?', [projectId]);
    if (!project?.delivery_accepted_at) { res.status(409).json({ error: 'La entrega debe estar aceptada para cerrar las finanzas' }); return; }
    const pendingMilestone = await db.get(`SELECT id FROM payment_milestones WHERE project_id = ? AND status <> 'paid' LIMIT 1`, [projectId]);
    const unpaidInvoice = await db.get(`SELECT i.id FROM invoices i WHERE i.project_id = ? AND i.status NOT IN ('paid', 'cancelled') AND i.amount > COALESCE((SELECT SUM(payments.amount) FROM payments WHERE payments.invoice_id = i.id), 0) LIMIT 1`, [projectId]);
    const missingPO = project.require_purchase_order && !await db.get(`SELECT id FROM project_commercial_documents WHERE project_id = ? AND document_type = 'purchase_order' LIMIT 1`, [projectId]);
    const missingServiceAcceptance = project.require_service_acceptance && !await db.get(`SELECT id FROM project_commercial_documents WHERE project_id = ? AND document_type = 'service_acceptance' LIMIT 1`, [projectId]);
    if (pendingMilestone || unpaidInvoice || missingPO || missingServiceAcceptance) { res.status(409).json({ error: 'Hay hitos, facturas o documentos obligatorios pendientes', pending_milestone: Boolean(pendingMilestone), unpaid_invoice: Boolean(unpaidInvoice), missing_purchase_order: Boolean(missingPO), missing_service_acceptance: Boolean(missingServiceAcceptance) }); return; }
    await db.run(`UPDATE projects SET financial_closed_at = datetime('now'), status = 'completed', actual_end_date = COALESCE(actual_end_date, date('now')) WHERE id = ?`, [projectId]);
    await activityLogService.logActivity(req.user?.id, 'project', projectId, 'financials_closed', null, await db.get('SELECT id, financial_closed_at, status FROM projects WHERE id = ?', [projectId]));
    res.json({ data: await db.get('SELECT id, status, delivery_accepted_at, financial_closed_at FROM projects WHERE id = ?', [projectId]) });
  };

  getClosureReport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const report = await closureReportService.getReport(Number(req.params.projectId));
      if (!report) { res.status(404).json({ error: 'Proyecto no encontrado' }); return; }
      res.json({ data: report });
    } catch (error) {
      logger.error('Get closure report error:', error);
      res.status(500).json({ error: 'Error al generar el informe de cierre' });
    }
  };

  getClosureReportPdf = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const projectId = Number(req.params.projectId);
      const report = await closureReportService.getReport(projectId);
      if (!report) { res.status(404).json({ error: 'Proyecto no encontrado' }); return; }
      const buffer = await generateClosureReport(report);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="informe-cierre-${projectId}.pdf"`);
      res.send(buffer);
    } catch (error) {
      logger.error('Get closure report PDF error:', error);
      res.status(500).json({ error: 'Error al generar el informe de cierre' });
    }
  };

  getCapacity = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!canManage(req.user?.role)) { res.status(403).json({ error: 'No tienes permiso para consultar la capacidad del equipo' }); return; }
    const projectId = Number(req.params.projectId);
    const rows = await db.query(`SELECT pa.user_id, u.full_name, pa.role, pa.allocation_percentage, pa.budgeted_hours, pa.start_date, pa.end_date, pa.is_active,
      COALESCE((SELECT SUM(te.hours) FROM time_entries te WHERE te.project_id = pa.project_id AND te.user_id = pa.user_id AND te.approval_status = 'approved'), 0) AS actual_hours
      FROM project_assignments pa JOIN users u ON u.id = pa.user_id WHERE pa.project_id = ? AND pa.is_active = 1 ORDER BY u.full_name`, [projectId]);
    res.json({ data: rows.map((r: any) => ({ ...r, planned_fte: Number(r.allocation_percentage || 0) / 100 })) });
  };

  getTeamCapacity = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!canManage(req.user?.role)) {
      res.status(403).json({ error: 'No tienes permiso para consultar la capacidad del equipo' });
      return;
    }

    const users = await db.query(
      `SELECT u.id, u.full_name, u.username, u.email, u.role, u.avatar_url
       FROM users u
       WHERE u.is_active = 1 AND u.role IN ('team_lead', 'rpa_developer', 'rpa_operations', 'it_support')
       ORDER BY u.full_name ASC`
    );

    const assignments = await db.query(
      `SELECT pa.user_id, pa.project_id, p.name as project_name, p.status as project_status,
              pa.role as assignment_role, pa.allocation_percentage, pa.budgeted_hours,
              pa.start_date, pa.end_date,
              COALESCE((
                SELECT SUM(te.hours)
                FROM time_entries te
                WHERE te.project_id = pa.project_id
                  AND te.user_id = pa.user_id
                  AND te.approval_status = 'approved'
              ), 0) as actual_hours
       FROM project_assignments pa
       JOIN projects p ON p.id = pa.project_id
       WHERE pa.is_active = 1
         AND p.status NOT IN ('completed', 'cancelled')
       ORDER BY p.name ASC`
    );

    const assignmentsByUser = new Map<number, any[]>();
    for (const a of assignments) {
      if (!assignmentsByUser.has(a.user_id)) {
        assignmentsByUser.set(a.user_id, []);
      }
      assignmentsByUser.get(a.user_id)!.push({
        ...a,
        planned_fte: Number(a.allocation_percentage || 0) / 100
      });
    }

    const teamCapacity = users.map((u: any) => {
      const userAssignments = assignmentsByUser.get(u.id) || [];
      const totalAllocation = userAssignments.reduce((acc: number, cur: any) => acc + Number(cur.allocation_percentage || 0), 0);
      const totalFte = Math.round((totalAllocation / 100) * 100) / 100;
      const totalBudgetedHours = userAssignments.reduce((acc: number, cur: any) => acc + Number(cur.budgeted_hours || 0), 0);
      const totalActualHours = userAssignments.reduce((acc: number, cur: any) => acc + Number(cur.actual_hours || 0), 0);

      let status = 'available';
      if (totalFte > 1.05) {
        status = 'overallocated';
      } else if (totalFte >= 0.8) {
        status = 'optimal';
      }

      return {
        user_id: u.id,
        full_name: u.full_name,
        username: u.username,
        email: u.email,
        role: u.role,
        avatar_url: u.avatar_url,
        total_allocation_percentage: totalAllocation,
        total_fte: totalFte,
        total_budgeted_hours: totalBudgetedHours,
        total_actual_hours: totalActualHours,
        status,
        projects_count: userAssignments.length,
        projects: userAssignments
      };
    });

    const summary = {
      total_team_members: teamCapacity.length,
      overallocated_count: teamCapacity.filter((m: any) => m.status === 'overallocated').length,
      optimal_count: teamCapacity.filter((m: any) => m.status === 'optimal').length,
      available_count: teamCapacity.filter((m: any) => m.status === 'available').length,
      average_fte: teamCapacity.length ? Math.round((teamCapacity.reduce((sum: number, m: any) => sum + m.total_fte, 0) / teamCapacity.length) * 100) / 100 : 0
    };

    res.json({ data: teamCapacity, summary });
  };

  saveCapacity = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!canManage(req.user?.role)) {
      res.status(403).json({ error: 'No tienes permiso para gestionar la capacidad del equipo' });
      return;
    }
    const projectId = Number(req.params.projectId);
    const { user_id, role, allocation_percentage, budgeted_hours, start_date, end_date } = req.body;

    if (!user_id || !Number.isInteger(Number(user_id))) {
      res.status(400).json({ error: 'Usuario obligatorio' });
      return;
    }

    if (!await this.projectExists(projectId)) {
      res.status(404).json({ error: 'Proyecto no encontrado' });
      return;
    }

    const allocation = allocation_percentage !== undefined ? Math.max(0, Math.min(100, Number(allocation_percentage))) : 100;
    const hours = budgeted_hours !== undefined && budgeted_hours !== null && budgeted_hours !== '' ? Math.max(0, Number(budgeted_hours)) : null;

    const existing = await db.get(
      `SELECT * FROM project_assignments WHERE project_id = ? AND user_id = ?`,
      [projectId, user_id]
    );

    if (existing) {
      await db.run(
        `UPDATE project_assignments
         SET role = COALESCE(?, role),
             allocation_percentage = ?,
             budgeted_hours = ?,
             start_date = ?,
             end_date = ?,
             is_active = 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [role || existing.role, allocation, hours, start_date || null, end_date || null, existing.id]
      );
      await activityLogService.logActivity(req.user?.id, 'project_assignment', existing.id, 'updated', existing, {
        allocation_percentage: allocation, budgeted_hours: hours, start_date, end_date
      });
    } else {
      const result = await db.run(
        `INSERT INTO project_assignments (project_id, user_id, role, allocation_percentage, budgeted_hours, start_date, end_date, is_active, assigned_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [projectId, user_id, role || 'contributor', allocation, hours, start_date || null, end_date || null, req.user?.id]
      );
      await activityLogService.logActivity(req.user?.id, 'project_assignment', Number(result.id), 'created', null, {
        project_id: projectId, user_id, allocation_percentage: allocation, budgeted_hours: hours
      });
    }

    const saved = await db.get(
      `SELECT pa.user_id, u.full_name, pa.role, pa.allocation_percentage, pa.budgeted_hours, pa.start_date, pa.end_date, pa.is_active,
              COALESCE((SELECT SUM(te.hours) FROM time_entries te WHERE te.project_id = pa.project_id AND te.user_id = pa.user_id AND te.approval_status = 'approved'), 0) AS actual_hours
       FROM project_assignments pa
       JOIN users u ON u.id = pa.user_id
       WHERE pa.project_id = ? AND pa.user_id = ?`,
      [projectId, user_id]
    );

    res.json({
      data: {
        ...saved,
        planned_fte: Number(saved.allocation_percentage || 0) / 100
      }
    });
  };

  deleteCapacity = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!canManage(req.user?.role)) {
      res.status(403).json({ error: 'No tienes permiso para gestionar la capacidad del equipo' });
      return;
    }
    const projectId = Number(req.params.projectId);
    const userId = Number(req.params.userId);

    const existing = await db.get(
      `SELECT * FROM project_assignments WHERE project_id = ? AND user_id = ?`,
      [projectId, userId]
    );

    if (!existing) {
      res.status(404).json({ error: 'Asignación no encontrada' });
      return;
    }

    const hasHours = await db.get(
      `SELECT COUNT(*) as count FROM time_entries WHERE project_id = ? AND user_id = ?`,
      [projectId, userId]
    );

    if (hasHours && hasHours.count > 0) {
      await db.run(
        `UPDATE project_assignments SET is_active = 0, allocation_percentage = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [existing.id]
      );
    } else {
      await db.run(`DELETE FROM project_assignments WHERE id = ?`, [existing.id]);
    }

    await activityLogService.logActivity(req.user?.id, 'project_assignment', existing.id, 'deleted', existing, null);
    res.json({ message: 'Asignación eliminada correctamente' });
  };

  estimateQuoteCost = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (req.user?.role !== 'team_lead') { res.status(403).json({ error: 'Solo la jefatura puede consultar costos del equipo' }); return; }
    const projectId = Number(req.params.projectId);
    const hours = Number(req.query.hours);
    const currency = String(req.query.currency || 'CLP') as Currency;
    if (!Number.isFinite(hours) || hours <= 0) { res.status(400).json({ error: 'Ingresa horas estimadas válidas' }); return; }
    if (!['CLP', 'UF', 'USD'].includes(currency)) { res.status(400).json({ error: 'Moneda no válida' }); return; }
    if (!await this.projectExists(projectId)) { res.status(404).json({ error: 'Proyecto no encontrado' }); return; }
    const { hourlyCostCLP, breakdown } = await financeService.getBlendedHourlyCostCLP(projectId);
    const costCLP = Math.round(hourlyCostCLP * hours);
    const rate = currency === 'CLP' ? 1 : await financeService.getExchangeRate(currency);
    if (rate <= 0) { res.status(409).json({ error: `Falta configurar el tipo de cambio vigente para ${currency}` }); return; }
    res.json({ currency, hours, cost_clp: costCLP, estimated_cost: Math.round((costCLP / rate) * 100) / 100, blended_hourly_cost_clp: Math.round(hourlyCostCLP), team: breakdown });
  };

  transitionToSupport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!canManage(req.user?.role)) {
      res.status(403).json({ error: 'No tienes permiso para activar el paso a soporte' });
      return;
    }
    const projectId = Number(req.params.projectId);
    const project = await db.get(
      `SELECT p.*, c.name AS client_name, c.contact_name, c.contact_email, c.contact_phone
       FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id
       WHERE p.id = ?`,
      [projectId]
    );
    if (!project) {
      res.status(404).json({ error: 'Proyecto no encontrado' });
      return;
    }

    const companyName = String(req.body.company_name || project.client_name || project.name).trim();
    const contractedHours = Number(req.body.contracted_hours_monthly) > 0 ? Number(req.body.contracted_hours_monthly) : 10;
    const currency = ['CLP', 'UF', 'USD'].includes(req.body.hourly_rate_currency)
      ? req.body.hourly_rate_currency
      : (project.currency || 'UF');
    const defaultRate = currency === 'CLP' ? 45000 : currency === 'USD' ? 50 : 1.2;
    const hourlyRate = Number(req.body.hourly_rate) > 0 ? Number(req.body.hourly_rate) : defaultRate;
    const hourlyRateExtra = Number(req.body.hourly_rate_extra) > 0 ? Number(req.body.hourly_rate_extra) : Math.round(hourlyRate * 1.25 * 100) / 100;

    let company = await db.get(
      `SELECT * FROM support_companies WHERE LOWER(TRIM(company_name)) = LOWER(TRIM(?)) LIMIT 1`,
      [companyName]
    );

    let createdNewCompany = false;
    if (!company) {
      const ins = await db.run(
        `INSERT INTO support_companies (
          company_name, contact_person, email, phone,
          contracted_hours_monthly, hourly_rate, hourly_rate_currency, hourly_rate_extra,
          notes, contract_start_date, status, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, date('now'), 'active', ?, datetime('now'), datetime('now'))`,
        [
          companyName,
          project.contact_name || 'Contacto Principal',
          project.contact_email || null,
          project.contact_phone || null,
          contractedHours,
          hourlyRate,
          currency,
          hourlyRateExtra,
          `Traspasado desde proyecto #${projectId}: ${project.name}`,
          req.user?.id ?? null
        ]
      );
      company = await db.get(`SELECT * FROM support_companies WHERE id = ?`, [ins.id]);
      createdNewCompany = true;
    }

    let rpaProcess = await db.get(
      `SELECT * FROM support_rpa_processes WHERE company_id = ? AND LOWER(TRIM(process_name)) = LOWER(TRIM(?)) LIMIT 1`,
      [company.id, project.name]
    );
    if (!rpaProcess) {
      const procIns = await db.run(
        `INSERT INTO support_rpa_processes (company_id, process_name, process_description) VALUES (?, ?, ?)`,
        [company.id, project.name, project.description || `Bot RPA traspasado desde proyecto #${projectId}`]
      );
      rpaProcess = await db.get(`SELECT * FROM support_rpa_processes WHERE id = ?`, [procIns.id]);
    }

    await activityLogService.logActivity(req.user?.id, 'project', projectId, 'transitioned_to_support', null, {
      support_company_id: company.id,
      company_name: company.company_name,
      rpa_process_id: rpaProcess?.id,
      created_new_company: createdNewCompany
    });

    res.status(createdNewCompany ? 201 : 200).json({
      data: {
        company,
        rpa_process: rpaProcess,
        created_new_company: createdNewCompany
      }
    });
  };
}

export const commercialController = new CommercialController();
