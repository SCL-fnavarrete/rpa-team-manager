import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

import { ScopingListTable } from '@/components/scoping/ScopingListTable';
import type { ScopingKpis, ScopingQuotationRecord } from '@/types/scoping';
import { makeRecord } from '../fixtures/scoping';

type TableProps = React.ComponentProps<typeof ScopingListTable>;

const kpisFor = (items: ScopingQuotationRecord[]): ScopingKpis => ({
  total_scopings: items.length,
  viable_percentage: items.length ? Math.round((items.filter((i) => i.viability_status === 'viable').length / items.length) * 100) : 0,
  total_quoted_hours: items.reduce((sum, item) => sum + item.total_hours, 0),
  // Así lo calcula el backend hoy: suma de montos de monedas distintas
  total_proposed_amount: items.reduce((sum, item) => sum + item.proposed_price, 0)
});

function renderTable(items: ScopingQuotationRecord[], props: Partial<TableProps> = {}) {
  return render(
    <ScopingListTable
      items={items}
      kpis={kpisFor(items)}
      loading={false}
      onViewProposal={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onConvertToProject={vi.fn()}
      onSearchChange={vi.fn()}
      onStatusFilterChange={vi.fn()}
      searchValue=""
      onNewScoping={vi.fn()}
      {...props}
    />
  );
}

const rowOf = (code: string) => screen.getByText(code).closest('tr') as HTMLElement;
const buttonsIn = (row: HTMLElement) => ({
  edit: within(row).queryByLabelText('edit'),
  convert: within(row).queryByLabelText('rocket'),
  remove: within(row).queryByLabelText('delete')
});

const lead = { id: 1, role: 'team_lead' };
const operations = { id: 2, role: 'rpa_operations' };
const developer = { id: 5, role: 'rpa_developer' };

describe('ScopingListTable', () => {
  // jsdom no implementa getComputedStyle con pseudo-elementos (antd lo usa para medir la barra de scroll) y avisa por consola
  const realGetComputedStyle = window.getComputedStyle;
  beforeAll(() => {
    window.getComputedStyle = ((element: Element) => realGetComputedStyle(element)) as typeof window.getComputedStyle;
  });
  afterAll(() => {
    window.getComputedStyle = realGetComputedStyle;
  });

  describe('margen por rol (I10)', () => {
    it('team_lead ve el margen proyectado de cada cotización', () => {
      renderTable([makeRecord({ projected_margin_pct: 50 })], { currentUser: lead });

      expect(screen.getByText('Margen ~50%')).toBeInTheDocument();
    });

    it('un rpa_developer no ve el margen ni deja un "Margen ~%" vacío, aunque el dato llegue', () => {
      renderTable([makeRecord({ projected_margin_pct: 50, project_internal_cost: 4248000 })], { currentUser: developer });

      expect(screen.queryByText(/Margen/)).not.toBeInTheDocument();
      expect(screen.queryByText(/50%/)).not.toBeInTheDocument();
      // El precio de venta sí es público (en la fila y en el total)
      expect(within(rowOf('COT-2026-007')).getByText('CLP 8.496.000')).toBeInTheDocument();
    });

    it('sin sesión tampoco se muestra', () => {
      renderTable([makeRecord({ projected_margin_pct: 50 })]);

      expect(screen.queryByText(/Margen/)).not.toBeInTheDocument();
    });

    it('team_lead no ve "Margen ~%" si la API no trae el margen', () => {
      renderTable([makeRecord({ projected_margin_pct: undefined })], { currentUser: lead });

      expect(screen.queryByText(/Margen/)).not.toBeInTheDocument();
    });
  });

  describe('convertir en proyecto (I10 / I6)', () => {
    it('solo aparece para team_lead y rpa_operations', () => {
      const items = [makeRecord()];
      const view = renderTable(items, { currentUser: lead });
      expect(buttonsIn(rowOf('COT-2026-007')).convert).not.toBeNull();
      view.unmount();

      const ops = renderTable(items, { currentUser: operations });
      expect(buttonsIn(rowOf('COT-2026-007')).convert).not.toBeNull();
      ops.unmount();

      for (const role of ['rpa_developer', 'it_support', 'billing']) {
        const other = renderTable(items, { currentUser: { id: 5, role } });
        expect(buttonsIn(rowOf('COT-2026-007')).convert, `rol ${role}`).toBeNull();
        other.unmount();
      }
    });

    it('queda deshabilitado si el proceso no es viable (el backend respondería 409)', () => {
      renderTable(
        [
          makeRecord({ id: 1, code: 'COT-2026-001', viability_status: 'viable' }),
          makeRecord({ id: 2, code: 'COT-2026-002', viability_status: 'not_viable' }),
          makeRecord({ id: 3, code: 'COT-2026-003', viability_status: 'digitize_first' })
        ],
        { currentUser: lead }
      );

      expect(buttonsIn(rowOf('COT-2026-001')).convert?.closest('button')).toBeEnabled();
      expect(buttonsIn(rowOf('COT-2026-002')).convert?.closest('button')).toBeDisabled();
      expect(buttonsIn(rowOf('COT-2026-003')).convert?.closest('button')).toBeDisabled();
    });

    it('una cotización ya convertida no ofrece convertir, editar ni borrar', () => {
      renderTable([makeRecord({ status: 'converted_to_project', converted_project_id: 12 })], { currentUser: lead });

      const row = rowOf('COT-2026-007');
      expect(within(row).queryByLabelText('edit')).toBeNull();
      expect(within(row).queryByLabelText('delete')).toBeNull();
      // Solo queda el cohete de la etiqueta de estado, no un botón
      expect(within(row).queryAllByLabelText('rocket').filter((icon) => icon.closest('button'))).toHaveLength(0);
    });
  });

  describe('borrar y editar (I10 / M9)', () => {
    it('el autor puede borrar y editar su borrador', () => {
      renderTable([makeRecord({ created_by: 5, status: 'draft' })], { currentUser: developer });

      const { remove, edit } = buttonsIn(rowOf('COT-2026-007'));
      expect(remove).not.toBeNull();
      expect(edit).not.toBeNull();
    });

    it('un rpa_developer no puede borrar ni editar la cotización de otro usuario', () => {
      renderTable([makeRecord({ created_by: 9, status: 'draft' })], { currentUser: developer });

      const { remove, edit } = buttonsIn(rowOf('COT-2026-007'));
      expect(remove).toBeNull();
      expect(edit).toBeNull();
    });

    it('team_lead puede borrar y editar el borrador de cualquiera', () => {
      renderTable([makeRecord({ created_by: 9, status: 'draft' })], { currentUser: lead });

      const { remove, edit } = buttonsIn(rowOf('COT-2026-007'));
      expect(remove).not.toBeNull();
      expect(edit).not.toBeNull();
    });

    it('solo se borran borradores: una cotización enviada no ofrece borrar, ni siquiera a su autor o a team_lead', () => {
      renderTable([makeRecord({ created_by: 5, status: 'sent_to_client' })], { currentUser: developer });
      expect(buttonsIn(rowOf('COT-2026-007')).remove).toBeNull();
      // Editarla sigue permitido
      expect(buttonsIn(rowOf('COT-2026-007')).edit).not.toBeNull();
    });

    it('team_lead tampoco borra una aprobada', () => {
      renderTable([makeRecord({ created_by: 9, status: 'approved' })], { currentUser: lead });
      expect(buttonsIn(rowOf('COT-2026-007')).remove).toBeNull();
    });

    it('ver la propuesta está disponible para todos los roles', () => {
      renderTable([makeRecord({ created_by: 9 })], { currentUser: developer });
      expect(within(rowOf('COT-2026-007')).getByLabelText('eye')).toBeInTheDocument();
    });
  });

  describe('indicadores (M2)', () => {
    const mixed = [
      makeRecord({ id: 1, code: 'COT-2026-001', currency: 'CLP', proposed_price: 8496000 }),
      makeRecord({ id: 2, code: 'COT-2026-002', currency: 'CLP', proposed_price: 16992000 }),
      makeRecord({ id: 3, code: 'COT-2026-003', currency: 'USD', proposed_price: 4000 })
    ];

    it('el monto propuesto no mezcla monedas: se muestra un total por moneda', () => {
      renderTable(mixed, { currentUser: lead });

      const card = screen.getByText('Monto Total Propuesto').closest('.ant-card') as HTMLElement;
      expect(within(card).getByText('CLP 25.488.000')).toBeInTheDocument();
      expect(within(card).getByText('USD 4.000')).toBeInTheDocument();
      // La suma ciega de pesos y dólares (25.492.000) nunca debe aparecer
      expect(screen.queryByText(/25\.492\.000/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^\$ /)).not.toBeInTheDocument();
    });

    it('con una sola moneda muestra un único total con su código', () => {
      renderTable(mixed.slice(0, 2), { currentUser: lead });

      const card = screen.getByText('Monto Total Propuesto').closest('.ant-card') as HTMLElement;
      expect(within(card).getByText('CLP 25.488.000')).toBeInTheDocument();
      expect(within(card).queryByText(/USD/)).not.toBeInTheDocument();
    });

    it('sin resultados el porcentaje de viabilidad y el monto no se muestran como 0', () => {
      renderTable([], { currentUser: lead });

      const viability = screen.getByText('Tasa de Viabilidad RPA').closest('.ant-card') as HTMLElement;
      expect(within(viability).queryByText(/0\s*%/)).not.toBeInTheDocument();
      expect(within(viability).getByText('—')).toBeInTheDocument();

      const amount = screen.getByText('Monto Total Propuesto').closest('.ant-card') as HTMLElement;
      expect(within(amount).getByText('—')).toBeInTheDocument();
      expect(within(amount).queryByText(/\$ 0/)).not.toBeInTheDocument();
    });

    it('con resultados muestra el porcentaje real', () => {
      renderTable(mixed, { currentUser: lead });

      const viability = screen.getByText('Tasa de Viabilidad RPA').closest('.ant-card') as HTMLElement;
      expect(within(viability).getByText('100%')).toBeInTheDocument();
    });

    it('un 0% real (hay cotizaciones pero ninguna viable) sí se muestra', () => {
      renderTable([makeRecord({ viability_status: 'not_viable' })], { currentUser: lead });

      const viability = screen.getByText('Tasa de Viabilidad RPA').closest('.ant-card') as HTMLElement;
      expect(within(viability).getByText('0%')).toBeInTheDocument();
    });

    it('las horas cotizadas usan punto de miles', () => {
      renderTable([makeRecord({ total_hours: 1234 }), makeRecord({ id: 8, code: 'COT-2026-008', total_hours: 1000 })], { currentUser: lead });

      const hours = screen.getByText('Total Horas Cotizadas').closest('.ant-card') as HTMLElement;
      expect(within(hours).getByText('2.234')).toBeInTheDocument();
    });
  });
});
