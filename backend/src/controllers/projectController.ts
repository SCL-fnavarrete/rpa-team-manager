import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { db } from '../database/database';
import { logger } from '../utils/logger';
import { LLMService, QuoteData } from '../services/llmService';
import { DocumentParserService } from '../services/documentParserService';
import { projectHealthService } from '../services/projectHealthService';
import { activityLogService } from '../services/activityLogService';
import { commentService } from '../services/commentService';
import { projectLogService, ProjectLogEntryType } from '../services/projectLogService';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

export class ProjectController {
    private llmService: LLMService;
    private documentParserService: DocumentParserService;

    constructor() {
        this.llmService = new LLMService();
        this.documentParserService = new DocumentParserService();
    }

    // Campo del body -> columna de project_financials.
    private static readonly FINANCIAL_FIELD_MAP: Record<string, string> = {
        budget: 'budgeted_cost',
        sale_price: 'sale_price',
        sale_price_currency: 'sale_price_currency',
        hours_budgeted: 'budgeted_hours'
    };

    // Solo team_lead fija precio/horas vendidas; el presupuesto (budget) lo puede fijar cualquier rol que edite el proyecto.
    private static readonly TEAM_LEAD_ONLY_FINANCIAL_FIELDS = ['sale_price', 'sale_price_currency', 'hours_budgeted'];

    private static readonly FINANCIAL_RESPONSE_FIELDS = ['budget', 'budgeted_cost', 'budget_spent', 'delay_cost', 'penalty_cost', 'sale_price'];

    private static readonly FINANCIAL_LOG_FIELDS = [
        ...ProjectController.FINANCIAL_RESPONSE_FIELDS, 'sale_price_currency', 'hours_budgeted'
    ];

    private static readonly LOG_ENTRY_TYPES: ProjectLogEntryType[] = [
        'technical_milestone', 'client_approval', 'decision', 'scope_change', 'incident'
    ];

    private financialInputFor(user: AuthenticatedRequest['user'], body: Record<string, any>): Record<string, any> {
        if (user?.role === 'team_lead') return body;
        const filtered = { ...body };
        for (const field of ProjectController.TEAM_LEAD_ONLY_FINANCIAL_FIELDS) delete filtered[field];
        return filtered;
    }

    // UPSERT parcial: escribe solo las columnas recibidas y nunca borra la fila (hourly_rate y demás se conservan).
    private async upsertProjectFinancials(projectId: number, input: Record<string, any>): Promise<void> {
        const entries = Object.entries(ProjectController.FINANCIAL_FIELD_MAP)
            .filter(([field]) => input[field] !== undefined)
            .map(([field, column]) => [column, input[field]] as [string, any]);
        if (entries.length === 0) return;

        const existing = await db.get('SELECT id FROM project_financials WHERE project_id = ?', [projectId]);
        if (existing) {
            await db.run(
                `UPDATE project_financials SET ${entries.map(([column]) => `${column} = ?`).join(', ')}, updated_at = datetime('now') WHERE project_id = ?`,
                [...entries.map(([, value]) => value), projectId]
            );
        } else {
            await db.run(
                `INSERT INTO project_financials (project_id, ${entries.map(([column]) => column).join(', ')}) VALUES (?, ${entries.map(() => '?').join(', ')})`,
                [projectId, ...entries.map(([, value]) => value)]
            );
        }
    }

    private stripFinancialFields<T extends Record<string, any> | null | undefined>(user: AuthenticatedRequest['user'], row: T): T {
        if (!row || user?.role === 'team_lead') return row;
        const copy: Record<string, any> = { ...row };
        for (const field of ProjectController.FINANCIAL_RESPONSE_FIELDS) delete copy[field];
        return copy as T;
    }

    // activity_log lo leen todos los roles con acceso al proyecto: se limpia siempre, sin importar quién edita.
    private stripFinancialFieldsForLog<T extends Record<string, any> | null | undefined>(values: T): T {
        if (!values) return values;
        const copy: Record<string, any> = { ...values };
        for (const field of ProjectController.FINANCIAL_LOG_FIELDS) delete copy[field];
        return copy as T;
    }

    // old_values/new_values pueden venir como JSON crudo (query directa) o ya parseados (activityLogService).
    private stripFinancialFieldsFromActivity<T extends { old_values?: any; new_values?: any }>(
        user: AuthenticatedRequest['user'],
        entry: T
    ): T {
        if (user?.role === 'team_lead') return entry;
        const clean = (value: any): any => {
            if (typeof value !== 'string') return this.stripFinancialFieldsForLog(value);
            try {
                return JSON.stringify(this.stripFinancialFieldsForLog(JSON.parse(value)));
            } catch {
                return null;
            }
        };
        return { ...entry, old_values: clean(entry.old_values), new_values: clean(entry.new_values) };
    }

    // GET /api/projects
    getProjects = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            let query = `
                SELECT p.*,
                       u1.full_name as created_by_name,
                       u2.full_name as assigned_to_name,
                       c.name as client_name,
                       sr.name as sales_rep_name,
                       (SELECT COUNT(*) FROM tasks t JOIN task_boards tb ON t.board_id = tb.id
                         WHERE tb.project_id = p.id) as total_tasks,
                       (SELECT COUNT(*) FROM tasks t JOIN task_boards tb ON t.board_id = tb.id
                         WHERE tb.project_id = p.id AND EXISTS (SELECT 1 FROM task_columns tc WHERE tc.id = t.column_id
                           AND (tc.is_done_column = 1 OR LOWER(TRIM(tc.name)) IN ('done', 'completed', 'finished')))) as completed_tasks,
                       (SELECT COALESCE(SUM(te.hours), 0) FROM time_entries te
                         WHERE te.project_id = p.id) as total_hours_logged
                FROM projects p
                LEFT JOIN users u1 ON p.created_by = u1.id
                LEFT JOIN users u2 ON p.assigned_to = u2.id
                LEFT JOIN clients c ON c.id = p.client_id
                LEFT JOIN sales_reps sr ON sr.id = p.sales_rep_id
            `;

            const params: any[] = [];
            const includeLost = req.query.include_lost === 'true';
            if (!includeLost) query += " WHERE COALESCE(p.commercial_stage, 'approved') <> 'lost'";

            // Filter based on user role
            if (req.user?.role === 'rpa_developer') {
                query += includeLost ? ' WHERE (p.assigned_to = ? OR p.created_by = ?)'
                    : ' AND (p.assigned_to = ? OR p.created_by = ?)';
                params.push(req.user.id, req.user.id);
            }

            query += ' ORDER BY p.created_at DESC';

            const projects = await db.query(query, params);

            // Calculate progress percentage for each project
            const projectsWithProgress = projects.map(project => ({
                ...this.stripFinancialFields(req.user, project),
                progress_percentage: project.total_tasks > 0 
                    ? Math.round((project.completed_tasks / project.total_tasks) * 100)
                    : 0,
                total_hours_logged: project.total_hours_logged || 0
            }));

            res.json(projectsWithProgress);
        } catch (error) {
            logger.error('Get projects error:', error);
            res.status(500).json({ error: 'Failed to get projects' });
        }
    };

    // GET /api/projects/:id
    getProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;

            const project = await db.get(`
                SELECT p.*, 
                       u1.full_name as created_by_name,
                       u2.full_name as assigned_to_name,
                       c.name as client_name,
                       sr.name as sales_rep_name,
                       pf.budgeted_cost,
                       pf.actual_cost as budget_spent,
                       pf.budgeted_hours as hours_budgeted,
                       (SELECT COALESCE(SUM(te.hours), 0) FROM time_entries te WHERE te.project_id = p.id) as total_hours_logged,
                       (SELECT COALESCE(SUM(te.hours), 0) FROM time_entries te WHERE te.project_id = p.id AND te.approval_status = 'approved') as hours_spent,
                       pf.delay_cost,
                       pf.penalty_cost,
                       pf.sale_price
                FROM projects p
                LEFT JOIN users u1 ON p.created_by = u1.id
                LEFT JOIN users u2 ON p.assigned_to = u2.id
                LEFT JOIN clients c ON c.id = p.client_id
                LEFT JOIN sales_reps sr ON sr.id = p.sales_rep_id
                LEFT JOIN project_financials pf ON p.id = pf.project_id
                WHERE p.id = ?
            `, [id]);

            if (!project) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }

            // Check access permissions
            if (req.user?.role === 'rpa_developer' && 
                project.assigned_to !== req.user.id && 
                project.created_by !== req.user.id) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            // Get project tasks summary
            const tasksSummary = await db.query(`
                SELECT 
                    CASE WHEN tc.is_done_column = 1 OR LOWER(TRIM(tc.name)) IN ('done', 'completed', 'finished')
                         THEN 'done' WHEN t.status = 'done' THEN 'todo' ELSE t.status END as status,
                    COUNT(*) as count,
                    SUM(t.estimated_hours) as estimated_hours,
                    SUM(t.actual_hours) as actual_hours
                FROM task_boards tb
                JOIN tasks t ON tb.id = t.board_id
                JOIN task_columns tc ON tc.id = t.column_id
                WHERE tb.project_id = ?
                GROUP BY CASE WHEN tc.is_done_column = 1 OR LOWER(TRIM(tc.name)) IN ('done', 'completed', 'finished')
                              THEN 'done' WHEN t.status = 'done' THEN 'todo' ELSE t.status END
            `, [id]);

            // Get recent activities
            const recentActivities = await db.query(`
                SELECT 
                    al.*,
                    u.full_name as user_name
                FROM activity_log al
                LEFT JOIN users u ON al.user_id = u.id
                WHERE al.entity_type = 'project' AND al.entity_id = ?
                ORDER BY al.created_at DESC
                LIMIT 10
            `, [id]);

            res.json({
                ...this.stripFinancialFields(req.user, project),
                total_tasks: tasksSummary.reduce((sum, row) => sum + row.count, 0),
                completed_tasks: tasksSummary.filter(row => row.status === 'done').reduce((sum, row) => sum + row.count, 0),
                tasks_summary: tasksSummary,
                recent_activities: recentActivities.map(activity => this.stripFinancialFieldsFromActivity(req.user, activity))
            });
        } catch (error) {
            logger.error('Get project error:', error);
            res.status(500).json({ error: 'Failed to get project' });
        }
    };

    // POST /api/projects
    createProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const {
                name,
                description,
                status = 'on_hold',
                priority = 'medium',
                budget,
                start_date,
                end_date,
                assigned_to,
                client_id,
                client_contact_id,
                sales_rep_id,
                opportunity_source = 'direct',
                area_id,
                pm_user_id,
                project_type = 'commercial',
                currency = 'CLP'
            } = req.body;

            if (!['direct', 'sales'].includes(opportunity_source)) {
                res.status(400).json({ error: 'El origen de la oportunidad no es válido' });
                return;
            }
            if (opportunity_source === 'sales' && !sales_rep_id) {
                res.status(400).json({ error: 'Selecciona el comercial que trajo la oportunidad' });
                return;
            }
            if (client_contact_id) {
                const contact = await db.get('SELECT client_id FROM client_contacts WHERE id = ? AND is_active = 1', [client_contact_id]);
                if (!contact || Number(contact.client_id) !== Number(client_id)) {
                    res.status(400).json({ error: 'El contacto seleccionado no pertenece al cliente activo' });
                    return;
                }
            }

            if (!name) {
                res.status(400).json({ error: 'Project name is required' });
                return;
            }

            // rpa_operations siempre se autoasigna al crear; se ignora cualquier assigned_to del body para este rol.
            const isSelfAssigningOps = req.user?.role === 'rpa_operations';
            const effectiveAssignedTo = isSelfAssigningOps ? req.user!.id : (assigned_to || null);
            const effectiveStatus = project_type === 'commercial' ? 'on_hold' : status;
            const commercialStage = project_type === 'commercial' ? 'quoting' : 'approved';

            // Validate assigned_to user exists if provided
            if (effectiveAssignedTo && !isSelfAssigningOps) {
                const assignedUser = await db.get('SELECT id FROM users WHERE id = ?', [effectiveAssignedTo]);
                if (!assignedUser) {
                    res.status(400).json({ error: `Assigned user with ID ${effectiveAssignedTo} does not exist` });
                    return;
                }
            }

            // Create project
            const result = await db.run(`
                INSERT INTO projects (
                    name, description, status, priority, budget,
                    start_date, end_date, assigned_to, created_by,
                    client_id, client_contact_id, sales_rep_id, opportunity_source, area_id, pm_user_id, project_type, currency, commercial_stage
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                name, description, effectiveStatus, priority, budget ?? null,
                start_date ?? null, end_date ?? null, effectiveAssignedTo, req.user?.id,
                client_id ?? null, client_contact_id ?? null, sales_rep_id ?? null, opportunity_source, area_id ?? null, pm_user_id ?? null, project_type, currency, commercialStage
            ]);

            const projectId = result.id!;

            if (project_type === 'internal') {
                await this.upsertProjectFinancials(projectId, this.financialInputFor(req.user, req.body));
            }

            if (isSelfAssigningOps && project_type === 'internal') {
                await db.run(`
                    INSERT INTO project_assignments (
                        project_id, user_id, role, allocation_percentage, start_date, end_date, assigned_by, is_active
                    ) VALUES (?, ?, 'lead', 100, NULL, NULL, ?, 1)
                `, [projectId, req.user!.id, req.user!.id]);
            }

            // Create default task board
            const boardResult = await db.run(`
                INSERT INTO task_boards (
                    project_id, name, description, board_type, is_default
                ) VALUES (?, ?, ?, 'kanban', 1)
            `, [projectId, `${name} Board`, `Main kanban board for ${name}`]);

            const boardId = boardResult.id!;

            // Create default columns
            const defaultColumns = [
                { name: 'Backlog', position: 1, color: '#gray', is_done: 0 },
                { name: 'To Do', position: 2, color: '#blue', is_done: 0 },
                { name: 'In Progress', position: 3, color: '#yellow', is_done: 0, wip_limit: 3 },
                { name: 'Review', position: 4, color: '#orange', is_done: 0 },
                { name: 'Testing', position: 5, color: '#purple', is_done: 0 },
                { name: 'Done', position: 6, color: '#green', is_done: 1 }
            ];

            for (const column of defaultColumns) {
                await db.run(`
                    INSERT INTO task_columns (
                        board_id, name, position, color, is_done_column, wip_limit
                    ) VALUES (?, ?, ?, ?, ?, ?)
                `, [boardId, column.name, column.position, column.color, column.is_done, column.wip_limit || null]);
            }

            // Auto-initialize mandatory lifecycle phases for the project
            try {
                const mandatoryTemplates = await db.query(`
                    SELECT * FROM project_phase_templates
                    WHERE is_mandatory = 1
                    ORDER BY phase_order ASC
                `);
                for (const template of mandatoryTemplates) {
                    await db.run(`
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
                        template.estimated_duration_days ? template.estimated_duration_days * 8 : 0,
                        template.is_billable,
                        'internal'
                    ]);
                }
            } catch (phaseInitError) {
                logger.warn('Could not auto-initialize project phases:', phaseInitError);
            }

            // Log activity
            await activityLogService.logActivity(
                req.user?.id,
                'project',
                projectId,
                'created',
                null,
                { name, status: effectiveStatus, priority, commercial_stage: commercialStage }
            );

            // Get the created project with details
            const createdProject = await db.get(`
                SELECT p.*, u.full_name as created_by_name,
                       pf.budgeted_cost, pf.budgeted_hours as hours_budgeted, pf.sale_price
                FROM projects p
                LEFT JOIN users u ON p.created_by = u.id
                LEFT JOIN project_financials pf ON p.id = pf.project_id
                WHERE p.id = ?
            `, [projectId]);

            res.status(201).json(this.stripFinancialFields(req.user, createdProject));
        } catch (error) {
            logger.error('Create project error:', error);
            res.status(500).json({ error: 'Failed to create project' });
        }
    };

    // PUT /api/projects/:id
    updateProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const updates = req.body;

            // Get current project
            const currentProject = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
            if (!currentProject) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }

            // Check permissions
            if (req.user?.role === 'rpa_developer' &&
                currentProject.created_by !== req.user.id &&
                currentProject.assigned_to !== req.user.id) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }
            if (!req.user || !['team_lead', 'rpa_operations', 'rpa_developer'].includes(req.user.role)) {
                res.status(403).json({ error: 'Access denied: insufficient permissions to update project' });
                return;
            }

            // Build update query dynamically
            const allowedFields = [
                'name', 'description', 'status', 'priority', 'budget',
                'start_date', 'end_date', 'actual_start_date', 'actual_end_date',
                'assigned_to', 'progress_percentage',
                'client_id', 'client_contact_id', 'sales_rep_id', 'opportunity_source', 'area_id', 'pm_user_id', 'currency'
            ];

            // Solo team_lead puede reasignar el proyecto (assigned_to); otros roles lo ven descartado silenciosamente.
            const updatesForFields = req.user?.role === 'team_lead' ? updates : (() => {
                const rest = { ...updates };
                delete rest.assigned_to;
                delete rest.budget;
                return rest;
            })();

            const updateFields = Object.keys(updatesForFields).filter(key => allowedFields.includes(key) && updatesForFields[key] !== undefined);
            const nextClientId = updatesForFields.client_id ?? currentProject.client_id;
            const nextContactId = updatesForFields.client_contact_id ?? currentProject.client_contact_id;
            if (nextContactId) {
                const contact = await db.get('SELECT client_id FROM client_contacts WHERE id = ? AND is_active = 1', [nextContactId]);
                if (!contact || Number(contact.client_id) !== Number(nextClientId)) {
                    res.status(400).json({ error: 'El contacto seleccionado no pertenece al cliente del proyecto' });
                    return;
                }
            }
            const financialInput = this.financialInputFor(req.user, updates);
            const hasFinancialChanges = Object.keys(ProjectController.FINANCIAL_FIELD_MAP)
                .some(field => financialInput[field] !== undefined);

            const lockedCommercialFields = ['sale_price', 'sale_price_currency', 'hours_budgeted'];
            if (currentProject.project_type === 'commercial' && lockedCommercialFields.some(field => financialInput[field] !== undefined)) {
                res.status(400).json({ error: 'El precio y las horas comerciales se actualizan mediante una versión de cotización' });
                return;
            }
            if (updatesForFields.status === 'active' && currentProject.commercial_stage === 'quoting') {
                res.status(409).json({ error: 'Aprueba una cotización y registra la aprobación del cliente antes de iniciar la ejecución' });
                return;
            }
            if (updatesForFields.status === 'active' && currentProject.require_purchase_order) {
                const purchaseOrder = await db.get(`SELECT id FROM project_commercial_documents WHERE project_id = ? AND document_type = 'purchase_order' LIMIT 1`, [id]);
                if (!purchaseOrder) {
                    res.status(409).json({ error: 'Registra la orden de compra obligatoria antes de iniciar ejecución' });
                    return;
                }
            }
            if (updatesForFields.status === 'completed' && !currentProject.delivery_accepted_at) {
                res.status(409).json({ error: 'Registra la aceptación del cliente para cerrar la entrega del proyecto' });
                return;
            }

            if (updateFields.length === 0 && !hasFinancialChanges) {
                res.status(400).json({ error: 'No valid fields to update' });
                return;
            }

            if (updateFields.length > 0) {
                const setClause = updateFields.map(field => `${field} = ?`).join(', ');
                const values = updateFields.map(field => updatesForFields[field]);
                values.push(id);

                await db.run(`
                    UPDATE projects
                    SET ${setClause}, updated_at = datetime('now')
                    WHERE id = ?
                `, values);
            }

            await this.upsertProjectFinancials(parseInt(id), financialInput);

            // Log activity
            await activityLogService.logActivity(
                req.user?.id,
                'project',
                parseInt(id),
                'updated',
                this.stripFinancialFieldsForLog(currentProject),
                this.stripFinancialFieldsForLog(updates)
            );

            // Get updated project with financial data
            const updatedProject = await db.get(`
                SELECT p.*,
                       u1.full_name as created_by_name,
                       u2.full_name as assigned_to_name,
                       c.name as client_name,
                       cc.name as client_contact_name,
                       sr.name as sales_rep_name,
                       pf.budgeted_cost,
                       pf.actual_cost as budget_spent,
                       pf.budgeted_hours as hours_budgeted,
                       0 as hours_spent,
                       pf.delay_cost,
                       pf.penalty_cost,
                       pf.sale_price
                FROM projects p
                LEFT JOIN users u1 ON p.created_by = u1.id
                LEFT JOIN users u2 ON p.assigned_to = u2.id
                LEFT JOIN clients c ON c.id = p.client_id
                LEFT JOIN client_contacts cc ON cc.id = p.client_contact_id
                LEFT JOIN sales_reps sr ON sr.id = p.sales_rep_id
                LEFT JOIN project_financials pf ON p.id = pf.project_id
                WHERE p.id = ?
            `, [id]);

            res.json(this.stripFinancialFields(req.user, updatedProject));
        } catch (error) {
            logger.error('Update project error:', error);
            res.status(500).json({ error: 'Failed to update project' });
        }
    };

    // DELETE /api/projects/:id
    deleteProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;

            // Only team leads can delete projects
            if (req.user?.role !== 'team_lead') {
                res.status(403).json({ error: 'Only team leads can delete projects' });
                return;
            }

            const project = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
            if (!project) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }

            // Delete project (cascading deletes will handle related records)
            await db.run('DELETE FROM projects WHERE id = ?', [id]);

            // Log activity
            await activityLogService.logActivity(
                req.user?.id,
                'project',
                parseInt(id),
                'deleted',
                this.stripFinancialFieldsForLog(project),
                null
            );

            res.json({ message: 'Project deleted successfully' });
        } catch (error) {
            logger.error('Delete project error:', error);
            res.status(500).json({ error: 'Failed to delete project' });
        }
    };

    // GET /api/projects/:id/gantt
    getProjectGantt = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;

            const project = await db.get('SELECT id, assigned_to, created_by FROM projects WHERE id = ?', [id]);

            if (!project) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }

            if (!this.hasProjectAccess(req.user, project)) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            // Get all tasks for the project with dependencies
            const tasks = await db.query(`
                SELECT 
                    t.*,
                    u.full_name as assignee_name,
                    tc.name as column_name
                FROM task_boards tb
                JOIN tasks t ON tb.id = t.board_id
                LEFT JOIN users u ON t.assignee_id = u.id
                LEFT JOIN task_columns tc ON t.column_id = tc.id
                WHERE tb.project_id = ?
                ORDER BY t.start_date ASC, t.created_at ASC
            `, [id]);

            // Get dependencies
            const dependencies = await db.query(`
                SELECT 
                    td.*,
                    t1.title as predecessor_title,
                    t2.title as successor_title
                FROM task_dependencies td
                JOIN tasks t1 ON td.predecessor_id = t1.id
                JOIN tasks t2 ON td.successor_id = t2.id
                JOIN task_boards tb1 ON t1.board_id = tb1.id
                JOIN task_boards tb2 ON t2.board_id = tb2.id
                WHERE tb1.project_id = ? OR tb2.project_id = ?
            `, [id, id]);

            res.json({
                tasks: tasks,
                dependencies: dependencies
            });
        } catch (error) {
            logger.error('Get project Gantt error:', error);
            res.status(500).json({ error: 'Failed to get project Gantt data' });
        }
    };

    // POST /api/projects/:id/baseline
    freezeBaseline = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const projectId = parseInt(req.params.id);
            const baseline = await projectHealthService.freezeBaseline(projectId, req.user!.id);
            res.status(201).json(baseline);
        } catch (error) {
            const message = (error as Error).message;
            if (message === 'PROJECT_NOT_FOUND') {
                res.status(404).json({ error: 'Project not found' });
            } else if (message === 'PROJECT_MISSING_DATES') {
                res.status(400).json({ error: 'Project must have start_date and end_date before freezing a baseline' });
            } else if (message === 'BASELINE_ALREADY_EXISTS') {
                res.status(409).json({ error: 'Baseline already exists for this project' });
            } else {
                logger.error('Freeze baseline error:', error);
                res.status(500).json({ error: 'Failed to freeze baseline' });
            }
        }
    };

    // GET /api/projects/:id/health
    getProjectHealth = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const projectId = parseInt(req.params.id);
            const project = await db.get('SELECT id, assigned_to, created_by FROM projects WHERE id = ?', [projectId]);

            if (!project) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }

            if (!this.hasProjectAccess(req.user, project)) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const health = await projectHealthService.getProjectHealth(projectId);
            res.json(health);
        } catch (error) {
            logger.error('Get project health error:', error);
            res.status(500).json({ error: 'Failed to get project health' });
        }
    };

    // GET /api/projects/:id/activity
    getProjectActivity = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const projectId = parseInt(req.params.id);
            const project = await db.get(
                'SELECT id, assigned_to, created_by FROM projects WHERE id = ?',
                [projectId]
            );

            if (!project) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }

            if (!this.hasProjectAccess(req.user, project)) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const parsedLimit = parseInt(req.query.limit as string);
            const parsedOffset = parseInt(req.query.offset as string);
            const limit = Math.min(Math.max(Number.isNaN(parsedLimit) ? 50 : parsedLimit, 1), 200);
            const offset = Math.max(Number.isNaN(parsedOffset) ? 0 : parsedOffset, 0);

            const activity = await activityLogService.getProjectActivity(projectId, { limit, offset });
            res.json(activity.map(entry => this.stripFinancialFieldsFromActivity(req.user, entry)));
        } catch (error) {
            logger.error('Get project activity error:', error);
            res.status(500).json({ error: 'Failed to get project activity' });
        }
    };

    private hasProjectAccess(
        user: AuthenticatedRequest['user'],
        project: { assigned_to: number | null; created_by: number }
    ): boolean {
        if (user?.role === 'rpa_developer' && project.assigned_to !== user.id && project.created_by !== user.id) {
            return false;
        }
        return true;
    }

    private canWriteProjectLog(
        user: AuthenticatedRequest['user'],
        project: { assigned_to: number | null; created_by: number }
    ): boolean {
        if (user?.role === 'team_lead') return true;
        return project.assigned_to === user?.id || project.created_by === user?.id;
    }

    // GET /api/projects/:id/log-entries - Bitácora inmutable del proyecto
    getProjectLogEntries = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const projectId = parseInt(req.params.id);
            const project = await db.get('SELECT id, assigned_to, created_by FROM projects WHERE id = ?', [projectId]);

            if (!project) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }
            if (!this.hasProjectAccess(req.user, project)) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const entries = await projectLogService.getForProject(projectId);
            res.json(entries);
        } catch (error) {
            logger.error('Get project log entries error:', error);
            res.status(500).json({ error: 'Failed to get project log entries' });
        }
    };

    // POST /api/projects/:id/log-entries - Agregar entrada a la bitácora (inmutable, sin edición/borrado)
    createProjectLogEntry = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const projectId = parseInt(req.params.id);
            const userId = req.user?.id as number;
            const { entry_type, description, file_id } = req.body;

            if (!ProjectController.LOG_ENTRY_TYPES.includes(entry_type)) {
                res.status(400).json({ error: 'Invalid entry_type' });
                return;
            }
            if (!description || typeof description !== 'string' || !description.trim()) {
                res.status(400).json({ error: 'Description is required' });
                return;
            }

            const project = await db.get('SELECT id, assigned_to, created_by FROM projects WHERE id = ?', [projectId]);
            if (!project) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }
            if (!this.hasProjectAccess(req.user, project)) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }
            if (!this.canWriteProjectLog(req.user, project)) {
                res.status(403).json({ error: 'Only the team lead or the project owner/responsible can write to the log' });
                return;
            }

            let fileId: number | null = null;
            if (file_id !== undefined && file_id !== null) {
                const parsedFileId = Number(file_id);
                if (!Number.isInteger(parsedFileId)) {
                    res.status(400).json({ error: 'Invalid file_id' });
                    return;
                }
                const file = await db.get('SELECT id, uploaded_by FROM files WHERE id = ?', [parsedFileId]);
                if (!file) {
                    res.status(400).json({ error: 'Invalid file_id' });
                    return;
                }
                if (file.uploaded_by !== userId) {
                    res.status(403).json({ error: 'You do not have access to this file' });
                    return;
                }
                fileId = parsedFileId;
            }

            const entry = await projectLogService.create(projectId, userId, entry_type, description, fileId);

            if (fileId) {
                await db.run(`INSERT INTO file_associations (file_id, entity_type, entity_id, association_type, created_by)
                    SELECT ?, 'project', ?, 'log_entry', ? WHERE NOT EXISTS (
                        SELECT 1 FROM file_associations WHERE file_id = ? AND entity_type = 'project' AND entity_id = ? AND association_type = 'log_entry'
                    )`, [fileId, projectId, userId, fileId, projectId]);
            }

            await activityLogService.logActivity(userId, 'log_entry', entry.id, 'created', null, entry);
            await activityLogService.logActivity(userId, 'project', projectId, 'log_entry_created', null, { log_entry_id: entry.id, entry_type });

            res.status(201).json(entry);
        } catch (error) {
            logger.error('Create project log entry error:', error);
            res.status(500).json({ error: 'Failed to create project log entry' });
        }
    };

    // GET /api/projects/:id/comments
    getProjectComments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const projectId = parseInt(req.params.id);
            const project = await db.get('SELECT id, assigned_to, created_by FROM projects WHERE id = ?', [projectId]);

            if (!project) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }
            if (!this.hasProjectAccess(req.user, project)) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const comments = await commentService.getForEntity('project', projectId);
            res.json(comments);
        } catch (error) {
            logger.error('Get project comments error:', error);
            res.status(500).json({ error: 'Failed to get comments' });
        }
    };

    // POST /api/projects/:id/comments
    createProjectComment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const projectId = parseInt(req.params.id);
            const userId = req.user?.id as number;
            const { content } = req.body;

            if (!content || typeof content !== 'string' || !content.trim()) {
                res.status(400).json({ error: 'Content is required' });
                return;
            }

            const project = await db.get('SELECT id, assigned_to, created_by FROM projects WHERE id = ?', [projectId]);
            if (!project) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }
            if (!this.hasProjectAccess(req.user, project)) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const comment = await commentService.create('project', projectId, userId, content);
            res.status(201).json(comment);
        } catch (error) {
            logger.error('Create project comment error:', error);
            res.status(500).json({ error: 'Failed to create comment' });
        }
    };

    // PATCH /api/projects/:id/comments/:commentId
    updateProjectComment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const projectId = parseInt(req.params.id);
            const commentId = parseInt(req.params.commentId);
            const userId = req.user?.id;
            const { content } = req.body;

            if (!content || typeof content !== 'string' || !content.trim()) {
                res.status(400).json({ error: 'Content is required' });
                return;
            }

            const project = await db.get('SELECT id, assigned_to, created_by FROM projects WHERE id = ?', [projectId]);
            if (!project) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }
            if (!this.hasProjectAccess(req.user, project)) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const comment = await commentService.findById(commentId);
            if (!comment || comment.entity_type !== 'project' || comment.entity_id !== projectId) {
                res.status(404).json({ error: 'Comment not found' });
                return;
            }
            if (comment.user_id !== userId) {
                res.status(403).json({ error: 'You can only edit your own comments' });
                return;
            }

            const updated = await commentService.update(commentId, content);
            res.json(updated);
        } catch (error) {
            logger.error('Update project comment error:', error);
            res.status(500).json({ error: 'Failed to update comment' });
        }
    };

    // DELETE /api/projects/:id/comments/:commentId
    deleteProjectComment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const projectId = parseInt(req.params.id);
            const commentId = parseInt(req.params.commentId);
            const userId = req.user?.id;

            const project = await db.get('SELECT id, assigned_to, created_by FROM projects WHERE id = ?', [projectId]);
            if (!project) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }
            if (!this.hasProjectAccess(req.user, project)) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const comment = await commentService.findById(commentId);
            if (!comment || comment.entity_type !== 'project' || comment.entity_id !== projectId) {
                res.status(404).json({ error: 'Comment not found' });
                return;
            }
            if (comment.user_id !== userId) {
                res.status(403).json({ error: 'You can only delete your own comments' });
                return;
            }

            await commentService.delete(commentId);
            res.json({ success: true, deletedId: commentId });
        } catch (error) {
            logger.error('Delete project comment error:', error);
            res.status(500).json({ error: 'Failed to delete comment' });
        }
    };

    // GET /api/projects/:id/mentionable-users - Users who can be @mentioned in comments on this project
    getProjectMentionableUsers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const projectId = parseInt(req.params.id);
            const project = await db.get('SELECT id, assigned_to, created_by FROM projects WHERE id = ?', [projectId]);

            if (!project) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }
            if (!this.hasProjectAccess(req.user, project)) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const users = await commentService.getMentionableUsers('project', projectId);
            res.json(users);
        } catch (error) {
            logger.error('Get project mentionable users error:', error);
            res.status(500).json({ error: 'Failed to get mentionable users' });
        }
    };

    // DEBUG: Temporary endpoint to check financial data
    debugFinancialData = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const projects = await db.query(`
                SELECT 
                    p.id, 
                    p.name, 
                    pf.sale_price, 
                    pf.budgeted_hours,
                    pf.budgeted_cost,
                    pf.updated_at as financial_updated
                FROM projects p 
                LEFT JOIN project_financials pf ON p.id = pf.project_id 
                ORDER BY p.id
            `);
            
            res.json(projects);
        } catch (error) {
            logger.error('Debug financial data error:', error);
            res.status(500).json({ error: 'Failed to get debug data' });
        }
    };

    // Clean duplicate financial records (keep only the latest one per project)
    cleanDuplicateFinancials = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            // Get count before cleaning
            const beforeCount = await db.get(`SELECT COUNT(*) as count FROM project_financials`);
            
            // Delete duplicates, keeping only the latest record per project
            await db.run(`
                DELETE FROM project_financials 
                WHERE id NOT IN (
                    SELECT MAX(id) 
                    FROM project_financials 
                    GROUP BY project_id
                )
            `);
            
            // Get count after cleaning
            const afterCount = await db.get(`SELECT COUNT(*) as count FROM project_financials`);
            
            const deleted = beforeCount.count - afterCount.count;
            
            res.json({
                message: 'Duplicate financial records cleaned successfully',
                records_before: beforeCount.count,
                records_after: afterCount.count,
                records_deleted: deleted
            });
        } catch (error) {
            logger.error('Clean duplicate financials error:', error);
            res.status(500).json({ error: 'Failed to clean duplicate records' });
        }
    };

    // === MULTI-USER ASSIGNMENT METHODS ===

    // GET /api/projects/:id/assignments
    getProjectAssignments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;

            const project = await db.get('SELECT id, assigned_to, created_by FROM projects WHERE id = ?', [id]);

            if (!project) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }

            if (!this.hasProjectAccess(req.user, project)) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const assignments = await db.query(`
                SELECT 
                    pa.*,
                    u.full_name,
                    u.role as user_role,
                    u.email,
                    ucr.monthly_cost,
                    ucr.hourly_rate
                FROM project_assignments pa
                JOIN users u ON pa.user_id = u.id
                LEFT JOIN user_cost_rates ucr ON pa.user_id = ucr.user_id AND ucr.is_active = 1
                WHERE pa.project_id = ? AND pa.is_active = 1
                ORDER BY pa.created_at ASC
            `, [id]);

            if (req.user?.role === 'team_lead') {
                res.json(assignments);
                return;
            }
            res.json(assignments.map(({ monthly_cost, hourly_rate, ...rest }: any) => rest));
        } catch (error) {
            logger.error('Get project assignments error:', error);
            res.status(500).json({ error: 'Failed to get project assignments' });
        }
    };

    private static readonly ASSIGNMENT_ROLES = ['lead', 'contributor', 'reviewer', 'observer'];

    // POST /api/projects/:id/assignments
    addProjectAssignments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const { user_assignments, responsible_user_id } = req.body;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({ error: 'User not authenticated' });
                return;
            }

            if (!Array.isArray(user_assignments) || user_assignments.length === 0) {
                res.status(400).json({ error: 'user_assignments array is required' });
                return;
            }

            const project = await db.get('SELECT id FROM projects WHERE id = ?', [id]);
            if (!project) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }

            // Validar todo ANTES de borrar: un payload inválido nunca debe dejar el proyecto sin equipo.
            const datePattern = /^\d{4}-\d{2}-\d{2}$/;
            const seen = new Set<number>();
            const normalized: Array<{ user_id: number; role: string; allocation_percentage: number; start_date: string | null; end_date: string | null; budgeted_hours: number | null }> = [];

            for (const assignment of user_assignments) {
                const { user_id, allocation_percentage = 100, role = 'contributor', start_date = null, end_date = null, budgeted_hours = null } = assignment || {};

                if (!Number.isInteger(user_id) || user_id <= 0) {
                    res.status(400).json({ error: 'Cada asignación requiere un user_id válido' });
                    return;
                }
                if (seen.has(user_id)) {
                    res.status(400).json({ error: `El usuario ${user_id} está repetido en la asignación` });
                    return;
                }
                if (!ProjectController.ASSIGNMENT_ROLES.includes(role)) {
                    res.status(400).json({ error: `Rol de asignación inválido: ${role}` });
                    return;
                }
                if (!Number.isInteger(allocation_percentage) || allocation_percentage < 0 || allocation_percentage > 100) {
                    res.status(400).json({ error: 'La dedicación debe ser un entero entre 0 y 100' });
                    return;
                }
                if (budgeted_hours !== null && (!Number.isFinite(Number(budgeted_hours)) || Number(budgeted_hours) < 0)) {
                    res.status(400).json({ error: 'Las horas presupuestadas deben ser un número mayor o igual a cero' });
                    return;
                }
                if ((start_date !== null && !datePattern.test(start_date)) || (end_date !== null && !datePattern.test(end_date))) {
                    res.status(400).json({ error: 'Las fechas deben tener formato YYYY-MM-DD' });
                    return;
                }
                const userExists = await db.get('SELECT id FROM users WHERE id = ? AND is_active = 1', [user_id]);
                if (!userExists) {
                    res.status(400).json({ error: `El usuario ${user_id} no existe o está inactivo` });
                    return;
                }

                seen.add(user_id);
                normalized.push({ user_id, role, allocation_percentage, start_date, end_date, budgeted_hours: budgeted_hours === null ? null : Number(budgeted_hours) });
            }

            const responsibleId = responsible_user_id ?? normalized.find(a => a.role === 'lead')?.user_id ?? normalized[0].user_id;
            if (!seen.has(responsibleId)) {
                res.status(400).json({ error: 'El responsable debe pertenecer al equipo asignado' });
                return;
            }

            await db.beginTransaction();
            try {
                await db.run('UPDATE projects SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [responsibleId, id]);
                await db.run('DELETE FROM project_assignments WHERE project_id = ?', [id]);

                const newAssignments = [];
                for (const a of normalized) {
                    const result = await db.run(`
                        INSERT INTO project_assignments (
                            project_id, user_id, role, allocation_percentage, start_date, end_date, assigned_by, is_active, budgeted_hours
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
                    `, [id, a.user_id, a.role, a.allocation_percentage, a.start_date, a.end_date, userId, a.budgeted_hours]);

                    newAssignments.push({ id: result.id, project_id: Number(id), ...a, assigned_by: userId, is_active: 1 });
                }

                await db.commit();

                logger.info(`Added ${newAssignments.length} assignments to project ${id}`);
                res.status(201).json({
                    message: 'Project assignments updated successfully',
                    assignments: newAssignments
                });
            } catch (error) {
                await db.rollback();
                throw error;
            }
        } catch (error) {
            logger.error('Add project assignments error:', error);
            res.status(500).json({ error: 'Failed to update project assignments' });
        }
    };

    // DELETE /api/projects/:id/assignments/:assignmentId
    removeProjectAssignment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id, assignmentId } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({ error: 'User not authenticated' });
                return;
            }

            // Verify assignment exists and belongs to the project
            const assignment = await db.get(`
                SELECT * FROM project_assignments 
                WHERE id = ? AND project_id = ? AND is_active = 1
            `, [assignmentId, id]);

            if (!assignment) {
                res.status(404).json({ error: 'Assignment not found' });
                return;
            }

            // Deactivate assignment instead of deleting (for audit trail)
            await db.run(`
                UPDATE project_assignments 
                SET is_active = 0 
                WHERE id = ?
            `, [assignmentId]);

            logger.info(`Removed assignment ${assignmentId} from project ${id}`);
            res.json({ message: 'Assignment removed successfully' });

        } catch (error) {
            logger.error('Remove project assignment error:', error);
            res.status(500).json({ error: 'Failed to remove project assignment' });
        }
    };

    // === QUOTE UPLOAD ENDPOINTS ===

    // POST /api/projects/upload-quote - Upload and process quote document
    uploadQuote = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        let uploadedFilePath: string | undefined;

        try {
            logger.info('=== Upload Quote Request Started ===');
            logger.info(`Request body:`, req.body);
            logger.info(`Request file:`, req.file ? 'File present' : 'NO FILE');
            logger.info(`Request user:`, req.user ? `User ID ${req.user.id}` : 'NO USER');

            const userId = req.user?.id;
            const provider = req.body.provider as string | undefined;

            if (!userId) {
                logger.error('Authentication failed: No user ID');
                res.status(401).json({ error: 'User not authenticated' });
                return;
            }

            // Check if file was uploaded
            if (!req.file) {
                logger.error('File upload failed: No file in request');
                res.status(400).json({ error: 'No file uploaded' });
                return;
            }

            const file = req.file;
            uploadedFilePath = file.path;

            logger.info(`Processing quote upload: ${file.originalname}, Size: ${file.size} bytes, User: ${userId}`);

            // Validate file type
            if (!this.documentParserService.validateFileType(file.mimetype, file.originalname)) {
                await this.documentParserService.cleanupFile(uploadedFilePath);
                res.status(400).json({
                    error: 'Invalid file type. Only PDF and DOCX files are allowed.'
                });
                return;
            }

            // Validate file size (10MB limit)
            const maxSize = 10 * 1024 * 1024; // 10MB
            if (file.size > maxSize) {
                await this.documentParserService.cleanupFile(uploadedFilePath);
                res.status(400).json({
                    error: 'File too large. Maximum size is 10MB.'
                });
                return;
            }

            // Extract quote data using LLM
            const quoteData = await this.llmService.extractQuoteDataFromDocument(
                uploadedFilePath,
                userId,
                provider
            );

            // Persistir el archivo en vez de borrarlo, para poder asociarlo a la version de cotizacion que el usuario confirme despues.
            const fileBuffer = await fs.promises.readFile(uploadedFilePath);
            const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
            const fileExtension = path.extname(file.originalname).toLowerCase().substring(1);

            const existingFile = await db.get('SELECT id FROM files WHERE file_hash = ? AND is_deleted = 0', [fileHash]);
            let fileId: number;
            if (existingFile) {
                fileId = existingFile.id;
                await this.documentParserService.cleanupFile(uploadedFilePath);
            } else {
                const inserted = await db.run(`
                    INSERT INTO files (
                        filename, original_filename, file_path, file_size, mime_type,
                        file_extension, file_hash, uploaded_by, description, is_public
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                `, [
                    file.filename, file.originalname, uploadedFilePath, file.size, file.mimetype,
                    fileExtension, fileHash, userId, 'Cotizacion leida con IA'
                ]);
                fileId = inserted.id!;
            }

            logger.info('Quote processed successfully', {
                project_name: quoteData.project_name,
                user_id: userId,
                file_id: fileId
            });

            res.status(200).json({
                message: 'Quote processed successfully',
                quote_data: quoteData,
                file_id: fileId
            });

        } catch (error) {
            // Clean up file on error
            if (uploadedFilePath) {
                await this.documentParserService.cleanupFile(uploadedFilePath);
            }

            logger.error('Upload quote error:', error);
            res.status(500).json({
                error: error instanceof Error ? error.message : 'Failed to process quote document'
            });
        }
    };

    // POST /api/projects/from-quote - Create project from extracted quote data
    createProjectFromQuote = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const userId = req.user?.id;
            const { quote_data } = req.body as { quote_data: QuoteData };

            if (!userId) {
                res.status(401).json({ error: 'User not authenticated' });
                return;
            }

            if (!quote_data) {
                res.status(400).json({ error: 'Quote data is required' });
                return;
            }

            // Validate required fields
            if (!quote_data.project_name || !quote_data.description || !quote_data.client_name) {
                res.status(400).json({
                    error: 'Missing required fields: project_name, description, client_name'
                });
                return;
            }

            logger.info('Creating project from quote data', {
                project_name: quote_data.project_name,
                user_id: userId
            });

            // Start transaction
            await db.beginTransaction();

            try {
                // 1. Create project (nace en ejecución: la cotización ya está aprobada, igual que approveByClient)
                const projectResult = await db.run(`
                    INSERT INTO projects (
                        name, description, status, priority,
                        start_date, end_date, created_by,
                        commercial_stage, client_approved_at
                    ) VALUES (?, ?, 'active', ?, ?, ?, ?, 'approved', datetime('now'))
                `, [
                    quote_data.project_name,
                    `${quote_data.description}\n\nClient: ${quote_data.client_name}`,
                    quote_data.priority || 'medium',
                    quote_data.estimated_start_date || null,
                    quote_data.estimated_end_date || null,
                    userId
                ]);

                const projectId = projectResult.id!;

                // 2. Create financial record if budget/revenue provided
                if (quote_data.budgeted_cost || quote_data.expected_revenue) {
                    await db.run(`
                        INSERT INTO project_financials (
                            project_id, budgeted_cost, sale_price, budgeted_hours
                        ) VALUES (?, ?, ?, ?)
                    `, [
                        projectId,
                        quote_data.budgeted_cost || null,
                        quote_data.expected_revenue || null,
                        null
                    ]);
                }

                // 3. Create default task board
                const boardResult = await db.run(`
                    INSERT INTO task_boards (
                        project_id, name, description, board_type, is_default
                    ) VALUES (?, ?, ?, 'kanban', 1)
                `, [
                    projectId,
                    `${quote_data.project_name} Board`,
                    `Main kanban board for ${quote_data.project_name}`
                ]);

                const boardId = boardResult.id!;

                // 4. Create default columns
                const defaultColumns = [
                    { name: 'Backlog', position: 1, color: '#gray', is_done: 0 },
                    { name: 'To Do', position: 2, color: '#blue', is_done: 0 },
                    { name: 'In Progress', position: 3, color: '#yellow', is_done: 0, wip_limit: 3 },
                    { name: 'Review', position: 4, color: '#orange', is_done: 0 },
                    { name: 'Testing', position: 5, color: '#purple', is_done: 0 },
                    { name: 'Done', position: 6, color: '#green', is_done: 1 }
                ];

                const columnIds: { [key: string]: number } = {};

                for (const column of defaultColumns) {
                    const colResult = await db.run(`
                        INSERT INTO task_columns (
                            board_id, name, position, color, is_done_column, wip_limit
                        ) VALUES (?, ?, ?, ?, ?, ?)
                    `, [
                        boardId,
                        column.name,
                        column.position,
                        column.color,
                        column.is_done,
                        column.wip_limit || null
                    ]);
                    columnIds[column.name] = colResult.id!;
                }

                // 5. Create tasks from quote data
                if (quote_data.tasks && quote_data.tasks.length > 0) {
                    for (let i = 0; i < quote_data.tasks.length; i++) {
                        const task = quote_data.tasks[i];
                        await db.run(`
                            INSERT INTO tasks (
                                board_id, column_id, title, description,
                                status, priority, position, estimated_hours, reporter_id
                            ) VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?)
                        `, [
                            boardId,
                            columnIds['To Do'],
                            task.title,
                            task.description || null,
                            task.priority || 'medium',
                            i,
                            task.estimated_hours || null,
                            userId
                        ]);
                    }
                }

                // 6. Create milestones from quote data
                if (quote_data.milestones && quote_data.milestones.length > 0) {
                    const fallbackDate = quote_data.estimated_end_date || new Date().toISOString().slice(0, 10);
                    for (const milestone of quote_data.milestones) {
                        await db.run(`
                            INSERT INTO project_milestones (
                                project_id, name, description, planned_date, status
                            ) VALUES (?, ?, ?, ?, 'pending')
                        `, [
                            projectId,
                            milestone.name,
                            milestone.description || null,
                            milestone.target_date || fallbackDate
                        ]);
                    }
                }

                // 7. Log activity
                await activityLogService.logActivity(
                    userId,
                    'project',
                    projectId,
                    'created_from_quote',
                    null,
                    {
                        project_name: quote_data.project_name,
                        client: quote_data.client_name,
                        tasks_count: (quote_data.tasks ?? []).length,
                        milestones_count: (quote_data.milestones ?? []).length
                    }
                );

                // Commit transaction
                await db.commit();

                // Get created project with details
                const createdProject = await db.get(`
                    SELECT p.*, u.full_name as created_by_name
                    FROM projects p
                    LEFT JOIN users u ON p.created_by = u.id
                    WHERE p.id = ?
                `, [projectId]);

                logger.info('Project created from quote successfully', {
                    project_id: projectId,
                    project_name: quote_data.project_name
                });

                res.status(201).json({
                    message: 'Project created successfully from quote',
                    project: createdProject,
                    tasks_created: (quote_data.tasks ?? []).length,
                    milestones_created: (quote_data.milestones ?? []).length
                });

            } catch (error) {
                await db.rollback();
                throw error;
            }

        } catch (error) {
            logger.error('Create project from quote error:', error);
            res.status(500).json({
                error: error instanceof Error ? error.message : 'Failed to create project from quote'
            });
        }
    };
}
