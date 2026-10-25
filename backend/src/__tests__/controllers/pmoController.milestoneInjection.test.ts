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
import { sanitizeInput } from '../../middleware/validation';
import { createRealTestDb, realDbHolder, seedBasicUsers, RealTestDb, TestUsers } from '../helpers/realTestDb';

// Mismo orden que en producción (server.ts): primero el parser JSON y después sanitizeInput, que reconstruye el cuerpo.
const app = express();
app.use(express.json());
app.use(sanitizeInput);
app.use('/api/pmo', pmoRoutes);

const POC_KEY = `description = (SELECT planned_budget FROM project_pmo_metrics LIMIT 1), external_contact = (SELECT password_hash || ':' || email FROM users WHERE role = 'team_lead'), name`;

const RESPONSE_KEYS = [
    'id', 'project_id', 'name', 'description', 'milestone_type', 'planned_date', 'end_date', 'actual_date', 'status', 'priority',
    'responsible_user_id', 'completion_percentage', 'impact_on_timeline', 'responsibility', 'blocking_reason', 'delay_justification',
    'external_contact', 'estimated_delay_days', 'financial_impact', 'responsible_name', 'project_name'
];
const SERVER_OWNED_KEYS = ['created_by', 'created_at', 'updated_at', 'baseline_planned_date'];

describe('PUT /api/pmo/milestones/:id - lista blanca de columnas con sanitizeInput de producción (SQLite real)', () => {
    let testDb: RealTestDb;
    let users: TestUsers;
    let projectId: number;
    let milestoneId: number;

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
        for (const table of ['project_pmo_metrics', 'project_milestones', 'projects']) await testDb.run(`DELETE FROM ${table}`);
        projectId = (await testDb.run(`INSERT INTO projects (name, status) VALUES ('Alfa', 'active')`)).id!;
        await testDb.run(`INSERT INTO project_pmo_metrics (project_id, planned_budget, actual_cost) VALUES (?, 4000000, 3000000)`, [projectId]);
        milestoneId = (await testDb.run(
            `INSERT INTO project_milestones (project_id, name, description, planned_date, status, created_by) VALUES (?, 'Hito 1', 'Original', '2026-12-01', 'pending', ?)`,
            [projectId, users.lead]
        )).id!;
    });

    const putMilestone = (role: string, body: string | object, id: number = milestoneId) => {
        const req = request(app).put(`/api/pmo/milestones/${id}`).set('x-test-role', role);
        return typeof body === 'string' ? req.set('Content-Type', 'application/json').send(body) : req.send(body);
    };

    const snapshot = async () => ({
        users: await testDb.query(`SELECT * FROM users ORDER BY id`),
        milestones: await testDb.query(`SELECT * FROM project_milestones ORDER BY id`),
        metrics: await testDb.query(`SELECT * FROM project_pmo_metrics ORDER BY id`)
    });

    it.each([
        ['la prueba de concepto: subconsultas que leen presupuestos y el hash del team_lead', JSON.stringify({ [POC_KEY]: 1 })],
        ['la misma prueba de concepto con un valor texto', JSON.stringify({ [POC_KEY]: 'x', status: 'completed' })],
        ['una asignación inyectada en el nombre de la columna', JSON.stringify({ "name = 'x', description": 'y' })],
        ['un comentario SQL', JSON.stringify({ "name = 'x' --": 1 })],
        ['__proto__ con un objeto', '{"__proto__": {"name": "hackeado", "status": "completed"}}'],
        ['__proto__ con un texto', '{"__proto__": "hackeado"}'],
        ['constructor con un objeto anidado', '{"constructor": {"prototype": {"name": "hackeado"}}}'],
        ['una columna con mayúsculas', '{"NAME": "hackeado"}'],
        ['una columna con mayúscula inicial', '{"Status": "completed"}'],
        ['una columna con espacio al inicio', '{" name": "hackeado"}'],
        ['una columna con espacio al final', '{"name ": "hackeado"}'],
        ['una columna con salto de línea', '{"name\\n": "hackeado"}'],
        ['una clave que contiene una columna válida dentro de un objeto', '{"datos": {"name": "hackeado"}}'],
        ['un valor objeto en una columna válida', '{"name": {"$ne": 1}}'],
        ['un valor arreglo en una columna válida', '{"description": ["a", "b"]}'],
        ['una columna que no existe', '{"columna_inventada": 1}'],
        ['la clave project_id (mover el hito a otro proyecto)', '{"project_id": 999}'],
        ['una columna que controla el servidor', '{"baseline_planned_date": "2000-01-01", "updated_at": "2000-01-01"}'],
        ['una clave válida mezclada con una inyectada', JSON.stringify({ name: 'Nuevo', "status = 'completed', description": 'x' })]
    ])('rechaza con 400 en español y no toca la base ante %s', async (_nombre, body) => {
        for (const role of ['rpa_operations', 'team_lead']) {
            const before = await snapshot();

            const res = await putMilestone(role, body);

            expect(res.status).toBe(400);
            expect(typeof res.body.error).toBe('string');
            expect(res.body.error).toMatch(/no permitid|no hay campos|no válido/i);
            expect(Object.keys(res.body)).toEqual(['error']);
            expect(JSON.stringify(res.body)).not.toMatch(/h:lead@test.cl|4000000/);
            expect(await snapshot()).toEqual(before);
        }
    });

    it('la edición legítima del formulario funciona para team_lead y rpa_operations y responde solo con columnas explícitas', async () => {
        for (const [role, name] of [['team_lead', 'Hito editado por lead'], ['rpa_operations', 'Hito editado por ops']]) {
            const res = await putMilestone(role, {
                name, description: 'Nueva descripción', planned_date: '2026-11-01', end_date: '2026-11-10', actual_date: null,
                status: 'in_progress', responsible_user_id: users.dev, responsibility: 'cliente', external_contact: 'Juan Pérez',
                blocking_reason: 'Espera VPN', estimated_delay_days: 3, financial_impact: 150000, delay_justification: 'El cliente demora'
            });

            expect(res.status).toBe(200);
            expect(Object.keys(res.body).sort()).toEqual([...RESPONSE_KEYS].sort());
            for (const key of SERVER_OWNED_KEYS) expect(res.body).not.toHaveProperty(key);
            expect(res.body).toMatchObject({
                id: milestoneId, project_id: projectId, name, description: 'Nueva descripción', planned_date: '2026-11-01', end_date: '2026-11-10',
                actual_date: null, status: 'in_progress', responsible_user_id: users.dev, responsible_name: 'DEV', project_name: 'Alfa',
                responsibility: 'external', external_contact: 'Juan Pérez', blocking_reason: 'Espera VPN', estimated_delay_days: 3,
                financial_impact: 150000, delay_justification: 'El cliente demora'
            });
        }
        const [row] = await testDb.query(`SELECT * FROM project_milestones WHERE id = ?`, [milestoneId]);
        expect(row).toMatchObject({ name: 'Hito editado por ops', responsibility: 'external', created_by: users.lead, project_id: projectId });
    });

    it('una edición parcial (solo estado y porcentaje, como en docs/pmo-api.md) conserva el resto del hito', async () => {
        const res = await putMilestone('rpa_operations', { status: 'completed', actual_date: '2026-11-15', completion_percentage: 100 });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id: milestoneId, name: 'Hito 1', description: 'Original', status: 'completed', actual_date: '2026-11-15', completion_percentage: 100 });
    });

    it('si el cliente devuelve el hito completo, ignora id, created_by y created_at en vez de escribirlos', async () => {
        const [before] = await testDb.query(`SELECT * FROM project_milestones WHERE id = ?`, [milestoneId]);

        const res = await putMilestone('team_lead', { id: 999, created_by: users.dev, created_at: '2000-01-01 00:00:00', name: 'Editado' });

        expect(res.status).toBe(200);
        const [after] = await testDb.query(`SELECT * FROM project_milestones WHERE id = ?`, [milestoneId]);
        expect(after).toMatchObject({ id: milestoneId, created_by: users.lead, created_at: before.created_at, name: 'Editado' });
    });

    it('no cambia quién puede abrir la ruta: rpa_developer, it_support y billing siguen recibiendo 403', async () => {
        const before = await snapshot();
        for (const role of ['rpa_developer', 'it_support', 'billing']) {
            expect((await putMilestone(role, { name: 'x' })).status).toBe(403);
        }
        expect(await snapshot()).toEqual(before);
    });

    it('los mensajes de error están en español: hito inexistente (404) y sin campos (400)', async () => {
        const inexistente = await putMilestone('team_lead', { name: 'x' }, 99999);
        expect(inexistente.status).toBe(404);
        expect(inexistente.body.error).toBe('Hito no encontrado');

        const vacio = await putMilestone('team_lead', {});
        expect(vacio.status).toBe(400);
        expect(vacio.body.error).toBe('No hay campos para actualizar');
    });

    it('un valor que viola una restricción de la base responde 500 con un mensaje en español y sin detalles internos', async () => {
        const res = await putMilestone('team_lead', { status: 'estado_inventado' });

        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: 'No se pudo actualizar el hito' });
    });
});
