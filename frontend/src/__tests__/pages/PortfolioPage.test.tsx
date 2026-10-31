import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/api', () => ({
  apiService: {
    getPortfolio: vi.fn(),
    get: vi.fn()
  }
}));

import { apiService } from '@/services/api';
import { PortfolioPage } from '@/pages/portfolio/PortfolioPage';
import type { PortfolioResult, PortfolioRow } from '@/types/portfolio';

const makeRow = (overrides: Partial<PortfolioRow> = {}): PortfolioRow => ({
  project_id: 1,
  project_name: 'Proyecto Alfa',
  status: 'active',
  commercial_stage: 'approved',
  client_id: 10,
  client_name: 'Cliente Alfa',
  sales_rep_id: 20,
  sales_rep_name: 'Comercial Uno',
  area_id: 30,
  area_name: 'Minería',
  sale_price: 1000000,
  real_cost: 350000,
  projected_cost: 600000,
  real_profit: 650000,
  projected_profit: 400000,
  real_margin_percentage: 65,
  projected_margin_percentage: 40,
  real_hours_source: 'approved',
  health_semaphore: 'green',
  invoiced_clp: 300000,
  collected_clp: 100000,
  pending_to_invoice_clp: 700000,
  financials_error: false,
  ...overrides
});

const makeResult = (overrides: Partial<PortfolioResult> = {}): PortfolioResult => ({
  rows: [
    makeRow(),
    makeRow({
      project_id: 2,
      project_name: 'Proyecto Beta',
      client_name: 'Cliente Beta',
      sale_price: 2000000,
      real_cost: 900000,
      projected_cost: 1500000,
      projected_profit: 500000,
      projected_margin_percentage: 25,
      health_semaphore: 'red',
      invoiced_clp: 1200000,
      collected_clp: 800000,
      pending_to_invoice_clp: 800000
    })
  ],
  totals: {
    projects: 2,
    sale_price: 3000000,
    real_cost: 1250000,
    projected_cost: 2100000,
    projected_profit: 900000,
    invoiced_clp: 1500000,
    collected_clp: 900000,
    pending_to_invoice_clp: 1500000
  },
  pipeline: [],
  sales_by_rep: [{ sales_rep_id: 20, sales_rep_name: 'Comercial Uno', projects: 2, sale_price: 3000000 }],
  ...overrides
});

const emptyResult = (): PortfolioResult => ({
  rows: [],
  totals: {
    projects: 0, sale_price: 0, real_cost: 0, projected_cost: 0, projected_profit: 0,
    invoiced_clp: 0, collected_clp: 0, pending_to_invoice_clp: 0
  },
  pipeline: [],
  sales_by_rep: []
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/portfolio']}>
      <PortfolioPage />
    </MemoryRouter>
  );
}

const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

describe('PortfolioPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiService.getPortfolio as any).mockResolvedValue(makeResult());
    (apiService.get as any).mockImplementation((url: string) => {
      if (url === '/clients') return Promise.resolve({ data: [{ id: 5, name: 'Constructora Norte' }] });
      if (url === '/sales-reps') return Promise.resolve({ data: [{ id: 6, name: 'Marta Ventas' }] });
      if (url === '/business-areas') return Promise.resolve({ data: [{ id: 7, name: 'Energía', code: 'ENE' }] });
      return Promise.resolve({ data: [] });
    });
  });

  it('muestra tarjetas de totales y una fila por proyecto con venta, costo real, costo proyectado, utilidad y margen %', async () => {
    renderPage();

    const saleCard = (await screen.findByTestId('kpi-sale_price'));
    expect(within(saleCard).getByText('$3.000.000 CLP')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-real_cost')).getByText('$1.250.000 CLP')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-projected_cost')).getByText('$2.100.000 CLP')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-projected_profit')).getByText('$900.000 CLP')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-pending_to_invoice')).getByText('$1.500.000 CLP')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-projects')).getByText('2')).toBeInTheDocument();

    const alfa = within(rowOf('Proyecto Alfa'));
    expect(alfa.getByText('$1.000.000 CLP')).toBeInTheDocument();
    expect(alfa.getByText('$350.000 CLP')).toBeInTheDocument();
    expect(alfa.getByText('$600.000 CLP')).toBeInTheDocument();
    expect(alfa.getByText('$400.000 CLP')).toBeInTheDocument();
    expect(alfa.getByText('40,0%')).toBeInTheDocument();
    expect(within(rowOf('Proyecto Beta')).getByText('25,0%')).toBeInTheDocument();
  });

  it('rotula las tarjetas de venta, costos y por facturar como "Solo proyectos con OK del cliente"', async () => {
    renderPage();

    for (const id of ['kpi-sale_price', 'kpi-real_cost', 'kpi-projected_cost', 'kpi-projected_profit', 'kpi-pending_to_invoice']) {
      expect(within(await screen.findByTestId(id)).getByText('Solo proyectos con OK del cliente')).toBeInTheDocument();
    }
    for (const id of ['kpi-invoiced', 'kpi-collected']) {
      expect(within(screen.getByTestId(id)).getByText('Incluye todos los proyectos de la cartera')).toBeInTheDocument();
    }
  });

  it('el nombre del proyecto enlaza a su ficha', async () => {
    renderPage();

    expect(await screen.findByRole('button', { name: 'Proyecto Alfa' })).toBeInTheDocument();
  });

  it('sin filtros activos el estado vacío dice "Aún no hay proyectos", sin hablar de filtros', async () => {
    (apiService.getPortfolio as any).mockResolvedValue(emptyResult());
    renderPage();

    expect(await screen.findByText('Aún no hay proyectos')).toBeInTheDocument();
    expect(screen.queryByText('No hay proyectos en la cartera con estos filtros')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-projects')).getByText('0')).toBeInTheDocument();
  });

  it('con un filtro activo y sin resultados el estado vacío habla de los filtros', async () => {
    renderPage();
    await screen.findByText('Proyecto Alfa');
    (apiService.getPortfolio as any).mockResolvedValue(emptyResult());

    await userEvent.click(screen.getByRole('combobox', { name: /filtrar por cliente/i }));
    await userEvent.click(await screen.findByTitle('Constructora Norte'));

    expect(await screen.findByText('No hay proyectos en la cartera con estos filtros')).toBeInTheDocument();
    expect(screen.queryByText('Aún no hay proyectos')).not.toBeInTheDocument();
  }, 30000);

  it('cambiar el filtro de cliente vuelve a llamar a getPortfolio con client_id', async () => {
    renderPage();
    await screen.findByText('Proyecto Alfa');
    expect(apiService.getPortfolio).toHaveBeenLastCalledWith({});

    await userEvent.click(screen.getByRole('combobox', { name: /filtrar por cliente/i }));
    await userEvent.click(await screen.findByTitle('Constructora Norte'));

    await waitFor(() => {
      expect(apiService.getPortfolio).toHaveBeenLastCalledWith({ client_id: 5 });
    });
  }, 30000);

  it('filtra por etapa comercial y al limpiar el filtro quita el parámetro', async () => {
    renderPage();
    await screen.findByText('Proyecto Alfa');

    await userEvent.click(screen.getByRole('combobox', { name: /filtrar por etapa/i }));
    await userEvent.click(await screen.findByTitle('En cotización'));
    await waitFor(() => {
      expect(apiService.getPortfolio).toHaveBeenLastCalledWith({ commercial_stage: 'quoting' });
    });

    await userEvent.hover(screen.getByRole('combobox', { name: /filtrar por etapa/i }).closest('.ant-select') as HTMLElement);
    await userEvent.click(document.querySelector('.ant-select-clear') as HTMLElement);
    await waitFor(() => {
      expect(Object.keys((apiService.getPortfolio as any).mock.lastCall[0])).toEqual([]);
    });
  }, 30000);

  it('renderiza "Sin asignar" para ventas por comercial sin comercial y no muestra NaN', async () => {
    (apiService.getPortfolio as any).mockResolvedValue(makeResult({
      sales_by_rep: [
        { sales_rep_id: 20, sales_rep_name: 'Comercial Uno', projects: 2, sale_price: 3000000 },
        { sales_rep_id: null, sales_rep_name: 'Sin asignar', projects: 1, sale_price: 500000 }
      ]
    }));
    renderPage();

    const card = await screen.findByTestId('sales-by-rep');
    expect(within(card).getByText('Sin asignar')).toBeInTheDocument();
    expect(within(card).getByText('$500.000 CLP')).toBeInTheDocument();
    expect(within(card).getByText('Proyectos')).toBeInTheDocument();
    expect(within(card).getByText('Solo proyectos con OK del cliente.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });

  it('fila con financials_error muestra aviso "Datos incompletos" en vez de números', async () => {
    (apiService.getPortfolio as any).mockResolvedValue(makeResult({
      rows: [makeRow({
        project_id: 3,
        project_name: 'Proyecto Roto',
        sale_price: 0,
        real_cost: 0,
        projected_cost: 0,
        projected_profit: 0,
        projected_margin_percentage: 0,
        pending_to_invoice_clp: 0,
        invoiced_clp: 250000,
        collected_clp: 120000,
        financials_error: true
      })]
    }));
    renderPage();

    await screen.findByText('Proyecto Roto');
    const broken = within(rowOf('Proyecto Roto'));
    expect(broken.getByText('Datos incompletos')).toBeInTheDocument();
    expect(broken.queryByText('$0 CLP')).not.toBeInTheDocument();
    expect(broken.queryByText('0,0%')).not.toBeInTheDocument();
    expect(broken.getByText('$250.000 CLP')).toBeInTheDocument();
  });

  it('no presenta como pendiente real el por facturar de proyectos en cotización, perdidos o cancelados', async () => {
    (apiService.getPortfolio as any).mockResolvedValue(makeResult({
      rows: [
        makeRow({ project_id: 4, project_name: 'Proyecto Perdido', commercial_stage: 'lost', pending_to_invoice_clp: 777000 }),
        makeRow({ project_id: 5, project_name: 'Proyecto Cancelado', status: 'cancelled', pending_to_invoice_clp: 888000 }),
        makeRow({ project_id: 6, project_name: 'Proyecto Vigente', pending_to_invoice_clp: 999000 }),
        makeRow({ project_id: 7, project_name: 'Proyecto Cotizando', commercial_stage: 'quoting', status: 'on_hold', pending_to_invoice_clp: 666000 }),
        makeRow({ project_id: 8, project_name: 'Proyecto Desde Cotizacion', commercial_stage: 'quoting', status: 'active', pending_to_invoice_clp: 555000 })
      ]
    }));
    renderPage();

    await screen.findByText('Proyecto Vigente');
    expect(within(rowOf('Proyecto Vigente')).getByText('$999.000 CLP')).toBeInTheDocument();
    // creado con "Crear desde cotización": etapa 'quoting' por defecto de la BD pero ya en ejecución, cuenta como venta
    expect(within(rowOf('Proyecto Desde Cotizacion')).getByText('$555.000 CLP')).toBeInTheDocument();
    expect(within(rowOf('Proyecto Cotizando')).queryByText('$666.000 CLP')).not.toBeInTheDocument();
    expect(within(rowOf('Proyecto Cotizando')).getByText('—')).toBeInTheDocument();
    expect(within(rowOf('Proyecto Perdido')).queryByText('$777.000 CLP')).not.toBeInTheDocument();
    expect(within(rowOf('Proyecto Perdido')).getByText('—')).toBeInTheDocument();
    expect(within(rowOf('Proyecto Cancelado')).queryByText('$888.000 CLP')).not.toBeInTheDocument();
    expect(within(rowOf('Proyecto Cancelado')).getByText('—')).toBeInTheDocument();
  }, 30000);

  it('muestra el pipeline con el monto de la última cotización y "Sin cotización" cuando no hay', async () => {
    (apiService.getPortfolio as any).mockResolvedValue(makeResult({
      pipeline: [
        { project_id: 8, project_name: 'Oportunidad Gamma', client_name: 'Cliente Gamma', sales_rep_name: 'Comercial Uno', last_quote_amount_clp: 4500000, last_quote_version: 2 },
        { project_id: 9, project_name: 'Oportunidad Delta', client_name: null, sales_rep_name: null, last_quote_amount_clp: 0, last_quote_version: null }
      ]
    }));
    renderPage();

    const card = await screen.findByTestId('pipeline');
    const gamma = within(within(card).getByRole('row', { name: /Oportunidad Gamma/ }));
    expect(gamma.getByText('$4.500.000 CLP')).toBeInTheDocument();
    expect(gamma.getByText('v2')).toBeInTheDocument();
    expect(within(within(card).getByRole('row', { name: /Oportunidad Delta/ })).getByText('Sin cotización')).toBeInTheDocument();
  });

  it('marca "estimado" el costo real de un proyecto sin horas aprobadas, con la explicación en el tooltip', async () => {
    (apiService.getPortfolio as any).mockResolvedValue(makeResult({
      rows: [
        makeRow({ project_id: 1, project_name: 'Proyecto Medido', real_hours_source: 'approved' }),
        makeRow({ project_id: 2, project_name: 'Proyecto Sin Horas', real_hours_source: 'projected' })
      ]
    }));
    renderPage();

    await screen.findByText('Proyecto Sin Horas');
    expect(within(rowOf('Proyecto Medido')).queryByText('estimado')).not.toBeInTheDocument();
    const tag = within(rowOf('Proyecto Sin Horas')).getByText('estimado');

    await userEvent.hover(tag);
    expect(await screen.findByText('Sin horas aprobadas: se usa el costo planificado')).toBeInTheDocument();
  }, 30000);

  it('la tarjeta de costo real avisa cuántos proyectos del total tienen costo estimado, y no dice nada si ninguno', async () => {
    (apiService.getPortfolio as any).mockResolvedValue(makeResult({
      rows: [
        makeRow({ project_id: 1, project_name: 'Medido', real_hours_source: 'approved' }),
        makeRow({ project_id: 2, project_name: 'Estimado Uno', real_hours_source: 'projected' }),
        makeRow({ project_id: 3, project_name: 'Estimado Dos', real_hours_source: 'projected' }),
        // no suman al costo real total, así que tampoco cuentan en el aviso
        makeRow({ project_id: 4, project_name: 'Estimado Cotizando', real_hours_source: 'projected', commercial_stage: 'quoting', status: 'on_hold' }),
        makeRow({ project_id: 5, project_name: 'Estimado Perdido', real_hours_source: 'projected', commercial_stage: 'lost' })
      ]
    }));
    const { unmount } = renderPage();

    const card = await screen.findByTestId('kpi-real_cost');
    expect(within(card).getByText('Incluye 2 proyectos con costo estimado (sin horas aprobadas)')).toBeInTheDocument();
    expect(within(card).getByText('Solo proyectos con OK del cliente')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-projected_cost')).queryByText(/costo estimado/)).not.toBeInTheDocument();
    unmount();

    (apiService.getPortfolio as any).mockResolvedValue(makeResult({
      rows: [makeRow({ project_id: 2, project_name: 'Único Estimado', real_hours_source: 'projected' })]
    }));
    const second = renderPage();
    expect(await within(await second.findByTestId('kpi-real_cost')).findByText('Incluye 1 proyecto con costo estimado (sin horas aprobadas)')).toBeInTheDocument();
    second.unmount();

    (apiService.getPortfolio as any).mockResolvedValue(makeResult());
    renderPage();
    expect(within(await screen.findByTestId('kpi-real_cost')).queryByText(/costo estimado/)).not.toBeInTheDocument();
  }, 30000);

  it('muestra un aviso con reintento cuando falla la carga', async () => {
    (apiService.getPortfolio as any).mockRejectedValueOnce({ response: { data: { error: 'Error al obtener la cartera' } } });
    renderPage();

    expect(await screen.findByText('Error al obtener la cartera')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Proyecto Alfa')).toBeInTheDocument();
  });

  it('si la carga falla sin respuesta del servidor (p. ej. el 429 ya traducido) muestra el mensaje del error', async () => {
    (apiService.getPortfolio as any).mockRejectedValueOnce(new Error('Hay demasiadas solicitudes. Espera antes de volver a intentarlo.'));
    renderPage();

    expect(await screen.findByText('Hay demasiadas solicitudes. Espera antes de volver a intentarlo.')).toBeInTheDocument();
  });

  it('si el error no trae ningún mensaje muestra un texto genérico en español', async () => {
    (apiService.getPortfolio as any).mockRejectedValueOnce({});
    renderPage();

    expect(await screen.findByText('No se pudo cargar la cartera de proyectos.')).toBeInTheDocument();
  });
});
