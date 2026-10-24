import { Request, Response } from 'express';
import { db } from '../database/database';
import { logger } from '../utils/logger';
import { activityLogService } from '../services/activityLogService';
import { financeService, Currency, ProjectFinancials } from '../services/financeService';
import { billingService } from '../services/billingService';
import { timesheetService } from '../services/timesheetService';
import { isRealizedSale } from '../services/portfolioService';

interface AuthenticatedRequest extends Request {
    user?: {
        id: number;
        email: string;
        role: string;
        full_name: string;
    };
}

type SuiteRow = Record<string, unknown>;

/** Respuesta de GET /pmo/executive-suite; solo tipa las secciones que stripFinancials recorre. */
export interface ExecutiveSuiteResponse {
    general_manager: { consolidated_pnl: SuiteRow; top_risk_projects: SuiteRow[] } & SuiteRow;
    commercial: { scope_creep_alerts: SuiteRow[] } & SuiteRow;
    controller: { triple_conciliation: SuiteRow[] } & SuiteRow;
}

/** Decisión de producto: sueldos, HH, costos y márgenes solo los ve team_lead (Facturación ve hitos y facturas). */
const FINANCIAL_ROLES = ['team_lead'];
const canSeeFinancials = (role: string | undefined): boolean => role !== undefined && FINANCIAL_ROLES.includes(role);

const omit = (row: SuiteRow, keys: string[]): SuiteRow =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));

/**
 * Quita de la respuesta del Centro PMO ejecutivo todo costo, utilidad, margen y CPI (derivado del costo) cuando
 * el rol no es team_lead; un rol ausente o desconocido se trata como sin permiso. No modifica el objeto recibido.
 * Se conserva lo de cobranza: hitos, facturas, cartera vencida, aging e imputación por centro de costo (reparte el
 * monto de venta del proyecto, no es costo interno), y las alertas, riesgos, scope creep e imputaciones faltantes.
 */
export const stripFinancials = (data: ExecutiveSuiteResponse, role: string | undefined): ExecutiveSuiteResponse => {
    if (canSeeFinancials(role)) return data;
    return {
        general_manager: {
            ...data.general_manager,
            consolidated_pnl: omit(data.general_manager.consolidated_pnl, ['total_real_cost_clp', 'total_gross_profit_clp', 'avg_margin_pct']),
            top_risk_projects: data.general_manager.top_risk_projects.map(project =>
                omit(project, ['cost_variance_clp', 'real_cost_clp', 'budgeted_cost_clp'])
            )
        },
        commercial: {
            ...omit(data.commercial, ['margin_variance']),
            scope_creep_alerts: data.commercial.scope_creep_alerts.map(alert => omit(alert, ['overrun_cost_clp']))
        },
        controller: {
            ...data.controller,
            triple_conciliation: data.controller.triple_conciliation.map(row =>
                omit(row, ['cost_consumed_pct', 'cpi', 'budgeted_cost_clp', 'real_cost_clp'])
            )
        }
    };
};

/** Diagnóstico de un proyecto en alerta; el monto del sobrecosto solo se escribe para quien puede ver costos. */
const describeCriticalReason = (costVarianceCLP: number, schedVar: number, riskLevel: string, showAmounts: boolean): string => {
    const overrun = showAmounts ? `Sobrecosto de $${Math.round(costVarianceCLP).toLocaleString('es-CL')}` : 'Sobrecosto';
    if (costVarianceCLP > 0 && schedVar > 5) return `${overrun} y retraso de ${schedVar} días`;
    if (costVarianceCLP > 0) return `${overrun} sobre presupuesto`;
    if (schedVar > 5) return `Retraso crítico de ${schedVar} días frente a la fecha comprometida`;
    if (riskLevel === 'critical' || riskLevel === 'high') return `Alerta de riesgo operativo ${riskLevel.toUpperCase()}`;
    return 'En curso regular';
};

export class PMOController {
    // GET /api/pmo/dashboard - Main PMO dashboard data
    getPMODashboard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            // Get all projects with PMO metrics
            const projects = await db.query(`
                SELECT 
                    p.*,
                    pm.completion_percentage,
                    pm.schedule_variance_days,
                    pm.cost_variance_percentage,
                    pm.risk_level,
                    pm.planned_hours,
                    pm.actual_hours,
                    pm.planned_budget,
                    pm.actual_cost,
                    pm.team_velocity,
                    pm.bugs_found,
                    pm.bugs_resolved,
                    pm.client_satisfaction_score,
                    u.full_name as assigned_to_name,
                    c.name as client_name,
                    CASE 
                        WHEN pm.schedule_variance_days > 5 OR pm.cost_variance_percentage > 20 OR pm.risk_level = 'critical' THEN 'critical'
                        WHEN pm.schedule_variance_days > 2 OR pm.cost_variance_percentage > 10 OR pm.risk_level = 'high' THEN 'warning'
                        ELSE 'healthy'
                    END as project_health_status,
                    -- Calculate days until deadline
                    CASE 
                        WHEN p.end_date IS NOT NULL THEN 
                            CAST((julianday(p.end_date) - julianday('now')) AS INTEGER)
                        ELSE NULL
                    END as days_to_deadline,
                    -- Count milestones
                    (SELECT COUNT(*) FROM project_milestones WHERE project_id = p.id) as total_milestones,
                    (SELECT COUNT(*) FROM project_milestones WHERE project_id = p.id AND status = 'completed') as completed_milestones
                FROM projects p
                LEFT JOIN project_pmo_metrics pm ON p.id = pm.project_id
                LEFT JOIN users u ON p.assigned_to = u.id
                LEFT JOIN clients c ON p.client_id = c.id
                WHERE p.status != 'cancelled'
                ORDER BY 
                    CASE 
                        WHEN pm.risk_level = 'critical' THEN 1
                        WHEN pm.risk_level = 'high' THEN 2
                        WHEN pm.risk_level = 'medium' THEN 3
                        ELSE 4
                    END,
                    p.priority DESC,
                    p.end_date ASC
            `);

            // Get overall PMO metrics
            const overallMetrics = await db.get(`
                SELECT 
                    COUNT(DISTINCT p.id) as total_projects,
                    COUNT(CASE WHEN p.status = 'active' THEN 1 END) as active_projects,
                    COUNT(CASE WHEN pm.risk_level = 'critical' THEN 1 END) as critical_projects,
                    COUNT(CASE WHEN pm.schedule_variance_days < -2 THEN 1 END) as delayed_projects,
                    AVG(pm.completion_percentage) as avg_completion,
                    SUM(pm.planned_budget) as total_planned_budget,
                    SUM(pm.actual_cost) as total_actual_cost,
                    AVG(pm.client_satisfaction_score) as avg_satisfaction
                FROM projects p
                LEFT JOIN project_pmo_metrics pm ON p.id = pm.project_id
                WHERE p.status != 'cancelled'
            `);

            // Get upcoming milestones (all pending/in_progress milestones)
            const upcomingMilestones = await db.query(`
                SELECT 
                    m.*,
                    p.name as project_name,
                    p.priority as project_priority,
                    u.full_name as responsible_name,
                    CAST((julianday(m.planned_date) - julianday('now')) AS INTEGER) as days_until
                FROM project_milestones m
                JOIN projects p ON m.project_id = p.id
                LEFT JOIN users u ON m.responsible_user_id = u.id
                WHERE m.status IN ('pending', 'in_progress')
                ORDER BY m.planned_date ASC
                LIMIT 15
            `);

            // Get team workload distribution (tareas activas por persona, dato vivo de la tabla tasks)
            const teamWorkload = await db.query(`
                SELECT
                    u.id,
                    u.full_name,
                    u.role,
                    COUNT(t.id) as active_tasks
                FROM users u
                JOIN task_assignees ta ON ta.user_id = u.id
                JOIN tasks t ON t.id = ta.task_id AND t.status != 'done'
                WHERE u.is_active = 1
                GROUP BY u.id, u.full_name, u.role
                HAVING COUNT(t.id) > 0
                ORDER BY active_tasks DESC
            `);

            const teamCapacity = await db.query(`
                SELECT u.id, u.full_name, u.role,
                       ROUND(COALESCE(SUM(CASE WHEN p.id IS NOT NULL THEN pa.allocation_percentage ELSE 0 END), 0) / 100.0, 2) AS planned_fte,
                       COALESCE(SUM(CASE WHEN p.id IS NOT NULL THEN pa.budgeted_hours ELSE 0 END), 0) AS budgeted_hours,
                       COUNT(DISTINCT CASE WHEN p.id IS NOT NULL THEN pa.project_id END) AS assigned_projects
                FROM users u
                LEFT JOIN project_assignments pa ON pa.user_id = u.id AND pa.is_active = 1
                LEFT JOIN projects p ON p.id = pa.project_id AND p.status IN ('active', 'on_hold') AND COALESCE(p.commercial_stage, 'approved') <> 'lost'
                  AND (pa.start_date IS NULL OR date(pa.start_date) <= date('now'))
                  AND (pa.end_date IS NULL OR date(pa.end_date) >= date('now'))
                WHERE u.is_active = 1 AND u.role IN ('rpa_developer', 'rpa_operations', 'team_lead')
                GROUP BY u.id, u.full_name, u.role
                ORDER BY planned_fte DESC, u.full_name
            `);

            res.json({
                projects,
                overallMetrics,
                upcomingMilestones,
                teamWorkload,
                teamCapacity
            });
        } catch (error) {
            logger.error('Get PMO dashboard error:', error);
            res.status(500).json({ error: 'Failed to get PMO dashboard data' });
        }
    };

    // GET /api/pmo/projects/:id/gantt - Gantt chart data for specific project
    getProjectGantt = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            logger.info(`Loading Gantt data for project: ${id}`);

            // Get project basic info
            const project = await db.get(`
                SELECT 
                    p.id,
                    p.name,
                    p.description,
                    p.status,
                    p.priority,
                    p.budget,
                    p.start_date,
                    p.end_date,
                    p.actual_start_date,
                    p.actual_end_date,
                    p.progress_percentage,
                    p.created_by,
                    p.assigned_to,
                    u.full_name as assigned_to_name,
                    c.name as client_name,
                    p.created_at,
                    p.updated_at,
                    pm.planned_hours,
                    pm.planned_start_date,
                    pm.planned_end_date,
                    pm.planned_budget,
                    pm.actual_hours,
                    pm.actual_cost,
                    pm.completion_percentage as pmo_completion_percentage,
                    pm.schedule_variance_days,
                    pm.cost_variance_percentage,
                    pm.scope_variance_percentage,
                    pm.risk_level,
                    pm.risk_factors,
                    pm.bugs_found,
                    pm.bugs_resolved,
                    pm.client_satisfaction_score,
                    pm.team_velocity,
                    pm.last_updated,
                    pm.updated_by
                FROM projects p
                LEFT JOIN project_pmo_metrics pm ON p.id = pm.project_id
                LEFT JOIN users u ON p.assigned_to = u.id
                LEFT JOIN clients c ON p.client_id = c.id
                WHERE p.id = ?
            `, [id]);

            if (!project) {
                logger.warn(`Project not found: ${id}`);
                res.status(404).json({ error: 'Project not found' });
                return;
            }

            logger.info(`Project found: ${project.name}`);

            // Get all tasks for the project
            const tasks = await db.query(`
                SELECT
                    t.*,
                    tc.name as column_name,
                    u.full_name as assignee_name,
                    tas.assignee_ids,
                    tas.assignee_names,
                    COALESCE(SUM(te.hours), 0) as actual_hours,
                    t.estimated_hours as planned_hours
                FROM tasks t
                LEFT JOIN task_columns tc ON t.column_id = tc.id
                LEFT JOIN users u ON t.assignee_id = u.id
                LEFT JOIN time_entries te ON t.id = te.task_id
                LEFT JOIN (
                    SELECT
                        ta.task_id,
                        GROUP_CONCAT(ta.user_id, '||') as assignee_ids,
                        GROUP_CONCAT(u_ta.full_name, '||') as assignee_names
                    FROM task_assignees ta
                    JOIN users u_ta ON ta.user_id = u_ta.id
                    GROUP BY ta.task_id
                ) tas ON t.id = tas.task_id
                WHERE t.board_id IN (SELECT id FROM task_boards WHERE project_id = ?)
                GROUP BY t.id
                ORDER BY t.position
            `, [id]);

            logger.info(`Found ${tasks.length} tasks`);

            // Get milestones
            const milestones = await db.query(`
                SELECT 
                    m.*,
                    u.full_name as responsible_name
                FROM project_milestones m
                LEFT JOIN users u ON m.responsible_user_id = u.id
                WHERE m.project_id = ?
                ORDER BY m.planned_date
            `, [id]);

            logger.info(`Found ${milestones.length} milestones`);

            // Get project baseline (Fase 4 - puede no existir todavía)
            const baseline = await db.get(
                `SELECT start_date, end_date FROM project_baselines WHERE project_id = ?`,
                [id]
            );

            // Get project dependencies
            const projectDependencies = await db.query(`
                SELECT 
                    pd.*,
                    sp.name as source_project_name,
                    dp.name as dependent_project_name
                FROM project_dependencies pd
                JOIN projects sp ON pd.source_project_id = sp.id
                JOIN projects dp ON pd.dependent_project_id = dp.id
                WHERE pd.source_project_id = ? OR pd.dependent_project_id = ?
            `, [id, id]);

            logger.info(`Found ${projectDependencies.length} project dependencies`);

            // Get task dependencies
            const taskDependencies = await db.query(`
                SELECT 
                    td.*,
                    pt.title as predecessor_title,
                    st.title as successor_title
                FROM task_dependencies td
                JOIN tasks pt ON td.predecessor_id = pt.id
                JOIN tasks st ON td.successor_id = st.id
                WHERE pt.board_id IN (SELECT id FROM task_boards WHERE project_id = ?)
                   OR st.board_id IN (SELECT id FROM task_boards WHERE project_id = ?)
            `, [id, id]);

            logger.info(`Found ${taskDependencies.length} task dependencies`);

            // Calculate completion percentage based on milestones and tasks
            let totalItems = 0;
            let completedItems = 0;

            // Count completed milestones
            if (milestones.length > 0) {
                totalItems += milestones.length;
                completedItems += milestones.filter((m: any) => m.status === 'completed').length;
            }

            // Count completed tasks
            if (tasks.length > 0) {
                totalItems += tasks.length;
                completedItems += tasks.filter((t: any) => t.status === 'done').length;
            }

            // Calculate completion percentage
            const calculatedCompletion = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

            // Update project with calculated completion if different from stored
            const projectWithCompletion = {
                ...project,
                completion_percentage: calculatedCompletion,
                baseline: baseline || null
            };

            logger.info(`Calculated completion: ${calculatedCompletion}% (${completedItems}/${totalItems} items completed)`);

            const result = {
                project: projectWithCompletion,
                tasks,
                milestones,
                projectDependencies,
                taskDependencies
            };

            logger.info(`Gantt data successfully loaded for project ${id}`);
            res.json(result);
        } catch (error) {
            logger.error('Get project Gantt error:', error);
            res.status(500).json({ error: 'Failed to get project Gantt data' });
        }
    };

    // POST /api/pmo/milestones - Create milestone
    createMilestone = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const {
                project_id,
                name,
                description,
                milestone_type,
                planned_date,
                end_date,
                priority,
                responsible_user_id,
                impact_on_timeline,
                responsibility,
                blocking_reason,
                delay_justification,
                external_contact,
                estimated_delay_days,
                financial_impact
            } = req.body;

            if (!project_id || !name || !planned_date) {
                res.status(400).json({ error: 'Missing required fields: project_id, name, planned_date' });
                return;
            }

            // Map frontend responsibility values to database values
            let mappedResponsibility = responsibility;
            if (responsibility === 'cliente' || responsibility === 'client') {
                mappedResponsibility = 'external';
            } else if (responsibility === 'interno' || responsibility === 'internal') {
                mappedResponsibility = 'internal';
            } else if (responsibility === 'compartido' || responsibility === 'shared') {
                mappedResponsibility = 'shared';
            }

            const result = await db.run(`
                INSERT INTO project_milestones (
                    project_id, name, description, milestone_type, planned_date, end_date,
                    priority, responsible_user_id, impact_on_timeline, responsibility,
                    blocking_reason, delay_justification, external_contact, 
                    estimated_delay_days, financial_impact, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                project_id, name, description, milestone_type || 'delivery', planned_date, end_date || planned_date,
                priority || 'medium', responsible_user_id, impact_on_timeline || 0, 
                mappedResponsibility || 'internal', blocking_reason, delay_justification, 
                external_contact, estimated_delay_days || 0, financial_impact || 0, req.user?.id
            ]);

            const newMilestone = await db.get(`
                SELECT m.*, u.full_name as responsible_name, p.name as project_name
                FROM project_milestones m
                LEFT JOIN users u ON m.responsible_user_id = u.id
                LEFT JOIN projects p ON m.project_id = p.id
                WHERE m.id = ?
            `, [result.id]);

            await activityLogService.logActivity(req.user?.id, 'milestone', Number(result.id), 'created', null, newMilestone);
            await activityLogService.logActivity(req.user?.id, 'project', Number(project_id), 'milestone_created', null, {
                milestone_id: result.id,
                name,
                planned_date,
                status: newMilestone.status
            });

            logger.info(`Milestone created: ${name} for project ${project_id}`);
            res.status(201).json(newMilestone);
        } catch (error) {
            logger.error('Create milestone error:', error);
            res.status(500).json({ error: 'Failed to create milestone' });
        }
    };

    // PUT /api/pmo/milestones/:id - Update milestone
    updateMilestone = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const updates = req.body;

            const existing = await db.get(`SELECT * FROM project_milestones WHERE id = ?`, [id]);
            if (!existing) {
                res.status(404).json({ error: 'Milestone not found' });
                return;
            }

            // Remove fields that shouldn't be updated directly
            delete updates.id;
            delete updates.created_by;
            delete updates.created_at;
            
            // Map frontend responsibility values to database values
            console.log('🔍 Original responsibility value:', updates.responsibility);
            if (updates.responsibility === 'cliente' || updates.responsibility === 'client') {
                updates.responsibility = 'external';
                console.log('✅ Mapped to external');
            } else if (updates.responsibility === 'interno' || updates.responsibility === 'internal') {
                updates.responsibility = 'internal';
                console.log('✅ Mapped to internal');
            } else if (updates.responsibility === 'compartido' || updates.responsibility === 'shared') {
                updates.responsibility = 'shared';
                console.log('✅ Mapped to shared');
            } else if (updates.responsibility) {
                console.log('⚠️ Unmapped responsibility value:', updates.responsibility);
            }

            const fields = [];
            const values = [];

            for (const [key, value] of Object.entries(updates)) {
                fields.push(`${key} = ?`);
                values.push(value);
            }

            if (fields.length === 0) {
                res.status(400).json({ error: 'No fields to update' });
                return;
            }

            fields.push('updated_at = datetime(\'now\')');
            values.push(id);

            await db.run(`
                UPDATE project_milestones 
                SET ${fields.join(', ')} 
                WHERE id = ?
            `, values);

            const updatedMilestone = await db.get(`
                SELECT m.*, u.full_name as responsible_name, p.name as project_name
                FROM project_milestones m
                LEFT JOIN users u ON m.responsible_user_id = u.id
                LEFT JOIN projects p ON m.project_id = p.id
                WHERE m.id = ?
            `, [id]);

            await activityLogService.logActivity(req.user?.id, 'milestone', Number(id), 'updated', existing, updatedMilestone);

            const statusChanged = existing.status !== updatedMilestone.status;
            const dateChanged = existing.planned_date !== updatedMilestone.planned_date;
            if (statusChanged || dateChanged) {
                await activityLogService.logActivity(req.user?.id, 'project', existing.project_id, 'milestone_updated', {
                    status: existing.status,
                    planned_date: existing.planned_date
                }, {
                    status: updatedMilestone.status,
                    planned_date: updatedMilestone.planned_date
                });
            }

            logger.info(`Milestone updated: ${id}`);
            res.json(updatedMilestone);
        } catch (error) {
            logger.error('Update milestone error:', error);
            res.status(500).json({ error: 'Failed to update milestone' });
        }
    };

    // DELETE /api/pmo/milestones/:id - Delete milestone
    deleteMilestone = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const userId = req.user?.id;

            // Use EXCLUSIVE transaction to prevent all concurrent access during deletion
            await db.beginTransaction('EXCLUSIVE');
            
            try {
                // First, perform atomic existence check
                const existsCheck = await db.get(`
                    SELECT id, name, project_id, status, planned_date FROM project_milestones WHERE id = ?
                `, [id]);

                if (!existsCheck) {
                    await db.rollback();
                    res.status(404).json({ 
                        error: 'Milestone not found or already deleted',
                        code: 'MILESTONE_NOT_FOUND'
                    });
                    return;
                }

                // Store milestone name for logging before deletion
                const milestoneName = existsCheck.name;

                // Perform atomic deletion with double-verification to prevent race conditions
                const deleteResult = await db.run(`
                    DELETE FROM project_milestones 
                    WHERE id = ? AND id IN (SELECT id FROM project_milestones WHERE id = ?)
                `, [id, id]);
                
                if (deleteResult.changes === 0) {
                    await db.rollback();
                    res.status(409).json({ 
                        error: 'Concurrent modification detected - milestone may have been deleted by another process',
                        code: 'CONCURRENT_MODIFICATION'
                    });
                    return;
                }

                await db.commit();

                await activityLogService.logActivity(userId, 'milestone', Number(id), 'deleted', existsCheck, null);
                await activityLogService.logActivity(userId, 'project', existsCheck.project_id, 'milestone_deleted', {
                    milestone_id: id,
                    name: milestoneName,
                    status: existsCheck.status,
                    planned_date: existsCheck.planned_date
                }, null);

                logger.info(`Milestone deleted successfully: ${id} (${milestoneName}) by user ${userId}`);
                res.json({
                    success: true,
                    message: 'Milestone deleted successfully',
                    deletedId: id
                });
                
            } catch (transactionError) {
                await db.rollback();
                logger.error('Transaction error during milestone deletion:', transactionError);
                throw transactionError;
            }
            
        } catch (error) {
            logger.error('Delete milestone error:', error);
            
            // Provide specific error codes for frontend handling
            const errorMessage = (error as Error)?.message || 'Unknown error';
            if (errorMessage.includes('database is locked') || errorMessage.includes('SQLITE_BUSY')) {
                res.status(409).json({ 
                    error: 'Database temporarily locked, please try again',
                    code: 'DATABASE_LOCKED'
                });
            } else if (errorMessage.includes('no such table') || errorMessage.includes('SQLITE_ERROR')) {
                res.status(500).json({ 
                    error: 'Database schema error',
                    code: 'DATABASE_SCHEMA_ERROR'
                });
            } else if (errorMessage.includes('FOREIGN KEY constraint failed')) {
                res.status(409).json({ 
                    error: 'Cannot delete milestone due to existing dependencies',
                    code: 'DEPENDENCY_CONSTRAINT'
                });
            } else {
                res.status(500).json({ 
                    error: 'Failed to delete milestone',
                    code: 'INTERNAL_ERROR'
                });
            }
        }
    };

    // POST /api/pmo/milestones/batch - Create multiple milestones in a single transaction
    batchCreateMilestones = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const userId = req.user?.id;
            const { milestones, project_id } = req.body;

            if (!Array.isArray(milestones) || milestones.length === 0) {
                res.status(400).json({ error: 'Milestones array is required and cannot be empty' });
                return;
            }

            if (!project_id) {
                res.status(400).json({ error: 'Project ID is required' });
                return;
            }

            // Verify user access to project once
            const project = await db.get(`
                SELECT id, name FROM projects 
                WHERE id = ?
            `, [project_id]);

            if (!project) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }

            // Use IMMEDIATE transaction for batch creation
            await db.beginTransaction('IMMEDIATE');
            
            try {
                const createdMilestones = [];
                
                for (let i = 0; i < milestones.length; i++) {
                    const milestone = milestones[i];
                    const {
                        name,
                        description,
                        milestone_type = 'delivery',
                        planned_date,
                        end_date,
                        priority = 'medium',
                        responsible_user_id,
                        impact_on_timeline = 0,
                        responsibility = 'internal',
                        blocking_reason,
                        delay_justification,
                        external_contact,
                        estimated_delay_days = 0,
                        financial_impact = 0
                    } = milestone;

                    if (!name || !planned_date) {
                        continue; // Skip invalid milestones
                    }

                    // Insert milestone
                    const result = await db.run(`
                        INSERT INTO project_milestones (
                            project_id, name, description, milestone_type, planned_date, end_date,
                            priority, responsible_user_id, impact_on_timeline, responsibility,
                            blocking_reason, delay_justification, external_contact, 
                            estimated_delay_days, financial_impact, created_by
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        project_id, name, description, milestone_type, planned_date, end_date || planned_date,
                        priority, responsible_user_id, impact_on_timeline, 
                        responsibility, blocking_reason, delay_justification, 
                        external_contact, estimated_delay_days, financial_impact, userId
                    ]);

                    createdMilestones.push({
                        id: result.id,
                        name,
                        planned_date,
                        milestone_type,
                        priority
                    });
                }

                await db.commit();
                
                logger.info(`Batch milestone creation completed: ${createdMilestones.length} milestones created by user ${userId}`);
                res.status(201).json({ 
                    success: true,
                    message: `Successfully created ${createdMilestones.length} milestones`,
                    createdMilestones,
                    createdCount: createdMilestones.length
                });
                
            } catch (transactionError) {
                await db.rollback();
                logger.error('Batch milestone creation transaction error:', transactionError);
                throw transactionError;
            }
        } catch (error) {
            logger.error('Batch create milestones error:', error);
            res.status(500).json({ error: 'Failed to create milestones in batch' });
        }
    };

    // DELETE /api/pmo/milestones/batch - Delete multiple milestones in a single transaction
    batchDeleteMilestones = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            logger.info(`🔥 Batch delete milestones called with body:`, req.body);
            const { milestoneIds } = req.body;
            const userId = req.user?.id;
            logger.info(`🔥 Received milestoneIds: ${JSON.stringify(milestoneIds)}, userId: ${userId}`);

            if (!Array.isArray(milestoneIds) || milestoneIds.length === 0) {
                res.status(400).json({ error: 'Milestone IDs array is required and cannot be empty' });
                return;
            }

            // Validate all milestone IDs are numbers
            const validMilestoneIds = milestoneIds.filter(id => 
                typeof id === 'number' || (typeof id === 'string' && !isNaN(parseInt(id)))
            );
            if (validMilestoneIds.length === 0) {
                res.status(400).json({ error: 'No valid milestone IDs provided' });
                return;
            }

            const deletedMilestoneIds: number[] = [];
            const milestoneNames: string[] = [];

            // Process each milestone deletion without nested transactions
            for (const milestoneId of validMilestoneIds) {
                try {
                    // Verify milestone exists and get name before deletion
                    const milestoneCheck = await db.get(`
                        SELECT id, name FROM project_milestones WHERE id = ?
                    `, [milestoneId]);

                    if (milestoneCheck) {
                        // Delete the milestone
                        const deleteResult = await db.run(`DELETE FROM project_milestones WHERE id = ?`, [milestoneId]);
                        
                        if (deleteResult.changes > 0) {
                            deletedMilestoneIds.push(parseInt(milestoneId.toString()));
                            milestoneNames.push(milestoneCheck.name);
                            logger.info(`Milestone ${milestoneId} (${milestoneCheck.name}) deleted successfully`);
                        }
                    } else {
                        logger.warn(`Milestone ${milestoneId} not found during batch deletion`);
                    }
                } catch (deleteError) {
                    logger.error(`Error deleting milestone ${milestoneId}:`, deleteError);
                }
            }
                
            logger.info(`Batch milestone deletion completed: ${deletedMilestoneIds.length} milestones deleted by user ${userId}`);
            res.json({ 
                success: true,
                message: `Successfully deleted ${deletedMilestoneIds.length} milestones`,
                deletedIds: deletedMilestoneIds,
                deletedCount: deletedMilestoneIds.length,
                deletedNames: milestoneNames
            });
        } catch (error) {
            logger.error('Batch delete milestones error:', error);
            
            const errorMessage = (error as Error)?.message || 'Unknown error';
            if (errorMessage.includes('database is locked') || errorMessage.includes('SQLITE_BUSY')) {
                res.status(409).json({ 
                    error: 'Database temporarily locked, please try again',
                    code: 'DATABASE_LOCKED'
                });
            } else {
                res.status(500).json({ 
                    error: 'Failed to delete milestones in batch',
                    code: 'BATCH_DELETE_ERROR'
                });
            }
        }
    };

    // POST /api/pmo/projects/:id/metrics - Update PMO metrics for project
    updateProjectMetrics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const metrics = req.body;

            // Check if metrics exist for this project
            const existing = await db.get('SELECT id FROM project_pmo_metrics WHERE project_id = ?', [id]);

            if (existing) {
                // Update existing metrics
                const fields = [];
                const values = [];

                for (const [key, value] of Object.entries(metrics)) {
                    if (key !== 'project_id') {
                        fields.push(`${key} = ?`);
                        values.push(value);
                    }
                }

                fields.push('last_updated = datetime(\'now\')');
                fields.push('updated_by = ?');
                values.push(req.user?.id);
                values.push(id);

                await db.run(`
                    UPDATE project_pmo_metrics 
                    SET ${fields.join(', ')} 
                    WHERE project_id = ?
                `, values);
            } else {
                // Create new metrics
                const columns = ['project_id', 'updated_by', 'last_updated'];
                const placeholders = ['?', '?', 'datetime(\'now\')'];
                const insertValues = [id, req.user?.id];

                for (const [key, value] of Object.entries(metrics)) {
                    if (key !== 'project_id') {
                        columns.push(key);
                        placeholders.push('?');
                        insertValues.push(value as string | number);
                    }
                }

                await db.run(`
                    INSERT INTO project_pmo_metrics (${columns.join(', ')})
                    VALUES (${placeholders.join(', ')})
                `, insertValues);
            }

            const updatedMetrics = await db.get(`
                SELECT * FROM project_pmo_metrics WHERE project_id = ?
            `, [id]);

            logger.info(`PMO metrics updated for project: ${id}`);
            res.json(updatedMetrics);
        } catch (error) {
            logger.error('Update project metrics error:', error);
            res.status(500).json({ error: 'Failed to update project metrics' });
        }
    };

    // GET /api/pmo/analytics - Advanced PMO analytics data
    getPMOAnalytics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            // 1. Executive Summary Metrics
            const executiveSummary = await db.get(`
                SELECT 
                    COUNT(DISTINCT p.id) as total_projects,
                    COUNT(DISTINCT CASE WHEN p.status = 'active' THEN p.id END) as active_projects,
                    COUNT(DISTINCT CASE WHEN p.status = 'completed' THEN p.id END) as completed_projects,
                    COUNT(DISTINCT CASE WHEN pm.risk_level = 'critical' THEN p.id END) as critical_projects,
                    COUNT(DISTINCT CASE WHEN pm.cost_variance_percentage > 15 THEN p.id END) as over_budget_projects,
                    COUNT(DISTINCT CASE WHEN pm.schedule_variance_days < -3 THEN p.id END) as delayed_projects,
                    ROUND(AVG(pm.completion_percentage), 1) as avg_completion,
                    ROUND(AVG(pm.client_satisfaction_score), 1) as avg_satisfaction,
                    ROUND(SUM(pm.planned_budget), 2) as total_planned_budget,
                    ROUND(SUM(pm.actual_cost), 2) as total_actual_cost,
                    ROUND((SUM(pm.actual_cost) - SUM(pm.planned_budget)) * 100.0 / SUM(pm.planned_budget), 2) as overall_budget_variance
                FROM projects p
                LEFT JOIN project_pmo_metrics pm ON p.id = pm.project_id
            `);

            // 2. Trend Analysis (last 12 weeks)
            const trendAnalysis = await db.query(`
                SELECT 
                    strftime('%Y-%W', pm.last_updated) as week,
                    COUNT(DISTINCT p.id) as projects_updated,
                    AVG(pm.completion_percentage) as avg_completion,
                    AVG(pm.client_satisfaction_score) as avg_satisfaction,
                    COUNT(DISTINCT CASE WHEN pm.risk_level = 'critical' THEN p.id END) as critical_count,
                    SUM(pm.planned_budget) as budget_planned,
                    SUM(pm.actual_cost) as budget_spent
                FROM projects p
                JOIN project_pmo_metrics pm ON p.id = pm.project_id
                WHERE pm.last_updated >= datetime('now', '-84 days')
                GROUP BY strftime('%Y-%W', pm.last_updated)
                ORDER BY week DESC
                LIMIT 12
            `);

            // 3. Budget Performance Analysis
            const budgetAnalysis = await db.query(`
                SELECT 
                    p.name as project_name,
                    p.id as project_id,
                    pm.planned_budget,
                    pm.actual_cost,
                    pm.cost_variance_percentage,
                    pm.completion_percentage,
                    ROUND((pm.actual_cost / NULLIF(pm.completion_percentage, 0)) * 100, 2) as projected_total_cost,
                    CASE 
                        WHEN pm.cost_variance_percentage > 20 THEN 'critical'
                        WHEN pm.cost_variance_percentage > 10 THEN 'warning' 
                        WHEN pm.cost_variance_percentage < -10 THEN 'under_budget'
                        ELSE 'on_track'
                    END as budget_status,
                    u.full_name as project_manager
                FROM projects p
                JOIN project_pmo_metrics pm ON p.id = pm.project_id
                LEFT JOIN users u ON p.assigned_to = u.id
                WHERE p.status IN ('active', 'completed') AND pm.planned_budget > 0
                ORDER BY pm.cost_variance_percentage DESC
            `);

            // 4. Schedule Performance Analysis
            const scheduleAnalysis = await db.query(`
                SELECT 
                    p.name as project_name,
                    p.id as project_id,
                    p.start_date as planned_start,
                    p.end_date as planned_end,
                    pm.actual_start_date,
                    pm.actual_end_date,
                    pm.schedule_variance_days,
                    pm.completion_percentage,
                    CASE 
                        WHEN p.end_date IS NOT NULL THEN 
                            CAST((julianday(p.end_date) - julianday('now')) AS INTEGER)
                        ELSE NULL
                    END as days_to_deadline,
                    CASE 
                        WHEN pm.schedule_variance_days < -10 THEN 'severely_delayed'
                        WHEN pm.schedule_variance_days < -3 THEN 'delayed'
                        WHEN pm.schedule_variance_days > 7 THEN 'ahead_of_schedule'
                        ELSE 'on_schedule'
                    END as schedule_status,
                    u.full_name as project_manager
                FROM projects p
                JOIN project_pmo_metrics pm ON p.id = pm.project_id
                LEFT JOIN users u ON p.assigned_to = u.id
                WHERE p.status IN ('active', 'completed')
                ORDER BY pm.schedule_variance_days ASC
            `);

            // 5. Risk Analysis
            const riskAnalysis = await db.query(`
                SELECT 
                    p.name as project_name,
                    p.id as project_id,
                    pm.risk_level,
                    pm.completion_percentage,
                    pm.cost_variance_percentage,
                    pm.schedule_variance_days,
                    pm.bugs_found,
                    pm.bugs_resolved,
                    ROUND((pm.bugs_resolved * 1.0 / NULLIF(pm.bugs_found, 0)) * 100, 1) as bug_resolution_rate,
                    pm.client_satisfaction_score,
                    u.full_name as project_manager,
                    CASE 
                        WHEN pm.risk_level = 'critical' AND pm.schedule_variance_days < -5 THEN 'high_priority'
                        WHEN pm.risk_level = 'high' AND pm.cost_variance_percentage > 15 THEN 'budget_risk'
                        WHEN pm.completion_percentage < 50 AND pm.schedule_variance_days < -3 THEN 'delivery_risk'
                        ELSE 'manageable'
                    END as priority_level
                FROM projects p
                JOIN project_pmo_metrics pm ON p.id = pm.project_id
                LEFT JOIN users u ON p.assigned_to = u.id
                WHERE p.status = 'active'
                ORDER BY 
                    CASE pm.risk_level 
                        WHEN 'critical' THEN 1
                        WHEN 'high' THEN 2
                        WHEN 'medium' THEN 3
                        WHEN 'low' THEN 4
                    END,
                    pm.schedule_variance_days ASC
            `);

            // 6. Team Performance Analysis
            const teamAnalysis = await db.query(`
                SELECT 
                    u.full_name,
                    u.role,
                    COUNT(DISTINCT p.id) as total_projects,
                    COUNT(DISTINCT CASE WHEN p.status = 'active' THEN p.id END) as active_projects,
                    COUNT(DISTINCT CASE WHEN p.status = 'completed' THEN p.id END) as completed_projects,
                    ROUND(AVG(pm.completion_percentage), 1) as avg_completion,
                    ROUND(AVG(pm.team_velocity), 1) as avg_velocity,
                    ROUND(AVG(pm.client_satisfaction_score), 1) as avg_satisfaction,
                    SUM(pm.bugs_found) as total_bugs_found,
                    SUM(pm.bugs_resolved) as total_bugs_resolved,
                    ROUND((SUM(pm.bugs_resolved) * 1.0 / NULLIF(SUM(pm.bugs_found), 0)) * 100, 1) as bug_resolution_rate,
                    COUNT(DISTINCT CASE WHEN pm.schedule_variance_days <= 0 THEN p.id END) as on_time_projects,
                    COUNT(DISTINCT CASE WHEN pm.cost_variance_percentage <= 10 THEN p.id END) as on_budget_projects,
                    ROUND(SUM(pm.planned_budget), 2) as total_budget_managed,
                    ROUND(AVG(pm.cost_variance_percentage), 1) as avg_budget_variance
                FROM users u
                LEFT JOIN projects p ON u.id = p.assigned_to
                LEFT JOIN project_pmo_metrics pm ON p.id = pm.project_id
                WHERE u.role IN ('project_manager', 'rpa_developer', 'rpa_operations') 
                GROUP BY u.id, u.full_name, u.role
                HAVING total_projects > 0
                ORDER BY avg_completion DESC, avg_satisfaction DESC
            `);

            // 7. Quality Metrics
            const qualityMetrics = await db.query(`
                SELECT 
                    p.name as project_name,
                    p.id as project_id,
                    pm.bugs_found,
                    pm.bugs_resolved,
                    ROUND((pm.bugs_resolved * 1.0 / NULLIF(pm.bugs_found, 0)) * 100, 1) as resolution_rate,
                    pm.client_satisfaction_score,
                    pm.completion_percentage,
                    CASE 
                        WHEN pm.bugs_found = 0 THEN 'no_issues'
                        WHEN (pm.bugs_resolved * 1.0 / pm.bugs_found) >= 0.9 THEN 'excellent'
                        WHEN (pm.bugs_resolved * 1.0 / pm.bugs_found) >= 0.7 THEN 'good'
                        WHEN (pm.bugs_resolved * 1.0 / pm.bugs_found) >= 0.5 THEN 'needs_attention'
                        ELSE 'critical'
                    END as quality_status,
                    u.full_name as project_manager
                FROM projects p
                JOIN project_pmo_metrics pm ON p.id = pm.project_id
                LEFT JOIN users u ON p.assigned_to = u.id
                WHERE p.status IN ('active', 'completed')
                ORDER BY pm.client_satisfaction_score DESC, resolution_rate DESC
            `);

            // 8. Resource Utilization
            const resourceUtilization = await db.query(`
                SELECT 
                    u.full_name,
                    u.role,
                    COUNT(DISTINCT p.id) as assigned_projects,
                    SUM(pm.planned_hours) as total_planned_hours,
                    SUM(pm.actual_hours) as total_actual_hours,
                    ROUND(AVG(pm.team_velocity), 1) as avg_velocity,
                    ROUND((SUM(pm.actual_hours) / NULLIF(SUM(pm.planned_hours), 0)) * 100, 1) as utilization_percentage,
                    CASE 
                        WHEN (SUM(pm.actual_hours) / NULLIF(SUM(pm.planned_hours), 0)) > 1.2 THEN 'overutilized'
                        WHEN (SUM(pm.actual_hours) / NULLIF(SUM(pm.planned_hours), 0)) < 0.8 THEN 'underutilized'
                        ELSE 'optimal'
                    END as utilization_status
                FROM users u
                LEFT JOIN projects p ON u.id = p.assigned_to AND p.status IN ('active', 'completed')
                LEFT JOIN project_pmo_metrics pm ON p.id = pm.project_id
                WHERE u.role IN ('project_manager', 'rpa_developer', 'rpa_operations')
                GROUP BY u.id, u.full_name, u.role
                HAVING total_planned_hours > 0
                ORDER BY utilization_percentage DESC
            `);

            // 9. Client Satisfaction Trends (using project name as client reference)
            const satisfactionTrends = await db.query(`
                SELECT 
                    p.name as client_name,
                    COUNT(DISTINCT p.id) as total_projects,
                    ROUND(AVG(pm.client_satisfaction_score), 1) as avg_satisfaction,
                    COUNT(DISTINCT CASE WHEN p.status = 'completed' THEN p.id END) as completed_projects,
                    COUNT(DISTINCT CASE WHEN pm.schedule_variance_days <= 0 THEN p.id END) as on_time_deliveries,
                    COUNT(DISTINCT CASE WHEN pm.cost_variance_percentage <= 10 THEN p.id END) as on_budget_deliveries,
                    ROUND((COUNT(DISTINCT CASE WHEN pm.schedule_variance_days <= 0 THEN p.id END) * 100.0 / COUNT(DISTINCT p.id)), 1) as on_time_rate,
                    ROUND((COUNT(DISTINCT CASE WHEN pm.cost_variance_percentage <= 10 THEN p.id END) * 100.0 / COUNT(DISTINCT p.id)), 1) as on_budget_rate
                FROM projects p
                LEFT JOIN project_pmo_metrics pm ON p.id = pm.project_id
                WHERE p.name IS NOT NULL AND p.name != ''
                GROUP BY p.name
                HAVING total_projects > 0
                ORDER BY avg_satisfaction DESC, total_projects DESC
                LIMIT 10
            `);

            // 10. Risk Distribution Summary
            const riskDistribution = await db.query(`
                SELECT 
                    pm.risk_level,
                    COUNT(*) as project_count,
                    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM project_pmo_metrics pm2 JOIN projects p2 ON pm2.project_id = p2.id WHERE p2.status = 'active'), 2) as percentage,
                    ROUND(AVG(pm.cost_variance_percentage), 1) as avg_budget_variance,
                    ROUND(AVG(pm.schedule_variance_days), 1) as avg_schedule_variance,
                    ROUND(AVG(pm.client_satisfaction_score), 1) as avg_satisfaction
                FROM project_pmo_metrics pm
                JOIN projects p ON pm.project_id = p.id
                WHERE p.status = 'active'
                GROUP BY pm.risk_level
                ORDER BY 
                    CASE pm.risk_level 
                        WHEN 'critical' THEN 1
                        WHEN 'high' THEN 2
                        WHEN 'medium' THEN 3
                        WHEN 'low' THEN 4
                    END
            `);

            res.json({
                executiveSummary,
                trendAnalysis,
                budgetAnalysis,
                scheduleAnalysis,
                riskAnalysis,
                teamAnalysis,
                qualityMetrics,
                resourceUtilization,
                satisfactionTrends,
                riskDistribution
            });
        } catch (error) {
            logger.error('Get PMO analytics error:', error);
            res.status(500).json({ error: 'Failed to get PMO analytics' });
        }
    };

    // GET /api/pmo/projects/:id/metrics - Project-specific PMO metrics
    getProjectPMOMetrics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const projectId = parseInt(req.params.id);

            if (!projectId) {
                res.status(400).json({ error: 'Invalid project ID' });
                return;
            }

            // Get project with PMO metrics
            const projectMetrics = await db.get(`
                SELECT 
                    p.id,
                    p.name,
                    p.description,
                    p.status,
                    p.priority,
                    p.start_date,
                    p.end_date,
                    p.budget,
                    u.full_name as assigned_to_name,
                    
                    -- PMO Metrics
                    pm.completion_percentage,
                    pm.schedule_variance_days,
                    pm.cost_variance_percentage,
                    pm.risk_level,
                    pm.planned_hours,
                    pm.actual_hours,
                    pm.planned_budget,
                    pm.actual_cost,
                    pm.team_velocity,
                    pm.bugs_found,
                    pm.bugs_resolved,
                    pm.client_satisfaction_score,
                    pm.last_updated as metrics_last_updated,
                    
                    -- Calculated metrics
                    CASE 
                        WHEN pm.schedule_variance_days > 5 OR pm.cost_variance_percentage > 20 OR pm.risk_level = 'critical' THEN 'critical'
                        WHEN pm.schedule_variance_days > 2 OR pm.cost_variance_percentage > 10 OR pm.risk_level = 'high' THEN 'warning'
                        ELSE 'healthy'
                    END as project_health_status,
                    
                    -- Days until deadline
                    CASE 
                        WHEN p.end_date IS NOT NULL THEN 
                            CAST((julianday(p.end_date) - julianday('now')) AS INTEGER)
                        ELSE NULL
                    END as days_to_deadline,
                    
                    -- Progress ratio
                    CASE 
                        WHEN pm.planned_hours > 0 THEN 
                            ROUND((pm.actual_hours * 100.0) / pm.planned_hours, 2)
                        ELSE NULL
                    END as hours_completion_ratio,
                    
                    -- Budget utilization
                    CASE 
                        WHEN pm.planned_budget > 0 THEN 
                            ROUND((pm.actual_cost * 100.0) / pm.planned_budget, 2)
                        ELSE NULL
                    END as budget_utilization_percentage

                FROM projects p
                LEFT JOIN project_pmo_metrics pm ON p.id = pm.project_id
                LEFT JOIN users u ON p.assigned_to = u.id
                WHERE p.id = ?
            `, [projectId]);

            if (!projectMetrics) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }

            // Get milestones for this project
            const milestones = await db.query(`
                SELECT 
                    id,
                    name as title,
                    description,
                    planned_date as due_date,
                    status,
                    actual_date as completion_date,
                    created_at
                FROM project_milestones 
                WHERE project_id = ?
                ORDER BY planned_date ASC
            `, [projectId]);

            // Get recent risks/alerts for this project
            const risks = await db.query(`
                SELECT 
                    'schedule_delay' as risk_type,
                    'Schedule Delay' as risk_title,
                    'Project is ' || ABS(pm.schedule_variance_days) || ' days behind schedule' as risk_description,
                    CASE 
                        WHEN pm.schedule_variance_days < -10 THEN 'critical'
                        WHEN pm.schedule_variance_days < -3 THEN 'high'
                        ELSE 'medium'
                    END as severity,
                    pm.last_updated as detected_date
                FROM project_pmo_metrics pm
                WHERE pm.project_id = ? AND pm.schedule_variance_days < -1
                
                UNION ALL
                
                SELECT 
                    'budget_overrun' as risk_type,
                    'Budget Overrun' as risk_title,
                    'Project is ' || ROUND(pm.cost_variance_percentage, 1) || '% over budget' as risk_description,
                    CASE 
                        WHEN pm.cost_variance_percentage > 25 THEN 'critical'
                        WHEN pm.cost_variance_percentage > 15 THEN 'high'
                        WHEN pm.cost_variance_percentage > 5 THEN 'medium'
                        ELSE 'low'
                    END as severity,
                    pm.last_updated as detected_date
                FROM project_pmo_metrics pm
                WHERE pm.project_id = ? AND pm.cost_variance_percentage > 5
                
                UNION ALL
                
                SELECT 
                    'quality_issues' as risk_type,
                    'Quality Concerns' as risk_title,
                    'High bug ratio: ' || pm.bugs_found || ' found, ' || pm.bugs_resolved || ' resolved' as risk_description,
                    CASE 
                        WHEN (pm.bugs_found - pm.bugs_resolved) > 10 THEN 'critical'
                        WHEN (pm.bugs_found - pm.bugs_resolved) > 5 THEN 'high'
                        ELSE 'medium'
                    END as severity,
                    pm.last_updated as detected_date
                FROM project_pmo_metrics pm
                WHERE pm.project_id = ? AND (pm.bugs_found - pm.bugs_resolved) > 3
                
                ORDER BY severity DESC, detected_date DESC
                LIMIT 10
            `, [projectId, projectId, projectId]);

            // Get team performance metrics
            const teamMetrics = await db.get(`
                SELECT 
                    COUNT(DISTINCT te.user_id) as team_size,
                    ROUND(AVG(te.hours), 2) as avg_daily_hours,
                    SUM(te.hours) as total_hours_logged,
                    COUNT(DISTINCT DATE(te.date)) as active_days
                FROM time_entries te
                JOIN projects p ON te.project_id = p.id
                WHERE te.project_id = ?
                    AND te.date >= datetime('now', '-30 days')
            `, [projectId]);

            // Calculate key performance indicators
            const kpis = {
                schedule_performance: projectMetrics.schedule_variance_days ? 
                    (projectMetrics.schedule_variance_days > 0 ? 'ahead' : 
                     projectMetrics.schedule_variance_days < -5 ? 'critical_delay' : 'minor_delay') : 'on_track',
                
                budget_performance: projectMetrics.cost_variance_percentage ? 
                    (projectMetrics.cost_variance_percentage > 15 ? 'critical_overrun' :
                     projectMetrics.cost_variance_percentage > 5 ? 'minor_overrun' : 'within_budget') : 'within_budget',
                
                quality_score: projectMetrics.bugs_found ? 
                    Math.max(0, 100 - ((projectMetrics.bugs_found - projectMetrics.bugs_resolved) * 10)) : 100,
                
                team_productivity: projectMetrics.team_velocity || 'N/A',
                
                client_satisfaction: projectMetrics.client_satisfaction_score || 'Not rated'
            };

            logger.info(`PMO metrics retrieved for project: ${projectMetrics.name} (ID: ${projectId})`);

            res.json({
                project: projectMetrics,
                milestones: {
                    total: milestones.length,
                    completed: milestones.filter((m: any) => m.status === 'completed').length,
                    upcoming: milestones.filter((m: any) => 
                        m.status !== 'completed' && new Date(m.due_date) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                    ).length,
                    list: milestones
                },
                risks: risks,
                team: teamMetrics,
                kpis: kpis,
                alerts: risks.filter((r: any) => r.severity === 'critical' || r.severity === 'high')
            });

        } catch (error) {
            logger.error(`Get project PMO metrics error for project ${req.params.id}:`, error);
            res.status(500).json({ error: 'Failed to get project PMO metrics' });
        }
    };

    // GET /api/pmo/executive-suite - Datos integrados para Gerente General, Comercial y Controller
    getPMOExecutiveSuite = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            await billingService.evaluateTriggers();
            await billingService.evaluateOverdue();

            // 1. Proyectos y avance PMO manual (project_pmo_metrics solo aporta avance, atraso, riesgo y satisfacción;
            // los montos salen siempre de financeService). Solo cuentan los de venta realizada, como en la cartera.
            const projects = (await db.query(`
                SELECT 
                    p.id, p.name, p.status, p.commercial_stage, p.priority, p.end_date, p.start_date,
                    c.id as client_id, c.name as client_name,
                    u.id as assigned_to_id, u.full_name as assigned_to_name,
                    pm.completion_percentage, pm.schedule_variance_days, pm.risk_level,
                    pm.client_satisfaction_score
                FROM projects p
                LEFT JOIN project_pmo_metrics pm ON p.id = pm.project_id
                LEFT JOIN clients c ON p.client_id = c.id
                LEFT JOIN users u ON p.assigned_to = u.id
                ORDER BY p.name ASC
            `)).filter(isRealizedSale);

            // 2. Financials calculados en vivo por financeService
            const financialsMap = new Map<number, ProjectFinancials | null>();
            await Promise.all(
                projects.map(async (p: any) => {
                    try {
                        financialsMap.set(p.id, await financeService.calculateProjectFinancials(p.id));
                    } catch (error) {
                        logger.error(`PMO Executive Suite: no se pudieron calcular las finanzas del proyecto ${p.id}:`, error);
                        financialsMap.set(p.id, null);
                    }
                })
            );

            // 3. Billing Dashboard para datos de caja y facturación
            const billingDashboard = await billingService.getDashboard();

            // -----------------------------------------------------------------
            // PERSPECTIVA 1: GERENTE GENERAL (CEO / P&L Consolidado)
            // -----------------------------------------------------------------
            let total_sold_clp = 0;
            let total_real_cost_clp = 0;
            let healthy_count = 0;
            let warning_count = 0;
            let critical_count = 0;

            const analyzedProjects = projects.map((p: any) => {
                const fin = financialsMap.get(p.id);
                const salePrice = fin?.sale_price ?? 0;
                const realCost = fin?.real_cost ?? 0;
                const budgetedCost = fin?.planned_cost ?? 0;
                const costVarianceCLP = Math.max(0, realCost - budgetedCost);
                const schedVar = Number(p.schedule_variance_days || 0);
                const riskLevel = p.risk_level || 'low';

                const isCritical = schedVar > 5 || (budgetedCost > 0 && (realCost / budgetedCost) > 1.2) || riskLevel === 'critical';
                const isWarning = !isCritical && (schedVar > 2 || (budgetedCost > 0 && (realCost / budgetedCost) > 1.1) || riskLevel === 'high');
                const healthStatus = isCritical ? 'critical' : isWarning ? 'warning' : 'healthy';

                if (healthStatus === 'critical') critical_count++;
                else if (healthStatus === 'warning') warning_count++;
                else healthy_count++;

                total_sold_clp += salePrice;
                total_real_cost_clp += realCost;

                const daysToDeadline = p.end_date
                    ? Math.round((new Date(p.end_date).getTime() - Date.now()) / (1000 * 3600 * 24))
                    : null;

                return {
                    id: p.id,
                    name: p.name,
                    client_id: p.client_id,
                    client_name: p.client_name || 'Sin cliente',
                    assigned_to_name: p.assigned_to_name || 'Sin asignar',
                    project_health_status: healthStatus,
                    schedule_variance_days: schedVar,
                    cost_variance_clp: costVarianceCLP,
                    real_cost_clp: realCost,
                    budgeted_cost_clp: budgetedCost,
                    sale_price_clp: salePrice,
                    progress_pct: Number(p.completion_percentage || 0),
                    days_to_deadline: daysToDeadline,
                    critical_reason: describeCriticalReason(costVarianceCLP, schedVar, riskLevel, canSeeFinancials(req.user?.role)),
                    risk_level: riskLevel,
                    satisfaction_score: p.client_satisfaction_score
                };
            });

            const total_gross_profit_clp = total_sold_clp - total_real_cost_clp;
            const avg_margin_pct = total_sold_clp > 0
                ? Math.round(((total_gross_profit_clp / total_sold_clp) * 100) * 10) / 10
                : 0;

            const top_risk_projects = analyzedProjects
                .filter(p => p.project_health_status !== 'healthy')
                .sort((a, b) => (b.cost_variance_clp + b.schedule_variance_days * 100000) - (a.cost_variance_clp + a.schedule_variance_days * 100000))
                .slice(0, 5);

            // Capacidad y utilización
            const teamCapacityRows = await db.query(`
                SELECT u.id, u.full_name, u.role,
                       ROUND(COALESCE(SUM(CASE WHEN p.id IS NOT NULL THEN pa.allocation_percentage ELSE 0 END), 0) / 100.0, 2) AS planned_fte
                FROM users u
                LEFT JOIN project_assignments pa ON pa.user_id = u.id AND pa.is_active = 1
                LEFT JOIN projects p ON p.id = pa.project_id AND p.status IN ('active', 'on_hold')
                WHERE u.is_active = 1 AND u.role IN ('rpa_developer', 'rpa_operations', 'team_lead')
                GROUP BY u.id, u.full_name, u.role
            `);

            const total_planned_fte = teamCapacityRows.reduce((acc: number, r: any) => acc + Number(r.planned_fte || 0), 0);
            const overutilized_count = teamCapacityRows.filter((r: any) => Number(r.planned_fte) > 1.05).length;
            const underutilized_count = teamCapacityRows.filter((r: any) => Number(r.planned_fte) < 0.8).length;
            const optimal_count = teamCapacityRows.length - overutilized_count - underutilized_count;

            // -----------------------------------------------------------------
            // PERSPECTIVA 2: GERENTE COMERCIAL (Revenue, Hitos Cobrables & Margen)
            // -----------------------------------------------------------------
            const billableMilestoneRows = await db.query(`
                SELECT 
                    pm.id as milestone_id, pm.name as milestone_name, pm.amount, pm.currency,
                    pm.status, pm.planned_date, pm.billable_at, pm.trigger_type,
                    p.id as project_id, p.name as project_name,
                    c.name as client_name,
                    mile.name as source_milestone_name,
                    CAST(julianday('now') - julianday(COALESCE(pm.billable_at, pm.planned_date, pm.created_at)) AS INTEGER) as days_since_completed
                FROM payment_milestones pm
                JOIN projects p ON p.id = pm.project_id
                LEFT JOIN clients c ON p.client_id = c.id
                LEFT JOIN project_milestones mile ON mile.id = pm.project_milestone_id
                WHERE pm.status = 'billable'
                ORDER BY days_since_completed DESC, pm.amount DESC
            `);

            let total_unlocked_revenue_clp = 0;
            const ready_to_invoice = await Promise.all(
                billableMilestoneRows.map(async (row: any) => {
                    const amountCLP = row.currency === 'CLP'
                        ? Number(row.amount)
                        : await financeService.toCLP(Number(row.amount), row.currency as Currency);
                    total_unlocked_revenue_clp += amountCLP;
                    return {
                        ...row,
                        amount_clp: Math.round(amountCLP),
                        days_since_completed: Math.max(0, Number(row.days_since_completed || 0))
                    };
                })
            );

            // Comparativa de Cotización (Margen Vendido vs Real)
            const approvedQuotes = await db.query(`
                SELECT pq.*, p.name as project_name, c.name as client_name
                FROM project_quotes pq
                JOIN projects p ON p.id = pq.project_id
                LEFT JOIN clients c ON p.client_id = c.id
                WHERE pq.status = 'approved'
                ORDER BY pq.created_at DESC
            `);

            const margin_variance = approvedQuotes.filter((q: any) => financialsMap.has(q.project_id)).map((q: any) => {
                const fin = financialsMap.get(q.project_id);
                const quotedMargin = Number(q.margin_percent || 0);
                const realMargin = fin ? Number(fin.real_margin_percentage || 0) : 0;
                const quotedHours = Number(q.hours || 0);
                const realHours = fin ? Number(fin.real_hours || 0) : 0;
                const leakage = quotedMargin - realMargin;

                return {
                    project_id: q.project_id,
                    project_name: q.project_name,
                    client_name: q.client_name || 'Sin cliente',
                    quoted_margin_pct: quotedMargin,
                    real_margin_pct: realMargin,
                    margin_leakage_pct: Math.round(leakage * 10) / 10,
                    quoted_hours: quotedHours,
                    real_hours: realHours,
                    hours_exceeded: Math.max(0, realHours - quotedHours),
                    quoted_amount_clp: Number(q.amount || 0),
                    real_cost_clp: fin ? fin.real_cost : 0,
                    pricing_model: q.pricing_model
                };
            });

            // Scope Creep Alerts (proyectos con exceso de horas sobre lo cotizado/estimado)
            const scope_creep_alerts = margin_variance
                .filter(m => m.hours_exceeded > 0)
                .map(m => ({
                    project_id: m.project_id,
                    project_name: m.project_name,
                    client_name: m.client_name,
                    quoted_hours: m.quoted_hours,
                    real_hours: m.real_hours,
                    overrun_hours: m.hours_exceeded,
                    overrun_cost_clp: Math.round(m.hours_exceeded * 35000), // Promedio estimado HH
                    severity: (m.hours_exceeded > 20 || m.margin_leakage_pct > 15) ? 'critical' : 'warning'
                }));

            // Scorecard por Cliente
            const clientScorecardMap = new Map<number, any>();
            analyzedProjects.forEach(p => {
                if (!p.client_id) return;
                const existing = clientScorecardMap.get(p.client_id) || {
                    client_id: p.client_id,
                    client_name: p.client_name,
                    active_projects: 0,
                    total_sold_clp: 0,
                    satisfaction_sum: 0,
                    satisfaction_count: 0,
                    has_critical: false
                };
                existing.active_projects++;
                existing.total_sold_clp += p.sale_price_clp;
                if (p.satisfaction_score) {
                    existing.satisfaction_sum += p.satisfaction_score;
                    existing.satisfaction_count++;
                }
                if (p.project_health_status === 'critical') existing.has_critical = true;
                clientScorecardMap.set(p.client_id, existing);
            });

            const client_scorecards = Array.from(clientScorecardMap.values()).map(c => ({
                client_id: c.client_id,
                client_name: c.client_name,
                active_projects: c.active_projects,
                total_sold_clp: c.total_sold_clp,
                avg_satisfaction: c.satisfaction_count > 0 ? Math.round((c.satisfaction_sum / c.satisfaction_count) * 10) / 10 : null,
                health: c.has_critical ? 'critical' : 'healthy'
            }));

            // -----------------------------------------------------------------
            // PERSPECTIVA 3: CONTROLLER / CONTROL DE GESTIÓN (Triple Conciliación & Imputaciones)
            // -----------------------------------------------------------------
            const invoiceAggregates = await db.query(`
                SELECT i.project_id,
                       COALESCE(SUM(i.amount), 0) as total_invoiced,
                       COALESCE(SUM(pay.amount), 0) as total_paid
                FROM invoices i
                LEFT JOIN payments pay ON pay.invoice_id = i.id
                WHERE i.status != 'cancelled'
                GROUP BY i.project_id
            `);
            const invoiceMap = new Map<number, { total_invoiced: number; total_paid: number }>();
            invoiceAggregates.forEach((r: any) => {
                invoiceMap.set(Number(r.project_id), {
                    total_invoiced: Number(r.total_invoiced || 0),
                    total_paid: Number(r.total_paid || 0)
                });
            });

            const triple_conciliation = analyzedProjects.map(p => {
                const inv = invoiceMap.get(p.id) || { total_invoiced: 0, total_paid: 0 };
                const physical_pct = p.progress_pct;
                const cost_consumed_pct = p.budgeted_cost_clp > 0
                    ? Math.round((p.real_cost_clp / p.budgeted_cost_clp) * 100)
                    : 0;
                const billed_pct = p.sale_price_clp > 0
                    ? Math.round((inv.total_invoiced / p.sale_price_clp) * 100)
                    : 0;

                // EVM (Earned Value Management)
                const ev = (physical_pct / 100) * p.sale_price_clp;
                const ac = p.real_cost_clp;
                const cpi = ac > 0 ? Math.round((ev / ac) * 100) / 100 : 1.0;

                let deviation_flag: 'healthy' | 'cost_overrun' | 'unbilled_work' | 'critical_desynchronization' = 'healthy';
                const hasCostOverrun = cost_consumed_pct > physical_pct + 15;
                const hasUnbilledWork = physical_pct > billed_pct + 25;

                if (hasCostOverrun && hasUnbilledWork) deviation_flag = 'critical_desynchronization';
                else if (hasCostOverrun) deviation_flag = 'cost_overrun';
                else if (hasUnbilledWork) deviation_flag = 'unbilled_work';

                return {
                    project_id: p.id,
                    project_name: p.name,
                    client_name: p.client_name,
                    physical_progress_pct: physical_pct,
                    cost_consumed_pct,
                    billed_pct,
                    cpi,
                    deviation_flag,
                    sale_price_clp: p.sale_price_clp,
                    budgeted_cost_clp: p.budgeted_cost_clp,
                    real_cost_clp: p.real_cost_clp,
                    invoiced_clp: inv.total_invoiced,
                    paid_clp: inv.total_paid
                };
            });

            // Auditoría de Imputaciones (Timesheet Hygiene)
            const activeTeamMembers = await db.query(`
                SELECT id, full_name, role 
                FROM users 
                WHERE is_active = 1 AND role IN ('rpa_developer', 'rpa_operations', 'team_lead')
            `);

            const users_with_missing_days: any[] = [];
            for (const member of activeTeamMembers) {
                const reminders = await timesheetService.getPendingReminders(member.id);
                if (reminders.missing_dates && reminders.missing_dates.length > 0) {
                    users_with_missing_days.push({
                        user_id: member.id,
                        user_name: member.full_name,
                        user_role: member.role,
                        missing_days_count: reminders.missing_dates.length,
                        missing_dates: reminders.missing_dates
                    });
                }
            }

            const pendingApprovalsRaw = await timesheetService.getPendingApprovals();
            const pending_approval_periods = pendingApprovalsRaw.map(r => ({
                period_id: r.id,
                user_name: r.user_name,
                week_start: r.period_start,
                total_hours: r.total_hours,
                submitted_at: r.submitted_at
            }));

            // Ratio de horas facturables en los últimos 30 días
            const hoursStats = await db.get(`
                SELECT 
                    COALESCE(SUM(hours), 0) as total_hours,
                    COALESCE(SUM(CASE WHEN is_billable = 1 THEN hours ELSE 0 END), 0) as billable_hours
                FROM time_entries
                WHERE date >= date('now', '-30 days')
            `);
            const totalHours30d = Number(hoursStats?.total_hours || 0);
            const billableHours30d = Number(hoursStats?.billable_hours || 0);
            const internalHours30d = Math.max(0, totalHours30d - billableHours30d);
            const billableRatio30d = totalHours30d > 0
                ? Math.round((billableHours30d / totalHours30d) * 1000) / 10
                : 100;

            // Desglose por Centro de Costos
            const costCentersRaw = await db.query(`
                SELECT cc.*,
                       COUNT(DISTINCT pcca.project_id) as allocated_projects_count,
                       COALESCE(SUM(pcca.amount), 0) as total_allocated_amount
                FROM cost_centers cc
                LEFT JOIN project_cost_center_allocations pcca ON pcca.cost_center_id = cc.id
                WHERE cc.is_active = 1
                GROUP BY cc.id
                ORDER BY cc.country, cc.name
            `);

            const cost_centers_summary = costCentersRaw.map((cc: any) => ({
                cost_center_id: cc.id,
                code: cc.code,
                name: cc.name,
                country: cc.country,
                is_rpa: Boolean(cc.is_rpa),
                allocated_projects_count: Number(cc.allocated_projects_count || 0),
                total_budget_clp: Number(cc.total_allocated_amount || 0)
            }));

            // Aging de Cartera (Cobranza y Facturación)
            const unpaidInvoices = await db.query(`
                SELECT i.*, p.name as project_name, c.name as client_name,
                       COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id), 0) as amount_paid,
                       CAST(julianday('now') - julianday(i.due_date) AS INTEGER) as days_overdue
                FROM invoices i
                JOIN projects p ON p.id = i.project_id
                LEFT JOIN clients c ON p.client_id = c.id
                WHERE i.status IN ('issued', 'partially_paid', 'overdue')
                ORDER BY days_overdue DESC
            `);

            let current_clp = 0;
            let overdue_30_clp = 0;
            let overdue_60_clp = 0;

            for (const inv of unpaidInvoices) {
                const balance = Number(inv.amount || 0) - Number(inv.amount_paid || 0);
                const balanceCLP = inv.currency === 'CLP'
                    ? balance
                    : await financeService.toCLP(balance, inv.currency as Currency);
                const days = Number(inv.days_overdue || 0);

                if (days <= 0) current_clp += balanceCLP;
                else if (days <= 30) overdue_30_clp += balanceCLP;
                else overdue_60_clp += balanceCLP;
            }

            const total_overdue_clp = overdue_30_clp + overdue_60_clp;

            const suite: ExecutiveSuiteResponse = {
                general_manager: {
                    consolidated_pnl: {
                        total_sold_clp: Math.round(total_sold_clp),
                        total_real_cost_clp: Math.round(total_real_cost_clp),
                        total_gross_profit_clp: Math.round(total_gross_profit_clp),
                        avg_margin_pct,
                        active_projects_count: projects.filter(p => p.status === 'active').length,
                        total_projects_count: projects.length,
                        billable_hours_ratio: billableRatio30d
                    },
                    cashflow_forecast: billingDashboard.cashflow_projection || [],
                    portfolio_health_summary: {
                        healthy: healthy_count,
                        warning: warning_count,
                        critical: critical_count
                    },
                    top_risk_projects,
                    team_utilization_summary: {
                        total_planned_fte: Math.round(total_planned_fte * 100) / 100,
                        total_developers: teamCapacityRows.length,
                        overutilized_count,
                        optimal_count,
                        underutilized_count
                    }
                },
                commercial: {
                    ready_to_invoice,
                    total_unlocked_revenue_clp: Math.round(total_unlocked_revenue_clp),
                    margin_variance,
                    scope_creep_alerts,
                    client_scorecards
                },
                controller: {
                    triple_conciliation,
                    imputations_audit: {
                        users_with_missing_days,
                        pending_approval_periods,
                        billable_breakdown: {
                            total_real_hours: totalHours30d,
                            total_billable_hours: billableHours30d,
                            total_internal_hours: internalHours30d,
                            billable_pct: billableRatio30d
                        }
                    },
                    cost_centers_summary,
                    aging_portfolio: {
                        current_clp: Math.round(current_clp),
                        overdue_30_clp: Math.round(overdue_30_clp),
                        overdue_60_clp: Math.round(overdue_60_clp),
                        total_overdue_clp: Math.round(total_overdue_clp),
                        overdue_invoices: unpaidInvoices.map((inv: any) => ({
                            id: inv.id,
                            invoice_number: inv.invoice_number,
                            project_name: inv.project_name,
                            client_name: inv.client_name,
                            amount: inv.amount,
                            amount_paid: inv.amount_paid,
                            currency: inv.currency,
                            due_date: inv.due_date,
                            days_overdue: Math.max(0, Number(inv.days_overdue || 0))
                        }))
                    }
                }
            };

            res.json(stripFinancials(suite, req.user?.role));

        } catch (error) {
            logger.error('Get PMO Executive Suite error:', error);
            res.status(500).json({ error: 'Failed to retrieve PMO executive suite data' });
        }
    };
}

