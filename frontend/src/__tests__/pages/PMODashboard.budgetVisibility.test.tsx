import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const auth = vi.hoisted(() => ({ role: 'rpa_operations' }));

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 1, role: auth.role, full_name: 'Usuario' } })
}));

vi.mock('../../services/api', () => {
  const mockApi = {
    getUsers: vi.fn(),
    getProjects: vi.fn(),
    getPMODashboard: vi.fn(),
    getPMOAnalytics: vi.fn(),
    getPMOExecutiveSuite: vi.fn(),
    getTeamCapacity: vi.fn()
  };
  return { default: mockApi, apiService: mockApi };
});

import apiService from '../../services/api';
import PMODashboard from '../../pages/pmo/PMODashboard';

// El backend solo envía presupuesto y costos a team_lead: rpa_operations recibe las mismas secciones sin esas claves
// y la pantalla debe ocultar sus tarjetas, columnas y textos sin dejar huecos ni NaN.

const dashboardProject = {
  id: 7, name: 'AGROSUPER', status: 'active', priority: 'high', client_name: 'Cliente Alfa', assigned_to_name: 'Ana',
  completion_percentage: 40, risk_level: 'low', project_health_status: 'healthy', end_date: null, days_to_deadline: null,
  total_milestones: 0, completed_milestones: 0, commercial_stage: 'approved'
};

const dashboardFull = {
  projects: [{ ...dashboardProject, budget: 5000000, planned_budget: 4000000, actual_cost: 3000000, cost_variance_percentage: 12 }],
  overallMetrics: { total_projects: 1, active_projects: 1, critical_projects: 0, avg_completion: 40, total_planned_budget: 4000000, total_actual_cost: 3000000 },
  upcomingMilestones: [],
  teamWorkload: [],
  teamCapacity: []
};

const dashboardStripped = {
  projects: [dashboardProject],
  overallMetrics: { total_projects: 1, active_projects: 1, critical_projects: 0, avg_completion: 40 },
  upcomingMilestones: [],
  teamWorkload: [],
  teamCapacity: []
};

const analyticsBase = {
  trendAnalysis: [],
  scheduleAnalysis: [{ project_id: 7, project_name: 'AGROSUPER', schedule_variance_days: -2, completion_percentage: 40, schedule_status: 'delayed', project_manager: 'Ana' }],
  riskAnalysis: [],
  qualityMetrics: [],
  resourceUtilization: [],
  riskDistribution: []
};

const analyticsFull = {
  ...analyticsBase,
  executiveSummary: {
    total_projects: 1, active_projects: 1, completed_projects: 0, critical_projects: 1, over_budget_projects: 3, delayed_projects: 1,
    avg_completion: 40, avg_satisfaction: 8, total_planned_budget: 4000000, total_actual_cost: 3000000, overall_budget_variance: -25
  },
  budgetAnalysis: [{ project_id: 7, project_name: 'AGROSUPER', planned_budget: 4000000, actual_cost: 3000000, cost_variance_percentage: 12, budget_status: 'warning', completion_percentage: 40 }],
  teamAnalysis: [{ full_name: 'Ana Dev', role: 'rpa_developer', total_projects: 1, avg_completion: 40, avg_satisfaction: 8, avg_velocity: 5, avg_budget_variance: 12 }],
  satisfactionTrends: [{ client_name: 'AGROSUPER', total_projects: 1, avg_satisfaction: 8, on_time_rate: 100, on_budget_rate: 100 }]
};

const analyticsStripped = {
  ...analyticsBase,
  executiveSummary: {
    total_projects: 1, active_projects: 1, completed_projects: 0, critical_projects: 1, delayed_projects: 1, avg_completion: 40, avg_satisfaction: 8
  },
  teamAnalysis: [{ full_name: 'Ana Dev', role: 'rpa_developer', total_projects: 1, avg_completion: 40, avg_satisfaction: 8, avg_velocity: 5 }],
  satisfactionTrends: [{ client_name: 'AGROSUPER', total_projects: 1, avg_satisfaction: 8, on_time_rate: 100 }]
};

function renderDashboard() {
  localStorage.setItem('pmo_preferred_perspective', 'operations');
  return render(
    <MemoryRouter initialEntries={['/pmo']}>
      <Routes>
        <Route path="/pmo" element={<PMODashboard />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('PMODashboard - presupuesto y costos solo para team_lead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    (apiService.getUsers as any).mockResolvedValue([]);
    (apiService.getProjects as any).mockResolvedValue([]);
    (apiService.getPMOExecutiveSuite as any).mockResolvedValue(null);
    (apiService.getTeamCapacity as any).mockResolvedValue({ members: [] });
  });

  it('team_lead ve la tarjeta y la columna de presupuesto y el análisis presupuestario completo', async () => {
    auth.role = 'team_lead';
    (apiService.getPMODashboard as any).mockResolvedValue(dashboardFull);
    (apiService.getPMOAnalytics as any).mockResolvedValue(analyticsFull);
    renderDashboard();

    expect(await screen.findByText('Presupuesto Total', {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByText('Presupuesto')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Análisis'));

    expect(await screen.findByText('Desempeño Presupuestario')).toBeInTheDocument();
    expect(screen.getByText('3 sobre presupuesto')).toBeInTheDocument();
    expect(screen.getByText('En Presupuesto')).toBeInTheDocument();
    expect(screen.getByText(/12\.0% budget/)).toBeInTheDocument();
  }, 40000);

  it('rpa_operations no ve presupuesto en el resumen, la tabla ni el análisis, y el resto se mantiene sin NaN', async () => {
    auth.role = 'rpa_operations';
    (apiService.getPMODashboard as any).mockResolvedValue(dashboardStripped);
    (apiService.getPMOAnalytics as any).mockResolvedValue(analyticsStripped);
    const { container } = renderDashboard();

    expect(await screen.findByText('Progreso Global', {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.queryByText('Presupuesto Total')).not.toBeInTheDocument();
    expect(screen.queryByText('Presupuesto')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Análisis'));

    expect(await screen.findByText('Desempeño de Cronograma')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Calidad & Satisfacción')).toBeInTheDocument());
    expect(screen.queryByText('Desempeño Presupuestario')).not.toBeInTheDocument();
    expect(screen.queryByText(/sobre presupuesto/)).not.toBeInTheDocument();
    expect(screen.queryByText('En Presupuesto')).not.toBeInTheDocument();
    expect(screen.queryByText(/% budget/)).not.toBeInTheDocument();
    expect(screen.getByText('Ana Dev')).toBeInTheDocument();
    expect(container.textContent).not.toContain('NaN');
  }, 40000);
});
