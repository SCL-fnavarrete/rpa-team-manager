import { db } from '../database/database';
import { financeService, Currency } from './financeService';

export interface ClosureChecklistItem {
    key: 'delivery_accepted' | 'payment_milestones' | 'invoices_paid' | 'timesheets_approved' | 'tasks_done' | 'required_documents';
    label: string;
    ok: boolean;
    pending_count: number;
    blocking: boolean;
}

export interface ClosureReport {
    project: {
        id: number; name: string; client_name: string | null; sales_rep_name: string | null; status: string;
        start_date: string | null; end_date: string | null; delivery_accepted_at: string | null; financial_closed_at: string | null;
    };
    checklist: ClosureChecklistItem[];
    can_close_financials: boolean;
    quoted: { amount_clp: number; hours: number; estimated_cost_clp: number; margin_percent: number | null; version: number | null };
    actual: {
        sale_price: number; real_cost: number; real_profit: number; real_margin_percentage: number;
        approved_hours: number; real_hours_source: 'approved' | 'projected'; planned_hours: number; variance_impact: number;
    };
    team: { user_name: string; budgeted_hours: number; actual_hours: number }[];
    milestones: { name: string; amount: number; currency: string; status: string; planned_date: string | null }[];
    generated_at: string;
}

const roundHours = (hours: number): number => Math.round(hours * 100) / 100;

/**
 * Informe de cierre de un proyecto: checklist de pendientes, cotizado vs real, equipo e hitos de pago.
 * No recalcula costos: las cifras reales salen de financeService.
 */
export class ClosureReportService {
    /** null si el proyecto no existe. */
    async getReport(projectId: number): Promise<ClosureReport | null> {
        const project = await db.get(
            `SELECT p.id, p.name, p.status, p.delivery_accepted_at, p.financial_closed_at,
                    p.require_purchase_order, p.require_service_acceptance,
                    COALESCE(p.actual_start_date, p.start_date) AS start_date,
                    COALESCE(p.actual_end_date, p.end_date) AS end_date,
                    c.name AS client_name, sr.name AS sales_rep_name
             FROM projects p
             LEFT JOIN clients c ON c.id = p.client_id
             LEFT JOIN sales_reps sr ON sr.id = p.sales_rep_id
             WHERE p.id = ?`,
            [projectId]
        );
        if (!project) return null;

        const checklist = await this.buildChecklist(projectId, project);
        const financials = await financeService.calculateProjectFinancials(projectId);

        return {
            project: {
                id: project.id,
                name: project.name,
                client_name: project.client_name ?? null,
                sales_rep_name: project.sales_rep_name ?? null,
                status: project.status,
                start_date: project.start_date ?? null,
                end_date: project.end_date ?? null,
                delivery_accepted_at: project.delivery_accepted_at ?? null,
                financial_closed_at: project.financial_closed_at ?? null
            },
            checklist,
            can_close_financials: checklist.filter(item => item.blocking).every(item => item.ok),
            quoted: await this.getQuoted(projectId),
            actual: {
                sale_price: financials.sale_price,
                real_cost: financials.real_cost,
                real_profit: financials.real_profit,
                real_margin_percentage: financials.real_margin_percentage,
                approved_hours: financials.approved_hours,
                real_hours_source: financials.real_hours_source,
                planned_hours: financials.planned_hours,
                variance_impact: financials.variance_impact
            },
            team: await this.getTeam(projectId),
            milestones: await db.query(
                `SELECT name, amount, currency, status, planned_date FROM payment_milestones
                 WHERE project_id = ? ORDER BY planned_date IS NULL, planned_date ASC, sort_order ASC, id ASC`,
                [projectId]
            ),
            generated_at: new Date().toISOString()
        };
    }

    /**
     * Los ítems bloqueantes aplican los mismos criterios que CommercialController.closeFinancials
     * (el test del informe verifica que ambos coincidan); horas sin aprobar y tareas abiertas solo advierten.
     */
    private async buildChecklist(projectId: number, project: any): Promise<ClosureChecklistItem[]> {
        const count = async (sql: string): Promise<number> => Number((await db.get(sql, [projectId]))?.count ?? 0);
        const hasDocument = async (documentType: string): Promise<boolean> => Boolean(await db.get(
            `SELECT id FROM project_commercial_documents WHERE project_id = ? AND document_type = ? LIMIT 1`,
            [projectId, documentType]
        ));

        const pendingMilestones = await count(
            `SELECT COUNT(*) AS count FROM payment_milestones WHERE project_id = ? AND status <> 'paid'`
        );
        const unpaidInvoices = await count(
            `SELECT COUNT(*) AS count FROM invoices i
             WHERE i.project_id = ? AND i.status NOT IN ('paid', 'cancelled')
               AND i.amount > COALESCE((SELECT SUM(payments.amount) FROM payments WHERE payments.invoice_id = i.id), 0)`
        );
        const unapprovedTimeEntries = await count(
            `SELECT COUNT(*) AS count FROM time_entries WHERE project_id = ? AND approval_status <> 'approved'`
        );
        // El tablero termina una tarea moviéndola a la columna Done sin tocar su status (nace 'todo'); la columna de
        // terminadas se reconoce igual que en el listado de proyectos (projectController.getProjects).
        const openTasks = await count(
            `SELECT COUNT(*) AS count FROM tasks t JOIN task_boards tb ON tb.id = t.board_id
             WHERE tb.project_id = ? AND t.status <> 'done'
               AND NOT EXISTS (SELECT 1 FROM task_columns tc WHERE tc.id = t.column_id
                 AND (tc.is_done_column = 1 OR LOWER(TRIM(tc.name)) IN ('done', 'completed', 'finished')))`
        );
        const missingDocuments =
            (project.require_purchase_order && !await hasDocument('purchase_order') ? 1 : 0)
            + (project.require_service_acceptance && !await hasDocument('service_acceptance') ? 1 : 0);

        const item = (
            key: ClosureChecklistItem['key'], label: string, pendingCount: number, blocking: boolean
        ): ClosureChecklistItem => ({ key, label, ok: pendingCount === 0, pending_count: pendingCount, blocking });

        return [
            item('delivery_accepted', 'Entrega aceptada por el cliente', project.delivery_accepted_at ? 0 : 1, true),
            item('payment_milestones', 'Hitos de pago pagados', pendingMilestones, true),
            item('invoices_paid', 'Facturas sin saldo pendiente', unpaidInvoices, true),
            item('timesheets_approved', 'Horas registradas aprobadas', unapprovedTimeEntries, false),
            item('tasks_done', 'Tareas terminadas', openTasks, false),
            item('required_documents', 'Documentos obligatorios registrados (OC / HES)', missingDocuments, true)
        ];
    }

    /** Última versión aprobada de la cotización, en CLP; sin cotización aprobada todo queda en 0 y version null. */
    private async getQuoted(projectId: number): Promise<ClosureReport['quoted']> {
        const quote = await db.get(
            `SELECT version, amount, currency, hours, estimated_cost, margin_percent FROM project_quotes
             WHERE project_id = ? AND status = 'approved' ORDER BY version DESC LIMIT 1`,
            [projectId]
        );
        if (!quote) return { amount_clp: 0, hours: 0, estimated_cost_clp: 0, margin_percent: null, version: null };

        const currency = quote.currency as Currency;
        return {
            amount_clp: Math.round(await financeService.toCLP(Number(quote.amount), currency)),
            hours: Number(quote.hours ?? 0),
            estimated_cost_clp: quote.estimated_cost == null ? 0 : Math.round(await financeService.toCLP(Number(quote.estimated_cost), currency)),
            margin_percent: quote.margin_percent ?? null,
            version: quote.version
        };
    }

    /**
     * Personas asignadas (incluso dadas de baja) más quienes tienen horas aprobadas sin asignación,
     * para que la suma de horas del equipo cuadre con las horas aprobadas del proyecto.
     */
    private async getTeam(projectId: number): Promise<ClosureReport['team']> {
        const rows = await db.query(
            `SELECT u.full_name AS user_name,
                    COALESCE((SELECT SUM(pa.budgeted_hours) FROM project_assignments pa WHERE pa.project_id = ? AND pa.user_id = u.id), 0) AS budgeted_hours,
                    COALESCE((SELECT SUM(te.hours) FROM time_entries te WHERE te.project_id = ? AND te.user_id = u.id AND te.approval_status = 'approved'), 0) AS actual_hours
             FROM users u
             WHERE u.id IN (SELECT user_id FROM project_assignments WHERE project_id = ?)
                OR u.id IN (SELECT user_id FROM time_entries WHERE project_id = ? AND approval_status = 'approved')
             ORDER BY u.full_name ASC, u.id ASC`,
            [projectId, projectId, projectId, projectId]
        );
        return rows.map((row: any) => ({
            user_name: row.user_name,
            budgeted_hours: roundHours(Number(row.budgeted_hours)),
            actual_hours: roundHours(Number(row.actual_hours))
        }));
    }
}

export const closureReportService = new ClosureReportService();
