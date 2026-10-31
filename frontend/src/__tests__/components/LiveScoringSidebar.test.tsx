import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { LiveScoringSidebar } from '@/components/scoping/LiveScoringSidebar';
import type { ScopingCalculationResult } from '@/types/scoping';
import { makeCalculation } from '../fixtures/scoping';

function renderSidebar(
  calculation: Partial<ScopingCalculationResult> = {},
  props: Partial<React.ComponentProps<typeof LiveScoringSidebar>> = {}
) {
  return render(
    <LiveScoringSidebar
      calculation={makeCalculation(calculation)}
      onOpenProposal={vi.fn()}
      onSaveQuote={vi.fn()}
      {...props}
    />
  );
}

// OCR y VDI juntos multiplican la dificultad base 0,20 por 1,6 x 1,2 = 1,92
const withBothFactors: Partial<ScopingCalculationResult> = {
  vdi_multiplier: 1.6,
  ocr_multiplier: 1.2,
  complexity_score: 0.2,
  difficulty_score: 0.384,
  effort_level: 'medium',
  effort_label: 'Mediano Esfuerzo'
};

describe('LiveScoringSidebar', () => {
  describe('factores multiplicadores (I1)', () => {
    it('describe VDI y OCR como aumento del puntaje de dificultad, no como "+60% / +20% de esfuerzo"', () => {
      renderSidebar(withBothFactors);

      expect(screen.getByText('Factores Multiplicadores Detectados:')).toBeInTheDocument();
      expect(screen.getByText(/VDI \/ Citrix: sube la dificultad \(x1,6\)/)).toBeInTheDocument();
      expect(screen.getByText(/OCR \/ Escaneados: sube la dificultad \(x1,2\)/)).toBeInTheDocument();
      expect(screen.queryByText(/\+60%/)).not.toBeInTheDocument();
      expect(screen.queryByText(/\+20%/)).not.toBeInTheDocument();
      expect(screen.queryByText(/% esfuerzo/)).not.toBeInTheDocument();
    });

    it('explica el efecto real: cuánto subió el puntaje y en qué nivel de esfuerzo quedó', () => {
      renderSidebar(withBothFactors);

      expect(screen.getByText(/Puntaje de dificultad: de 0,20 a 0,38/)).toBeInTheDocument();
      expect(screen.getByText(/Nivel de esfuerzo resultante: Mediano Esfuerzo/)).toBeInTheDocument();
    });

    it('solo aparece si el factor realmente cambió el puntaje: con los interruptores apagados no hay bloque', () => {
      renderSidebar({ vdi_multiplier: 1, ocr_multiplier: 1, complexity_score: 0.2, difficulty_score: 0.2 });

      expect(screen.queryByText(/Factores Multiplicadores Detectados/)).not.toBeInTheDocument();
    });

    it('no aparece si el puntaje no se movió (ya estaba en el tope de dificultad)', () => {
      renderSidebar({ vdi_multiplier: 1.6, ocr_multiplier: 1, complexity_score: 1, difficulty_score: 1 });

      expect(screen.queryByText(/Factores Multiplicadores Detectados/)).not.toBeInTheDocument();
      expect(screen.queryByText(/VDI \/ Citrix/)).not.toBeInTheDocument();
    });

    it('muestra solo el factor que está activo', () => {
      renderSidebar({ vdi_multiplier: 1, ocr_multiplier: 1.2, complexity_score: 0.2, difficulty_score: 0.24 });

      expect(screen.getByText(/OCR \/ Escaneados: sube la dificultad \(x1,2\)/)).toBeInTheDocument();
      expect(screen.queryByText(/VDI \/ Citrix/)).not.toBeInTheDocument();
    });
  });

  describe('retorno (M1)', () => {
    it('con ahorro anual cero el payback es "Sin retorno" y no "Inmediato"', () => {
      renderSidebar({ client_annual_savings: 0, hours_saved_annual: 0, payback_months: 0 });

      expect(screen.getByText('Sin retorno')).toBeInTheDocument();
      expect(screen.queryByText('Inmediato')).not.toBeInTheDocument();
    });

    it('con ahorro muestra los meses de recuperación con coma decimal', () => {
      renderSidebar({ payback_months: 1.8 });

      expect(screen.getByText('1,8 meses')).toBeInTheDocument();
    });
  });

  describe('costos internos por rol (I10)', () => {
    it('team_lead ve el margen estimado', () => {
      renderSidebar({ projected_margin_pct: 50 }, { showInternalCosts: true });

      expect(screen.getByText('Margen estimado:')).toBeInTheDocument();
      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('otro rol no ve el margen aunque el dato llegue en la respuesta', () => {
      renderSidebar({ projected_margin_pct: 50, project_internal_cost: 4248000 }, { showInternalCosts: false });

      expect(screen.queryByText('Margen estimado:')).not.toBeInTheDocument();
      expect(screen.queryByText(/margen/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/costo interno/i)).not.toBeInTheDocument();
      expect(screen.queryByText('50%')).not.toBeInTheDocument();
      // Lo que ve el cliente sigue visible para todos
      expect(screen.getByText('CLP 8.496.000')).toBeInTheDocument();
    });

    it('por defecto (sin indicar el rol) no muestra costos internos', () => {
      renderSidebar({ projected_margin_pct: 50 });

      expect(screen.queryByText('Margen estimado:')).not.toBeInTheDocument();
    });

    it('team_lead tampoco ve una fila vacía si la API no trae el margen', () => {
      renderSidebar({ projected_margin_pct: undefined }, { showInternalCosts: true });

      expect(screen.queryByText('Margen estimado:')).not.toBeInTheDocument();
    });
  });

  it('los montos y horas usan punto de miles y coma decimal', () => {
    renderSidebar({ hours_saved_annual: 3952, client_annual_savings: 55328000, proposed_price: 8496000 });

    expect(screen.getByText('CLP 8.496.000')).toBeInTheDocument();
    expect(screen.getByText('CLP 55.328.000')).toBeInTheDocument();
    expect(screen.getByText('3.952 h/año')).toBeInTheDocument();
  });
});
