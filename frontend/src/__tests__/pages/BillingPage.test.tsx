// frontend/src/__tests__/pages/BillingPage.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import BillingPage from '../../pages/billing/BillingPage';

vi.mock('../../services/api', () => ({
  default: {
    getProjects: vi.fn().mockResolvedValue([{ id: 1, name: 'AGROSUPER' }]),
    getBillingDashboard: vi.fn().mockResolvedValue({
      ready_to_invoice: [{
        id: 11,
        project_id: 1,
        project_name: 'AGROSUPER',
        name: 'Hito aprobado',
        amount: 500000,
        currency: 'CLP',
        status: 'billable',
        planned_date: '2026-09-26',
        trigger_type: 'date'
      }],
      invoiced_unpaid: [],
      paid: [],
      overdue: [],
      cashflow_projection: [{ month: '2026-09', expected_amount_clp: 1000000 }],
      summary: { total_pending_clp: 0, total_billable_clp: 500000, total_invoiced_clp: 0, total_paid_clp: 200000, total_overdue_clp: 0 }
    }),
    getPaymentMilestones: vi.fn().mockResolvedValue([]),
    getInvoices: vi.fn().mockResolvedValue([]),
    getCostCenters: vi.fn().mockResolvedValue([])
  }
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 1, role: 'team_lead' } })
}));

describe('BillingPage', () => {
  const renderBillingPage = () => render(
    <MemoryRouter>
      <BillingPage />
    </MemoryRouter>
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('muestra el resumen de cobranza y el monto origen desde el dashboard', async () => {
    renderBillingPage();
    expect(await screen.findByText('Finanzas y cobranza')).toBeInTheDocument();
    expect(await screen.findByText('Listo para facturar')).toBeInTheDocument();
    expect(await screen.findByText('500.000 CLP')).toBeInTheDocument();
  }, 15000);

  it('muestra el botón para crear un nuevo hito de pago', async () => {
    renderBillingPage();
    expect(await screen.findByText('Nuevo hito de pago')).toBeInTheDocument();
  });
});
