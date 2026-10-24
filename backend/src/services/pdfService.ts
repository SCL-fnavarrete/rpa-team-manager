import PDFDocument from 'pdfkit';
import type { ClosureReport } from './closureReportService';

export interface PaymentStatementMilestone {
    name: string;
    amount: number;
    currency: string;
    status: string;
    planned_date: string | null;
}

export interface PaymentStatementHours {
    user_name: string;
    total_hours: number;
}

export interface PaymentStatementData {
    project_name: string;
    client_name: string;
    generated_at: string;
    financials?: { sale_price: number | null };
    milestones: PaymentStatementMilestone[];
    hours_summary: PaymentStatementHours[];
}

const STATUS_LABEL: Record<string, string> = {
    pending: 'Pendiente',
    billable: 'Por facturar',
    invoiced: 'Facturado',
    paid: 'Pagado',
    overdue: 'Vencido'
};

function formatCLP(amount: number): string {
    return `$${Math.round(amount).toLocaleString('es-CL')}`;
}

/** Genera el estado de pago con importes originales y moneda explícita. */
export function generatePaymentStatement(data: PaymentStatementData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(18).text('Estado de Pago', { align: 'center' });
        doc.moveDown();
        doc.fontSize(11);
        doc.text(`Proyecto: ${data.project_name}`);
        doc.text(`Cliente: ${data.client_name}`);
        doc.text(`Generado: ${data.generated_at}`);
        doc.moveDown();

        if (data.financials?.sale_price != null) {
            doc.fontSize(13).text('Resumen financiero', { underline: true });
            doc.fontSize(11).text(`Precio de venta: ${formatCLP(data.financials.sale_price)}`);
            doc.moveDown();
        }

        doc.fontSize(13).text(`Hitos de pago al ${data.generated_at}`, { underline: true });
        doc.fontSize(10);
        if (data.milestones.length === 0) {
            doc.text('Sin hitos de pago registrados.');
        } else {
            for (const m of data.milestones) {
                const statusLabel = STATUS_LABEL[m.status] || m.status;
                const dateLabel = m.planned_date || 's/f';
                doc.text(`${m.name} — ${m.amount.toLocaleString('es-CL')} ${m.currency} — ${statusLabel} — ${dateLabel}`);
            }
        }
        doc.end();
    });
}

const PROJECT_STATUS_LABEL: Record<string, string> = {
    planning: 'Planificación',
    active: 'Activo',
    on_hold: 'En pausa',
    completed: 'Completado',
    cancelled: 'Cancelado'
};

const NO_DATA = '—';
const ROW_HEIGHT = 16;

const formatNumber = (value: number): string => value.toLocaleString('es-CL', { maximumFractionDigits: 2 });
const formatSigned = (value: number, format: (n: number) => string): string => `${value > 0 ? '+' : value < 0 ? '-' : ''}${format(Math.abs(value))}`;
const formatPercent = (value: number): string => `${formatNumber(value)} %`;

const chileDateFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Fecha AAAA-MM-DD en hora de Chile de un instante ISO o de un timestamp UTC de SQLite ("AAAA-MM-DD HH:MM:SS"). */
function formatChileDate(timestamp: string): string {
    const instant = new Date(timestamp.includes('T') ? timestamp : `${timestamp.replace(' ', 'T')}Z`);
    if (Number.isNaN(instant.getTime())) return timestamp.slice(0, 10);
    const parts = Object.fromEntries(chileDateFormat.formatToParts(instant).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}

type TableColumn = { width: number; align?: 'left' | 'right' };

/** Deja espacio para la siguiente fila o bloque: si no cabe en la página, pasa a una nueva. */
function ensureSpace(doc: PDFKit.PDFDocument, height: number): void {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function drawRow(doc: PDFKit.PDFDocument, columns: TableColumn[], cells: string[], bold = false): void {
    ensureSpace(doc, ROW_HEIGHT);
    const left = doc.page.margins.left;
    const top = doc.y;
    let x = left;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
    columns.forEach((column, index) => {
        // pdfkit solo aplica la elipsis cuando hay height: sin él el texto largo se parte en renglones y pisa la fila siguiente
        doc.text(cells[index], x, top, { width: column.width - 6, height: ROW_HEIGHT - 4, align: column.align ?? 'left', ellipsis: true });
        x += column.width;
    });
    doc.x = left;
    doc.y = top + ROW_HEIGHT;
}

function drawSection(doc: PDFKit.PDFDocument, title: string): void {
    ensureSpace(doc, ROW_HEIGHT * 3);
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(13).text(title, doc.page.margins.left, doc.y, { underline: true });
    doc.moveDown(0.3);
}

/** Genera el informe de cierre del proyecto: resumen, cotizado vs real, equipo, hitos de pago y pendientes. */
export function generateClosureReport(report: ClosureReport): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const { project, quoted, actual } = report;
        const left = doc.page.margins.left;
        const hasQuote = quoted.version !== null;

        doc.fontSize(18).text('Informe de Cierre', { align: 'center' });
        doc.moveDown();
        doc.fontSize(11);
        doc.text(`Proyecto: ${project.name}`);
        doc.text(`Cliente: ${project.client_name ?? 'N/A'}`);
        doc.text(`Comercial: ${project.sales_rep_name ?? 'N/A'}`);
        doc.text(`Generado: ${formatChileDate(report.generated_at)}`);

        drawSection(doc, 'Resumen');
        doc.fontSize(11);
        doc.text(`Estado: ${PROJECT_STATUS_LABEL[project.status] || project.status}`);
        doc.text(project.start_date || project.end_date
            ? `Inicio: ${project.start_date ?? NO_DATA} — Término: ${project.end_date ?? NO_DATA}`
            : 'Fechas: sin registrar');
        doc.text(`Entrega aceptada: ${project.delivery_accepted_at ? formatChileDate(project.delivery_accepted_at) : 'Pendiente'}`);
        doc.text(`Cierre financiero: ${project.financial_closed_at ? formatChileDate(project.financial_closed_at) : 'Pendiente'}`);
        doc.text(`Listo para cerrar finanzas: ${report.can_close_financials ? 'Sí' : 'No'}`);

        drawSection(doc, 'Cotizado vs Real');
        const comparison: TableColumn[] = [{ width: 150 }, { width: 115, align: 'right' }, { width: 115, align: 'right' }, { width: 115, align: 'right' }];
        drawRow(doc, comparison, ['Concepto', 'Cotizado', 'Real', 'Diferencia'], true);
        const comparisonRow = (
            label: string, quotedValue: number | null, realValue: number, format: (n: number) => string, formatDiff = format
        ): void => {
            const quotedKnown = hasQuote && quotedValue !== null;
            drawRow(doc, comparison, [
                label,
                quotedKnown ? format(quotedValue) : NO_DATA,
                format(realValue),
                quotedKnown ? formatSigned(realValue - quotedValue, formatDiff) : NO_DATA
            ]);
        };
        comparisonRow('Venta', quoted.amount_clp, actual.sale_price, formatCLP);
        comparisonRow('Costo', quoted.estimated_cost_clp, actual.real_cost, formatCLP);
        comparisonRow('Horas', quoted.hours, actual.approved_hours, formatNumber);
        comparisonRow('Margen', quoted.margin_percent, actual.real_margin_percentage, formatPercent, n => `${formatNumber(n)} pp`);
        doc.moveDown(0.5);
        doc.font('Helvetica').fontSize(10);
        if (actual.real_hours_source === 'projected') doc.text('Real estimado: no hay horas aprobadas aún', left, doc.y);
        doc.text(hasQuote ? `Cotización aprobada: versión ${quoted.version}` : 'Sin cotización aprobada registrada.', left, doc.y);
        doc.text(`Utilidad real: ${formatCLP(actual.real_profit)}`);
        doc.text(`Horas planificadas: ${formatNumber(actual.planned_hours)}`);
        doc.text(`Impacto económico del desvío: ${formatSigned(actual.variance_impact, formatCLP)}`);

        drawSection(doc, 'Equipo');
        if (report.team.length === 0) {
            doc.font('Helvetica').fontSize(10).text('Sin personas asignadas ni horas aprobadas.', left, doc.y);
        } else {
            const team: TableColumn[] = [{ width: 255 }, { width: 120, align: 'right' }, { width: 120, align: 'right' }];
            drawRow(doc, team, ['Persona', 'Horas presupuestadas', 'Horas reales'], true);
            for (const member of report.team) {
                drawRow(doc, team, [member.user_name, formatNumber(member.budgeted_hours), formatNumber(member.actual_hours)]);
            }
        }

        drawSection(doc, 'Hitos de pago');
        if (report.milestones.length === 0) {
            doc.font('Helvetica').fontSize(10).text('Sin hitos de pago registrados.', left, doc.y);
        } else {
            const milestones: TableColumn[] = [{ width: 205 }, { width: 120, align: 'right' }, { width: 90 }, { width: 80 }];
            drawRow(doc, milestones, ['Hito', 'Monto', 'Estado', 'Fecha'], true);
            for (const m of report.milestones) {
                drawRow(doc, milestones, [
                    m.name, `${m.amount.toLocaleString('es-CL')} ${m.currency}`, STATUS_LABEL[m.status] || m.status, m.planned_date ?? 's/f'
                ]);
            }
        }

        drawSection(doc, 'Pendientes');
        const checklist: TableColumn[] = [{ width: 70 }, { width: 245 }, { width: 80, align: 'right' }, { width: 100 }];
        drawRow(doc, checklist, ['Estado', 'Control', 'Pendientes', 'Tipo'], true);
        for (const item of report.checklist) {
            drawRow(doc, checklist, [
                item.ok ? 'Completo' : 'Pendiente', item.label, String(item.pending_count), item.blocking ? 'Bloqueante' : 'Advertencia'
            ]);
        }

        doc.end();
    });
}
