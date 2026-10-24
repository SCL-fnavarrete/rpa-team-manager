// eslint-disable-next-line @typescript-eslint/no-var-requires
jest.mock('../../database/database', () => ({ db: require('../helpers/realTestDb').realDbProxy }));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/authService', () => ({
    AuthService: jest.fn().mockImplementation(() => ({}))
}));
jest.mock('../../services/emailService', () => ({ emailService: { sendEmail: jest.fn() } }));
jest.mock('../../middleware/auth', () => {
    const actual = jest.requireActual('../../middleware/auth');
    return {
        ...actual,
        authenticate: (req: any, _res: any, next: any) => {
            req.user = { id: 1, role: req.headers['x-test-role'] };
            next();
        }
    };
});

import express from 'express';
import request from 'supertest';
import { logger } from '../../utils/logger';
import { financeService } from '../../services/financeService';
import { portfolioService } from '../../services/portfolioService';
import pmoRoutes from '../../routes/pmoRoutes';
import { stripFinancials } from '../../controllers/pmoController';
import { createRealTestDb, realDbHolder, seedBasicUsers, RealTestDb, TestUsers } from '../helpers/realTestDb';

const app = express();
app.use(express.json());
app.use('/api/pmo', pmoRoutes);

// Claves que contienen cost/profit/margin/cpi y se conservan a propósito para todos los roles: la imputación por
// centro de costo reparte el monto de venta o cotización del proyecto (no es un costo interno de la empresa) y
// cualquier usuario autenticado ya puede leerla en /cost-centers.
const ALLOWED_COST_KEYS = new Set(['cost_centers_summary', 'cost_center_id']);
const FINANCIAL_KEY = /cost|profit|margin|cpi/i;

function financialKeys(value: unknown, path = '$'): string[] {
    if (Array.isArray(value)) return value.flatMap((item, index) => financialKeys(item, `${path}[${index}]`));
    if (value === null || typeof value !== 'object') return [];
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
        ...(FINANCIAL_KEY.test(key) && !ALLOWED_COST_KEYS.has(key) ? [`${path}.${key}`] : []),
        ...financialKeys(child, `${path}.${key}`)
    ]);
}

interface SeedProject {
    name: string;
    stage?: 'quoting' | 'approved' | 'lost';
    status?: 'active' | 'on_hold' | 'completed' | 'cancelled';
    clientId?: number | null;
    salePrice?: number;
    budgetedCost?: number;
    budgetedHours?: number;
}

describe('GET /api/pmo/executive-suite - costos y márgenes por rol y cifras alineadas con la cartera (SQLite real)', () => {
    let testDb: RealTestDb;
    let users: TestUsers;
    let invoiceSeq = 0;

    beforeAll(async () => {
        testDb = await createRealTestDb();
        realDbHolder.current = testDb;
        users = await seedBasicUsers(testDb);
        // El dev tiene tarifa vigente y sus horas aprobadas se valorizan con ella (snapshot de la entrada)
        await testDb.run(
            `INSERT INTO user_cost_rates (user_id, monthly_cost, hourly_rate, effective_from, created_by) VALUES (?, 1344000, 8000, '2026-01-01', ?)`,
            [users.dev, users.lead]
        );
    });

    afterAll(async () => {
        realDbHolder.current = null;
        await testDb.close();
    });

    beforeEach(async () => {
        for (const table of [
            'payments', 'invoices', 'payment_milestones', 'project_cost_center_allocations', 'project_pmo_metrics',
            'project_quotes', 'time_entries', 'project_assignments', 'project_milestones', 'project_baselines',
            'project_financials', 'projects', 'clients', 'exchange_rates'
        ]) {
            await testDb.run(`DELETE FROM ${table}`);
        }
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const getSuite = (role: string) => request(app).get('/api/pmo/executive-suite').set('x-test-role', role);

    // Una cotización real nace 'on_hold' (createProject y scoping); el resto de los proyectos, 'active'.
    async function addProject(p: SeedProject): Promise<number> {
        const stage = p.stage ?? 'approved';
        const { id } = await testDb.run(
            `INSERT INTO projects (name, status, commercial_stage, client_id) VALUES (?, ?, ?, ?)`,
            [p.name, p.status ?? (stage === 'quoting' ? 'on_hold' : 'active'), stage, p.clientId ?? null]
        );
        if (p.salePrice !== undefined || p.budgetedCost !== undefined || p.budgetedHours !== undefined) {
            await testDb.run(
                `INSERT INTO project_financials (project_id, sale_price, sale_price_currency, budgeted_cost, budgeted_hours)
                 VALUES (?, ?, 'CLP', ?, ?)`,
                [id, p.salePrice ?? null, p.budgetedCost ?? 0, p.budgetedHours ?? 0]
            );
        }
        return id!;
    }

    async function addApprovedHours(projectId: number, hours: number): Promise<void> {
        await testDb.run(
            `INSERT INTO project_assignments (project_id, user_id, allocation_percentage, assigned_by) VALUES (?, ?, 100, ?)`,
            [projectId, users.dev, users.lead]
        );
        await testDb.run(
            `INSERT INTO time_entries (user_id, project_id, hours, date, approval_status, cost_rate_snapshot) VALUES (?, ?, ?, '2026-10-05', 'approved', 8000)`,
            [users.dev, projectId, hours]
        );
    }

    async function addInvoice(
        projectId: number, amount: number, dueDate: string, status = 'issued', currency: 'CLP' | 'USD' = 'CLP'
    ): Promise<number> {
        invoiceSeq += 1;
        return (await testDb.run(
            `INSERT INTO invoices (project_id, invoice_number, issue_date, due_date, currency, amount, status)
             VALUES (?, ?, '2026-10-01', ?, ?, ?, ?)`,
            [projectId, `F-${invoiceSeq}`, dueDate, currency, amount, status]
        )).id!;
    }

    async function addPayment(invoiceId: number, amount: number): Promise<void> {
        await testDb.run(
            `INSERT INTO payments (invoice_id, amount, currency, payment_date) VALUES (?, ?, 'CLP', '2026-10-10')`,
            [invoiceId, amount]
        );
    }

    async function addBillableMilestone(projectId: number, amount: number): Promise<void> {
        await testDb.run(
            `INSERT INTO payment_milestones (project_id, name, amount, currency, trigger_type, status, planned_date, billable_at)
             VALUES (?, 'Hito de pago 1', ?, 'CLP', 'date', 'billable', '2026-10-01', '2026-10-02')`,
            [projectId, amount]
        );
    }

    async function addApprovedQuote(projectId: number, hours: number, marginPercent: number, amount: number): Promise<void> {
        await testDb.run(
            `INSERT INTO project_quotes (project_id, version, amount, currency, hours, margin_percent, status) VALUES (?, 1, ?, 'CLP', ?, ?, 'approved')`,
            [projectId, amount, hours, marginPercent]
        );
    }

    // Proyecto realizado con sobrecosto (200.000 reales vs 100.000 presupuestados), horas por sobre lo cotizado,
    // un hito listo para facturar y una factura vencida: toca todas las secciones de la respuesta.
    async function seedFullScenario(): Promise<{ projectId: number }> {
        const clientId = (await testDb.run(`INSERT INTO clients (name) VALUES ('Cliente Alfa')`)).id!;
        const projectId = await addProject({ name: 'Alfa', clientId, salePrice: 1000000, budgetedCost: 100000, budgetedHours: 10 });
        await addApprovedHours(projectId, 25);
        await addApprovedQuote(projectId, 10, 60, 1000000);
        await addBillableMilestone(projectId, 250000);
        await addInvoice(projectId, 400000, '2020-01-01');
        return { projectId };
    }

    it('rpa_operations y billing no reciben campos de costo, utilidad ni margen en executive-suite', async () => {
        await seedFullScenario();

        for (const role of ['rpa_operations', 'billing']) {
            const res = await getSuite(role);

            expect(res.status).toBe(200);
            expect(financialKeys(res.body)).toEqual([]);
            // el sobrecosto en pesos tampoco puede colarse dentro de un texto
            const risk = res.body.general_manager.top_risk_projects;
            expect(risk).toHaveLength(1);
            expect(risk[0].critical_reason).not.toMatch(/\$|\d{3}/);
        }
    });

    it('billing conserva montos de hitos, facturas, cartera vencida y aging, y rpa_operations alertas, riesgos, scope creep e imputaciones faltantes', async () => {
        const { projectId } = await seedFullScenario();

        const billing = (await getSuite('billing')).body;
        expect(billing.commercial.total_unlocked_revenue_clp).toBe(250000);
        expect(billing.commercial.ready_to_invoice).toHaveLength(1);
        expect(billing.commercial.ready_to_invoice[0]).toMatchObject({ project_id: projectId, amount_clp: 250000 });
        expect(billing.controller.aging_portfolio).toMatchObject({ overdue_60_clp: 400000, total_overdue_clp: 400000 });
        expect(billing.controller.aging_portfolio.overdue_invoices).toHaveLength(1);
        expect(billing.controller.triple_conciliation[0]).toMatchObject({
            project_id: projectId, sale_price_clp: 1000000, invoiced_clp: 400000, billed_pct: 40
        });
        expect(billing.controller.cost_centers_summary).toEqual(expect.any(Array));

        const ops = (await getSuite('rpa_operations')).body;
        expect(ops.general_manager.portfolio_health_summary).toEqual({ healthy: 0, warning: 0, critical: 1 });
        expect(ops.general_manager.top_risk_projects).toHaveLength(1);
        expect(ops.commercial.scope_creep_alerts).toEqual([
            expect.objectContaining({ project_id: projectId, quoted_hours: 10, real_hours: 25, overrun_hours: 15, severity: 'warning' })
        ]);
        const missing = ops.controller.imputations_audit.users_with_missing_days.map((u: any) => u.user_id);
        expect(missing).toContain(users.dev);
    });

    it('team_lead sigue recibiendo margen y utilidad', async () => {
        const { projectId } = await seedFullScenario();

        const res = await getSuite('team_lead');

        expect(res.status).toBe(200);
        expect(res.body.general_manager.consolidated_pnl).toMatchObject({
            total_sold_clp: 1000000, total_real_cost_clp: 200000, total_gross_profit_clp: 800000, avg_margin_pct: 80
        });
        expect(res.body.general_manager.top_risk_projects[0]).toMatchObject({
            id: projectId, real_cost_clp: 200000, budgeted_cost_clp: 100000, cost_variance_clp: 100000
        });
        expect(res.body.general_manager.top_risk_projects[0].critical_reason).toMatch(/^Sobrecosto de \$100\.000/);
        expect(res.body.commercial.margin_variance).toEqual([
            expect.objectContaining({ project_id: projectId, quoted_margin_pct: 60, real_margin_pct: 80, real_cost_clp: 200000 })
        ]);
        expect(res.body.commercial.scope_creep_alerts[0]).toMatchObject({ overrun_hours: 15, overrun_cost_clp: 525000 });
        expect(res.body.controller.triple_conciliation[0]).toMatchObject({
            real_cost_clp: 200000, budgeted_cost_clp: 100000, cost_consumed_pct: 200, cpi: expect.any(Number)
        });
        expect(financialKeys(res.body).length).toBeGreaterThan(0);
    });

    it('la venta consolidada excluye proyectos perdidos, cancelados y en cotización, igual que la cartera', async () => {
        await addProject({ name: 'Vigente', salePrice: 1000000, budgetedCost: 600000, budgetedHours: 10 });
        await addProject({ name: 'Cotizando', stage: 'quoting', salePrice: 4000000, budgetedCost: 300000, budgetedHours: 10 });
        await addProject({ name: 'Perdido', stage: 'lost', salePrice: 5000000, budgetedCost: 100000, budgetedHours: 10 });
        await addProject({ name: 'Cancelado', status: 'cancelled', salePrice: 3000000, budgetedCost: 200000, budgetedHours: 10 });
        // "Crear desde cotización" lo deja activo con la etapa por defecto 'quoting': la cartera lo cuenta como venta realizada
        await addProject({ name: 'Desde cotización', stage: 'quoting', status: 'active', salePrice: 2000000, budgetedCost: 500000, budgetedHours: 10 });

        const res = await getSuite('team_lead');
        const portfolio = await portfolioService.getPortfolio();

        expect(portfolio.totals.sale_price).toBe(3000000);
        expect(res.body.general_manager.consolidated_pnl).toMatchObject({
            total_sold_clp: portfolio.totals.sale_price,
            total_real_cost_clp: portfolio.totals.real_cost,
            total_gross_profit_clp: 1900000,
            avg_margin_pct: 63.3,
            active_projects_count: 2,
            total_projects_count: 2
        });
        // los proyectos que no son venta realizada tampoco aparecen en el resto de las vistas
        const names = res.body.controller.triple_conciliation.map((r: any) => r.project_name).sort();
        expect(names).toEqual(['Desde cotización', 'Vigente']);
        expect(res.body.general_manager.portfolio_health_summary).toEqual({ healthy: 2, warning: 0, critical: 0 });
        expect(res.body.commercial.client_scorecards).toEqual([]);
    });

    it('sin filas en project_pmo_metrics el P&L no se vacía ni se rompe', async () => {
        await addProject({ name: 'Alfa', salePrice: 1000000, budgetedCost: 400000, budgetedHours: 10 });
        await addProject({ name: 'Beta', salePrice: 500000, budgetedCost: 300000, budgetedHours: 10 });
        expect(await testDb.get(`SELECT COUNT(*) AS n FROM project_pmo_metrics`)).toEqual({ n: 0 });

        const res = await getSuite('team_lead');

        expect(res.status).toBe(200);
        expect(res.body.general_manager.consolidated_pnl).toMatchObject({
            total_sold_clp: 1500000, total_real_cost_clp: 700000, total_gross_profit_clp: 800000, avg_margin_pct: 53.3
        });
        expect(res.body.controller.triple_conciliation).toHaveLength(2);
    });

    it('el P&L usa solo financeService: ignora planned_budget y actual_cost de project_pmo_metrics y budget del proyecto', async () => {
        const sinPrecio = await addProject({ name: 'Sin precio ni costo' });
        await testDb.run(`UPDATE projects SET budget = 900000 WHERE id = ?`, [sinPrecio]);
        await testDb.run(
            `INSERT INTO project_pmo_metrics (project_id, planned_budget, actual_cost, completion_percentage) VALUES (?, 700000, 650000, 30)`,
            [sinPrecio]
        );

        const res = await getSuite('team_lead');

        expect(res.body.general_manager.consolidated_pnl).toMatchObject({
            total_sold_clp: 0, total_real_cost_clp: 0, total_gross_profit_clp: 0, avg_margin_pct: 0
        });
        // el avance físico sigue viniendo de las métricas PMO manuales
        expect(res.body.controller.triple_conciliation[0]).toMatchObject({
            project_id: sinPrecio, sale_price_clp: 0, real_cost_clp: 0, budgeted_cost_clp: 0, physical_progress_pct: 30
        });
    });

    it('una falla al calcular las finanzas de un proyecto se registra y no rompe la respuesta', async () => {
        await addProject({ name: 'Alfa', salePrice: 1000000, budgetedCost: 400000, budgetedHours: 10 });
        jest.spyOn(financeService, 'calculateProjectFinancials').mockRejectedValue(new Error('fallo simulado'));
        (logger.error as jest.Mock).mockClear();

        const res = await getSuite('team_lead');

        expect(res.status).toBe(200);
        expect(res.body.general_manager.consolidated_pnl.total_sold_clp).toBe(0);
        expect(res.body.controller.triple_conciliation).toHaveLength(1);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('finanzas del proyecto'), expect.any(Error));
    });

    it('invoiced_clp y paid_clp coinciden con los de la cartera: sin duplicar facturas con varios pagos, sin borradores y convirtiendo USD', async () => {
        await testDb.run(`INSERT INTO exchange_rates (currency, rate_date, rate_to_clp) VALUES ('USD', '2020-01-01', 950)`);
        const projectId = await addProject({ name: 'Con facturas', salePrice: 1000000, budgetedCost: 400000, budgetedHours: 10 });
        const dosPagos = await addInvoice(projectId, 300000, '2030-01-01');
        await addPayment(dosPagos, 100000);
        await addPayment(dosPagos, 50000);
        await addInvoice(projectId, 999999, '2030-01-01', 'draft');
        await addInvoice(projectId, 100, '2030-01-01', 'issued', 'USD'); // 100 USD x 950 = 95.000
        await addInvoice(projectId, 888888, '2030-01-01', 'cancelled');

        const res = await getSuite('team_lead');
        const portfolio = await portfolioService.getPortfolio();

        const row = portfolio.rows.find(r => r.project_id === projectId)!;
        expect(row).toMatchObject({ invoiced_clp: 395000, collected_clp: 150000 });
        const conciliation = res.body.controller.triple_conciliation.find((r: any) => r.project_id === projectId);
        expect(conciliation).toMatchObject({ invoiced_clp: row.invoiced_clp, paid_clp: row.collected_clp, billed_pct: 40 });
        // lo mismo le llega a billing
        const billing = (await getSuite('billing')).body.controller.triple_conciliation.find((r: any) => r.project_id === projectId);
        expect(billing).toMatchObject({ invoiced_clp: 395000, paid_clp: 150000 });
    });

    describe('señales que no dependen del costo para quien no es team_lead', () => {
        // Dos proyectos críticos con el mismo atraso y riesgo, pero Beta (creado primero) con más sobrecosto que Alfa.
        async function seedTwoRiskProjects(): Promise<void> {
            const beta = await addProject({ name: 'Beta', salePrice: 1000000, budgetedCost: 100000, budgetedHours: 10 });
            const alfa = await addProject({ name: 'Alfa', salePrice: 1000000, budgetedCost: 150000, budgetedHours: 10 });
            for (const id of [beta, alfa]) {
                await addApprovedHours(id, 25); // costo real 200.000 en ambos
                await testDb.run(`INSERT INTO project_pmo_metrics (project_id, schedule_variance_days, risk_level) VALUES (?, 6, 'low')`, [id]);
            }
        }

        it('top_risk_projects de rpa_operations se ordena sin mirar el sobrecosto (empate por nombre) y el de team_lead sigue ordenado por sobrecosto', async () => {
            await seedTwoRiskProjects();

            const ops = (await getSuite('rpa_operations')).body.general_manager.top_risk_projects.map((p: any) => p.name);
            const billing = (await getSuite('billing')).body.general_manager.top_risk_projects.map((p: any) => p.name);
            const lead = (await getSuite('team_lead')).body.general_manager.top_risk_projects;

            expect(ops).toEqual(['Alfa', 'Beta']);
            expect(billing).toEqual(['Alfa', 'Beta']);
            expect(lead.map((p: any) => p.name)).toEqual(['Beta', 'Alfa']);
            expect(lead.map((p: any) => p.cost_variance_clp)).toEqual([100000, 50000]);
        });

        it('top_risk_projects de rpa_operations pone primero lo crítico, luego más atraso y luego más riesgo', async () => {
            const atrasado = await addProject({ name: 'Zeta atrasado', salePrice: 1000000, budgetedCost: 100000, budgetedHours: 10 });
            const riesgoso = await addProject({ name: 'Yota riesgoso', salePrice: 1000000, budgetedCost: 100000, budgetedHours: 10 });
            const alerta = await addProject({ name: 'Alfa en alerta', salePrice: 1000000, budgetedCost: 100000, budgetedHours: 10 });
            const riesgoAlto = await addProject({ name: 'Mu riesgo alto', salePrice: 1000000, budgetedCost: 100000, budgetedHours: 10 });
            await testDb.run(`INSERT INTO project_pmo_metrics (project_id, schedule_variance_days, risk_level) VALUES (?, 9, 'low')`, [atrasado]);
            await testDb.run(`INSERT INTO project_pmo_metrics (project_id, schedule_variance_days, risk_level) VALUES (?, 7, 'critical')`, [riesgoso]);
            await testDb.run(`INSERT INTO project_pmo_metrics (project_id, schedule_variance_days, risk_level) VALUES (?, 7, 'high')`, [riesgoAlto]);
            await testDb.run(`INSERT INTO project_pmo_metrics (project_id, schedule_variance_days, risk_level) VALUES (?, 3, 'high')`, [alerta]);

            const ops = (await getSuite('rpa_operations')).body.general_manager.top_risk_projects.map((p: any) => p.name);

            // crítico (atraso > 5): 9 días, luego 7 días con riesgo crítico antes que 7 días con riesgo alto; al final el que solo está en alerta
            expect(ops).toEqual(['Zeta atrasado', 'Yota riesgoso', 'Mu riesgo alto', 'Alfa en alerta']);
        });

        it('la severity del scope creep de rpa_operations se basa solo en horas y la de team_lead también mira la fuga de margen', async () => {
            // 15 h sobre lo cotizado (menos de 20) y fuga de margen de 19 puntos (cotizado 99%, real 80%)
            const projectId = await addProject({ name: 'Alfa', salePrice: 1000000, budgetedCost: 100000, budgetedHours: 10 });
            await addApprovedHours(projectId, 25);
            await addApprovedQuote(projectId, 10, 99, 1000000);

            const lead = (await getSuite('team_lead')).body.commercial.scope_creep_alerts;
            const ops = (await getSuite('rpa_operations')).body.commercial.scope_creep_alerts;

            expect(lead).toEqual([expect.objectContaining({ overrun_hours: 15, severity: 'critical' })]);
            expect(ops).toEqual([expect.objectContaining({ overrun_hours: 15, severity: 'warning' })]);
        });

        it('la severity de rpa_operations es crítica cuando las horas excedidas superan 20', async () => {
            const projectId = await addProject({ name: 'Alfa', salePrice: 1000000, budgetedCost: 100000, budgetedHours: 10 });
            await addApprovedHours(projectId, 35);
            await addApprovedQuote(projectId, 10, 50, 1000000);

            const ops = (await getSuite('rpa_operations')).body.commercial.scope_creep_alerts;

            expect(ops).toEqual([expect.objectContaining({ overrun_hours: 25, severity: 'critical' })]);
        });
    });
});

describe('stripFinancials', () => {
    const suite = () => ({
        general_manager: {
            consolidated_pnl: {
                total_sold_clp: 100, total_real_cost_clp: 60, total_gross_profit_clp: 40, avg_margin_pct: 40,
                active_projects_count: 1, total_projects_count: 1, billable_hours_ratio: 80
            },
            cashflow_forecast: [{ month: '2026-11', expected_amount_clp: 50 }],
            portfolio_health_summary: { healthy: 0, warning: 0, critical: 1 },
            top_risk_projects: [{
                id: 1, name: 'Alfa', cost_variance_clp: 10, real_cost_clp: 60, budgeted_cost_clp: 50, sale_price_clp: 100,
                critical_reason: 'Retraso crítico de 7 días frente a la fecha comprometida'
            }],
            team_utilization_summary: { total_planned_fte: 1 }
        },
        commercial: {
            ready_to_invoice: [{ milestone_id: 1, amount_clp: 30 }],
            total_unlocked_revenue_clp: 30,
            margin_variance: [{ project_id: 1, quoted_margin_pct: 50, real_margin_pct: 40, real_cost_clp: 60 }],
            scope_creep_alerts: [{ project_id: 1, overrun_hours: 5, overrun_cost_clp: 175000, severity: 'warning' }],
            client_scorecards: [{ client_id: 1, total_sold_clp: 100 }]
        },
        controller: {
            triple_conciliation: [{
                project_id: 1, physical_progress_pct: 50, cost_consumed_pct: 120, billed_pct: 40, cpi: 0.8,
                deviation_flag: 'cost_overrun', sale_price_clp: 100, budgeted_cost_clp: 50, real_cost_clp: 60, invoiced_clp: 40, paid_clp: 10
            }],
            imputations_audit: { users_with_missing_days: [] },
            cost_centers_summary: [{ cost_center_id: 1, code: 'RPA-CL', total_budget_clp: 100 }],
            aging_portfolio: { total_overdue_clp: 5 }
        }
    });

    it('team_lead recibe la respuesta completa', () => {
        const data = suite();

        expect(stripFinancials(data, 'team_lead')).toEqual(suite());
    });

    it.each(['rpa_operations', 'billing', 'rpa_developer', undefined])('quita costos, utilidad, margen y CPI para %s y conserva el resto', (role) => {
        const stripped = stripFinancials(suite(), role);

        expect(financialKeys(stripped)).toEqual([]);
        expect(stripped.general_manager.consolidated_pnl).toEqual({
            total_sold_clp: 100, active_projects_count: 1, total_projects_count: 1, billable_hours_ratio: 80
        });
        expect(stripped.general_manager.top_risk_projects[0]).toEqual({
            id: 1, name: 'Alfa', sale_price_clp: 100, critical_reason: 'Retraso crítico de 7 días frente a la fecha comprometida'
        });
        expect(stripped.commercial).not.toHaveProperty('margin_variance');
        expect(stripped.commercial.scope_creep_alerts).toEqual([{ project_id: 1, overrun_hours: 5, severity: 'warning' }]);
        expect(stripped.commercial.ready_to_invoice).toEqual(suite().commercial.ready_to_invoice);
        expect(stripped.controller.triple_conciliation).toEqual([{
            project_id: 1, physical_progress_pct: 50, billed_pct: 40, deviation_flag: 'cost_overrun',
            sale_price_clp: 100, invoiced_clp: 40, paid_clp: 10
        }]);
        expect(stripped.controller.aging_portfolio).toEqual({ total_overdue_clp: 5 });
        expect(stripped.controller.cost_centers_summary).toEqual(suite().controller.cost_centers_summary);
    });

    it('no modifica el objeto de entrada', () => {
        const data = suite();

        stripFinancials(data, 'billing');

        expect(data).toEqual(suite());
    });
});
