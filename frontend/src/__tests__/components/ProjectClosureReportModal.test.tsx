import type { ComponentProps } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/services/api', () => ({
  apiService: {
    getClosureReport: vi.fn(),
    downloadClosureReportPdf: vi.fn()
  }
}));

import { apiService } from '@/services/api';
import { ProjectClosureReportModal } from '@/components/projects/ProjectClosureReportModal';
import type { ClosureReport } from '@/types/closureReport';

type ReportOverrides = Partial<Omit<ClosureReport, 'project' | 'quoted' | 'actual'>> & {
  project?: Partial<ClosureReport['project']>;
  quoted?: Partial<ClosureReport['quoted']>;
  actual?: Partial<ClosureReport['actual']>;
};

const makeReport = ({ project, quoted, actual, ...rest }: ReportOverrides = {}): ClosureReport => ({
  project: {
    id: 7,
    name: 'Proyecto Alfa',
    client_name: 'Cliente Alfa',
    sales_rep_name: 'Comercial Uno',
    status: 'completed',
    start_date: '2026-03-01',
    end_date: '2026-09-30',
    delivery_accepted_at: '2026-10-01 15:30:00',
    financial_closed_at: null,
    ...project
  },
  checklist: [
    { key: 'delivery_accepted', label: 'Entrega aceptada por el cliente', ok: true, pending_count: 0, blocking: true },
    { key: 'payment_milestones', label: 'Hitos de pago pagados', ok: false, pending_count: 2, blocking: true },
    { key: 'invoices_paid', label: 'Facturas sin saldo pendiente', ok: true, pending_count: 0, blocking: true },
    { key: 'timesheets_approved', label: 'Horas registradas aprobadas', ok: false, pending_count: 3, blocking: false },
    { key: 'tasks_done', label: 'Tareas terminadas', ok: true, pending_count: 0, blocking: false },
    { key: 'required_documents', label: 'Documentos obligatorios registrados (OC / HES)', ok: false, pending_count: 1, blocking: true }
  ],
  can_close_financials: false,
  quoted: { amount_clp: 1000000, hours: 100, estimated_cost_clp: 600000, margin_percent: 40, version: 2, ...quoted },
  actual: {
    sale_price: 1200000,
    real_cost: 500000,
    real_profit: 700000,
    real_margin_percentage: 58.3,
    approved_hours: 120,
    real_hours_source: 'approved',
    planned_hours: 110,
    variance_impact: -150000,
    ...actual
  },
  team: [{ user_name: 'Ana Pérez', budgeted_hours: 80, actual_hours: 72.5 }],
  milestones: [],
  generated_at: '2026-10-24T12:00:00.000Z',
  ...rest
});

const mockReport = (report: ClosureReport) => (apiService.getClosureReport as any).mockResolvedValue(report);

const renderModal = (props: Partial<ComponentProps<typeof ProjectClosureReportModal>> = {}) =>
  render(<ProjectClosureReportModal projectId={7} open onClose={vi.fn()} {...props} />);

const cellsOf = (container: HTMLElement, label: string): (string | null)[] => {
  const row = within(container).getByText(label).closest('tr') as HTMLElement;
  return within(row).getAllByRole('cell').map((cell) => cell.textContent);
};

describe('ProjectClosureReportModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockReport(makeReport());
    (apiService.downloadClosureReportPdf as any).mockResolvedValue(new Blob(['%PDF']));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('muestra el checklist con ícono de ok/pendiente y la cantidad de pendientes por ítem', async () => {
    renderModal();

    const delivery = await screen.findByTestId('checklist-delivery_accepted');
    expect(within(delivery).getByRole('img', { name: 'check-circle' })).toBeInTheDocument();
    expect(within(delivery).getByText('Sin pendientes')).toBeInTheDocument();

    const milestones = screen.getByTestId('checklist-payment_milestones');
    expect(within(milestones).queryByRole('img', { name: 'check-circle' })).not.toBeInTheDocument();
    expect(within(milestones).getByText('2 pendientes')).toBeInTheDocument();

    expect(within(screen.getByTestId('checklist-timesheets_approved')).getByText('3 pendientes')).toBeInTheDocument();
    expect(within(screen.getByTestId('checklist-required_documents')).getByText('1 pendiente')).toBeInTheDocument();
  });

  it('distingue visualmente los ítems bloqueantes de las advertencias', async () => {
    renderModal();

    const blocking = await screen.findByTestId('checklist-payment_milestones');
    const warning = screen.getByTestId('checklist-timesheets_approved');

    expect(within(blocking).getByText('Bloquea el cierre')).toBeInTheDocument();
    expect(within(blocking).queryByText('Solo advertencia')).not.toBeInTheDocument();
    expect(within(warning).getByText('Solo advertencia')).toBeInTheDocument();
    expect(within(warning).queryByText('Bloquea el cierre')).not.toBeInTheDocument();

    const blockingIcon = within(blocking).getByRole('img', { name: 'close-circle' });
    const warningIcon = within(warning).getByRole('img', { name: 'warning' });
    expect(blockingIcon.style.color).toBeTruthy();
    expect(warningIcon.style.color).toBeTruthy();
    expect(blockingIcon.style.color).not.toBe(warningIcon.style.color);

    // un bloqueante ya resuelto no lleva etiqueta: no hay nada que advertir
    expect(within(screen.getByTestId('checklist-delivery_accepted')).queryByText('Bloquea el cierre')).not.toBeInTheDocument();
  });

  it('muestra cotizado vs real con la diferencia, sin NaN cuando todo es 0', async () => {
    const { unmount } = renderModal();
    const comparison = await screen.findByTestId('quoted-vs-real');

    expect(cellsOf(comparison, 'Venta')).toEqual(['Venta', '$1.000.000 CLP', '$1.200.000 CLP', '+$200.000 CLP']);
    expect(cellsOf(comparison, 'Costo')).toEqual(['Costo', '$600.000 CLP', '$500.000 CLP', '-$100.000 CLP']);
    expect(cellsOf(comparison, 'Horas')).toEqual(['Horas', '100', '120', '+20']);
    expect(cellsOf(comparison, 'Margen')).toEqual(['Margen', '40,0%', '58,3%', '+18,3 pp']);
    expect(screen.getByText('Cotización aprobada: versión 2')).toBeInTheDocument();
    unmount();

    mockReport(makeReport({
      quoted: { amount_clp: 0, hours: 0, estimated_cost_clp: 0, margin_percent: 0, version: 1 },
      actual: { sale_price: 0, real_cost: 0, real_profit: 0, real_margin_percentage: 0, approved_hours: 0, planned_hours: 0, variance_impact: 0 }
    }));
    renderModal();
    const zeroComparison = await screen.findByTestId('quoted-vs-real');

    expect(cellsOf(zeroComparison, 'Venta')).toEqual(['Venta', '$0 CLP', '$0 CLP', '$0 CLP']);
    expect(cellsOf(zeroComparison, 'Horas')).toEqual(['Horas', '0', '0', '0']);
    expect(cellsOf(zeroComparison, 'Margen')).toEqual(['Margen', '0,0%', '0,0%', '0,0 pp']);
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('sin cotización aprobada muestra el aviso y guiones en vez de cifras inventadas', async () => {
    mockReport(makeReport({
      quoted: { amount_clp: 0, hours: 0, estimated_cost_clp: 0, margin_percent: null, version: null }
    }));
    renderModal();
    const comparison = await screen.findByTestId('quoted-vs-real');

    expect(screen.getByText('Sin cotización aprobada')).toBeInTheDocument();
    expect(cellsOf(comparison, 'Venta')).toEqual(['Venta', '—', '$1.200.000 CLP', '—']);
    expect(cellsOf(comparison, 'Margen')).toEqual(['Margen', '—', '58,3%', '—']);
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('avisa que el real es estimado solo cuando no hay horas aprobadas', async () => {
    const { unmount } = renderModal();
    await screen.findByTestId('quoted-vs-real');
    expect(screen.queryByText('Real estimado: no hay horas aprobadas aún')).not.toBeInTheDocument();
    unmount();

    mockReport(makeReport({ actual: { real_hours_source: 'projected', approved_hours: 0 } }));
    renderModal();
    expect(await screen.findByText('Real estimado: no hay horas aprobadas aún')).toBeInTheDocument();
  });

  it('avisa si aún hay pendientes bloqueantes para el cierre financiero y lo confirma cuando no los hay', async () => {
    const { unmount } = renderModal();
    expect(await screen.findByText('Aún hay pendientes bloqueantes para el cierre financiero')).toBeInTheDocument();
    unmount();

    mockReport(makeReport({ can_close_financials: true }));
    renderModal();
    expect(await screen.findByText('Sin pendientes bloqueantes para el cierre financiero')).toBeInTheDocument();
    expect(screen.queryByText('Aún hay pendientes bloqueantes para el cierre financiero')).not.toBeInTheDocument();
  });

  it('ya cerradas las finanzas muestra "Cierre financiero completado el <fecha>" en vez de si está listo para cerrar', async () => {
    for (const canClose of [true, false]) {
      mockReport(makeReport({ can_close_financials: canClose, project: { financial_closed_at: '2026-10-26 12:00:00' } }));
      const { unmount } = renderModal();

      expect(await screen.findByText('Cierre financiero completado el 26/10/2026')).toBeInTheDocument();
      expect(screen.queryByText('Sin pendientes bloqueantes para el cierre financiero')).not.toBeInTheDocument();
      expect(screen.queryByText('Aún hay pendientes bloqueantes para el cierre financiero')).not.toBeInTheDocument();
      expect(screen.queryByText('Cierre financiero: Pendiente')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('antes del cierre financiero indica que está pendiente y no habla de cierre completado', async () => {
    renderModal();

    expect(await screen.findByText('Cierre financiero: Pendiente')).toBeInTheDocument();
    expect(screen.queryByText(/Cierre financiero completado/)).not.toBeInTheDocument();
  });

  it('muestra las fechas del proyecto o "Fechas: sin registrar" cuando inicio y término son nulos', async () => {
    const { unmount } = renderModal();
    expect(await screen.findByText('Inicio: 01/03/2026 — Término: 30/09/2026')).toBeInTheDocument();
    unmount();

    mockReport(makeReport({ project: { start_date: null, end_date: null } }));
    renderModal();
    expect(await screen.findByText('Fechas: sin registrar')).toBeInTheDocument();
  });

  it('muestra el equipo con horas presupuestadas y reales, o un mensaje si está vacío', async () => {
    const { unmount } = renderModal();
    const team = await screen.findByTestId('team-hours');
    expect(cellsOf(team, 'Ana Pérez')).toEqual(['Ana Pérez', '80', '72,5']);
    unmount();

    mockReport(makeReport({ team: [] }));
    renderModal();
    expect(await screen.findByText('Sin personas asignadas ni horas aprobadas')).toBeInTheDocument();
  });

  it('el botón "Descargar PDF" llama a downloadClosureReportPdf y dispara la descarga', async () => {
    const blob = new Blob(['%PDF']);
    (apiService.downloadClosureReportPdf as any).mockResolvedValue(blob);
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi.fn();
    (global.URL as any).createObjectURL = createObjectURL;
    (global.URL as any).revokeObjectURL = revokeObjectURL;
    const downloads: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ href: this.href, download: this.download });
    });

    renderModal();
    await screen.findByTestId('quoted-vs-real');
    await userEvent.click(screen.getByRole('button', { name: /descargar pdf/i }));

    await waitFor(() => expect(apiService.downloadClosureReportPdf).toHaveBeenCalledWith(7));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url'));
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(downloads).toEqual([{ href: 'blob:mock-url', download: 'informe-cierre-7.pdf' }]);
  });

  it('avisa si falla la descarga del PDF y no intenta guardar nada', async () => {
    (apiService.downloadClosureReportPdf as any).mockRejectedValue(new Error('boom'));
    const createObjectURL = vi.fn();
    (global.URL as any).createObjectURL = createObjectURL;

    renderModal();
    await screen.findByTestId('quoted-vs-real');
    await userEvent.click(screen.getByRole('button', { name: /descargar pdf/i }));

    expect(await screen.findByText('No se pudo descargar el informe de cierre')).toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('muestra Alert de error si getClosureReport falla, deshabilita el PDF y permite reintentar', async () => {
    (apiService.getClosureReport as any).mockRejectedValueOnce({ response: { data: { error: 'Proyecto no encontrado' } } });

    renderModal();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('No se pudo cargar el informe de cierre')).toBeInTheDocument();
    expect(within(alert).getByText('Proyecto no encontrado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /descargar pdf/i })).toBeDisabled();

    await userEvent.click(within(alert).getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByTestId('quoted-vs-real')).toBeInTheDocument();
    expect(apiService.getClosureReport).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('No se pudo cargar el informe de cierre')).not.toBeInTheDocument();
  });

  it('no consulta el informe mientras el modal está cerrado y lo pide al abrirse', async () => {
    const { rerender } = renderModal({ open: false });
    expect(apiService.getClosureReport).not.toHaveBeenCalled();

    rerender(<ProjectClosureReportModal projectId={7} open onClose={vi.fn()} />);

    expect(await screen.findByTestId('quoted-vs-real')).toBeInTheDocument();
    expect(apiService.getClosureReport).toHaveBeenCalledWith(7);
  });

  it('el botón "Cerrar" llama a onClose', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await screen.findByTestId('quoted-vs-real');

    await userEvent.click(screen.getByRole('button', { name: /^cerrar$/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
