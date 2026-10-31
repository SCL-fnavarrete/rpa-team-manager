import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/api', () => ({
  default: { getProjectPMOMetrics: vi.fn() },
  apiService: { getProjectPMOMetrics: vi.fn() }
}));

import apiService from '@/services/api';
import { ProjectPMOView } from '@/components/projects/ProjectPMOView';

// El backend solo envía el desvío de presupuesto a team_lead; rpa_developer y rpa_operations reciben el resto de las métricas.

const projectBase = {
  id: 7, name: 'Alfa', completion_percentage: 50, schedule_variance_days: -2, risk_level: 'low',
  team_velocity: 5, bugs_found: 0, bugs_resolved: 0, actual_hours: 10, planned_hours: 20
};

const renderView = () =>
  render(
    <MemoryRouter>
      <ProjectPMOView projectId={7} projectName="Alfa" />
    </MemoryRouter>
  );

describe('ProjectPMOView - desvío de presupuesto opcional', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('con el desvío de costo muestra el indicador de presupuesto y la alerta de sobrecosto', async () => {
    (apiService.getProjectPMOMetrics as any).mockResolvedValue({
      project: { ...projectBase, cost_variance_percentage: 25 },
      milestones: { list: [] }
    });

    renderView();

    expect(await screen.findByText('Indicadores del proyecto')).toBeInTheDocument();
    expect(screen.getByText('Presupuesto')).toBeInTheDocument();
    expect(screen.getByText('Sobrecosto')).toBeInTheDocument();
  });

  it('sin el desvío de costo oculta el indicador y la alerta, mantiene el resto y no deja NaN', async () => {
    (apiService.getProjectPMOMetrics as any).mockResolvedValue({
      project: projectBase,
      milestones: { list: [] }
    });

    const { container } = renderView();

    expect(await screen.findByText('Indicadores del proyecto')).toBeInTheDocument();
    expect(screen.queryByText('Presupuesto')).not.toBeInTheDocument();
    expect(screen.queryByText('Sobrecosto')).not.toBeInTheDocument();
    expect(screen.getByText('Avance del cronograma')).toBeInTheDocument();
    expect(screen.getByText('Programar')).toBeInTheDocument();
    expect(screen.getByText('Puntaje de calidad')).toBeInTheDocument();
    expect(container.textContent).not.toContain('NaN');
  });
});
