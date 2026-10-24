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
import { portfolioService } from '../../services/portfolioService';
import portfolioRoutes from '../../routes/portfolioRoutes';
import { createRealTestDb, realDbHolder, seedBasicUsers, RealTestDb, TestUsers } from '../helpers/realTestDb';

const app = express();
app.use(express.json());
app.use('/api/portfolio', portfolioRoutes);

const EMPTY_TOTALS = {
    projects: 0, sale_price: 0, real_cost: 0, projected_cost: 0, projected_profit: 0,
    invoiced_clp: 0, collected_clp: 0, pending_to_invoice_clp: 0
};

interface SeedProject {
    name: string;
    stage?: 'quoting' | 'approved' | 'lost';
    clientId?: number | null;
    repId?: number | null;
    areaId?: number | null;
    salePrice?: number;
    salePriceCurrency?: 'CLP' | 'UF' | 'USD';
    budgetedCost?: number;
    budgetedHours?: number;
}

describe('Cartera de proyectos - servicio y endpoint (SQLite real)', () => {
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
            'payments', 'invoices', 'project_quotes', 'time_entries', 'project_assignments', 'user_cost_rates',
            'project_milestones', 'project_baselines', 'project_financials', 'projects', 'clients', 'sales_reps', 'exchange_rates'
        ]) {
            await testDb.run(`DELETE FROM ${table}`);
        }
        await setRate('UF', 40000);
        await setRate('USD', 950);
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

    async function addClient(name: string): Promise<number> {
        return (await testDb.run(`INSERT INTO clients (name) VALUES (?)`, [name])).id!;
    }

    async function addRep(name: string): Promise<number> {
        return (await testDb.run(`INSERT INTO sales_reps (name) VALUES (?)`, [name])).id!;
    }

    async function areaId(code: 'RPA_IA' | 'SAP'): Promise<number> {
        return (await testDb.get(`SELECT id FROM business_areas WHERE code = ?`, [code])).id;
    }

    async function addProject(p: SeedProject): Promise<number> {
        const { id } = await testDb.run(
            `INSERT INTO projects (name, commercial_stage, client_id, sales_rep_id, area_id) VALUES (?, ?, ?, ?, ?)`,
            [p.name, p.stage ?? 'approved', p.clientId ?? null, p.repId ?? null, p.areaId ?? null]
        );
        if (p.salePrice !== undefined || p.budgetedCost !== undefined || p.budgetedHours !== undefined) {
            await testDb.run(
                `INSERT INTO project_financials (project_id, sale_price, sale_price_currency, budgeted_cost, budgeted_hours)
                 VALUES (?, ?, ?, ?, ?)`,
                [id, p.salePrice ?? null, p.salePriceCurrency ?? 'CLP', p.budgetedCost ?? 0, p.budgetedHours ?? 0]
            );
        }
        return id!;
    }

    async function addInvoice(
        projectId: number, amount: number, currency: 'CLP' | 'UF' | 'USD', status = 'issued'
    ): Promise<number> {
        invoiceSeq += 1;
        return (await testDb.run(
            `INSERT INTO invoices (project_id, invoice_number, issue_date, due_date, currency, amount, status)
             VALUES (?, ?, '2026-10-01', '2026-11-01', ?, ?, ?)`,
            [projectId, `F-${invoiceSeq}`, currency, amount, status]
        )).id!;
    }

    async function addPayment(invoiceId: number, amount: number, currency: 'CLP' | 'UF' | 'USD'): Promise<void> {
        await testDb.run(
            `INSERT INTO payments (invoice_id, amount, currency, payment_date) VALUES (?, ?, ?, '2026-10-10')`,
            [invoiceId, amount, currency]
        );
    }

    async function addQuote(
        projectId: number, version: number, amount: number, currency: 'CLP' | 'UF' | 'USD', status = 'sent'
    ): Promise<void> {
        await testDb.run(
            `INSERT INTO project_quotes (project_id, version, amount, currency, status) VALUES (?, ?, ?, ?, ?)`,
            [projectId, version, amount, currency, status]
        );
    }

    it('devuelve cartera vacía con totales en 0 cuando no hay proyectos', async () => {
        const result = await portfolioService.getPortfolio();

        expect(result).toEqual({ rows: [], totals: EMPTY_TOTALS, pipeline: [], sales_by_rep: [] });
    });

    it('calcula por fila venta, costo real/proyectado, utilidad y margen desde financeService', async () => {
        const client = await addClient('Cliente Alfa');
        const rep = await addRep('Comercial Uno');
        const area = await areaId('RPA_IA');
        const alfa = await addProject({
            name: 'Alfa', clientId: client, repId: rep, areaId: area,
            salePrice: 1000000, budgetedCost: 600000, budgetedHours: 100
        });
        // 25 h aprobadas a $8.000/h: real = 200.000; proyectado = 200.000 + 75 h restantes x 8.000 = 800.000
        await testDb.run(
            `INSERT INTO user_cost_rates (user_id, monthly_cost, hourly_rate, effective_from, created_by) VALUES (?, 1344000, 8000, '2026-01-01', ?)`,
            [users.dev, users.lead]
        );
        await testDb.run(
            `INSERT INTO project_assignments (project_id, user_id, allocation_percentage, assigned_by) VALUES (?, ?, 100, ?)`,
            [alfa, users.dev, users.lead]
        );
        await testDb.run(
            `INSERT INTO time_entries (user_id, project_id, hours, date, approval_status, cost_rate_snapshot) VALUES (?, ?, 25, '2026-10-05', 'approved', 8000)`,
            [users.dev, alfa]
        );
        const beta = await addProject({ name: 'Beta', salePrice: 500000, budgetedCost: 300000, budgetedHours: 40 });

        const result = await portfolioService.getPortfolio();

        const fin = await financeService.calculateProjectFinancials(alfa);
        expect(result.rows.map(r => r.project_name)).toEqual(['Alfa', 'Beta']);
        expect(result.rows[0]).toEqual({
            project_id: alfa, project_name: 'Alfa', status: 'active', commercial_stage: 'approved',
            client_id: client, client_name: 'Cliente Alfa',
            sales_rep_id: rep, sales_rep_name: 'Comercial Uno',
            area_id: area, area_name: expect.any(String),
            sale_price: fin.sale_price, real_cost: fin.real_cost, projected_cost: fin.projected_cost,
            real_profit: fin.real_profit, projected_profit: fin.projected_profit,
            real_margin_percentage: fin.real_margin_percentage, projected_margin_percentage: fin.projected_margin_percentage,
            health_semaphore: 'gray',
            invoiced_clp: 0, collected_clp: 0, pending_to_invoice_clp: 1000000,
            financials_error: false
        });
        expect(result.rows[0]).toMatchObject({
            sale_price: 1000000, real_cost: 200000, projected_cost: 800000,
            real_profit: 800000, projected_profit: 200000,
            real_margin_percentage: 80, projected_margin_percentage: 20
        });
        expect(result.rows[1]).toMatchObject({ project_id: beta, sale_price: 500000, real_cost: 300000, projected_cost: 300000 });
        expect(result.totals).toEqual({
            projects: 2, sale_price: 1500000, real_cost: 500000, projected_cost: 1100000, projected_profit: 400000,
            invoiced_clp: 0, collected_clp: 0, pending_to_invoice_clp: 1500000
        });
    });

    it('la fila trae el semáforo de salud del proyecto (gris sin línea base, verde con la línea base al día)', async () => {
        const sinBase = await addProject({ name: 'Sin base', salePrice: 100 });
        const alDia = await addProject({ name: 'Al día', salePrice: 100 });
        await testDb.run(
            `INSERT INTO project_baselines (project_id, start_date, end_date, budgeted_cost_clp, budgeted_hours, created_by) VALUES (?, '2026-01-01', '2026-12-31', 0, 0, ?)`,
            [alDia, users.lead]
        );
        await testDb.run(
            `INSERT INTO project_milestones (project_id, name, planned_date, completion_percentage, baseline_planned_date) VALUES (?, 'Hito 1', '2026-02-01', 100, '2026-02-01')`,
            [alDia]
        );

        const result = await portfolioService.getPortfolio();

        const byId = new Map(result.rows.map(r => [r.project_id, r.health_semaphore]));
        expect(byId.get(sinBase)).toBe('gray');
        expect(byId.get(alDia)).toBe('green');
    });

    it('facturado = facturas no borrador/anuladas, cobrado = suma de pagos, por facturar = max(venta - facturado, 0), con conversión a CLP', async () => {
        const proyecto = await addProject({ name: 'Con facturas', salePrice: 1000000 });
        const facturaClp = await addInvoice(proyecto, 300000, 'CLP');
        const facturaUf = await addInvoice(proyecto, 5, 'UF', 'partially_paid'); // 5 UF x 40.000 = 200.000
        const facturaUsd = await addInvoice(proyecto, 100, 'USD', 'paid'); // 100 USD x 950 = 95.000
        await addInvoice(proyecto, 999999, 'CLP', 'draft');
        await addInvoice(proyecto, 888888, 'CLP', 'cancelled');
        await addPayment(facturaClp, 100000, 'CLP');
        await addPayment(facturaUf, 2, 'UF'); // 80.000
        await addPayment(facturaUsd, 100, 'USD'); // 95.000
        const sobrefacturado = await addProject({ name: 'Sobrefacturado', salePrice: 100000 });
        await addInvoice(sobrefacturado, 150000, 'CLP');

        const result = await portfolioService.getPortfolio();

        const row = (name: string) => result.rows.find(r => r.project_name === name)!;
        expect(row('Con facturas')).toMatchObject({
            invoiced_clp: 595000, collected_clp: 275000, pending_to_invoice_clp: 405000
        });
        expect(row('Sobrefacturado')).toMatchObject({
            invoiced_clp: 150000, collected_clp: 0, pending_to_invoice_clp: 0
        });
        expect(result.totals).toMatchObject({
            sale_price: 1100000, invoiced_clp: 745000, collected_clp: 275000, pending_to_invoice_clp: 405000
        });
    });

    it("pipeline lista solo proyectos en commercial_stage 'quoting' con el monto de su última cotización", async () => {
        const client = await addClient('Cliente Pipeline');
        const rep = await addRep('Comercial Pipeline');
        const conVersiones = await addProject({ name: 'Q con versiones', stage: 'quoting', clientId: client, repId: rep });
        await addQuote(conVersiones, 1, 100, 'UF', 'replaced');
        await addQuote(conVersiones, 2, 150, 'UF', 'sent'); // 150 UF x 40.000 = 6.000.000
        const sinCotizacion = await addProject({ name: 'Q sin cotización', stage: 'quoting' });
        const aprobado = await addProject({ name: 'Aprobado', stage: 'approved' });
        await addQuote(aprobado, 1, 900000, 'CLP', 'approved');
        const perdido = await addProject({ name: 'Perdido', stage: 'lost' });
        await addQuote(perdido, 1, 800000, 'CLP', 'rejected');

        const result = await portfolioService.getPortfolio();

        expect(result.pipeline).toEqual([
            {
                project_id: conVersiones, project_name: 'Q con versiones', client_name: 'Cliente Pipeline',
                sales_rep_name: 'Comercial Pipeline', last_quote_amount_clp: 6000000, last_quote_version: 2
            },
            {
                project_id: sinCotizacion, project_name: 'Q sin cotización', client_name: null,
                sales_rep_name: null, last_quote_amount_clp: 0, last_quote_version: null
            }
        ]);
    });

    it('sales_by_rep suma venta por comercial y agrupa los sin comercial como "Sin asignar"', async () => {
        const repA = await addRep('Ana');
        const repB = await addRep('Beto');
        await addProject({ name: 'A1', repId: repA, salePrice: 1000000 });
        await addProject({ name: 'A2', repId: repA, salePrice: 500000 });
        await addProject({ name: 'A perdido', repId: repA, stage: 'lost', salePrice: 9999999 });
        await addProject({ name: 'B1', repId: repB, salePrice: 700000 });
        await addProject({ name: 'Huérfano', salePrice: 200000 });

        const result = await portfolioService.getPortfolio();

        expect(result.sales_by_rep).toEqual([
            { sales_rep_id: repA, sales_rep_name: 'Ana', projects: 2, sale_price: 1500000 },
            { sales_rep_id: repB, sales_rep_name: 'Beto', projects: 1, sale_price: 700000 },
            { sales_rep_id: null, sales_rep_name: 'Sin asignar', projects: 1, sale_price: 200000 }
        ]);
    });

    it('los filtros client_id / sales_rep_id / commercial_stage / area_id acotan filas, totales y ventas por comercial; un client_id inexistente da lista vacía', async () => {
        const clientX = await addClient('Cliente X');
        const clientY = await addClient('Cliente Y');
        const repA = await addRep('Ana');
        const repB = await addRep('Beto');
        const rpa = await areaId('RPA_IA');
        const sap = await areaId('SAP');
        const p1 = await addProject({ name: 'P1', clientId: clientX, repId: repA, areaId: rpa, stage: 'approved', salePrice: 1000 });
        const p2 = await addProject({ name: 'P2', clientId: clientX, repId: repB, areaId: sap, stage: 'approved', salePrice: 2000 });
        const p3 = await addProject({ name: 'P3', clientId: clientY, repId: repA, areaId: sap, stage: 'quoting', salePrice: 4000 });
        const p4 = await addProject({ name: 'P4', clientId: clientY, repId: repB, areaId: rpa, stage: 'lost', salePrice: 8000 });
        const ids = (rows: { project_id: number }[]) => rows.map(r => r.project_id);

        const porCliente = await portfolioService.getPortfolio({ client_id: clientX });
        expect(ids(porCliente.rows)).toEqual([p1, p2]);
        expect(porCliente.totals).toMatchObject({ projects: 2, sale_price: 3000 });
        expect(porCliente.sales_by_rep.map(r => [r.sales_rep_name, r.sale_price])).toEqual([['Beto', 2000], ['Ana', 1000]]);

        const porComercial = await portfolioService.getPortfolio({ sales_rep_id: repA });
        expect(ids(porComercial.rows)).toEqual([p1, p3]);
        expect(porComercial.totals).toMatchObject({ projects: 2, sale_price: 5000 });
        expect(porComercial.sales_by_rep).toEqual([{ sales_rep_id: repA, sales_rep_name: 'Ana', projects: 2, sale_price: 5000 }]);

        const porArea = await portfolioService.getPortfolio({ area_id: sap });
        expect(ids(porArea.rows)).toEqual([p2, p3]);
        expect(porArea.totals).toMatchObject({ projects: 2, sale_price: 6000 });

        const porEtapa = await portfolioService.getPortfolio({ commercial_stage: 'approved' });
        expect(ids(porEtapa.rows)).toEqual([p1, p2]);
        // el pipeline ignora el filtro de etapa: sigue mostrando lo que está cotizándose
        expect(ids(porEtapa.pipeline)).toEqual([p3]);

        const combinado = await portfolioService.getPortfolio({ client_id: clientY, commercial_stage: 'lost' });
        expect(ids(combinado.rows)).toEqual([p4]);
        expect(combinado.sales_by_rep).toEqual([]);
        // el pipeline respeta cliente/comercial/área: p3 es de Cliente Y
        expect(ids(combinado.pipeline)).toEqual([p3]);

        const sinCoincidencia = await portfolioService.getPortfolio({ client_id: 99999 });
        expect(sinCoincidencia).toEqual({ rows: [], totals: EMPTY_TOTALS, pipeline: [], sales_by_rep: [] });
    });

    it('un proyecto sin cliente ni área aparece con client_name y area_name null', async () => {
        const huerfano = await addProject({ name: 'Sin cliente ni área' });

        const result = await portfolioService.getPortfolio();

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toMatchObject({
            project_id: huerfano, client_id: null, client_name: null, area_id: null, area_name: null,
            sales_rep_id: null, sales_rep_name: null
        });
    });

    it('venta 0 produce margen 0 (no NaN)', async () => {
        await addProject({ name: 'Sin precio' });

        const result = await portfolioService.getPortfolio();

        const row = result.rows[0];
        expect(row.sale_price).toBe(0);
        expect(row.real_margin_percentage).toBe(0);
        expect(row.projected_margin_percentage).toBe(0);
        expect(row.pending_to_invoice_clp).toBe(0);
        for (const value of Object.values(row)) {
            if (typeof value === 'number') expect(Number.isNaN(value)).toBe(false);
        }
    });

    it('si calculateProjectFinancials falla para un proyecto, esa fila sale con financials_error=true y las demás siguen', async () => {
        const roto = await addProject({ name: 'Roto', salePrice: 5000000 });
        const sano = await addProject({ name: 'Sano', salePrice: 1000000, budgetedCost: 400000, budgetedHours: 10 });
        await addInvoice(roto, 700000, 'CLP');
        const original = financeService.calculateProjectFinancials.bind(financeService);
        jest.spyOn(financeService, 'calculateProjectFinancials').mockImplementation(async (projectId: number) => {
            if (projectId === roto) throw new Error('boom');
            return original(projectId);
        });

        const result = await portfolioService.getPortfolio();

        const rowOf = (id: number) => result.rows.find(r => r.project_id === id)!;
        expect(rowOf(roto)).toMatchObject({
            financials_error: true, sale_price: 0, real_cost: 0, projected_cost: 0,
            real_profit: 0, projected_profit: 0, real_margin_percentage: 0, projected_margin_percentage: 0,
            health_semaphore: 'gray', invoiced_clp: 700000, pending_to_invoice_clp: 0
        });
        expect(rowOf(sano)).toMatchObject({
            financials_error: false, sale_price: 1000000, real_cost: 400000, projected_cost: 400000, projected_profit: 600000
        });
        expect(result.totals).toMatchObject({ projects: 2, sale_price: 1000000, real_cost: 400000, projected_profit: 600000, invoiced_clp: 700000 });
        expect(logger.error).toHaveBeenCalled();
    });

    it('rpa_developer, rpa_operations y billing reciben 403; team_lead recibe 200', async () => {
        for (const role of ['rpa_developer', 'rpa_operations', 'billing']) {
            const res = await request(app).get('/api/portfolio').set('x-test-role', role);
            expect({ role, status: res.status }).toEqual({ role, status: 403 });
        }

        const res = await request(app).get('/api/portfolio').set('x-test-role', 'team_lead');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ data: { rows: [], totals: EMPTY_TOTALS, pipeline: [], sales_by_rep: [] } });
    });

    it('el endpoint convierte la querystring en filtros numéricos y responde 400 ante valores inválidos', async () => {
        const clientX = await addClient('Cliente X');
        const clientY = await addClient('Cliente Y');
        const px = await addProject({ name: 'PX', clientId: clientX, stage: 'approved', salePrice: 1000 });
        await addProject({ name: 'PY', clientId: clientY, stage: 'approved', salePrice: 2000 });
        const get = (query: string) => request(app).get(`/api/portfolio?${query}`).set('x-test-role', 'team_lead');

        const filtrado = await get(`client_id=${clientX}&commercial_stage=approved`);
        expect(filtrado.status).toBe(200);
        expect(filtrado.body.data.rows.map((r: any) => r.project_id)).toEqual([px]);

        const vacio = await get('client_id=&sales_rep_id=&commercial_stage=&area_id=');
        expect(vacio.status).toBe(200);
        expect(vacio.body.data.rows).toHaveLength(2);

        for (const invalid of ['client_id=abc', 'sales_rep_id=-1', 'area_id=1.5', 'commercial_stage=ganado']) {
            const res = await get(invalid);
            expect({ invalid, status: res.status }).toEqual({ invalid, status: 400 });
        }
    });
});
