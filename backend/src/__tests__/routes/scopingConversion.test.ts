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
            req.user = {
                id: Number(req.headers['x-test-user'] ?? 1),
                role: req.headers['x-test-role'] ?? 'rpa_developer',
                email: 'test@rpa.com'
            };
            next();
        }
    };
});

import express from 'express';
import request from 'supertest';
import scopingRoutes from '../../routes/scopingRoutes';
import commercialRoutes from '../../routes/commercialRoutes';
import portfolioRoutes from '../../routes/portfolioRoutes';
import { financeService } from '../../services/financeService';
import { createRealTestDb, realDbHolder, seedBasicUsers, RealTestDb, TestUsers } from '../helpers/realTestDb';

const app = express();
app.use(express.json());
app.use('/api/scopings', scopingRoutes);
app.use('/api/commercial', commercialRoutes);
app.use('/api/portfolio', portfolioRoutes);

type Actor = { id: number; role: string };
type Currency = 'CLP' | 'UF' | 'USD';

const RATES: Record<Currency, number> = { CLP: 1, UF: 38000, USD: 950 };

// Entradas que dan esfuerzo bajo (236 HH) y un levantamiento viable
const baseCreate = {
    client_name: 'Acme SpA',
    process_name: 'Contabilización de facturas',
    data_input_type: 'digital_structured',
    rule_based_level: 'rules_mostly',
    process_stability: 'no_change',
    application_stability: 'no_change',
    frequency: 'daily',
    volume_per_frequency: 200,
    aht_minutes: 8,
    process_steps_count: '25_40',
    decision_complexity: 'simple_yes_no',
    applications_count: '2_3_apps',
    uses_vdi: false,
    requires_ocr: false,
    structured_data_pct: 'gte_80'
};

describe('Conversión del cotizador a proyecto: cifras en pesos y versión 1 de cotización (SQLite real)', () => {
    let testDb: RealTestDb;
    let users: TestUsers;
    let lead: Actor;
    let ops: Actor;

    beforeAll(async () => {
        testDb = await createRealTestDb();
        realDbHolder.current = testDb;
        users = await seedBasicUsers(testDb);
        lead = { id: users.lead, role: 'team_lead' };
        ops = { id: users.ops, role: 'rpa_operations' };
        // Las migraciones siembran tipos de cambio con fecha reciente; se reemplazan por los de la prueba
        await testDb.run('DELETE FROM exchange_rates');
        for (const currency of ['UF', 'USD'] as const) {
            await testDb.run(`INSERT INTO exchange_rates (currency, rate_date, rate_to_clp) VALUES (?, '2020-01-01', ?)`, [currency, RATES[currency]]);
        }
    });

    afterAll(async () => {
        realDbHolder.current = null;
        await testDb.close();
    });

    beforeEach(async () => {
        await testDb.run('DELETE FROM scoping_quotations');
        await testDb.run('DELETE FROM projects');
    });

    const call = (actor: Actor, method: 'get' | 'post', url: string, body?: unknown) => {
        const req = request(app)[method](url).set({ 'x-test-user': String(actor.id), 'x-test-role': actor.role });
        return body === undefined ? req : req.send(body as object);
    };

    const createScoping = async (actor: Actor, currency: Currency) => {
        const res = await call(actor, 'post', '/api/scopings', { ...baseCreate, currency });
        expect(res.status).toBe(201);
        return res.body.data;
    };

    const convert = async (actor: Actor, scopingId: number): Promise<number> => {
        const res = await call(actor, 'post', `/api/scopings/${scopingId}/convert-to-project`);
        expect(res.status).toBe(200);
        return res.body.data.project_id;
    };

    const scopingRow = (id: number) => testDb.get('SELECT * FROM scoping_quotations WHERE id = ?', [id]);

    describe('el costo del proyecto se guarda en pesos (los demás módulos lo asumen así)', () => {
        it.each(['UF', 'USD', 'CLP'] as const)('convertir un levantamiento en %s guarda el costo presupuestado en CLP', async (currency) => {
            const created = await createScoping(lead, currency);
            const row = await scopingRow(created.id);
            const costClp = row.project_internal_cost * RATES[currency];

            const projectId = await convert(ops, created.id);

            expect(await testDb.get('SELECT * FROM project_financials WHERE project_id = ?', [projectId])).toMatchObject({
                budgeted_cost: costClp,
                budgeted_cost_currency: 'CLP',
                sale_price: row.proposed_price,
                sale_price_currency: currency,
                budgeted_hours: row.total_hours
            });
            expect(await testDb.get('SELECT budget, currency FROM projects WHERE id = ?', [projectId])).toEqual({
                budget: costClp,
                currency
            });

            const financials = await financeService.calculateProjectFinancials(projectId);
            expect(financials.planned_cost).toBe(Math.round(costClp));
            expect(financials.sale_price).toBe(Math.round(row.proposed_price * RATES[currency]));
        });

        it.each(['UF', 'USD'] as const)('aprobar una versión de cotización en %s fija la moneda del costo en CLP y no lo reconvierte', async (currency) => {
            // Estado que dejaba la conversión anterior: costo en la moneda de la cotización
            const project = await testDb.run(
                `INSERT INTO projects (name, status, commercial_stage, created_by) VALUES ('Legado', 'on_hold', 'quoting', ?)`,
                [users.lead]
            );
            await testDb.run(
                `INSERT INTO project_financials (project_id, budgeted_cost, budgeted_cost_currency, sale_price, sale_price_currency)
                 VALUES (?, 100, ?, 200, ?)`,
                [project.id, currency, currency]
            );
            const quote = await call(lead, 'post', `/api/commercial/projects/${project.id}/quotes`, {
                amount: 224, currency, hours: 236, estimated_cost: 113
            });
            expect(quote.status).toBe(201);

            const approved = await call(lead, 'post', `/api/commercial/quotes/${quote.body.data.id}/approve`);

            expect(approved.status).toBe(200);
            expect(await testDb.get('SELECT * FROM project_financials WHERE project_id = ?', [project.id])).toMatchObject({
                budgeted_cost: 113 * RATES[currency],
                budgeted_cost_currency: 'CLP',
                sale_price: 224,
                sale_price_currency: currency
            });
            const financials = await financeService.calculateProjectFinancials(project.id!);
            expect(financials.planned_cost).toBe(113 * RATES[currency]);
            expect(financials.sale_price).toBe(224 * RATES[currency]);
        });
    });
});
