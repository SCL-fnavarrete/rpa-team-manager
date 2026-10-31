import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { PMOGeneralManagerView } from '@/components/pmo/views/PMOGeneralManagerView';
import { PMOCommercialView } from '@/components/pmo/views/PMOCommercialView';
import { PMOControllerView } from '@/components/pmo/views/PMOControllerView';
import type { PMOGeneralManagerData, PMOCommercialData, PMOControllerData } from '@/types/pmo';

// El backend solo envía costos, utilidad y margen a team_lead: rpa_operations y billing reciben las mismas
// secciones sin esos campos y las vistas deben ocultar lo que no llega, sin huecos ni NaN.

const generalManagerFull: PMOGeneralManagerData = {
  consolidated_pnl: {
    total_sold_clp: 1000000, total_real_cost_clp: 600000, total_gross_profit_clp: 400000, avg_margin_pct: 40,
    active_projects_count: 1, total_projects_count: 1, billable_hours_ratio: 80
  },
  cashflow_forecast: [],
  portfolio_health_summary: { healthy: 0, warning: 0, critical: 1 },
  top_risk_projects: [{
    id: 1, name: 'Proyecto Alfa', client_name: 'Cliente Alfa', assigned_to_name: 'Ana',
    project_health_status: 'critical', schedule_variance_days: 7,
    cost_variance_clp: 100000, real_cost_clp: 600000, budgeted_cost_clp: 500000,
    progress_pct: 50, days_to_deadline: 3, critical_reason: 'Retraso crítico de 7 días', risk_level: 'high'
  }],
  team_utilization_summary: { total_planned_fte: 1, total_developers: 2, overutilized_count: 0, optimal_count: 1, underutilized_count: 1 }
};

const generalManagerStripped: PMOGeneralManagerData = {
  ...generalManagerFull,
  consolidated_pnl: {
    total_sold_clp: 1000000, active_projects_count: 1, total_projects_count: 1, billable_hours_ratio: 80
  },
  top_risk_projects: [{
    id: 1, name: 'Proyecto Alfa', client_name: 'Cliente Alfa', assigned_to_name: 'Ana',
    project_health_status: 'critical', schedule_variance_days: 7,
    progress_pct: 50, days_to_deadline: 3, critical_reason: 'Retraso crítico de 7 días', risk_level: 'high'
  }]
};

const commercialBase = {
  ready_to_invoice: [],
  total_unlocked_revenue_clp: 0,
  client_scorecards: []
};

const commercialFull: PMOCommercialData = {
  ...commercialBase,
  margin_variance: [{
    project_id: 1, project_name: 'Proyecto Alfa', client_name: 'Cliente Alfa', quoted_margin_pct: 60, real_margin_pct: 40,
    margin_leakage_pct: 20, quoted_hours: 10, real_hours: 25, hours_exceeded: 15, quoted_amount_clp: 1000000, real_cost_clp: 600000
  }],
  scope_creep_alerts: [{
    project_id: 1, project_name: 'Proyecto Alfa', client_name: 'Cliente Alfa', quoted_hours: 10, real_hours: 25,
    overrun_hours: 15, overrun_cost_clp: 525000, severity: 'critical'
  }]
};

const commercialStripped: PMOCommercialData = {
  ...commercialBase,
  scope_creep_alerts: [{
    project_id: 1, project_name: 'Proyecto Alfa', client_name: 'Cliente Alfa', quoted_hours: 10, real_hours: 25,
    overrun_hours: 15, severity: 'critical'
  }]
};

const controllerShared = {
  imputations_audit: {
    users_with_missing_days: [],
    pending_approval_periods: [],
    billable_breakdown: { total_real_hours: 100, total_billable_hours: 80, total_internal_hours: 20, billable_pct: 80 }
  },
  cost_centers_summary: [],
  aging_portfolio: { current_clp: 0, overdue_30_clp: 0, overdue_60_clp: 400000, total_overdue_clp: 400000, overdue_invoices: [] }
};

const controllerFull: PMOControllerData = {
  ...controllerShared,
  triple_conciliation: [{
    project_id: 1, project_name: 'Proyecto Alfa', client_name: 'Cliente Alfa', physical_progress_pct: 50,
    cost_consumed_pct: 120, billed_pct: 40, cpi: 0.8, deviation_flag: 'cost_overrun',
    sale_price_clp: 1000000, budgeted_cost_clp: 500000, real_cost_clp: 600000, invoiced_clp: 400000, paid_clp: 100000
  }]
};

const controllerStripped: PMOControllerData = {
  ...controllerShared,
  triple_conciliation: [{
    project_id: 1, project_name: 'Proyecto Alfa', client_name: 'Cliente Alfa', physical_progress_pct: 50,
    billed_pct: 40, deviation_flag: 'unbilled_work', sale_price_clp: 1000000, invoiced_clp: 400000, paid_clp: 100000
  }]
};

const renderInRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('PMOGeneralManagerView - campos de costo y margen opcionales', () => {
  it('con costos y margen muestra la tarjeta de margen, la utilidad bruta y la columna de costo real', () => {
    renderInRouter(<PMOGeneralManagerView data={generalManagerFull} />);

    expect(screen.getByText('Margen Operacional Consolidado')).toBeInTheDocument();
    expect(screen.getByText(/Utilidad bruta/)).toBeInTheDocument();
    expect(screen.getByText('Impacto Costo Real')).toBeInTheDocument();
    expect(screen.getByText(/Sobrecosto: \+/)).toBeInTheDocument();
  });

  it('sin costos ni margen oculta esas tarjetas y columnas, mantiene el resto y no deja NaN', () => {
    const { container } = renderInRouter(<PMOGeneralManagerView data={generalManagerStripped} />);

    expect(screen.queryByText('Margen Operacional Consolidado')).not.toBeInTheDocument();
    expect(screen.queryByText(/Utilidad bruta/)).not.toBeInTheDocument();
    expect(screen.queryByText('Impacto Costo Real')).not.toBeInTheDocument();
    expect(screen.queryByText(/Sobrecosto: \+/)).not.toBeInTheDocument();
    expect(screen.getByText('Venta Total Portafolio')).toBeInTheDocument();
    expect(screen.getByText('Salud de Proyectos')).toBeInTheDocument();
    expect(screen.getByText('Eficiencia de Equipo RPA')).toBeInTheDocument();
    expect(screen.getByText('Proyecto Alfa')).toBeInTheDocument();
    expect(screen.getByText('Retraso crítico de 7 días')).toBeInTheDocument();
    expect(container.textContent).not.toContain('NaN');
  });
});

describe('PMOCommercialView - campos de margen y costo opcionales', () => {
  it('con margen muestra el control de margen comercial y el costo HH adicional del scope creep', () => {
    renderInRouter(<PMOCommercialView data={commercialFull} />);

    expect(screen.getByText('Control de Margen Comercial: Cotización Inicial vs Ejecución Real')).toBeInTheDocument();
    expect(screen.getByText('Margen Cotizado')).toBeInTheDocument();
    expect(screen.getByText(/Costo HH adicional estimado/)).toBeInTheDocument();
  });

  it('sin margen ni costo oculta el control de margen y el costo HH, y conserva el scope creep por horas', () => {
    const { container } = renderInRouter(<PMOCommercialView data={commercialStripped} />);

    expect(screen.queryByText('Control de Margen Comercial: Cotización Inicial vs Ejecución Real')).not.toBeInTheDocument();
    expect(screen.queryByText(/Costo HH adicional estimado/)).not.toBeInTheDocument();
    expect(screen.getByText('Detección de Scope Creep: Oportunidades de Orden de Cambio (CR)')).toBeInTheDocument();
    expect(screen.getByText('+15 hrs extra')).toBeInTheDocument();
    expect(screen.getByText('Ver Cotización / CR')).toBeInTheDocument();
    expect(screen.getByText('Revenue Desbloqueado Listo para Facturar')).toBeInTheDocument();
    expect(container.textContent).not.toContain('NaN');
  });
});

describe('PMOControllerView - campos de costo y CPI opcionales', () => {
  it('con costos muestra el avance de costo, el CPI y el costo en los montos clave', () => {
    renderInRouter(<PMOControllerView data={controllerFull} />);

    expect(screen.getByText('Matriz de Triple Conciliación de Proyectos (EVM / Físico vs Costo vs Facturación)')).toBeInTheDocument();
    expect(screen.getByText('CPI (Cost Efficiency)')).toBeInTheDocument();
    expect(screen.getByText('CPI 0.8')).toBeInTheDocument();
    expect(screen.getAllByText(/^Costo:/).length).toBeGreaterThan(0);
  });

  it('sin costos oculta CPI y costo, y conserva venta, facturado, cartera vencida y aging', () => {
    const { container } = renderInRouter(<PMOControllerView data={controllerStripped} />);

    expect(screen.getByText('Conciliación de Avance Físico vs Facturación')).toBeInTheDocument();
    expect(screen.queryByText(/Triple/)).not.toBeInTheDocument();
    expect(screen.queryByText(/CPI/)).not.toBeInTheDocument();
    expect(screen.queryAllByText(/^Costo:/)).toHaveLength(0);
    expect(screen.getByText(/Venta:/)).toBeInTheDocument();
    expect(screen.getAllByText(/Facturado:/).length).toBeGreaterThan(0);
    expect(screen.getByText('Riesgo Cobro (Físico > Facturado)')).toBeInTheDocument();
    expect(screen.getByText('Cartera Total Vencida')).toBeInTheDocument();
    expect(screen.getByText('Antigüedad de Deuda por Cobrar:')).toBeInTheDocument();
    expect(container.textContent).not.toContain('NaN');
  });
});
