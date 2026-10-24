import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

import { TechnicalEconomicProposalModal } from '@/components/scoping/TechnicalEconomicProposalModal';
import type { ScopingCalculationResult, ScopingInputs } from '@/types/scoping';
import { makeCalculation, makeInputs } from '../fixtures/scoping';

type Overrides = Omit<React.ComponentProps<typeof TechnicalEconomicProposalModal>, 'inputs' | 'calculation'> & {
  inputs?: Partial<ScopingInputs>;
  calculation?: Partial<ScopingCalculationResult>;
};

const baseProps = { visible: true, onClose: () => undefined, quoteCode: 'COT-2026-007', quoteDate: '2026-10-20T12:00:00Z' };

function renderModal(overrides: Partial<Overrides> = {}) {
  const build = (current: Partial<Overrides>) => {
    const { inputs, calculation, ...rest } = current;
    return (
      <TechnicalEconomicProposalModal
        {...baseProps}
        {...rest}
        inputs={makeInputs(inputs)}
        calculation={makeCalculation(calculation)}
      />
    );
  };
  const view = render(build(overrides));
  // Vuelve a dibujar con los cambios sobre lo anterior (para comparar varios casos en una misma prueba)
  let state = overrides;
  return {
    ...view,
    rerenderWith: (extra: Partial<Overrides>) => {
      state = { ...state, ...extra };
      view.rerender(build(state));
    }
  };
}

const notViable = (status: ScopingCalculationResult['viability_status'], label: string): Partial<ScopingCalculationResult> => ({
  viability_status: status,
  viability_label: label,
  is_viable: false,
  blockers: ['Los datos de entrada no permiten automatizar el proceso hoy.']
});

describe('TechnicalEconomicProposalModal', () => {
  // jsdom no implementa getComputedStyle con pseudo-elementos (antd lo usa para medir la barra de scroll) y avisa por consola
  const realGetComputedStyle = window.getComputedStyle;
  beforeAll(() => {
    window.getComputedStyle = ((element: Element) => realGetComputedStyle(element)) as typeof window.getComputedStyle;
  });
  afterAll(() => {
    window.getComputedStyle = realGetComputedStyle;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.classList.remove('proposal-printing');
  });

  describe('proceso no viable (I6)', () => {
    it('muestra la leyenda en tono de error, oculta precio y ROI y deshabilita "Convertir en Proyecto"', () => {
      renderModal({
        calculation: notViable('not_viable', 'No se puede automatizar con RPA'),
        onConvertToProject: vi.fn()
      });

      const legend = screen.getByText('NO SE PUEDE AUTOMATIZAR CON RPA');
      expect(legend.closest('.ant-alert')).toHaveClass('ant-alert-error');
      expect(screen.getByText('Los datos de entrada no permiten automatizar el proceso hoy.')).toBeInTheDocument();

      // Ni oferta económica ni retorno: no hay nada que vender
      expect(screen.queryByText('VALOR TOTAL DEL PROYECTO')).not.toBeInTheDocument();
      expect(screen.queryByText('RETORNO ESTIMADO PARA EL CLIENTE')).not.toBeInTheDocument();
      expect(screen.queryByText(/CLP 8\.496\.000/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Payback/)).not.toBeInTheDocument();

      expect(screen.getByText(/Convertir en Proyecto/).closest('button')).toBeDisabled();
    });

    it('"Digitalizar primero" y "Posponer" usan tono de advertencia y también bloquean la conversión', () => {
      const { rerenderWith } = renderModal({
        calculation: notViable('digitize_first', 'Digitalizar Primero'),
        onConvertToProject: vi.fn()
      });
      expect(screen.getByText('DIGITALIZAR PRIMERO').closest('.ant-alert')).toHaveClass('ant-alert-warning');
      expect(screen.queryByText('VALOR TOTAL DEL PROYECTO')).not.toBeInTheDocument();
      expect(screen.getByText(/Convertir en Proyecto/).closest('button')).toBeDisabled();

      rerenderWith({ calculation: notViable('postpone', 'Posponer Proyecto') });
      expect(screen.getByText('POSPONER PROYECTO').closest('.ant-alert')).toHaveClass('ant-alert-warning');
      expect(screen.getByText(/Convertir en Proyecto/).closest('button')).toBeDisabled();
    });

    it('"Baja viabilidad" usa tono de error', () => {
      renderModal({ calculation: notViable('low_viability', 'Baja Viabilidad por Alta Subjetividad') });
      expect(screen.getByText('BAJA VIABILIDAD POR ALTA SUBJETIVIDAD').closest('.ant-alert')).toHaveClass('ant-alert-error');
    });

    it('un proceso viable conserva su oferta, su retorno y el botón activo', () => {
      const onConvert = vi.fn();
      renderModal({ onConvertToProject: onConvert });

      expect(screen.getByText('FACTIBLE PARA AUTOMATIZACIÓN')).toBeInTheDocument();
      expect(document.querySelector('.ant-alert-error, .ant-alert-warning')).toBeNull();
      expect(screen.getByText('VALOR TOTAL DEL PROYECTO')).toBeInTheDocument();
      expect(screen.getByText('RETORNO ESTIMADO PARA EL CLIENTE')).toBeInTheDocument();
      expect(screen.getByText('CLP 8.496.000')).toBeInTheDocument();

      const convert = screen.getByText(/Convertir en Proyecto/).closest('button') as HTMLElement;
      expect(convert).toBeEnabled();
      fireEvent.click(convert);
      expect(onConvert).toHaveBeenCalledTimes(1);
    });

    it('sin onConvertToProject (rol sin permiso) no ofrece convertir', () => {
      renderModal();
      expect(screen.queryByText(/Convertir en Proyecto/)).not.toBeInTheDocument();
      expect(screen.getByText('Cerrar')).toBeInTheDocument();
    });
  });

  describe('datos reales y legibles (I7)', () => {
    it('muestra el código y la fecha del levantamiento, no el borrador ni la fecha de hoy', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2027-03-05T12:00:00Z'));

      renderModal({ quoteCode: 'COT-2026-007', quoteDate: '2026-10-20T12:00:00Z' });

      expect(screen.getByText('COT-2026-007')).toBeInTheDocument();
      expect(screen.getByText(/Fecha: 20-10-2026/)).toBeInTheDocument();
      expect(screen.queryByText(/05-03-2027/)).not.toBeInTheDocument();
      expect(screen.queryByText(/COT-2026-NUEVA/)).not.toBeInTheDocument();
    });

    it('un levantamiento aún sin guardar se rotula como borrador, con la fecha de hoy', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2027-03-05T12:00:00Z'));

      renderModal({ quoteCode: undefined, quoteDate: undefined });

      expect(screen.getByText('Borrador sin guardar')).toBeInTheDocument();
      expect(screen.getByText(/Fecha: 05-03-2027/)).toBeInTheDocument();
      expect(screen.queryByText(/COT-2026/)).not.toBeInTheDocument();
    });

    it('la entrada de datos no digital ya no se rotula "Digital Mixta"', () => {
      const { rerenderWith } = renderModal({ inputs: { data_input_type: 'non_digital_structured' } });
      expect(screen.getByText(/^No digital/)).toBeInTheDocument();
      expect(screen.queryByText(/Digital mixta/i)).not.toBeInTheDocument();

      rerenderWith({ inputs: { data_input_type: 'digital_unstructured' } });
      expect(screen.getByText(/^Digital mixta/)).toBeInTheDocument();

      rerenderWith({ inputs: { data_input_type: 'digital_structured' } });
      expect(screen.getByText('Digital estructurada')).toBeInTheDocument();
    });

    it('muestra "2-3 aplicaciones" y la frecuencia en español, sin identificadores internos', () => {
      renderModal({ inputs: { applications_count: '2_3_apps', applications_detail: undefined, frequency: 'daily' } });

      expect(screen.getByText('2-3 aplicaciones')).toBeInTheDocument();
      expect(screen.getByText(/Diaria \(80 transacciones/)).toBeInTheDocument();
      expect(screen.queryByText(/3_apps/)).not.toBeInTheDocument();
      expect(screen.queryByText(/DAILY/)).not.toBeInTheDocument();
    });

    it('con el detalle de sistemas escrito, lo muestra junto con la cantidad', () => {
      renderModal({ inputs: { applications_detail: 'Outlook, SAP', applications_count: '2_3_apps' } });
      expect(screen.getByText('Outlook, SAP (2-3 aplicaciones)')).toBeInTheDocument();
    });

    it('el perfil requerido se mide en FTE, no en FTE-mes', () => {
      renderModal();
      expect(screen.getByText('0,9 FTE')).toBeInTheDocument();
      expect(screen.queryByText(/FTE-mes/)).not.toBeInTheDocument();
    });

    it('los números usan punto de miles y coma decimal', () => {
      renderModal({ calculation: { annual_manual_hours: 4160, hours_saved_annual: 3952 } });
      expect(screen.getByText('4.160 h/año')).toBeInTheDocument();
      expect(screen.getByText('3.952 h')).toBeInTheDocument();
    });
  });

  describe('retorno (M1)', () => {
    it('con ahorro anual cero el payback es "Sin retorno" y no "Inmediato"', () => {
      renderModal({ calculation: { client_annual_savings: 0, hours_saved_annual: 0, payback_months: 0 } });
      expect(screen.getByText('Sin retorno')).toBeInTheDocument();
      expect(screen.queryByText('Inmediato')).not.toBeInTheDocument();
    });

    it('con ahorro muestra los meses de recuperación', () => {
      renderModal({ calculation: { payback_months: 4.5 } });
      expect(screen.getByText('4,5 meses')).toBeInTheDocument();
    });
  });

  describe('costos internos (I10)', () => {
    it('la propuesta es un documento para el cliente: nunca muestra costo interno ni margen, ni siquiera si el dato llega', () => {
      renderModal({ calculation: { project_internal_cost: 4248000, projected_margin_pct: 50 } });

      expect(screen.queryByText(/margen/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/costo interno/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/4\.248\.000/)).not.toBeInTheDocument();
      expect(screen.queryByText(/50%/)).not.toBeInTheDocument();
    });
  });

  describe('impresión (I11)', () => {
    it('marca como área imprimible solo la propuesta: membrete, secciones y supuestos, sin los botones del modal', () => {
      renderModal();

      const area = document.querySelector('.proposal-print-area') as HTMLElement;
      expect(area).not.toBeNull();
      expect(area).toHaveTextContent('Propuesta Técnico - Económica de Automatización');
      expect(area).toHaveTextContent('1. Diagnóstico de Viabilidad y Alcance');
      expect(area).toHaveTextContent('3. Oferta Económica y Análisis de Retorno (ROI)');
      expect(area).toHaveTextContent('4. Supuestos, Requisitos y Exclusiones');
      expect(document.querySelectorAll('.proposal-print-area')).toHaveLength(1);

      expect(area.contains(screen.getByText('Imprimir / Exportar PDF'))).toBe(false);
      expect(area.contains(screen.getByText('Cerrar'))).toBe(false);
    });

    it('Imprimir activa el modo de impresión de la propuesta antes de abrir el diálogo y lo apaga al terminar (afterprint)', () => {
      let classDuringPrint: boolean | null = null;
      const print = vi.spyOn(window, 'print').mockImplementation(() => {
        classDuringPrint = document.body.classList.contains('proposal-printing');
      });
      renderModal();

      fireEvent.click(screen.getByText('Imprimir / Exportar PDF'));

      expect(print).toHaveBeenCalledTimes(1);
      expect(classDuringPrint).toBe(true);
      // Algunos navegadores devuelven de print() antes de dibujar la hoja: el modo sigue activo hasta afterprint
      expect(document.body.classList.contains('proposal-printing')).toBe(true);

      act(() => {
        window.dispatchEvent(new Event('afterprint'));
      });
      expect(document.body.classList.contains('proposal-printing')).toBe(false);
    });

    it('Ctrl+P con la propuesta abierta también imprime solo la propuesta (eventos beforeprint / afterprint)', () => {
      renderModal();
      expect(document.body.classList.contains('proposal-printing')).toBe(false);

      act(() => {
        window.dispatchEvent(new Event('beforeprint'));
      });
      expect(document.body.classList.contains('proposal-printing')).toBe(true);

      act(() => {
        window.dispatchEvent(new Event('afterprint'));
      });
      expect(document.body.classList.contains('proposal-printing')).toBe(false);
    });

    it('con la propuesta cerrada, imprimir la página no se altera', () => {
      renderModal({ visible: false });

      act(() => {
        window.dispatchEvent(new Event('beforeprint'));
      });
      expect(document.body.classList.contains('proposal-printing')).toBe(false);
    });

    it('al desmontar la propuesta deja de escuchar y limpia el modo de impresión', () => {
      const { unmount } = renderModal();
      act(() => {
        window.dispatchEvent(new Event('beforeprint'));
      });
      expect(document.body.classList.contains('proposal-printing')).toBe(true);

      unmount();
      expect(document.body.classList.contains('proposal-printing')).toBe(false);

      act(() => {
        window.dispatchEvent(new Event('beforeprint'));
      });
      expect(document.body.classList.contains('proposal-printing')).toBe(false);
    });

    describe('hoja de estilos de impresión', () => {
      const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

      // Contenido de cada bloque `@media print { ... }` (con llaves anidadas)
      const printBlocks = (source: string): string[] => {
        const blocks: string[] = [];
        let index = source.indexOf('@media print');
        while (index !== -1) {
          const open = source.indexOf('{', index);
          let depth = 1;
          let cursor = open + 1;
          while (depth > 0 && cursor < source.length) {
            if (source[cursor] === '{') depth += 1;
            if (source[cursor] === '}') depth -= 1;
            cursor += 1;
          }
          blocks.push(source.slice(open + 1, cursor - 1));
          index = source.indexOf('@media print', cursor);
        }
        return blocks;
      };
      const proposalPrint = printBlocks(css).filter((block) => block.includes('.proposal-print-area')).join('\n');

      it('tiene reglas @media print que se activan solo en modo impresión de la propuesta', () => {
        expect(proposalPrint).not.toBe('');
        expect(proposalPrint).toContain('body.proposal-printing');
      });

      it('oculta todo salvo la propuesta: la aplicación, el fondo gris, el marco y los botones del modal', () => {
        expect(proposalPrint).toMatch(/#root[^{}]*\{[^}]*display:\s*none/);
        expect(proposalPrint).toMatch(/\.ant-modal-mask[^{}]*\{[^}]*display:\s*none/);
        expect(proposalPrint).toMatch(/\.ant-modal-footer[^{}]*\{[^}]*display:\s*none/);
        expect(proposalPrint).toMatch(/\.ant-modal-close[^{}]*\{[^}]*display:\s*none/);
      });

      it('imprime sobre hoja blanca con texto oscuro aunque la aplicación esté en modo Noche (fondo oscuro + texto claro dejaría la propuesta ilegible)', () => {
        expect(proposalPrint).toMatch(/html:has\(body\.proposal-printing\)[^{}]*\{[^}]*color-scheme:\s*light\s*!important/);
        expect(proposalPrint).toMatch(/html:has\(body\.proposal-printing\)[^{}]*\{[^}]*background:\s*Canvas/);
        expect(proposalPrint).toMatch(/data-theme="dark"\][^{}]*\{[^}]*color:\s*CanvasText/);
      });

      it('suelta el recorte del modal (ancho completo, sin posición fija ni scroll interno) para que la propuesta salga entera', () => {
        expect(proposalPrint).toMatch(/\.ant-modal-wrap[^{}]*\{[^}]*position:\s*static/);
        expect(proposalPrint).toMatch(/\.ant-modal\b[^{}]*\{[^}]*width:\s*100%/);
        expect(proposalPrint).toMatch(/\.ant-modal\b[^{}]*\{[^}]*max-width:\s*none/);
        expect(proposalPrint).toMatch(/\.ant-modal-wrap[^{}]*\{[^}]*overflow:\s*visible/);
        // El cuerpo del modal tiene un alto máximo con scroll interno (`.ant-modal-body`, ~70vh): sin soltarlo la hoja sale cortada
        expect(css).toMatch(/\.ant-modal-body\s*\{[^}]*max-height:[^}]*overflow:\s*auto/);
        expect(proposalPrint).toMatch(/\.ant-modal-body[^{}]*\{[^}]*max-height:\s*none/);
        expect(proposalPrint).toMatch(/\.ant-modal-body[^{}]*\{[^}]*overflow:\s*visible/);
      });
    });
  });
});
