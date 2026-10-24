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
import pmoRoutes from '../../routes/pmoRoutes';
import { stripBudgetFields } from '../../controllers/pmoController';
import { createRealTestDb, realDbHolder, seedBasicUsers, RealTestDb, TestUsers } from '../helpers/realTestDb';

const app = express();
app.use(express.json());
app.use('/api/pmo', pmoRoutes);

const BUDGET_OR_COST_KEY = /budget|cost/i;
// Claves con "budget" o "cost" que se conservan a propósito para todos los roles: son horas, no dinero, y la
// Fase 6a ya decidió que las horas presupuestadas no se ocultan (solo se restringe su escritura).
const ALLOWED_KEYS = new Set(['budgeted_hours']);

function budgetOrCostKeys(value: unknown, path = '$'): string[] {
    if (Array.isArray(value)) return value.flatMap((item, index) => budgetOrCostKeys(item, `${path}[${index}]`));
    if (value === null || typeof value !== 'object') return [];
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
        ...(BUDGET_OR_COST_KEY.test(key) && !ALLOWED_KEYS.has(key) ? [`${path}.${key}`] : []),
        ...budgetOrCostKeys(child, `${path}.${key}`)
    ]);
}

describe('Presupuesto y costos del PMO solo para team_lead (SQLite real)', () => {
    let testDb: RealTestDb;
    let users: TestUsers;
    let projectId: number;

    beforeAll(async () => {
        testDb = await createRealTestDb();
        realDbHolder.current = testDb;
        users = await seedBasicUsers(testDb);
    });

    afterAll(async () => {
        realDbHolder.current = null;
        await testDb.close();
    });

    beforeEach(async () => {
        for (const table of ['project_assignments', 'project_milestones', 'project_pmo_metrics', 'project_financials', 'projects']) {
            await testDb.run(`DELETE FROM ${table}`);
        }
        projectId = (await testDb.run(
            `INSERT INTO projects (name, status, commercial_stage, budget, assigned_to) VALUES ('Alfa', 'active', 'approved', 5000000, ?)`,
            [users.dev]
        )).id!;
        await testDb.run(
            `INSERT INTO project_pmo_metrics (project_id, planned_hours, actual_hours, planned_budget, actual_cost, completion_percentage,
                                              schedule_variance_days, cost_variance_percentage, risk_level, bugs_found, bugs_resolved,
                                              client_satisfaction_score, team_velocity)
             VALUES (?, 100, 80, 4000000, 3000000, 50, -4, 12, 'high', 5, 4, 8, 5)`,
            [projectId]
        );
        await testDb.run(
            `INSERT INTO project_milestones (project_id, name, planned_date, status, financial_impact) VALUES (?, 'Hito 1', '2026-12-01', 'pending', 250000)`,
            [projectId]
        );
        await testDb.run(
            `INSERT INTO project_assignments (project_id, user_id, allocation_percentage, budgeted_hours, assigned_by) VALUES (?, ?, 50, 40, ?)`,
            [projectId, users.dev, users.lead]
        );
    });

    const get = (role: string, path: string) => request(app).get(`/api/pmo${path}`).set('x-test-role', role);

    it('rpa_operations no recibe presupuesto ni costos en /pmo/dashboard, /pmo/analytics ni /pmo/projects/:id/gantt', async () => {
        for (const path of ['/dashboard', '/analytics', `/projects/${projectId}/gantt`]) {
            const res = await get('rpa_operations', path);

            expect(res.status).toBe(200);
            expect(budgetOrCostKeys(res.body)).toEqual([]);
        }
    });

    it('rpa_developer no recibe presupuesto ni costos en /pmo/projects/:id/gantt ni en /pmo/projects/:id/metrics', async () => {
        for (const path of [`/projects/${projectId}/gantt`, `/projects/${projectId}/metrics`]) {
            const res = await get('rpa_developer', path);

            expect(res.status).toBe(200);
            expect(budgetOrCostKeys(res.body)).toEqual([]);
        }
    });

    it('lo que no es presupuesto sigue llegando a rpa_operations: avance, atraso, riesgo, salud, horas presupuestadas e impacto financiero de hitos', async () => {
        const dashboard = (await get('rpa_operations', '/dashboard')).body;
        expect(dashboard.projects[0]).toMatchObject({
            id: projectId, name: 'Alfa', completion_percentage: 50, schedule_variance_days: -4, risk_level: 'high',
            planned_hours: 100, actual_hours: 80, project_health_status: 'warning'
        });
        expect(dashboard.overallMetrics).toMatchObject({ total_projects: 1, active_projects: 1, avg_completion: 50 });
        expect(dashboard.upcomingMilestones[0]).toMatchObject({ name: 'Hito 1', financial_impact: 250000 });
        expect(dashboard.teamCapacity.find((m: any) => m.id === users.dev)).toMatchObject({ budgeted_hours: 40 });

        const analytics = (await get('rpa_operations', '/analytics')).body;
        expect(analytics.executiveSummary).toMatchObject({ total_projects: 1, critical_projects: 0, avg_completion: 50, avg_satisfaction: 8 });
        expect(analytics.trendAnalysis).toHaveLength(1);
        expect(analytics.riskAnalysis[0]).toMatchObject({ project_id: projectId, risk_level: 'high' });
        expect(analytics.teamAnalysis[0]).toMatchObject({ total_projects: 1, avg_completion: 50 });
        expect(analytics.satisfactionTrends[0]).toMatchObject({ client_name: 'Alfa', total_projects: 1 });
        expect(analytics.riskDistribution[0]).toMatchObject({ risk_level: 'high', project_count: 1 });

        const gantt = (await get('rpa_operations', `/projects/${projectId}/gantt`)).body;
        expect(gantt.project).toMatchObject({ id: projectId, name: 'Alfa', pmo_completion_percentage: 50, schedule_variance_days: -4, planned_hours: 100 });
        expect(gantt.milestones[0]).toMatchObject({ name: 'Hito 1', financial_impact: 250000 });

        const metrics = (await get('rpa_developer', `/projects/${projectId}/metrics`)).body;
        expect(metrics.project).toMatchObject({ name: 'Alfa', completion_percentage: 50, project_health_status: 'warning', hours_completion_ratio: 80 });
        expect(metrics.risks.map((r: any) => r.risk_type)).toEqual(expect.arrayContaining(['schedule_delay']));
        expect(metrics.risks.map((r: any) => r.risk_type)).not.toContain('budget_overrun');
        expect(metrics.kpis).toMatchObject({ schedule_performance: 'minor_delay', quality_score: 90 });
        expect(metrics.alerts).toEqual(metrics.risks.filter((r: any) => r.severity === 'critical' || r.severity === 'high'));
    });

    it('team_lead sigue recibiendo todas las claves de presupuesto y costo en dashboard, analytics, gantt y métricas', async () => {
        const dashboard = (await get('team_lead', '/dashboard')).body;
        expect(Object.keys(dashboard.projects[0])).toEqual(expect.arrayContaining(['budget', 'planned_budget', 'actual_cost', 'cost_variance_percentage']));
        expect(dashboard.projects[0]).toMatchObject({ budget: 5000000, planned_budget: 4000000, actual_cost: 3000000, cost_variance_percentage: 12 });
        expect(dashboard.overallMetrics).toMatchObject({ total_planned_budget: 4000000, total_actual_cost: 3000000 });

        const analytics = (await get('team_lead', '/analytics')).body;
        expect(analytics.executiveSummary).toMatchObject({
            over_budget_projects: 0, total_planned_budget: 4000000, total_actual_cost: 3000000, overall_budget_variance: -25
        });
        expect(analytics.trendAnalysis[0]).toMatchObject({ budget_planned: 4000000, budget_spent: 3000000 });
        expect(analytics.budgetAnalysis[0]).toMatchObject({
            project_id: projectId, planned_budget: 4000000, actual_cost: 3000000, cost_variance_percentage: 12,
            projected_total_cost: 6000000, budget_status: 'warning'
        });
        expect(analytics.riskAnalysis[0]).toMatchObject({ cost_variance_percentage: 12 });
        expect(analytics.teamAnalysis[0]).toMatchObject({ on_budget_projects: 0, total_budget_managed: 4000000, avg_budget_variance: 12 });
        expect(analytics.satisfactionTrends[0]).toMatchObject({ on_budget_deliveries: 0, on_budget_rate: 0 });
        expect(analytics.riskDistribution[0]).toMatchObject({ avg_budget_variance: 12 });

        const gantt = (await get('team_lead', `/projects/${projectId}/gantt`)).body;
        expect(gantt.project).toMatchObject({ budget: 5000000, planned_budget: 4000000, actual_cost: 3000000, cost_variance_percentage: 12 });

        const metrics = (await get('team_lead', `/projects/${projectId}/metrics`)).body;
        expect(metrics.project).toMatchObject({
            budget: 5000000, planned_budget: 4000000, actual_cost: 3000000, cost_variance_percentage: 12, budget_utilization_percentage: 75
        });
        expect(metrics.risks.map((r: any) => r.risk_type)).toEqual(expect.arrayContaining(['schedule_delay', 'budget_overrun']));
        expect(metrics.kpis).toMatchObject({ budget_performance: 'minor_overrun' });
        expect(budgetOrCostKeys(metrics).length).toBeGreaterThan(0);
    });

    it('no cambia quién puede abrir cada ruta', async () => {
        for (const role of ['rpa_developer', 'it_support', 'billing']) {
            expect((await get(role, '/dashboard')).status).toBe(403);
            expect((await get(role, '/analytics')).status).toBe(403);
        }
        for (const role of ['it_support', 'billing']) {
            expect((await get(role, `/projects/${projectId}/gantt`)).status).toBe(403);
            expect((await get(role, `/projects/${projectId}/metrics`)).status).toBe(403);
        }
    });
});

describe('stripBudgetFields', () => {
    const sample = () => ({
        projects: [{ id: 1, name: 'Alfa', budget: 5, planned_budget: 4, actual_cost: 3, cost_variance_percentage: 12, budgeted_hours: 40, financial_impact: 9 }],
        overallMetrics: { total_projects: 1, total_planned_budget: 4, total_actual_cost: 3 },
        executiveSummary: {
            critical_projects: 0, over_budget_projects: 1, total_planned_budget: 4, total_actual_cost: 3, overall_budget_variance: -25
        },
        trendAnalysis: [{ week: '2026-43', budget_planned: 4, budget_spent: 3 }],
        budgetAnalysis: [{ project_id: 1, planned_budget: 4, budget_status: 'warning' }],
        teamAnalysis: [{ full_name: 'Dev', on_budget_projects: 1, total_budget_managed: 4, avg_budget_variance: 12 }],
        satisfactionTrends: [{ client_name: 'Alfa', on_budget_deliveries: 1, on_budget_rate: 100, on_time_rate: 50 }],
        riskDistribution: [{ risk_level: 'high', avg_budget_variance: 12 }],
        project: { id: 1, budget_utilization_percentage: 75 },
        kpis: { budget_performance: 'within_budget', quality_score: 100 }
    });

    it('team_lead recibe todo igual', () => {
        const data = sample();

        expect(stripBudgetFields(data, 'team_lead')).toEqual(sample());
    });

    it.each(['rpa_operations', 'rpa_developer', 'it_support', 'billing', undefined])('quita presupuesto y costos para %s y conserva el resto', (role) => {
        const stripped = stripBudgetFields(sample(), role);

        expect(budgetOrCostKeys(stripped)).toEqual([]);
        expect(stripped).toEqual({
            projects: [{ id: 1, name: 'Alfa', budgeted_hours: 40, financial_impact: 9 }],
            overallMetrics: { total_projects: 1 },
            executiveSummary: { critical_projects: 0 },
            trendAnalysis: [{ week: '2026-43' }],
            teamAnalysis: [{ full_name: 'Dev' }],
            satisfactionTrends: [{ client_name: 'Alfa', on_time_rate: 50 }],
            riskDistribution: [{ risk_level: 'high' }],
            project: { id: 1 },
            kpis: { quality_score: 100 }
        });
    });

    it('no modifica el objeto de entrada', () => {
        const data = sample();

        stripBudgetFields(data, 'rpa_operations');

        expect(data).toEqual(sample());
    });

    it('deja pasar tal cual lo que no es un objeto o arreglo', () => {
        expect(stripBudgetFields(null, 'billing')).toBeNull();
        expect(stripBudgetFields('texto', 'billing')).toBe('texto');
        expect(stripBudgetFields(7, undefined)).toBe(7);
    });
});
