import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { ProjectCommercialSection } from '@/components/projects/ProjectCommercialSection';
import { apiService } from '@/services/api';
import { Project } from '@/types/project';

vi.mock('@/services/api', () => ({
  apiService: {
    request: vi.fn(),
    post: vi.fn(),
    getPaymentMilestones: vi.fn().mockResolvedValue([]),
    getInvoices: vi.fn().mockResolvedValue([]),
    getProjectCostCenters: vi.fn().mockResolvedValue({ allocations: [] }),
    getTeamCapacity: vi.fn(),
    getProjectCapacity: vi.fn(),
    saveProjectCapacity: vi.fn(),
    deleteProjectCapacity: vi.fn(),
    getUsers: vi.fn().mockResolvedValue([
      { id: 1, full_name: 'Ana Dev', email: 'ana@example.com', role: 'developer' }
    ])
  }
}));

const mockProject: Project = {
  id: 10,
  name: 'Proyecto Automatización RPA',
  code: 'RPA-10',
  description: 'Desc',
  status: 'active',
  created_by: 1,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  commercial_stage: 'approved'
} as any;

describe('ProjectCommercialSection - Capacidad y FTE (Fase 6F)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('muestra la pestaña de equipo y capacidad con KPIs y asignaciones', async () => {
    (apiService.request as any).mockImplementation((opts: any) => {
      if (opts.url.includes('/capacity')) {
        return Promise.resolve({
          data: [
            {
              user_id: 1,
              full_name: 'Ana Dev',
              role: 'Desarrollador RPA',
              allocation_percentage: 100,
              planned_fte: 1.0,
              budgeted_hours: 160,
              actual_hours: 40,
              start_date: '2026-01-01',
              end_date: '2026-06-30'
            }
          ]
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <App>
        <ProjectCommercialSection
          project={mockProject}
          user={{ id: 1, full_name: 'Líder', email: 'lead@test.com', role: 'team_lead' } as any}
          initialTab="capacity"
        />
      </App>
    );

    // Verify presence of table headers and content
    await waitFor(() => {
      expect(screen.getByText('Dedicación y horas presupuestadas')).toBeInTheDocument();
      expect(screen.getByText('Ana Dev')).toBeInTheDocument();
      expect(screen.getByText('Desarrollador RPA')).toBeInTheDocument();
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    // Check action buttons for team_lead
    const assignBtn = screen.getByRole('button', { name: /asignar persona/i });
    expect(assignBtn).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /editar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /desasignar/i })).toBeInTheDocument();
  });

  it('abre el modal de asignación al hacer clic en Asignar persona', async () => {
    (apiService.request as any).mockResolvedValue({ data: [] });

    render(
      <App>
        <ProjectCommercialSection
          project={mockProject}
          user={{ id: 1, full_name: 'Líder', email: 'lead@test.com', role: 'team_lead' } as any}
          initialTab="capacity"
        />
      </App>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /asignar persona/i })).toBeInTheDocument();
    });

    const assignBtn = screen.getByRole('button', { name: /asignar persona/i });
    assignBtn.click();

    await waitFor(() => {
      expect(screen.getByText('Asignar persona al proyecto')).toBeInTheDocument();
      expect(screen.getByText('Integrante del equipo')).toBeInTheDocument();
      expect(screen.getByText('% Asignación')).toBeInTheDocument();
    });
  });
});
