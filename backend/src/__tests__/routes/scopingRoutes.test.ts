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
import { RPA_ARCHETYPES } from '../../constants/rpaArchetypes';
import { ScopingService } from '../../services/scopingService';
import { createRealTestDb, realDbHolder, seedBasicUsers, RealTestDb, TestUsers } from '../helpers/realTestDb';

const app = express();
app.use(express.json());
app.use('/api/scopings', scopingRoutes);

type Actor = { id: number; role: string };
type Method = 'get' | 'post' | 'put' | 'delete';

const INTERNAL_FIELDS = ['internal_cost_rate', 'project_internal_cost', 'projected_margin_pct'];

// Entradas completas que el frontend envía siempre (nivel de esfuerzo bajo: 236 HH, 6 semanas).
const baseInputs = {
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

const baseCreate = { client_name: 'Acme SpA', process_name: 'Contabilización de facturas', ...baseInputs };

// Arquetipo "Recepción de OC": con OCR activo cae en esfuerzo medio (492 HH); sin OCR sería bajo (236 HH).
const purchaseOrderInputs = RPA_ARCHETYPES.find((a) => a.id === 'recepcion_ordenes_compra')!.default_inputs;

describe('scopingRoutes API (SQLite real)', () => {
    let testDb: RealTestDb;
    let users: TestUsers;
    let lead: Actor;
    let dev: Actor;
    let ops: Actor;

    beforeAll(async () => {
        testDb = await createRealTestDb();
        realDbHolder.current = testDb;
        users = await seedBasicUsers(testDb);
        lead = { id: users.lead, role: 'team_lead' };
        dev = { id: users.dev, role: 'rpa_developer' };
        ops = { id: users.ops, role: 'rpa_operations' };
    });

    afterAll(async () => {
        realDbHolder.current = null;
        await testDb.close();
    });

    beforeEach(async () => {
        await testDb.run('DELETE FROM scoping_quotations');
        await testDb.run('DELETE FROM projects');
    });

    const call = (actor: Actor, method: Method, url: string, body?: unknown) => {
        const req = request(app)[method](url).set({ 'x-test-user': String(actor.id), 'x-test-role': actor.role });
        return body === undefined ? req : req.send(body as object);
    };

    const createQuote = async (actor: Actor, body: Record<string, unknown> = {}) => {
        const res = await call(actor, 'post', '/api/scopings', { ...baseCreate, ...body });
        expect(res.status).toBe(201);
        return res.body.data;
    };

    const rowOf = (id: number) => testDb.get('SELECT * FROM scoping_quotations WHERE id = ?', [id]);
    const count = async (table: string) => (await testDb.get(`SELECT COUNT(*) AS n FROM ${table}`)).n as number;

    describe('catálogo y cálculo en memoria', () => {
        it('GET /api/scopings/archetypes devuelve el catálogo de arquetipos RPA', async () => {
            const res = await call(dev, 'get', '/api/scopings/archetypes');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data.length).toBeGreaterThanOrEqual(4);

            const ids = res.body.data.map((a: any) => a.id);
            expect(ids).toContain('conciliacion_bancaria');
            expect(ids).toContain('contabilizacion_facturas');
            expect(ids).toContain('recepcion_ordenes_compra');
        });

        it('POST /api/scopings/calculate realiza el cálculo en memoria con cubicación y ROI', async () => {
            const res = await call(dev, 'post', '/api/scopings/calculate', baseInputs);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
            expect(res.body.data.is_viable).toBe(true);
            expect(res.body.data.total_hours).toBeGreaterThan(0);
            expect(res.body.data.proposed_price).toBeGreaterThan(0);
            expect(res.body.data.roles_breakdown).toHaveLength(4);
            expect(res.body.data.phases_breakdown).toHaveLength(5);
            expect(res.body.data.custom_hours).toBeNull();
        });

        it('calculate devuelve la calibración manual aplicada en custom_hours', async () => {
            const custom = { lp: 10, crpa: 20, ar: 30, adv: 5, weeks: 4 };
            const res = await call(dev, 'post', '/api/scopings/calculate', { ...baseInputs, custom_hours: custom });

            expect(res.status).toBe(200);
            expect(res.body.data.custom_hours).toEqual(custom);
            expect(res.body.data.total_hours).toBe(65);
        });
    });

    describe('validación de entradas (I5, I12)', () => {
        const invalidBodies: Array<[string, Record<string, unknown>, string]> = [
            ['cuerpo vacío', {}, 'El cuerpo de la solicitud está vacío'],
            ['frecuencia inválida', { ...baseInputs, frequency: 'hourly' }, 'La frecuencia del proceso no es válida'],
            ['volumen no numérico', { ...baseInputs, volume_per_frequency: 'abc' }, 'El volumen por frecuencia debe ser un número'],
            ['volumen cero', { ...baseInputs, volume_per_frequency: 0 }, 'El volumen por frecuencia debe ser al menos 1'],
            ['AHT negativo', { ...baseInputs, aht_minutes: -3 }, 'El tiempo promedio por ejecución (AHT) debe ser mayor que cero'],
            ['horas manuales negativas', { ...baseInputs, custom_hours: { lp: -10 } }, 'Las horas del Líder de Proyecto (LP) deben ser un número mayor o igual a cero'],
            ['semanas en cero', { ...baseInputs, custom_hours: { weeks: 0 } }, 'Las semanas estimadas deben ser un número entero entre 1 y 520'],
            ['campo de entrada null', { ...baseInputs, volume_per_frequency: null }, 'El volumen por frecuencia debe ser un número'],
            ['hora de calibración null', { ...baseInputs, custom_hours: { ar: null } }, 'Las horas del Automatizador (AR) deben ser un número mayor o igual a cero'],
            ['interruptor no booleano', { ...baseInputs, requires_ocr: 'si' }, 'El indicador de OCR debe ser verdadero o falso'],
            ['moneda EUR', { ...baseInputs, currency: 'EUR' }, 'La moneda debe ser CLP, USD o UF'],
            ['tarifa negativa', { ...baseInputs, target_hourly_rate: -1 }, 'La tarifa de venta por hora debe ser un número mayor o igual a cero']
        ];

        it.each(invalidBodies)('calculate responde 400 en español ante %s', async (_label, body, expected) => {
            const res = await call(dev, 'post', '/api/scopings/calculate', body);

            expect(res.status).toBe(400);
            expect(res.body).toEqual({ success: false, error: expected });
        });

        it.each(invalidBodies)('create responde 400 en español ante %s y no guarda nada', async (_label, body, expected) => {
            // Un cuerpo vacío se envía tal cual; el resto lleva nombres válidos para que el error sea el del dato probado.
            const payload = Object.keys(body).length === 0 ? body : { client_name: 'Acme', process_name: 'Proceso', ...body };
            const res = await call(dev, 'post', '/api/scopings', payload);

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBe(expected);
            expect(await count('scoping_quotations')).toBe(0);
        });

        it('create exige nombre de cliente y de proceso', async () => {
            const noClient = await call(dev, 'post', '/api/scopings', { process_name: 'P', ...baseInputs });
            const blankProcess = await call(dev, 'post', '/api/scopings', { client_name: 'C', process_name: '   ', ...baseInputs });

            expect(noClient.body.error).toBe('El nombre del cliente es obligatorio');
            expect(blankProcess.body.error).toBe('El nombre del proceso es obligatorio');
        });

        it('PUT valida igual que create y no modifica el registro', async () => {
            const created = await createQuote(dev);

            const res = await call(dev, 'put', `/api/scopings/${created.id}`, { currency: 'EUR' });
            const empty = await call(dev, 'put', `/api/scopings/${created.id}`, {});

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('La moneda debe ser CLP, USD o UF');
            expect(empty.status).toBe(400);
            expect((await rowOf(created.id)).currency).toBe('CLP');
        });

        it('rechaza ids no numéricos en español', async () => {
            const res = await call(dev, 'get', '/api/scopings/abc');

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('ID inválido');
        });
    });

    describe('actualización fiel (C2)', () => {
        it('PUT parcial con solo client_name conserva arquetipo, OCR, horas y precio', async () => {
            const created = await createQuote(dev, {
                ...purchaseOrderInputs,
                process_archetype: 'recepcion_ordenes_compra'
            });
            expect(created).toMatchObject({ requires_ocr: true, total_hours: 492, process_archetype: 'recepcion_ordenes_compra' });

            const res = await call(dev, 'put', `/api/scopings/${created.id}`, { client_name: 'Cliente renombrado' });
            const after = (await call(dev, 'get', `/api/scopings/${created.id}`)).body.data;

            expect(res.status).toBe(200);
            expect(res.body.data.client_name).toBe('Cliente renombrado');
            for (const field of [
                'process_archetype', 'requires_ocr', 'uses_vdi', 'volume_per_frequency', 'aht_minutes', 'frequency',
                'estimated_weeks', 'hours_pm', 'hours_consultant', 'hours_developer', 'hours_advisor', 'total_hours',
                'proposed_price', 'effort_level', 'hourly_labor_cost', 'target_hourly_rate'
            ]) {
                expect({ field, value: after[field] }).toEqual({ field, value: created[field] });
            }
            expect(after.calculation.total_hours).toBe(492);
        });

        it('crear con custom_hours persiste custom_hours_json y GET lo devuelve como objeto', async () => {
            const custom = { lp: 10, crpa: 20, ar: 30, adv: 5, weeks: 4 };

            const created = await createQuote(dev, { custom_hours: custom });
            const fetched = (await call(dev, 'get', `/api/scopings/${created.id}`)).body.data;
            const listed = (await call(dev, 'get', '/api/scopings')).body.data.find((r: any) => r.id === created.id);

            expect(JSON.parse((await rowOf(created.id)).custom_hours_json)).toEqual(custom);
            expect(created.custom_hours).toEqual(custom);
            expect(fetched.custom_hours).toEqual(custom);
            expect(listed.custom_hours).toEqual(custom);
            expect(fetched).not.toHaveProperty('custom_hours_json');
            expect(listed).not.toHaveProperty('custom_hours_json');
            expect(fetched).toMatchObject({ total_hours: 65, estimated_weeks: 4, hours_developer: 30 });
        });

        it('una cotización sin calibración devuelve custom_hours null', async () => {
            const created = await createQuote(dev);

            expect(created.custom_hours).toBeNull();
            expect((await rowOf(created.id)).custom_hours_json).toBeNull();
        });

        it('PUT sin custom_hours conserva las horas manuales guardadas', async () => {
            const custom = { lp: 10, crpa: 20, ar: 30, adv: 5, weeks: 4 };
            const created = await createQuote(dev, { custom_hours: custom });

            const res = await call(dev, 'put', `/api/scopings/${created.id}`, { client_name: 'Otro nombre', volume_per_frequency: 500 });

            expect(res.status).toBe(200);
            expect(res.body.data.custom_hours).toEqual(custom);
            expect(res.body.data).toMatchObject({ total_hours: 65, estimated_weeks: 4, volume_per_frequency: 500 });
            expect(res.body.data.proposed_price).toBe(65 * 36000);
        });

        it('PUT con custom_hours:null recalcula con los niveles del motor', async () => {
            const created = await createQuote(dev, { custom_hours: { lp: 10, crpa: 20, ar: 30, adv: 5, weeks: 4 } });

            const res = await call(dev, 'put', `/api/scopings/${created.id}`, { custom_hours: null });

            expect(res.status).toBe(200);
            expect(res.body.data.custom_hours).toBeNull();
            expect(res.body.data).toMatchObject({ total_hours: 236, estimated_weeks: 6, effort_level: 'low' });
            expect((await rowOf(created.id)).custom_hours_json).toBeNull();
        });

        it('PUT con un objeto custom_hours lo reemplaza completo (no lo fusiona)', async () => {
            const created = await createQuote(dev, { custom_hours: { lp: 10, crpa: 20, ar: 30, adv: 5, weeks: 4 } });

            const res = await call(dev, 'put', `/api/scopings/${created.id}`, { custom_hours: { ar: 100 } });

            expect(res.status).toBe(200);
            expect(res.body.data.custom_hours).toEqual({ ar: 100 });
            // lp 24 + crpa 54 + ar 100 + adv 18 (niveles bajos del motor) = 196
            expect(res.body.data.total_hours).toBe(196);
        });

        it('un custom_hours vacío equivale a sin calibración', async () => {
            const created = await createQuote(dev, { custom_hours: {} });

            expect(created.custom_hours).toBeNull();
            expect((await rowOf(created.id)).custom_hours_json).toBeNull();
        });

        it('PUT que cambia solo un dato recalcula el resultado con las entradas fusionadas', async () => {
            const created = await createQuote(dev);

            const res = await call(dev, 'put', `/api/scopings/${created.id}`, { requires_ocr: true, process_stability: 'medium_change' });

            expect(res.status).toBe(200);
            expect(res.body.data.requires_ocr).toBe(true);
            expect(res.body.data.volume_per_frequency).toBe(200);
            expect(res.body.data.difficulty_score).toBeGreaterThan(created.difficulty_score);
        });

        it('PUT sobre una cotización inexistente responde 404 en español', async () => {
            const res = await call(lead, 'put', '/api/scopings/9999', { client_name: 'X' });

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Levantamiento no encontrado');
        });
    });

    describe('monedas (I2, M9)', () => {
        it.each([
            ['USD', { labor: 15, target: 40, internal: 20 }],
            ['UF', { labor: 0.36, target: 0.95, internal: 0.48 }],
            ['CLP', { labor: 14000, target: 36000, internal: 18000 }]
        ])('crear en %s sin tarifas explícitas usa las tarifas por defecto de esa moneda', async (currency, rates) => {
            const created = await createQuote(lead, { currency });

            const row = await rowOf(created.id);
            expect(row).toMatchObject({
                currency,
                hourly_labor_cost: rates.labor,
                target_hourly_rate: rates.target,
                internal_cost_rate: rates.internal
            });
            expect(row.proposed_price).toBe(Math.round(row.total_hours * rates.target));
        });

        it('las tarifas explícitas del cliente se respetan y se guardan en la moneda elegida', async () => {
            const created = await createQuote(lead, {
                currency: 'USD', hourly_labor_cost: 22, target_hourly_rate: 55, internal_cost_rate: 31
            });

            expect(await rowOf(created.id)).toMatchObject({
                currency: 'USD', hourly_labor_cost: 22, target_hourly_rate: 55, internal_cost_rate: 31
            });
        });

        it('PUT que cambia la moneda sin enviar tarifas usa las de la nueva moneda (no deja las de CLP)', async () => {
            const created = await createQuote(lead);

            const res = await call(lead, 'put', `/api/scopings/${created.id}`, { currency: 'USD' });

            expect(res.status).toBe(200);
            expect(await rowOf(created.id)).toMatchObject({
                currency: 'USD', hourly_labor_cost: 15, target_hourly_rate: 40, internal_cost_rate: 20
            });
            expect(res.body.data.proposed_price).toBe(Math.round(res.body.data.total_hours * 40));
        });

        it('PUT sin cambiar de moneda conserva las tarifas guardadas', async () => {
            const created = await createQuote(lead, { target_hourly_rate: 50000 });

            const res = await call(lead, 'put', `/api/scopings/${created.id}`, { client_name: 'Otro' });

            expect(res.body.data.target_hourly_rate).toBe(50000);
            expect(res.body.data.proposed_price).toBe(res.body.data.total_hours * 50000);
        });
    });

    describe('costos internos solo para team_lead (I10)', () => {
        const nonLeadRoles = ['rpa_developer', 'rpa_operations', 'it_support', 'billing'];

        const expectNoInternalCosts = (payload: any) => {
            for (const field of INTERNAL_FIELDS) {
                expect(payload).not.toHaveProperty(field);
            }
        };

        it.each(nonLeadRoles)('%s no recibe costo interno ni margen en list, get ni calculate', async (role) => {
            const created = await createQuote(lead);
            const actor = { id: users.dev, role };

            const list = (await call(actor, 'get', '/api/scopings')).body;
            const detail = (await call(actor, 'get', `/api/scopings/${created.id}`)).body.data;
            const calc = (await call(actor, 'post', '/api/scopings/calculate', baseInputs)).body.data;

            expect(list.data).toHaveLength(1);
            list.data.forEach(expectNoInternalCosts);
            expectNoInternalCosts(detail);
            expectNoInternalCosts(detail.calculation);
            expectNoInternalCosts(calc);
            // La tarifa de venta, el precio, el ROI y el payback sí los ven todos los roles.
            expect(detail).toMatchObject({ target_hourly_rate: 36000, proposed_price: created.proposed_price });
            expect(calc).toHaveProperty('roi_first_year_pct');
            expect(calc).toHaveProperty('payback_months');
        });

        it('team_lead sí recibe costo interno y margen en list, get y calculate', async () => {
            const created = await createQuote(lead);

            const list = (await call(lead, 'get', '/api/scopings')).body.data[0];
            const detail = (await call(lead, 'get', `/api/scopings/${created.id}`)).body.data;
            const calc = (await call(lead, 'post', '/api/scopings/calculate', baseInputs)).body.data;

            for (const payload of [list, detail, detail.calculation, calc]) {
                for (const field of ['project_internal_cost', 'projected_margin_pct']) {
                    expect(payload).toHaveProperty(field);
                }
            }
            expect(list.internal_cost_rate).toBe(18000);
            expect(detail.internal_cost_rate).toBe(18000);
        });

        it('create y update de un rol distinto de team_lead tampoco devuelven costos internos', async () => {
            const created = await call(dev, 'post', '/api/scopings', { ...baseCreate, internal_cost_rate: 99999 });
            const updated = await call(dev, 'put', `/api/scopings/${created.body.data.id}`, { client_name: 'Nuevo' });

            expect(created.status).toBe(201);
            expectNoInternalCosts(created.body.data);
            expectNoInternalCosts(created.body.data.calculation);
            expect(updated.status).toBe(200);
            expectNoInternalCosts(updated.body.data);
            expectNoInternalCosts(updated.body.data.calculation);
        });
    });

    describe('internal_cost_rate solo lo escribe team_lead', () => {
        it('un developer no puede fijar internal_cost_rate al crear: se guarda el default de la moneda', async () => {
            const created = await call(dev, 'post', '/api/scopings', { ...baseCreate, internal_cost_rate: 99999 });

            expect(created.status).toBe(201);
            expect((await rowOf(created.body.data.id)).internal_cost_rate).toBe(18000);
        });

        it('team_lead sí guarda internal_cost_rate al crear y al editar, y el costo del proyecto lo usa', async () => {
            const created = await createQuote(lead, { internal_cost_rate: 25000 });
            expect((await rowOf(created.id)).internal_cost_rate).toBe(25000);

            const updated = await call(lead, 'put', `/api/scopings/${created.id}`, { internal_cost_rate: 27000 });

            expect(updated.status).toBe(200);
            const row = await rowOf(created.id);
            expect(row.internal_cost_rate).toBe(27000);
            expect(row.project_internal_cost).toBe(Math.round(row.total_hours * 27000));
        });

        it('un developer que edita su cotización no altera el internal_cost_rate que fijó el team_lead', async () => {
            const own = await createQuote(dev);
            await call(lead, 'put', `/api/scopings/${own.id}`, { internal_cost_rate: 25000 });

            // El frontend reenvía la tarifa interna por defecto junto con el resto de las entradas
            const edit = await call(dev, 'put', `/api/scopings/${own.id}`, { client_name: 'Editada por el autor', internal_cost_rate: 18000 });

            expect(edit.status).toBe(200);
            const row = await rowOf(own.id);
            expect(row.internal_cost_rate).toBe(25000);
            expect(row.project_internal_cost).toBe(Math.round(row.total_hours * 25000));
            expect(row.client_name).toBe('Editada por el autor');
        });

        it('un developer que cambia la moneda no fija la tarifa interna: se usa el default de la nueva moneda', async () => {
            const own = await createQuote(dev);

            const edit = await call(dev, 'put', `/api/scopings/${own.id}`, { currency: 'USD', internal_cost_rate: 99999 });

            expect(edit.status).toBe(200);
            expect((await rowOf(own.id)).internal_cost_rate).toBe(20);
        });

        it('el valor enviado por un developer sigue validándose (negativo => 400)', async () => {
            const res = await call(dev, 'post', '/api/scopings', { ...baseCreate, internal_cost_rate: -1 });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('El costo interno por hora debe ser un número mayor o igual a cero');
        });
    });

    describe('propiedad de la cotización (I10)', () => {
        it('rpa_developer no puede editar ni borrar la cotización de otro usuario (403) pero sí la propia', async () => {
            const others = await createQuote(lead);
            const own = await createQuote(dev);

            const editOthers = await call(dev, 'put', `/api/scopings/${others.id}`, { client_name: 'Intento' });
            const deleteOthers = await call(dev, 'delete', `/api/scopings/${others.id}`);
            const editOwn = await call(dev, 'put', `/api/scopings/${own.id}`, { client_name: 'Propia editada' });
            const deleteOwn = await call(dev, 'delete', `/api/scopings/${own.id}`);

            expect(editOthers.status).toBe(403);
            expect(editOthers.body.error).toBe('Solo el autor del levantamiento o la jefatura pueden modificarlo');
            expect(deleteOthers.status).toBe(403);
            expect((await rowOf(others.id)).client_name).toBe('Acme SpA');
            expect(editOwn.status).toBe(200);
            expect(editOwn.body.data.client_name).toBe('Propia editada');
            expect(deleteOwn.status).toBe(200);
            expect(await rowOf(own.id)).toBeUndefined();
        });

        it('rpa_operations tampoco modifica cotizaciones ajenas', async () => {
            const owned = await createQuote(dev);

            const edit = await call(ops, 'put', `/api/scopings/${owned.id}`, { client_name: 'Intento' });
            const remove = await call(ops, 'delete', `/api/scopings/${owned.id}`);

            expect(edit.status).toBe(403);
            expect(remove.status).toBe(403);
        });

        it('team_lead puede editar y borrar cualquier cotización', async () => {
            const owned = await createQuote(dev);

            const edit = await call(lead, 'put', `/api/scopings/${owned.id}`, { client_name: 'Editada por jefatura' });
            const remove = await call(lead, 'delete', `/api/scopings/${owned.id}`);

            expect(edit.status).toBe(200);
            expect(remove.status).toBe(200);
            expect(await rowOf(owned.id)).toBeUndefined();
        });

        it('DELETE sobre una cotización inexistente responde 404 en español', async () => {
            const res = await call(lead, 'delete', '/api/scopings/9999');

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Levantamiento no encontrado');
        });
    });

    describe('borrado solo de borradores (M9)', () => {
        it.each(['sent_to_client', 'approved', 'rejected', 'converted_to_project'])(
            'no se puede borrar una cotización en estado %s (409 en español)',
            async (status) => {
                const created = await createQuote(lead);
                await testDb.run('UPDATE scoping_quotations SET status = ? WHERE id = ?', [status, created.id]);

                const res = await call(lead, 'delete', `/api/scopings/${created.id}`);

                expect(res.status).toBe(409);
                expect(res.body.error).toBe('Solo se pueden eliminar levantamientos en estado borrador');
                expect(await rowOf(created.id)).toBeDefined();
            }
        );

        it('un borrador sí se elimina', async () => {
            const created = await createQuote(lead);

            const res = await call(lead, 'delete', `/api/scopings/${created.id}`);

            expect(res.status).toBe(200);
            expect(await count('scoping_quotations')).toBe(0);
        });
    });

    describe('filas guardadas con datos inválidos', () => {
        // [descripción, columnas dañadas a mano, cuerpo de PUT que la repara]
        const corruptions: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
            ['horas manuales negativas', { hours_pm: -10 }, { custom_hours: null }],
            ['semanas en cero', { estimated_weeks: 0 }, { custom_hours: null }],
            ['moneda fuera de catálogo', { currency: 'EUR' }, { currency: 'CLP' }],
            ['frecuencia desconocida', { frequency: 'hourly' }, { frequency: 'daily' }]
        ];

        const corruptQuote = async (changes: Record<string, unknown>) => {
            const created = await createQuote(dev);
            const sets = Object.keys(changes).map((column) => `${column} = ?`).join(', ');
            await testDb.run(`UPDATE scoping_quotations SET ${sets} WHERE id = ?`, [...Object.values(changes), created.id]);
            return created;
        };

        it.each(corruptions)('GET responde 200 con la fila aunque tenga %s (sin el cálculo reconstruido)', async (_label, changes) => {
            const created = await corruptQuote(changes);

            const detail = await call(dev, 'get', `/api/scopings/${created.id}`);
            const list = await call(dev, 'get', '/api/scopings');

            expect(detail.status).toBe(200);
            expect(detail.body.data).toMatchObject({ id: created.id, client_name: 'Acme SpA' });
            expect(detail.body.data.calculation).toBeUndefined();
            expect(list.status).toBe(200);
            expect(list.body.data.map((row: any) => row.id)).toContain(created.id);
        });

        it.each(corruptions)('el autor puede borrar una fila con %s', async (_label, changes) => {
            const created = await corruptQuote(changes);

            const res = await call(dev, 'delete', `/api/scopings/${created.id}`);

            expect(res.status).toBe(200);
            expect(await rowOf(created.id)).toBeUndefined();
        });

        it.each(corruptions)('una fila con %s se repara editándola', async (_label, changes, repair) => {
            const created = await corruptQuote(changes);

            const res = await call(dev, 'put', `/api/scopings/${created.id}`, repair);

            expect(res.status).toBe(200);
            expect(res.body.data.calculation).toBeDefined();
            expect(res.body.data.total_hours).toBe(236);
        });

        it('convertir una fila con datos inválidos responde 409 en español y no crea nada', async () => {
            const created = await corruptQuote({ hours_pm: -10 });

            const res = await call(lead, 'post', `/api/scopings/${created.id}/convert-to-project`);

            expect(res.status).toBe(409);
            expect(res.body.error).toBe('Los datos guardados del levantamiento no son válidos: corrígelos antes de convertirlo en proyecto');
            expect(await count('projects')).toBe(0);
        });
    });

    describe('código correlativo (M4)', () => {
        it('el código de una cotización nueva no reutiliza el de una borrada', async () => {
            const first = await createQuote(lead);
            const second = await createQuote(lead);
            const third = await createQuote(lead);
            await call(lead, 'delete', `/api/scopings/${third.id}`);

            const fourth = await createQuote(lead);

            const seq = (code: string) => Number(code.split('-')[2]);
            expect(fourth.code).not.toBe(third.code);
            expect([first.code, second.code]).not.toContain(fourth.code);
            expect(seq(fourth.code)).toBeGreaterThan(seq(third.code));
            expect(fourth.code).toMatch(/^COT-\d{4}-\d{3,}$/);
        });

        it('dos creaciones consecutivas reciben códigos distintos derivados de su id', async () => {
            const first = await createQuote(lead);
            const second = await createQuote(lead);

            expect(second.code).not.toBe(first.code);
            for (const quote of [first, second]) {
                expect(quote.code).toBe(`COT-${new Date().getFullYear()}-${String(quote.id).padStart(3, '0')}`);
            }
        });

        it('dos creaciones simultáneas reciben códigos distintos (sin carrera entre leer el correlativo e insertar)', async () => {
            const [a, b, c] = await Promise.all([
                call(lead, 'post', '/api/scopings', baseCreate),
                call(lead, 'post', '/api/scopings', baseCreate),
                call(dev, 'post', '/api/scopings', baseCreate)
            ]);

            expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
            const codes = [a, b, c].map((res) => res.body.data.code);
            expect(new Set(codes).size).toBe(3);
            const stored = await testDb.query(`SELECT code FROM scoping_quotations WHERE code LIKE 'TMP-%'`);
            expect(stored).toEqual([]);
        });
    });

    describe('conversión a proyecto (C3)', () => {
        const convert = (actor: Actor, id: number) => call(actor, 'post', `/api/scopings/${id}/convert-to-project`);

        it.each([
            ['rpa_developer', () => dev],
            ['it_support', () => ({ id: users.dev, role: 'it_support' })],
            ['billing', () => ({ id: users.dev, role: 'billing' })]
        ])('convert-to-project responde 403 a %s', async (_role, actor) => {
            const created = await createQuote(lead);

            const res = await convert(actor(), created.id);

            expect(res.status).toBe(403);
            expect(res.body).toEqual({
                success: false,
                error: 'Solo el jefe de equipo u operaciones pueden convertir un levantamiento en proyecto'
            });
            expect(await count('projects')).toBe(0);
            expect((await rowOf(created.id)).status).toBe('draft');
        });

        it('convierte: crea proyecto, cliente por nombre, tablero con colores válidos, tareas con reporter y fases; marca la cotización', async () => {
            const client = await testDb.run(`INSERT INTO clients (name, created_by) VALUES ('Acme SpA', ?)`, [users.lead]);
            const created = await createQuote(dev, { client_name: '  acme spa ', process_name: 'Facturas' });

            const res = await convert(ops, created.id);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            const projectId = res.body.data.project_id;
            expect(projectId).toEqual(expect.any(Number));
            expect(res.body.data.message).toEqual(expect.stringContaining('5 tareas'));
            expect(res.body.message).toBe(res.body.data.message);

            const project = await testDb.get('SELECT * FROM projects WHERE id = ?', [projectId]);
            expect(project).toMatchObject({
                name: 'RPA - Facturas (acme spa)',
                created_by: users.ops,
                client_id: client.id,
                project_type: 'commercial',
                commercial_stage: 'quoting',
                status: 'on_hold',
                currency: 'CLP'
            });
            expect(project.description).toContain(created.code);
            expect(project.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(project.end_date > project.start_date).toBe(true);

            const financials = await testDb.get('SELECT * FROM project_financials WHERE project_id = ?', [projectId]);
            expect(financials).toMatchObject({
                sale_price: created.proposed_price,
                sale_price_currency: 'CLP',
                budgeted_hours: created.total_hours
            });
            expect(financials.budgeted_cost).toBe((await rowOf(created.id)).project_internal_cost);

            const board = await testDb.get('SELECT * FROM task_boards WHERE project_id = ?', [projectId]);
            expect(board).toMatchObject({ is_default: 1, board_type: 'kanban' });

            const columns = await testDb.query('SELECT * FROM task_columns WHERE board_id = ? ORDER BY position', [board.id]);
            expect(columns).toHaveLength(5);
            columns.forEach((c) => expect(c.color).toMatch(/^#[0-9a-fA-F]{6}$/));
            expect(columns.filter((c) => c.is_done_column === 1).map((c) => c.name)).toEqual(['Producción / Listo']);

            const tasks = await testDb.query('SELECT * FROM tasks WHERE board_id = ? ORDER BY position', [board.id]);
            const phases = created.calculation.phases_breakdown;
            expect(tasks).toHaveLength(phases.length);
            tasks.forEach((t, i) => {
                expect(t).toMatchObject({
                    reporter_id: users.ops,
                    column_id: columns[0].id,
                    status: 'todo',
                    estimated_hours: phases[i].hours
                });
                expect(t.title).toBe(`Fase ${phases[i].phase_number}: ${phases[i].name}`);
            });

            const projectPhases = await testDb.query('SELECT * FROM project_phases WHERE project_id = ? ORDER BY phase_order', [projectId]);
            expect(projectPhases).toHaveLength(phases.length);
            projectPhases.forEach((p, i) => {
                expect(p).toMatchObject({
                    name: phases[i].name,
                    phase_order: phases[i].phase_number,
                    estimated_hours: phases[i].hours,
                    status: 'pending',
                    responsibility: 'internal'
                });
                expect(p.planned_start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
                expect(p.planned_end_date >= p.planned_start_date).toBe(true);
            });

            expect(await rowOf(created.id)).toMatchObject({ status: 'converted_to_project', converted_project_id: projectId });
        });

        it('sin cliente coincidente deja client_id vacío y team_lead también puede convertir', async () => {
            const created = await createQuote(lead, { client_name: 'Cliente que no existe en el registro' });

            const res = await convert(lead, created.id);

            expect(res.status).toBe(200);
            const project = await testDb.get('SELECT client_id, created_by FROM projects WHERE id = ?', [res.body.data.project_id]);
            expect(project).toEqual({ client_id: null, created_by: users.lead });
        });

        it('si falla la inserción de una tarea no queda proyecto, tablero ni columnas (rollback) y la cotización sigue en draft', async () => {
            const created = await createQuote(lead);
            const original = testDb.run.bind(testDb);
            const spy = jest.spyOn(testDb, 'run').mockImplementation(async (sql: string, params?: any[]) => {
                if (/INSERT INTO tasks/i.test(sql)) throw new Error('SQLITE_ERROR: fallo simulado en tasks');
                return original(sql, params);
            });

            try {
                const res = await convert(lead, created.id);

                expect(res.status).toBe(500);
                expect(res.body).toEqual({ success: false, error: 'No se pudo convertir el levantamiento en proyecto. No se creó ningún dato; intenta nuevamente.' });
                expect(JSON.stringify(res.body)).not.toMatch(/SQLITE/i);
                expect(spy.mock.calls.some(([sql]) => /INSERT INTO tasks/i.test(sql))).toBe(true);
            } finally {
                spy.mockRestore();
            }

            for (const table of ['projects', 'task_boards', 'task_columns', 'tasks', 'project_phases', 'project_financials']) {
                expect({ table, rows: await count(table) }).toEqual({ table, rows: 0 });
            }
            expect(await rowOf(created.id)).toMatchObject({ status: 'draft', converted_project_id: null });

            // La conexión quedó usable y reintentar funciona sin dejar huérfanos del intento fallido.
            const retry = await convert(lead, created.id);
            expect(retry.status).toBe(200);
            expect(await count('projects')).toBe(1);
            expect(await count('task_boards')).toBe(1);
            expect(await count('task_columns')).toBe(5);
        });

        it('si otra conversión gana entre la verificación previa y el cierre, no queda proyecto huérfano y responde 409', async () => {
            const created = await createQuote(lead);
            const snapshot = (await call(lead, 'get', `/api/scopings/${created.id}`)).body.data;
            // Otra conversión termina justo después de la verificación previa de esta (que aún ve un borrador)
            await testDb.run(`UPDATE scoping_quotations SET status = 'converted_to_project' WHERE id = ?`, [created.id]);
            const spy = jest.spyOn(ScopingService.prototype, 'getById').mockResolvedValueOnce(snapshot);

            try {
                const res = await convert(lead, created.id);

                expect(res.status).toBe(409);
                expect(res.body).toEqual({ success: false, error: 'Este levantamiento ya fue convertido a proyecto' });
                expect(spy).toHaveBeenCalledTimes(1);
            } finally {
                spy.mockRestore();
            }

            for (const table of ['projects', 'task_boards', 'task_columns', 'tasks', 'project_phases', 'project_financials']) {
                expect({ table, rows: await count(table) }).toEqual({ table, rows: 0 });
            }
            // La marca de la otra conversión no se pisó
            expect(await rowOf(created.id)).toMatchObject({ status: 'converted_to_project', converted_project_id: null });
        });

        it('convertir dos veces responde 409 sin crear un segundo proyecto', async () => {
            const created = await createQuote(lead);
            const first = await convert(lead, created.id);

            const second = await convert(lead, created.id);

            expect(first.status).toBe(200);
            expect(second.status).toBe(409);
            expect(second.body.error).toBe(`Este levantamiento ya fue convertido al proyecto ID ${first.body.data.project_id}`);
            expect(await count('projects')).toBe(1);
            expect(await count('task_boards')).toBe(1);
        });

        it.each([
            ['non_digital_unstructured', 'No se puede automatizar con RPA'],
            ['non_digital_structured', 'Digitalizar Primero']
        ])('un levantamiento no viable (%s) responde 409 y no crea nada', async (dataInputType, label) => {
            const created = await createQuote(lead, { data_input_type: dataInputType });

            const res = await convert(lead, created.id);

            expect(res.status).toBe(409);
            expect(res.body.error).toBe(`No se puede convertir a proyecto un levantamiento no viable (${label})`);
            expect(await count('projects')).toBe(0);
            expect((await rowOf(created.id)).status).toBe('draft');
        });

        it('convertir una cotización inexistente responde 404 en español', async () => {
            const res = await convert(lead, 9999);

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Levantamiento no encontrado');
        });

        it('una cotización ya convertida no se puede editar (409): el proyecto ya nació con esas cifras', async () => {
            const created = await createQuote(lead);
            await convert(lead, created.id);

            const res = await call(lead, 'put', `/api/scopings/${created.id}`, { client_name: 'Otro' });

            expect(res.status).toBe(409);
            expect(res.body.error).toBe('No se puede modificar un levantamiento que ya fue convertido a proyecto');
        });

        it('el estado "convertida" solo lo asigna la conversión, no un PUT ni un POST', async () => {
            const created = await createQuote(lead);

            const put = await call(lead, 'put', `/api/scopings/${created.id}`, { status: 'converted_to_project' });
            const post = await call(lead, 'post', '/api/scopings', { ...baseCreate, status: 'converted_to_project' });

            expect(put.status).toBe(409);
            expect(post.status).toBe(409);
            expect(put.body.error).toBe('El estado "convertida a proyecto" solo se asigna al convertir el levantamiento en proyecto');
            expect((await rowOf(created.id)).status).toBe('draft');
        });
    });
});
