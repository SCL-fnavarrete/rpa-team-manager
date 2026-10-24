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
import { PMO_METRICS_COLUMNS } from '../../controllers/pmoController';
import { createRealTestDb, realDbHolder, seedBasicUsers, RealTestDb } from '../helpers/realTestDb';

const app = express();
app.use(express.json());
app.use('/api/pmo', pmoRoutes);

// Columnas que el servidor controla: ningún cliente puede escribirlas.
const SERVER_CONTROLLED_COLUMNS = ['id', 'project_id', 'last_updated', 'updated_by'];
const BUDGET_COST_COLUMNS = ['planned_budget', 'actual_cost', 'cost_variance_percentage'];

describe('POST /api/pmo/projects/:id/metrics - lista blanca de columnas (SQLite real)', () => {
    let testDb: RealTestDb;
    let projectId: number;

    beforeAll(async () => {
        testDb = await createRealTestDb();
        realDbHolder.current = testDb;
        await seedBasicUsers(testDb);
    });

    afterAll(async () => {
        realDbHolder.current = null;
        await testDb.close();
    });

    beforeEach(async () => {
        await testDb.run(`DELETE FROM project_pmo_metrics`);
        await testDb.run(`DELETE FROM projects`);
        projectId = (await testDb.run(`INSERT INTO projects (name, status) VALUES ('Alfa', 'active')`)).id!;
    });

    const postMetrics = (role: string, body: unknown, id: number = projectId) =>
        request(app).post(`/api/pmo/projects/${id}/metrics`).set('x-test-role', role).send(body as object);

    const metricsRows = () => testDb.query(`SELECT * FROM project_pmo_metrics ORDER BY id`);
    const userNames = async () => (await testDb.query(`SELECT username FROM users ORDER BY id`)).map((u: any) => u.username);

    async function seedMetrics(): Promise<void> {
        await testDb.run(
            `INSERT INTO project_pmo_metrics (project_id, planned_budget, actual_cost, completion_percentage, risk_level, last_updated)
             VALUES (?, 1000, 500, 10, 'low', '2026-01-01 00:00:00')`,
            [projectId]
        );
    }

    it.each([
        ['una asignación inyectada en el nombre de la columna', { 'planned_budget = 0, actual_cost': 1 }],
        ['un cierre de paréntesis con DROP TABLE', { 'x) VALUES (1); DROP TABLE users; --': 1 }],
        ['una subconsulta que filtra otra tabla', { 'completion_percentage = (SELECT COUNT(*) FROM users), risk_level': 'low' }],
        ['una columna que no existe', { columna_inventada: 1 }],
        ['la clave primaria', { id: 99 }],
        ['project_id', { project_id: 99 }],
        ['una columna que controla el servidor', { last_updated: '2000-01-01', updated_by: 99 }],
        ['una clave válida mezclada con una maliciosa', { completion_percentage: 80, 'risk_level = \'critical\', planned_budget': 0 }]
    ])('responde 400 en español y no toca la base ante %s', async (_nombre, body) => {
        await seedMetrics();
        const before = await metricsRows();
        const usersBefore = await userNames();

        const res = await postMetrics('team_lead', body);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/no permitid/i);
        expect(Object.keys(res.body)).toEqual(['error']);
        expect(await metricsRows()).toEqual(before);
        expect(await userNames()).toEqual(usersBefore);
    });

    it('la clave maliciosa tampoco crea una fila de métricas cuando el proyecto aún no tiene', async () => {
        const res = await postMetrics('rpa_operations', { 'x) VALUES (1); DROP TABLE users; --': 1 });

        expect(res.status).toBe(400);
        expect(await metricsRows()).toEqual([]);
        expect(await userNames()).toEqual(['lead', 'dev', 'ops']);
    });

    it.each([
        ['un arreglo', [{ completion_percentage: 10 }]],
        ['un texto', 'completion_percentage=10'],
        ['un número', 5]
    ])('responde 400 si el cuerpo es %s en vez de un objeto', async (_nombre, body) => {
        const res = await request(app)
            .post(`/api/pmo/projects/${projectId}/metrics`)
            .set('x-test-role', 'team_lead')
            .set('Content-Type', 'application/json')
            .send(JSON.stringify(body));

        expect(res.status).toBe(400);
        expect(await metricsRows()).toEqual([]);
    });

    it('con claves válidas crea la fila de métricas si no existe y responde con ella', async () => {
        const res = await postMetrics('team_lead', {
            completion_percentage: 80, schedule_variance_days: -1, cost_variance_percentage: -5, risk_level: 'low',
            planned_hours: 120, actual_hours: 100, planned_budget: 55000, actual_cost: 48000,
            team_velocity: 9, bugs_found: 2, bugs_resolved: 2, client_satisfaction_score: 4
        });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            project_id: projectId, completion_percentage: 80, schedule_variance_days: -1, cost_variance_percentage: -5,
            risk_level: 'low', planned_hours: 120, actual_hours: 100, planned_budget: 55000, actual_cost: 48000,
            team_velocity: 9, bugs_found: 2, bugs_resolved: 2, client_satisfaction_score: 4, updated_by: 1
        });
        expect(await metricsRows()).toHaveLength(1);
    });

    it('con claves válidas actualiza solo esas columnas de la fila existente y refresca last_updated', async () => {
        await seedMetrics();

        const res = await postMetrics('team_lead', { completion_percentage: 60, risk_level: 'high', risk_factors: 'Integración con SAP' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            project_id: projectId, completion_percentage: 60, risk_level: 'high', risk_factors: 'Integración con SAP',
            planned_budget: 1000, actual_cost: 500, updated_by: 1
        });
        expect(res.body.last_updated).not.toBe('2026-01-01 00:00:00');
        expect(await metricsRows()).toHaveLength(1);
    });

    it('un cuerpo vacío no cambia las métricas y responde con la fila actual', async () => {
        await seedMetrics();

        const res = await postMetrics('team_lead', {});

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ project_id: projectId, completion_percentage: 10, planned_budget: 1000 });
    });

    it('rpa_operations puede guardar presupuesto y costo, pero la respuesta no los devuelve', async () => {
        const res = await postMetrics('rpa_operations', { completion_percentage: 40, planned_budget: 777, actual_cost: 333, cost_variance_percentage: 7, planned_hours: 50 });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ project_id: projectId, completion_percentage: 40, planned_hours: 50 });
        for (const column of BUDGET_COST_COLUMNS) expect(res.body).not.toHaveProperty(column);
        expect(await metricsRows()).toEqual([expect.objectContaining({ planned_budget: 777, actual_cost: 333, cost_variance_percentage: 7 })]);
    });

    it('la respuesta nunca trae columnas fuera de la lista blanca y los campos del servidor', async () => {
        const res = await postMetrics('team_lead', { completion_percentage: 40 });

        const allowed = new Set([...PMO_METRICS_COLUMNS, ...SERVER_CONTROLLED_COLUMNS]);
        expect(Object.keys(res.body).filter((key) => !allowed.has(key))).toEqual([]);
    });

    it('la lista blanca coincide con las columnas editables de project_pmo_metrics (si se agrega una columna hay que revisarla)', async () => {
        const columns = (await testDb.query(`PRAGMA table_info(project_pmo_metrics)`)).map((c: any) => c.name as string);

        expect([...PMO_METRICS_COLUMNS].sort()).toEqual(columns.filter((c) => !SERVER_CONTROLLED_COLUMNS.includes(c)).sort());
    });

    it('no cambia quién puede abrir la ruta: rpa_developer, it_support y billing siguen recibiendo 403', async () => {
        for (const role of ['rpa_developer', 'it_support', 'billing']) {
            const res = await postMetrics(role, { completion_percentage: 10 });

            expect(res.status).toBe(403);
        }
        expect(await metricsRows()).toEqual([]);
    });
});
