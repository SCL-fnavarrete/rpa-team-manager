import { db } from '../database/database';
import { logger } from '../utils/logger';
import { financeService, Currency, ProjectFinancials } from './financeService';
import { projectHealthService } from './projectHealthService';

export interface PortfolioFilters { client_id?: number; sales_rep_id?: number; commercial_stage?: 'quoting' | 'approved' | 'lost'; area_id?: number }

export interface PortfolioRow {
    project_id: number; project_name: string; status: string; commercial_stage: string;
    client_id: number | null; client_name: string | null;
    sales_rep_id: number | null; sales_rep_name: string | null;
    area_id: number | null; area_name: string | null;
    sale_price: number; real_cost: number; projected_cost: number;
    real_profit: number; projected_profit: number;
    real_margin_percentage: number; projected_margin_percentage: number;
    /** 'projected': el costo real es el planificado porque el proyecto aún no tiene horas aprobadas. */
    real_hours_source: 'approved' | 'projected';
    health_semaphore: 'green' | 'yellow' | 'red' | 'gray';
    invoiced_clp: number; collected_clp: number; pending_to_invoice_clp: number;
    financials_error: boolean;
}

export interface PortfolioResult {
    rows: PortfolioRow[];
    totals: { projects: number; sale_price: number; real_cost: number; projected_cost: number; projected_profit: number; invoiced_clp: number; collected_clp: number; pending_to_invoice_clp: number };
    pipeline: { project_id: number; project_name: string; client_name: string | null; sales_rep_name: string | null; last_quote_amount_clp: number; last_quote_version: number | null }[];
    sales_by_rep: { sales_rep_id: number | null; sales_rep_name: string; projects: number; sale_price: number }[];
}

const UNASSIGNED_REP_NAME = 'Sin asignar';

/** Proyecto ya en marcha o terminado; una cotización real siempre está 'on_hold'. */
const EXECUTION_STATUSES = ['active', 'completed'];

/** Estados que sacan a un proyecto 'quoting' del pipeline: ya se ejecuta o terminó, o la cotización se canceló. */
const OUT_OF_PIPELINE_STATUSES = [...EXECUTION_STATUSES, 'cancelled'];

/**
 * Venta realizada: el cliente dio el OK (etapa 'approved') y el proyecto no se canceló; el resto (en cotización,
 * perdido, cancelado) no suma a venta, costo ni por facturar. También cuenta un proyecto 'quoting' ya activo o
 * completado: "Crear desde cotización" (POST /projects/from-quote) lo crea activo sin fijar la etapa y la BD le
 * pone 'quoting' por defecto, mientras que una cotización real nace 'on_hold' (createProject y scoping) y
 * updateProject impide activarla sin la aprobación del cliente. Los internos nacen 'approved' en createProject.
 * Es el criterio único de venta realizada: la cartera y el Centro PMO ejecutivo lo comparten para que sus cifras cuadren.
 */
export const isRealizedSale = (row: { status: string; commercial_stage: string }): boolean =>
    row.status !== 'cancelled'
    && (row.commercial_stage === 'approved' || (row.commercial_stage === 'quoting' && EXECUTION_STATUSES.includes(row.status)));

const PROJECT_JOINS = `
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    LEFT JOIN sales_reps sr ON sr.id = p.sales_rep_id
    LEFT JOIN business_areas ba ON ba.id = p.area_id`;

/**
 * Cartera de proyectos: junta en una sola vista las cifras que ya calculan financeService
 * (venta, costo, margen), projectHealthService (semáforo) y las tablas de cobranza.
 * No recalcula costos por su cuenta: solo compone y totaliza.
 */
export class PortfolioService {
    async getPortfolio(filters: PortfolioFilters = {}): Promise<PortfolioResult> {
        const { clause, params } = this.buildWhere(filters);
        const projects = await db.query(
            `SELECT p.id, p.name, p.status, p.commercial_stage,
                    p.client_id, c.name AS client_name,
                    p.sales_rep_id, sr.name AS sales_rep_name,
                    p.area_id, ba.name AS area_name
             ${PROJECT_JOINS}
             ${clause}
             ORDER BY p.name ASC, p.id ASC`,
            params
        );

        const { invoiced, collected } = await this.getBillingByProject(projects.map((p: any) => Number(p.id)));

        const rows = await Promise.all(projects.map((p: any) =>
            this.buildRow(p, invoiced.get(Number(p.id)) ?? 0, collected.get(Number(p.id)) ?? 0)
        ));

        return {
            rows,
            totals: this.buildTotals(rows),
            pipeline: await this.getPipeline(filters),
            sales_by_rep: this.buildSalesByRep(rows)
        };
    }

    /**
     * Facturado (facturas que no son borrador ni anuladas) y cobrado (pagos de facturas no anuladas) por proyecto,
     * en CLP. Lo comparten la cartera y el Centro PMO ejecutivo para que sus cifras de cobranza cuadren.
     */
    async getBillingByProject(projectIds: number[]): Promise<{ invoiced: Map<number, number>; collected: Map<number, number> }> {
        const invoiced = await this.sumByProjectToCLP(
            `SELECT i.project_id, i.currency, SUM(i.amount) AS amount
             FROM invoices i
             WHERE i.status NOT IN ('draft', 'cancelled') AND i.project_id IN (${this.placeholders(projectIds)})
             GROUP BY i.project_id, i.currency`,
            projectIds
        );
        const collected = await this.sumByProjectToCLP(
            `SELECT i.project_id, pay.currency, SUM(pay.amount) AS amount
             FROM payments pay
             JOIN invoices i ON i.id = pay.invoice_id
             WHERE i.status <> 'cancelled' AND i.project_id IN (${this.placeholders(projectIds)})
             GROUP BY i.project_id, pay.currency`,
            projectIds
        );
        return { invoiced, collected };
    }

    private async buildRow(project: any, invoicedCLP: number, collectedCLP: number): Promise<PortfolioRow> {
        let financials: ProjectFinancials | null = null;
        try {
            financials = await financeService.calculateProjectFinancials(project.id);
        } catch (error) {
            logger.error(`Portfolio: no se pudieron calcular las finanzas del proyecto ${project.id}:`, error);
        }

        let semaphore: PortfolioRow['health_semaphore'] = 'gray';
        try {
            semaphore = (await projectHealthService.getProjectHealth(project.id)).semaphore;
        } catch (error) {
            logger.error(`Portfolio: no se pudo calcular la salud del proyecto ${project.id}:`, error);
        }

        const salePrice = financials?.sale_price ?? 0;
        return {
            project_id: project.id,
            project_name: project.name,
            status: project.status,
            commercial_stage: project.commercial_stage,
            client_id: project.client_id ?? null,
            client_name: project.client_name ?? null,
            sales_rep_id: project.sales_rep_id ?? null,
            sales_rep_name: project.sales_rep_name ?? null,
            area_id: project.area_id ?? null,
            area_name: project.area_name ?? null,
            sale_price: salePrice,
            real_cost: financials?.real_cost ?? 0,
            projected_cost: financials?.projected_cost ?? 0,
            real_profit: financials?.real_profit ?? 0,
            projected_profit: financials?.projected_profit ?? 0,
            real_margin_percentage: financials?.real_margin_percentage ?? 0,
            projected_margin_percentage: financials?.projected_margin_percentage ?? 0,
            real_hours_source: financials?.real_hours_source ?? 'approved',
            health_semaphore: semaphore,
            invoiced_clp: invoicedCLP,
            collected_clp: collectedCLP,
            pending_to_invoice_clp: Math.max(salePrice - invoicedCLP, 0),
            financials_error: financials === null
        };
    }

    /**
     * Venta, costo y pendiente por facturar solo suman venta realizada (ver isRealizedSale);
     * lo facturado y cobrado suma todas las filas porque es dinero real, y projects cuenta las filas devueltas.
     */
    private buildTotals(rows: PortfolioRow[]): PortfolioResult['totals'] {
        const sum = (list: PortfolioRow[], pick: (row: PortfolioRow) => number) => list.reduce((acc, row) => acc + pick(row), 0);
        const realized = rows.filter(isRealizedSale);
        return {
            projects: rows.length,
            sale_price: sum(realized, r => r.sale_price),
            real_cost: sum(realized, r => r.real_cost),
            projected_cost: sum(realized, r => r.projected_cost),
            projected_profit: sum(realized, r => r.projected_profit),
            invoiced_clp: sum(rows, r => r.invoiced_clp),
            collected_clp: sum(rows, r => r.collected_clp),
            pending_to_invoice_clp: sum(realized, r => r.pending_to_invoice_clp)
        };
    }

    /** Venta por comercial sobre las filas ya filtradas; solo cuenta la venta realizada, así que suma lo mismo que totals.sale_price. */
    private buildSalesByRep(rows: PortfolioRow[]): PortfolioResult['sales_by_rep'] {
        const byRep = new Map<number | null, PortfolioResult['sales_by_rep'][number]>();
        for (const row of rows) {
            if (!isRealizedSale(row)) continue;
            const entry = byRep.get(row.sales_rep_id) ?? {
                sales_rep_id: row.sales_rep_id,
                sales_rep_name: row.sales_rep_name ?? UNASSIGNED_REP_NAME,
                projects: 0,
                sale_price: 0
            };
            entry.projects += 1;
            entry.sale_price += row.sale_price;
            byRep.set(row.sales_rep_id, entry);
        }
        return [...byRep.values()].sort((a, b) => b.sale_price - a.sale_price || a.sales_rep_name.localeCompare(b.sales_rep_name));
    }

    /**
     * Cotizaciones en curso con el monto de su última versión; ignora el filtro de etapa pero respeta el resto.
     * Excluye los 'quoting' ya activos o completados (la cartera los cuenta como venta realizada) y los
     * cancelados (cotización que ya no sigue viva).
     */
    private async getPipeline(filters: PortfolioFilters): Promise<PortfolioResult['pipeline']> {
        const { clause, params } = this.buildWhere({ ...filters, commercial_stage: 'quoting' });
        const projects = await db.query(
            `SELECT p.id, p.name, c.name AS client_name, sr.name AS sales_rep_name,
                    q.version AS last_quote_version, q.amount AS last_quote_amount, q.currency AS last_quote_currency
             ${PROJECT_JOINS}
             LEFT JOIN project_quotes q ON q.project_id = p.id
                AND q.version = (SELECT MAX(version) FROM project_quotes WHERE project_id = p.id)
             ${clause} AND p.status NOT IN (${this.placeholders(OUT_OF_PIPELINE_STATUSES)})
             ORDER BY p.name ASC, p.id ASC`,
            [...params, ...OUT_OF_PIPELINE_STATUSES]
        );

        const pipeline: PortfolioResult['pipeline'] = [];
        for (const p of projects) {
            const amount = p.last_quote_version === null
                ? 0
                : await financeService.toCLP(Number(p.last_quote_amount), p.last_quote_currency as Currency);
            pipeline.push({
                project_id: p.id,
                project_name: p.name,
                client_name: p.client_name ?? null,
                sales_rep_name: p.sales_rep_name ?? null,
                last_quote_amount_clp: Math.round(amount),
                last_quote_version: p.last_quote_version ?? null
            });
        }
        return pipeline;
    }

    /** Condiciones de filtro con parámetros enlazados; nunca interpola valores en el SQL. */
    private buildWhere(filters: PortfolioFilters): { clause: string; params: (string | number)[] } {
        const conditions: string[] = [];
        const params: (string | number)[] = [];
        if (filters.client_id !== undefined) { conditions.push('p.client_id = ?'); params.push(filters.client_id); }
        if (filters.sales_rep_id !== undefined) { conditions.push('p.sales_rep_id = ?'); params.push(filters.sales_rep_id); }
        if (filters.commercial_stage !== undefined) { conditions.push('p.commercial_stage = ?'); params.push(filters.commercial_stage); }
        if (filters.area_id !== undefined) { conditions.push('p.area_id = ?'); params.push(filters.area_id); }
        return { clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params };
    }

    private placeholders(values: unknown[]): string {
        return values.length > 0 ? values.map(() => '?').join(', ') : 'NULL';
    }

    /** Ejecuta una query (project_id, currency, amount) y devuelve el total en CLP por proyecto. */
    private async sumByProjectToCLP(sql: string, projectIds: number[]): Promise<Map<number, number>> {
        const totals = new Map<number, number>();
        if (projectIds.length === 0) return totals;

        const rows: { project_id: number; currency: string; amount: number }[] = await db.query(sql, projectIds);
        for (const row of rows) {
            const clp = await financeService.toCLP(Number(row.amount), row.currency as Currency);
            totals.set(row.project_id, (totals.get(row.project_id) ?? 0) + clp);
        }
        return new Map([...totals].map(([projectId, total]) => [projectId, Math.round(total)]));
    }
}

export const portfolioService = new PortfolioService();
