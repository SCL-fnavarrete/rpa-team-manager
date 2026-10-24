import { generateClosureReport, generatePaymentStatement, PaymentStatementData } from '../../services/pdfService';
import type { ClosureReport } from '../../services/closureReportService';
import { extractPdfLines } from '../helpers/pdfText';

describe('pdfService.generatePaymentStatement', () => {
    it('genera un buffer con cabecera PDF válida', async () => {
        const data: PaymentStatementData = {
            project_name: 'AGROSUPER - Toma de Control',
            client_name: 'Agrosuper S.A.',
            generated_at: '2026-09-16',
            financials: {
                sale_price: 4470102
            },
            milestones: [
                { name: 'Hito 1', amount: 1000000, currency: 'CLP', status: 'paid', planned_date: '2026-06-01' },
                { name: 'Hito 2', amount: 1000000, currency: 'CLP', status: 'billable', planned_date: '2026-09-01' }
            ],
            hours_summary: [
                { user_name: 'Dev Uno', total_hours: 120 }
            ]
        };

        const buffer = await generatePaymentStatement(data);

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(100);
        expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('no lanza si no hay horas registradas', async () => {
        const data: PaymentStatementData = {
            project_name: 'PROMET',
            client_name: 'Promet',
            generated_at: '2026-09-16',
            financials: { sale_price: 1000000 },
            milestones: [],
            hours_summary: []
        };

        await expect(generatePaymentStatement(data)).resolves.toBeInstanceOf(Buffer);
    });
});

describe('pdfService.generateClosureReport', () => {
    const buildReport = (overrides: Partial<ClosureReport> = {}, actual: Partial<ClosureReport['actual']> = {}): ClosureReport => ({
        project: {
            id: 7, name: 'Migración útil', client_name: 'Cliente Ñandú Ltda.', sales_rep_name: 'Comercial Uno', status: 'completed',
            start_date: '2026-03-01', end_date: '2026-09-30', delivery_accepted_at: '2026-10-20 10:00:00', financial_closed_at: null
        },
        checklist: [
            { key: 'delivery_accepted', label: 'Entrega aceptada por el cliente', ok: true, pending_count: 0, blocking: true },
            { key: 'payment_milestones', label: 'Hitos de pago pagados', ok: false, pending_count: 2, blocking: true }
        ],
        can_close_financials: true,
        quoted: { amount_clp: 12000000, hours: 100, estimated_cost_clp: 7000000, margin_percent: 41.67, version: 2 },
        actual: {
            sale_price: 12000000, real_cost: 8500000, real_profit: 3500000, real_margin_percentage: 29.17,
            approved_hours: 112.5, real_hours_source: 'approved', planned_hours: 100, variance_impact: -1500000, ...actual
        },
        team: [{ user_name: 'Dev Uno', budgeted_hours: 40, actual_hours: 52.5 }],
        milestones: [{ name: 'Anticipo 30%', amount: 3600000, currency: 'CLP', status: 'paid', planned_date: '2026-03-15' }],
        generated_at: '2026-10-24T15:00:00.000Z',
        ...overrides
    });

    // Una línea por fila visual: si una celda se parte en dos renglones, aparece como una línea aparte
    const extractLines = async (...reports: ClosureReport[]): Promise<string[][]> =>
        extractPdfLines(await Promise.all(reports.map(generateClosureReport)));

    it('incluye los títulos de sección y conserva tildes y eñes', async () => {
        const [lines] = await extractLines(buildReport());

        for (const title of ['Informe de Cierre', 'Resumen', 'Cotizado vs Real', 'Equipo', 'Hitos de pago', 'Pendientes']) {
            expect(lines).toContain(title);
        }
        expect(lines).toContain('Inicio: 2026-03-01 — Término: 2026-09-30');
        expect(lines).toContain('Listo para cerrar finanzas: Sí');
        expect(lines).toContain('Cliente: Cliente Ñandú Ltda.');
        expect(lines).toContain('Estado: Completado');
    });

    it('trunca en una sola línea los nombres largos de hitos y personas sin pisar la fila siguiente', async () => {
        const [lines] = await extractLines(buildReport({
            team: [
                { user_name: 'María de los Ángeles Fernández-Gutiérrez de la Vega y Montenegro', budgeted_hours: 1, actual_hours: 2 },
                { user_name: 'Dev Dos', budgeted_hours: 60, actual_hours: 60 }
            ],
            milestones: [
                { name: 'Hito de entrega final con integración de todos los módulos y capacitación', amount: 1, currency: 'CLP', status: 'paid', planned_date: '2026-03-15' },
                { name: 'Hito corto', amount: 2, currency: 'CLP', status: 'paid', planned_date: null }
            ]
        }));

        const person = lines.find(line => line.startsWith('María de los'));
        expect(person).toBeDefined();
        expect(person).not.toContain('Montenegro');
        expect(person).toMatch(/ 1 2$/);
        expect(lines).toContain('Dev Dos 60 60');
        const milestone = lines.find(line => line.startsWith('Hito de entrega'));
        expect(milestone).toBeDefined();
        expect(milestone).not.toContain('capacitación');
        expect(milestone).toMatch(/ 1 CLP Pagado 2026-03-15$/);
        expect(lines).toContain('Hito corto 2 CLP Pagado s/f');
    });

    it('traduce todos los estados del proyecto, incluido planning', async () => {
        const labels: Record<string, string> = {
            planning: 'Planificación', active: 'Activo', on_hold: 'En pausa', completed: 'Completado', cancelled: 'Cancelado'
        };
        const statuses = Object.keys(labels);

        const reports = await extractLines(...statuses.map(status => buildReport({ project: { ...buildReport().project, status } })));

        statuses.forEach((status, index) => expect(reports[index]).toContain(`Estado: ${labels[status]}`));
    });

    it('imprime la fecha de generación en hora de Chile y no la UTC', async () => {
        // 02:30 UTC del 25 de octubre son las 23:30 del 24 en Santiago (UTC-3)
        const [lines] = await extractLines(buildReport({ generated_at: '2026-10-25T02:30:00.000Z' }));

        expect(lines).toContain('Generado: 2026-10-24');
    });

    it('convierte a hora de Chile las fechas de entrega y cierre guardadas en UTC', async () => {
        const [lines] = await extractLines(buildReport({
            project: { ...buildReport().project, delivery_accepted_at: '2026-10-25 02:30:00', financial_closed_at: '2026-10-26 12:00:00' }
        }));

        expect(lines).toContain('Entrega aceptada: 2026-10-24');
        expect(lines).toContain('Cierre financiero: 2026-10-26');
    });

    it('sin fechas de inicio y término imprime una sola línea "Fechas: sin registrar"', async () => {
        const base = buildReport().project;

        const [sinFechas, soloInicio] = await extractLines(
            buildReport({ project: { ...base, start_date: null, end_date: null } }),
            buildReport({ project: { ...base, end_date: null } })
        );

        expect(sinFechas).toContain('Fechas: sin registrar');
        expect(sinFechas.some(line => line.startsWith('Inicio:'))).toBe(false);
        expect(soloInicio).toContain('Inicio: 2026-03-01 — Término: —');
    });

    it('avisa que el real es estimado cuando no hay horas aprobadas y no lo avisa cuando sí', async () => {
        const note = 'Real estimado: no hay horas aprobadas aún';

        const [projected, approved] = await extractLines(
            buildReport({}, { approved_hours: 0, real_hours_source: 'projected' }),
            buildReport()
        );

        expect(projected).toContain(note);
        expect(approved).not.toContain(note);
    });
});
