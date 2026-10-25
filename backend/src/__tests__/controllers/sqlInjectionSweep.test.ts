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
import lifecycleRoutes from '../../routes/lifecycleRoutes';
import supportRoutes from '../../routes/supportRoutes';
import { sanitizeInput } from '../../middleware/validation';
import { createRealTestDb, realDbHolder, seedBasicUsers, RealTestDb, TestUsers } from '../helpers/realTestDb';

// Mismo orden que en producción (server.ts): primero el parser JSON y después sanitizeInput, que reconstruye el cuerpo.
const app = express();
app.use(express.json());
app.use(sanitizeInput);
app.use('/api/lifecycle', lifecycleRoutes);
app.use('/api/support', supportRoutes);

// Barrido de las demás rutas PUT que armaban el SET del UPDATE con las claves del cuerpo de la petición.
describe('Barrido de inyección SQL por claves del cuerpo en rutas PUT (SQLite real, con sanitizeInput)', () => {
    let testDb: RealTestDb;
    let users: TestUsers;
    let ids: { project: number; template: number; phase: number; activity: number; delay: number; company: number };

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
        for (const table of ['phase_activities', 'project_delays', 'project_phases', 'support_tickets', 'support_companies', 'projects']) {
            await testDb.run(`DELETE FROM ${table}`);
        }
        await testDb.run(`DELETE FROM project_phase_templates WHERE name = 'Plantilla de prueba'`);
        const project = (await testDb.run(`INSERT INTO projects (name, status) VALUES ('Alfa', 'active')`)).id!;
        const template = (await testDb.run(`INSERT INTO project_phase_templates (name, phase_order, category) VALUES ('Plantilla de prueba', 99, 'development')`)).id!;
        const phase = (await testDb.run(
            `INSERT INTO project_phases (project_id, template_id, name, phase_order) VALUES (?, ?, 'Fase 1', 1)`, [project, template]
        )).id!;
        const activity = (await testDb.run(
            `INSERT INTO phase_activities (phase_id, project_id, activity_type, description, user_id) VALUES (?, ?, 'development', 'Actividad', ?)`,
            [phase, project, users.dev]
        )).id!;
        const delay = (await testDb.run(
            `INSERT INTO project_delays (project_id, description, delay_start_date, created_by) VALUES (?, 'Retraso', '2026-10-01', ?)`, [project, users.lead]
        )).id!;
        const company = (await testDb.run(`INSERT INTO support_companies (company_name, status) VALUES ('Cliente Alfa', 'active')`)).id!;
        await testDb.run(
            `INSERT INTO support_tickets (id, id_ticket, company_id, title, description, created_by) VALUES ('1', 'SUP-TEST-1', ?, 'Ticket', 'Descripción', ?)`,
            [company, users.lead]
        );
        ids = { project, template, phase, activity, delay, company };
    });

    const put = (role: string, path: string, body: string | object) => {
        const req = request(app).put(path).set('x-test-role', role);
        return typeof body === 'string' ? req.set('Content-Type', 'application/json').send(body) : req.send(body);
    };

    const snapshot = async () => {
        const tables = ['users', 'project_phase_templates', 'project_phases', 'phase_activities', 'project_delays', 'support_companies', 'support_tickets'];
        const entries = await Promise.all(tables.map(async (table) => [table, await testDb.query(`SELECT * FROM ${table} ORDER BY 1`)] as const));
        return Object.fromEntries(entries);
    };

    const endpoints = () => [
        { nombre: 'plantilla de fase', role: 'team_lead', path: `/api/lifecycle/templates/${ids.template}`, column: 'name', legit: { name: 'Plantilla editada', color: '#112233' } },
        { nombre: 'fase del proyecto', role: 'rpa_operations', path: `/api/lifecycle/phases/${ids.phase}`, column: 'status', legit: { status: 'in_progress', actual_start_date: '2026-11-01' } },
        { nombre: 'actividad de una fase', role: 'rpa_operations', path: `/api/lifecycle/activities/${ids.activity}`, column: 'description', legit: { description: 'Actividad editada', notes: 'Con nota', is_billable: 1 } },
        { nombre: 'retraso del proyecto', role: 'rpa_operations', path: `/api/lifecycle/delays/${ids.delay}`, column: 'description', legit: { description: 'Retraso editado', delay_days: 4, responsible_party: 'client' } },
        // Esta ruta no exige un rol: la abre cualquier usuario autenticado, así que la prueba va con el rol más bajo
        { nombre: 'ticket de soporte', role: 'rpa_developer', path: '/api/support/tickets/SUP-TEST-1', column: 'title', legit: { title: 'Ticket editado', priority: 'high', hours_spent: 2.5 } }
    ];

    const maliciousBodies = (column: string): [string, string][] => [
        ['una asignación inyectada en el nombre de la columna', JSON.stringify({ [`${column} = 'hackeado', ${column}`]: 'x' })],
        ['subconsultas que leen el hash del team_lead', JSON.stringify({ [`${column} = (SELECT password_hash || ':' || email FROM users WHERE role = 'team_lead'), ${column}`]: 1 })],
        ['un comentario SQL', JSON.stringify({ [`${column} = 'x' --`]: 1 })],
        ['__proto__ con un objeto', `{"__proto__": {"${column}": "hackeado"}}`],
        ['constructor con un objeto anidado', `{"constructor": {"prototype": {"${column}": "hackeado"}}}`],
        ['una columna con mayúsculas', JSON.stringify({ [column.toUpperCase()]: 'hackeado' })],
        ['una columna con espacios', JSON.stringify({ [` ${column} `]: 'hackeado' })],
        ['una columna válida dentro de un objeto', JSON.stringify({ datos: { [column]: 'hackeado' } })],
        ['un valor objeto en una columna válida', JSON.stringify({ [column]: { $ne: 1 } })],
        ['una columna que no existe', JSON.stringify({ columna_inventada: 1 })]
    ];

    it.each([0, 1, 2, 3, 4])('cada ruta PUT rechaza con 400 en español y deja la base intacta ante claves maliciosas (ruta %i)', async (index) => {
        const { role, path, column, nombre } = endpoints()[index];

        for (const [caso, body] of maliciousBodies(column)) {
            const before = await snapshot();

            const res = await put(role, path, body);

            expect([nombre, caso, res.status]).toEqual([nombre, caso, 400]);
            expect(res.body.error).toMatch(/no permitid|no hay campos|no válido/i);
            expect(Object.keys(res.body)).toEqual(['error']);
            expect(JSON.stringify(res.body)).not.toMatch(/h:lead@test.cl/);
            expect(await snapshot()).toEqual(before);
        }
    });

    it.each([0, 1, 2, 3, 4])('cada ruta PUT sigue aceptando la edición legítima de columnas conocidas (ruta %i)', async (index) => {
        const { role, path, legit } = endpoints()[index];

        const res = await put(role, path, legit);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject(legit);
    });

    it('un ticket pasado a resuelto sigue fijando resolved_at, y las claves id_ticket, id y created_by que el servidor posee no se escriben', async () => {
        const res = await put('rpa_developer', '/api/support/tickets/SUP-TEST-1', { status: 'resolved', id_ticket: 'OTRO-1' });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id_ticket: 'SUP-TEST-1', status: 'resolved' });
        expect(res.body.resolved_at).toBeTruthy();

        const rechazada = await put('rpa_developer', '/api/support/tickets/SUP-TEST-1', { created_by: users.dev });
        expect(rechazada.status).toBe(400);
        const [ticket] = await testDb.query(`SELECT created_by FROM support_tickets WHERE id_ticket = 'SUP-TEST-1'`);
        expect(ticket.created_by).toBe(users.lead);
    });

    it('las rutas de lifecycle siguen cerradas a roles sin permiso', async () => {
        const before = await snapshot();
        for (const role of ['rpa_developer', 'it_support', 'billing']) {
            for (const { path } of endpoints().slice(0, 4)) {
                expect((await put(role, path, { description: 'x' })).status).toBe(403);
            }
        }
        expect((await put('rpa_operations', `/api/lifecycle/templates/${ids.template}`, { name: 'x' })).status).toBe(403);
        expect(await snapshot()).toEqual(before);
    });

    it('PUT /support/companies/:id ya descartaba las claves desconocidas con su esquema de validación: una clave inyectada no escribe nada', async () => {
        const before = await snapshot();

        const res = await put('rpa_operations', `/api/support/companies/${ids.company}`, { "notes = 'x', status": 'inactive', company_name: 'Cliente editado' });

        expect(res.status).toBe(200);
        const [company] = await testDb.query(`SELECT company_name, status, notes FROM support_companies WHERE id = ?`, [ids.company]);
        expect(company).toEqual({ company_name: 'Cliente editado', status: 'active', notes: null });
        expect((await snapshot()).users).toEqual(before.users);
    });
});
