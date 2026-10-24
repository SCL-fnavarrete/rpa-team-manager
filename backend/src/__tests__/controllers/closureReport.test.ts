// eslint-disable-next-line @typescript-eslint/no-var-requires
jest.mock('../../database/database', () => ({ db: require('../helpers/realTestDb').realDbProxy }));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/authService', () => ({
    AuthService: jest.fn().mockImplementation(() => ({}))
}));
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
import { closureReportService, ClosureReport } from '../../services/closureReportService';
import { generateClosureReport } from '../../services/pdfService';
import commercialRoutes from '../../routes/commercialRoutes';
import { createRealTestDb, realDbHolder, seedBasicUsers, RealTestDb, TestUsers } from '../helpers/realTestDb';

const app = express();
app.use(express.json());
app.use('/api/commercial', commercialRoutes);

const binaryParser = (res: any, callback: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
};

interface SeedProject {
    name?: string;
    clientId?: number | null;
    repId?: number | null;
    deliveryAcceptedAt?: string | null;
    requirePurchaseOrder?: boolean;
    requireServiceAcceptance?: boolean;
    salePrice?: number;
    budgetedHours?: number;
    budgetedCost?: number;
}

describe('Informe de cierre - servicio, endpoints y PDF (SQLite real)', () => {
    let testDb: RealTestDb;
    let users: TestUsers;
    let invoiceSeq = 0;

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
        for (const table of [
            'payments', 'invoices', 'payment_milestones', 'project_commercial_documents', 'tasks', 'task_columns',
            'task_boards', 'project_quotes', 'time_entries', 'project_assignments', 'user_cost_rates',
            'project_financials', 'projects', 'clients', 'sales_reps', 'exchange_rates'
        ]) {
            await testDb.run(`DELETE FROM ${table}`);
        }
        await setRate('UF', 40000);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    async function setRate(currency: 'UF' | 'USD', rate: number): Promise<void> {
        await testDb.run(
            `INSERT INTO exchange_rates (currency, rate_date, rate_to_clp) VALUES (?, '2020-01-01', ?)`,
            [currency, rate]
        );
    }

    async function addProject(p: SeedProject = {}): Promise<number> {
        const { id } = await testDb.run(
            `INSERT INTO projects (name, status, commercial_stage, client_id, sales_rep_id, start_date, end_date,
                                   delivery_accepted_at, require_purchase_order, require_service_acceptance)
             VALUES (?, 'active', 'approved', ?, ?, '2026-03-01', '2026-09-30', ?, ?, ?)`,
            [
                p.name ?? 'Proyecto Cierre', p.clientId ?? null, p.repId ?? null, p.deliveryAcceptedAt ?? null,
                p.requirePurchaseOrder ? 1 : 0, p.requireServiceAcceptance ? 1 : 0
            ]
        );
        if (p.salePrice !== undefined || p.budgetedHours !== undefined || p.budgetedCost !== undefined) {
            await testDb.run(
                `INSERT INTO project_financials (project_id, sale_price, sale_price_currency, budgeted_cost, budgeted_hours)
                 VALUES (?, ?, 'CLP', ?, ?)`,
                [id, p.salePrice ?? null, p.budgetedCost ?? 0, p.budgetedHours ?? 0]
            );
        }
        return id!;
    }

    async function addMilestone(projectId: number, name: string, status: string, plannedDate: string | null = null): Promise<void> {
        await testDb.run(
            `INSERT INTO payment_milestones (project_id, name, amount, currency, trigger_type, planned_date, status)
             VALUES (?, ?, 500000, 'CLP', 'date', ?, ?)`,
            [projectId, name, plannedDate, status]
        );
    }

    async function addInvoice(projectId: number, amount: number, status = 'issued'): Promise<number> {
        invoiceSeq += 1;
        return (await testDb.run(
            `INSERT INTO invoices (project_id, invoice_number, issue_date, due_date, currency, amount, status)
             VALUES (?, ?, '2026-10-01', '2026-11-01', 'CLP', ?, ?)`,
            [projectId, `FC-${invoiceSeq}`, amount, status]
        )).id!;
    }

    async function addPayment(invoiceId: number, amount: number): Promise<void> {
        await testDb.run(
            `INSERT INTO payments (invoice_id, amount, currency, payment_date) VALUES (?, ?, 'CLP', '2026-10-10')`,
            [invoiceId, amount]
        );
    }

    async function addDocument(projectId: number, type: 'purchase_order' | 'service_acceptance'): Promise<void> {
        await testDb.run(
            `INSERT INTO project_commercial_documents (project_id, document_type, reference_number) VALUES (?, ?, 'REF-1')`,
            [projectId, type]
        );
    }

    async function addTimeEntry(projectId: number, userId: number, hours: number, approvalStatus: string): Promise<void> {
        await testDb.run(
            `INSERT INTO time_entries (user_id, project_id, hours, date, approval_status, cost_rate_snapshot) VALUES (?, ?, ?, '2026-10-05', ?, 8000)`,
            [userId, projectId, hours, approvalStatus]
        );
    }

    async function addAssignment(projectId: number, userId: number, budgetedHours: number | null, isActive = 1): Promise<void> {
        await testDb.run(
            `INSERT INTO project_assignments (project_id, user_id, allocation_percentage, budgeted_hours, is_active, assigned_by) VALUES (?, ?, 100, ?, ?, ?)`,
            [projectId, userId, budgetedHours, isActive, users.lead]
        );
    }

    /** Crea la tarea en una columna del tablero del proyecto (la crea si no existe); isDone marca la columna de terminadas. */
    async function addTask(
        projectId: number, title: string, status: string, columnName = 'Columna', isDoneColumn = false
    ): Promise<number> {
        let board = await testDb.get(`SELECT id FROM task_boards WHERE project_id = ?`, [projectId]);
        if (!board) board = { id: (await testDb.run(`INSERT INTO task_boards (project_id, name) VALUES (?, 'Tablero')`, [projectId])).id };
        let column = await testDb.get(`SELECT id FROM task_columns WHERE board_id = ? AND name = ?`, [board.id, columnName]);
        if (!column) {
            column = {
                id: (await testDb.run(
                    `INSERT INTO task_columns (board_id, name, position, is_done_column) VALUES (?, ?, 0, ?)`,
                    [board.id, columnName, isDoneColumn ? 1 : 0]
                )).id
            };
        }
        return (await testDb.run(
            `INSERT INTO tasks (board_id, column_id, title, status, reporter_id) VALUES (?, ?, ?, ?, ?)`,
            [board.id, column.id, title, status, users.lead]
        )).id!;
    }

    async function addApprovedQuote(
        projectId: number, version: number, amount: number, currency: 'CLP' | 'UF' | 'USD',
        hours: number | null, estimatedCost: number | null, marginPercent: number | null, status = 'approved'
    ): Promise<void> {
        await testDb.run(
            `INSERT INTO project_quotes (project_id, version, amount, currency, hours, estimated_cost, margin_percent, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [projectId, version, amount, currency, hours, estimatedCost, marginPercent, status]
        );
    }

    const item = (report: ClosureReport, key: string) => report.checklist.find(i => i.key === key)!;
    const getJson = (projectId: number | string, role = 'team_lead') =>
        request(app).get(`/api/commercial/projects/${projectId}/closure-report`).set('x-test-role', role);
    const getPdf = (projectId: number | string, role = 'team_lead') =>
        request(app).get(`/api/commercial/projects/${projectId}/closure-report.pdf`).set('x-test-role', role)
            .buffer(true).parse(binaryParser);

    it('devuelve 404 para un proyecto inexistente', async () => {
        expect(await closureReportService.getReport(99999)).toBeNull();

        const json = await getJson(99999);
        expect(json.status).toBe(404);
        expect(json.body).toEqual({ error: 'Proyecto no encontrado' });
        expect((await getJson('abc')).status).toBe(404);

        const pdf = await request(app).get('/api/commercial/projects/99999/closure-report.pdf').set('x-test-role', 'team_lead');
        expect(pdf.status).toBe(404);
        expect(pdf.body).toEqual({ error: 'Proyecto no encontrado' });
    });

    it('checklist marca delivery_accepted pendiente hasta que exista delivery_accepted_at', async () => {
        const client = (await testDb.run(`INSERT INTO clients (name) VALUES ('Cliente Cierre')`)).id!;
        const rep = (await testDb.run(`INSERT INTO sales_reps (name) VALUES ('Comercial Cierre')`)).id!;
        const projectId = await addProject({ clientId: client, repId: rep });

        const before = (await closureReportService.getReport(projectId))!;

        expect(before.project).toMatchObject({
            id: projectId, name: 'Proyecto Cierre', client_name: 'Cliente Cierre', sales_rep_name: 'Comercial Cierre',
            status: 'active', start_date: '2026-03-01', end_date: '2026-09-30',
            delivery_accepted_at: null, financial_closed_at: null
        });
        expect(item(before, 'delivery_accepted')).toMatchObject({ ok: false, pending_count: 1, blocking: true });
        expect(before.can_close_financials).toBe(false);

        await testDb.run(`UPDATE projects SET delivery_accepted_at = '2026-10-20 10:00:00' WHERE id = ?`, [projectId]);
        const after = (await closureReportService.getReport(projectId))!;

        expect(after.project.delivery_accepted_at).toBe('2026-10-20 10:00:00');
        expect(item(after, 'delivery_accepted')).toMatchObject({ ok: true, pending_count: 0, blocking: true });
        expect(after.can_close_financials).toBe(true);
    });

    it('hitos de pago no pagados y facturas con saldo ponen ok=false y can_close_financials=false', async () => {
        const projectId = await addProject({ deliveryAcceptedAt: '2026-10-20 10:00:00' });
        await addMilestone(projectId, 'Hito pagado', 'paid');
        await addMilestone(projectId, 'Hito facturado', 'invoiced');
        await addMilestone(projectId, 'Hito pendiente', 'pending');
        const conSaldo = await addInvoice(projectId, 1000000);
        await addPayment(conSaldo, 400000);
        const saldada = await addInvoice(projectId, 300000);
        await addPayment(saldada, 300000);
        await addInvoice(projectId, 700000, 'cancelled');
        await addInvoice(projectId, 200000, 'paid');

        const report = (await closureReportService.getReport(projectId))!;

        expect(item(report, 'payment_milestones')).toMatchObject({ ok: false, pending_count: 2, blocking: true });
        expect(item(report, 'invoices_paid')).toMatchObject({ ok: false, pending_count: 1, blocking: true });
        expect(report.can_close_financials).toBe(false);

        await testDb.run(`UPDATE payment_milestones SET status = 'paid' WHERE project_id = ?`, [projectId]);
        await addPayment(conSaldo, 600000);
        const settled = (await closureReportService.getReport(projectId))!;

        expect(item(settled, 'payment_milestones')).toMatchObject({ ok: true, pending_count: 0 });
        expect(item(settled, 'invoices_paid')).toMatchObject({ ok: true, pending_count: 0 });
        expect(settled.can_close_financials).toBe(true);
    });

    it('OC y HES obligatorias faltantes son bloqueantes y cuentan cada documento pendiente', async () => {
        const projectId = await addProject({
            deliveryAcceptedAt: '2026-10-20 10:00:00', requirePurchaseOrder: true, requireServiceAcceptance: true
        });

        const missingBoth = (await closureReportService.getReport(projectId))!;
        expect(item(missingBoth, 'required_documents')).toMatchObject({ ok: false, pending_count: 2, blocking: true });
        expect(missingBoth.can_close_financials).toBe(false);

        await addDocument(projectId, 'purchase_order');
        const missingHes = (await closureReportService.getReport(projectId))!;
        expect(item(missingHes, 'required_documents')).toMatchObject({ ok: false, pending_count: 1 });

        await addDocument(projectId, 'service_acceptance');
        const complete = (await closureReportService.getReport(projectId))!;
        expect(item(complete, 'required_documents')).toMatchObject({ ok: true, pending_count: 0 });
        expect(complete.can_close_financials).toBe(true);

        const optional = await addProject({ name: 'Sin requisitos', deliveryAcceptedAt: '2026-10-20 10:00:00' });
        expect(item((await closureReportService.getReport(optional))!, 'required_documents')).toMatchObject({ ok: true, pending_count: 0 });
    });

    it('horas sin aprobar y tareas sin terminar aparecen con blocking=false y no impiden can_close_financials', async () => {
        const projectId = await addProject({ deliveryAcceptedAt: '2026-10-20 10:00:00' });
        await addTimeEntry(projectId, users.dev, 4, 'approved');
        await addTimeEntry(projectId, users.dev, 3, 'draft');
        await addTimeEntry(projectId, users.ops, 2, 'submitted');
        await addTimeEntry(projectId, users.ops, 1, 'rejected');
        await addTask(projectId, 'Hecha', 'done');
        await addTask(projectId, 'En curso', 'in_progress');
        await addTask(projectId, 'Bloqueada', 'blocked');

        const report = (await closureReportService.getReport(projectId))!;

        expect(item(report, 'timesheets_approved')).toMatchObject({ ok: false, pending_count: 3, blocking: false });
        expect(item(report, 'tasks_done')).toMatchObject({ ok: false, pending_count: 2, blocking: false });
        expect(report.can_close_financials).toBe(true);
        expect(report.checklist.map(i => [i.key, i.blocking])).toEqual([
            ['delivery_accepted', true], ['payment_milestones', true], ['invoices_paid', true],
            ['timesheets_approved', false], ['tasks_done', false], ['required_documents', true]
        ]);
        for (const entry of report.checklist) expect(entry.label.length).toBeGreaterThan(0);
    });

    it('una tarea movida a la columna Done cuenta como terminada aunque su status siga en todo, y una en otra columna sigue pendiente', async () => {
        const projectId = await addProject({ deliveryAcceptedAt: '2026-10-20 10:00:00' });
        // El tablero crea las tareas con status 'todo' y al terminarlas solo cambia su column_id: el status no se toca.
        const movida = await addTask(projectId, 'Movida a Done', 'todo', 'To Do');
        await addTask(projectId, 'Sigue en To Do', 'todo', 'To Do');
        await addTask(projectId, 'En progreso', 'todo', 'In Progress');
        const doneColumn = (await testDb.run(
            `INSERT INTO task_columns (board_id, name, position, is_done_column)
             VALUES ((SELECT board_id FROM tasks WHERE id = ?), 'Done', 6, 1)`, [movida]
        )).id!;
        await testDb.run(`UPDATE tasks SET column_id = ? WHERE id = ?`, [doneColumn, movida]);

        const report = (await closureReportService.getReport(projectId))!;

        expect(item(report, 'tasks_done')).toMatchObject({ ok: false, pending_count: 2, blocking: false });

        await testDb.run(`UPDATE tasks SET column_id = ?`, [doneColumn]);
        const allDone = (await closureReportService.getReport(projectId))!;

        expect(item(allDone, 'tasks_done')).toMatchObject({ ok: true, pending_count: 0 });
    });

    it('las columnas de terminadas se reconocen por is_done_column o por su nombre (done, completed, finished), igual que el listado de proyectos', async () => {
        const projectId = await addProject({ deliveryAcceptedAt: '2026-10-20 10:00:00' });
        await addTask(projectId, 'Columna marcada', 'todo', 'Entregadas', true);
        await addTask(projectId, 'Por nombre Done', 'todo', 'Done');
        await addTask(projectId, 'Por nombre con espacios', 'todo', ' Completed ');
        await addTask(projectId, 'Por nombre Finished', 'todo', 'finished');
        await addTask(projectId, 'Pendiente real', 'todo', 'Backlog');
        await addTask(projectId, 'Status done en otra columna', 'done', 'Backlog');

        const report = (await closureReportService.getReport(projectId))!;

        expect(item(report, 'tasks_done')).toMatchObject({ ok: false, pending_count: 1 });
    });

    it('can_close_financials coincide con lo que acepta POST financial-close', async () => {
        const projectId = await addProject({
            deliveryAcceptedAt: '2026-10-20 10:00:00', requirePurchaseOrder: true
        });
        await addMilestone(projectId, 'Hito', 'billable');
        const factura = await addInvoice(projectId, 500000);
        const close = () => request(app).post(`/api/commercial/projects/${projectId}/financial-close`).set('x-test-role', 'team_lead');

        expect((await closureReportService.getReport(projectId))!.can_close_financials).toBe(false);
        expect((await close()).status).toBe(409);

        await testDb.run(`UPDATE payment_milestones SET status = 'paid' WHERE project_id = ?`, [projectId]);
        await addPayment(factura, 500000);
        expect((await closureReportService.getReport(projectId))!.can_close_financials).toBe(false);
        expect((await close()).status).toBe(409);

        await addDocument(projectId, 'purchase_order');
        expect((await closureReportService.getReport(projectId))!.can_close_financials).toBe(true);
        expect((await close()).status).toBe(200);
        expect((await closureReportService.getReport(projectId))!.project.financial_closed_at).not.toBeNull();
    });

    it('quoted viene de la última cotización aprobada; sin cotización queda en 0 y version null', async () => {
        const sinCotizacion = await addProject({ name: 'Sin cotización' });
        const conVersiones = await addProject({ name: 'Con versiones' });
        await addApprovedQuote(conVersiones, 1, 100, 'UF', 50, 50, 50, 'replaced');
        // monto y costo estimado van en la moneda de la cotización: 150 UF x 40.000 = 6.000.000 y 75 UF x 40.000 = 3.000.000
        await addApprovedQuote(conVersiones, 2, 150, 'UF', 80, 75, 50);
        await addApprovedQuote(conVersiones, 3, 999, 'UF', 99, 1, 99, 'sent'); // enviada, aún no aprobada

        const sin = (await closureReportService.getReport(sinCotizacion))!;
        const con = (await closureReportService.getReport(conVersiones))!;

        expect(sin.quoted).toEqual({ amount_clp: 0, hours: 0, estimated_cost_clp: 0, margin_percent: null, version: null });
        expect(con.quoted).toEqual({ amount_clp: 6000000, hours: 80, estimated_cost_clp: 3000000, margin_percent: 50, version: 2 });
    });

    it('actual y team salen de financeService y de horas aprobadas por persona', async () => {
        const projectId = await addProject({ salePrice: 1000000, budgetedCost: 600000, budgetedHours: 100 });
        await testDb.run(
            `INSERT INTO user_cost_rates (user_id, monthly_cost, hourly_rate, effective_from, created_by) VALUES (?, 1344000, 8000, '2026-01-01', ?)`,
            [users.dev, users.lead]
        );
        await addAssignment(projectId, users.dev, 40);
        await addAssignment(projectId, users.ops, 20);
        await addTimeEntry(projectId, users.dev, 25, 'approved');
        await addTimeEntry(projectId, users.dev, 5, 'draft');
        await addTimeEntry(projectId, users.ops, 6, 'submitted');

        const report = (await closureReportService.getReport(projectId))!;

        const fin = await financeService.calculateProjectFinancials(projectId);
        expect(report.actual).toEqual({
            sale_price: fin.sale_price, real_cost: fin.real_cost, real_profit: fin.real_profit,
            real_margin_percentage: fin.real_margin_percentage, approved_hours: fin.approved_hours,
            real_hours_source: fin.real_hours_source, planned_hours: fin.planned_hours, variance_impact: fin.variance_impact
        });
        expect(report.actual).toMatchObject({
            sale_price: 1000000, real_cost: 200000, real_profit: 800000, real_margin_percentage: 80,
            approved_hours: 25, real_hours_source: 'approved', planned_hours: 100
        });
        expect(report.team).toEqual([
            { user_name: 'DEV', budgeted_hours: 40, actual_hours: 25 },
            { user_name: 'OPS', budgeted_hours: 20, actual_hours: 0 }
        ]);
    });

    it('el equipo incluye a quien trabajó sin asignación activa y sus horas aprobadas suman las de actual', async () => {
        const projectId = await addProject({ salePrice: 100000, budgetedHours: 10 });
        await addAssignment(projectId, users.dev, 10, 0); // asignación dada de baja que ya tenía horas
        await addTimeEntry(projectId, users.dev, 3.5, 'approved');
        await addTimeEntry(projectId, users.ops, 1.25, 'approved'); // sin asignación

        const report = (await closureReportService.getReport(projectId))!;

        expect(report.team).toEqual([
            { user_name: 'DEV', budgeted_hours: 10, actual_hours: 3.5 },
            { user_name: 'OPS', budgeted_hours: 0, actual_hours: 1.25 }
        ]);
        expect(report.team.reduce((acc, member) => acc + member.actual_hours, 0)).toBe(report.actual.approved_hours);
    });

    it('lista los hitos de pago con sus importes originales ordenados por fecha y los sin fecha al final', async () => {
        const projectId = await addProject();
        await addMilestone(projectId, 'Sin fecha', 'pending', null);
        await addMilestone(projectId, 'Segundo', 'pending', '2026-12-01');
        await addMilestone(projectId, 'Primero', 'paid', '2026-06-01');

        const report = (await closureReportService.getReport(projectId))!;

        expect(report.milestones).toEqual([
            { name: 'Primero', amount: 500000, currency: 'CLP', status: 'paid', planned_date: '2026-06-01' },
            { name: 'Segundo', amount: 500000, currency: 'CLP', status: 'pending', planned_date: '2026-12-01' },
            { name: 'Sin fecha', amount: 500000, currency: 'CLP', status: 'pending', planned_date: null }
        ]);
        expect(new Date(report.generated_at).toString()).not.toBe('Invalid Date');
    });

    it('actual.real_hours_source avisa si el real viene de horas aprobadas o de una proyección', async () => {
        const sinHoras = await addProject({ name: 'Sin horas aprobadas', salePrice: 1000000, budgetedCost: 600000, budgetedHours: 100 });
        await addTimeEntry(sinHoras, users.dev, 8, 'submitted');
        const conHoras = await addProject({ name: 'Con horas aprobadas', salePrice: 1000000, budgetedCost: 600000, budgetedHours: 100 });
        await addTimeEntry(conHoras, users.dev, 8, 'approved');

        expect((await closureReportService.getReport(sinHoras))!.actual).toMatchObject({ real_hours_source: 'projected', approved_hours: 0 });
        expect((await closureReportService.getReport(conHoras))!.actual).toMatchObject({ real_hours_source: 'approved', approved_hours: 8 });
    });

    it('proyecto sin horas, cotización ni facturas devuelve secciones vacías sin NaN', async () => {
        const projectId = await addProject();

        const report = (await closureReportService.getReport(projectId))!;

        expect(report.team).toEqual([]);
        expect(report.milestones).toEqual([]);
        expect(report.quoted).toEqual({ amount_clp: 0, hours: 0, estimated_cost_clp: 0, margin_percent: null, version: null });
        expect(report.actual).toMatchObject({ sale_price: 0, real_margin_percentage: 0, approved_hours: 0 });
        expect(item(report, 'payment_milestones')).toMatchObject({ ok: true, pending_count: 0 });
        expect(item(report, 'invoices_paid')).toMatchObject({ ok: true, pending_count: 0 });
        expect(item(report, 'timesheets_approved')).toMatchObject({ ok: true, pending_count: 0 });
        expect(item(report, 'tasks_done')).toMatchObject({ ok: true, pending_count: 0 });
        const numbers: number[] = [];
        const collect = (value: unknown): void => {
            if (typeof value === 'number') numbers.push(value);
            else if (value && typeof value === 'object') Object.values(value).forEach(collect);
        };
        collect(report);
        expect(numbers.length).toBeGreaterThan(0);
        for (const n of numbers) expect(Number.isFinite(n)).toBe(true);

        const res = await getJson(projectId);
        expect(res.status).toBe(200);
        expect(res.body.data.actual.real_margin_percentage).toBe(0);
        const pdf = await getPdf(projectId);
        expect(pdf.status).toBe(200);
    });

    it('rpa_developer, rpa_operations y billing reciben 403 en el JSON y en el PDF', async () => {
        const projectId = await addProject();

        for (const role of ['rpa_developer', 'rpa_operations', 'billing']) {
            const json = await getJson(projectId, role);
            const pdf = await request(app).get(`/api/commercial/projects/${projectId}/closure-report.pdf`).set('x-test-role', role);
            expect({ role, json: json.status, pdf: pdf.status }).toEqual({ role, json: 403, pdf: 403 });
        }
    });

    it('team_lead recibe el informe como { data } con el checklist completo', async () => {
        const projectId = await addProject();

        const res = await getJson(projectId);

        expect(res.status).toBe(200);
        expect(res.body.data.project).toMatchObject({ id: projectId, name: 'Proyecto Cierre' });
        expect(res.body.data.checklist).toHaveLength(6);
        expect(res.body.data.can_close_financials).toBe(false);
    });

    it('el PDF responde 200, content-type application/pdf y un buffer que empieza con "%PDF"', async () => {
        const client = (await testDb.run(`INSERT INTO clients (name) VALUES ('Cliente Ñandú Ltda.')`)).id!;
        const projectId = await addProject({ name: 'Migración útil', clientId: client, salePrice: 1000000, budgetedHours: 100 });
        await addMilestone(projectId, 'Hito único', 'pending', '2026-12-01');
        await addAssignment(projectId, users.dev, 40);
        await addTimeEntry(projectId, users.dev, 12.5, 'approved');
        await addApprovedQuote(projectId, 1, 1200000, 'CLP', 100, 700000, 41.67);

        const res = await getPdf(projectId);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/pdf');
        expect(res.headers['content-disposition']).toBe(`attachment; filename="informe-cierre-${projectId}.pdf"`);
        expect(Buffer.isBuffer(res.body)).toBe(true);
        expect(res.body.subarray(0, 4).toString('ascii')).toBe('%PDF');
        expect(res.body.length).toBeGreaterThan(500);
    });

    it('el PDF reparte un equipo largo en varias páginas en vez de cortar las filas', async () => {
        const projectId = await addProject();
        const report = (await closureReportService.getReport(projectId))!;
        report.team = Array.from({ length: 70 }, (_, i) => ({ user_name: `Persona ${i + 1}`, budgeted_hours: i, actual_hours: i * 1.5 }));

        const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page(?![s\w])/g) ?? []).length;
        const short = await generateClosureReport((await closureReportService.getReport(projectId))!);
        const long = await generateClosureReport(report);

        expect(pages(short)).toBe(1);
        expect(pages(long)).toBeGreaterThan(1);
    });

    it('si el cálculo falla responde 500 en español en vez de dejar la petición colgada', async () => {
        const projectId = await addProject();
        jest.spyOn(financeService, 'calculateProjectFinancials').mockRejectedValue(new Error('boom'));

        const json = await getJson(projectId);
        const pdf = await request(app).get(`/api/commercial/projects/${projectId}/closure-report.pdf`).set('x-test-role', 'team_lead');

        expect(logger.error).toHaveBeenCalled();
        expect(json.status).toBe(500);
        expect(json.body).toEqual({ error: 'Error al generar el informe de cierre' });
        expect(pdf.status).toBe(500);
        expect(pdf.body).toEqual({ error: 'Error al generar el informe de cierre' });
    });
});
