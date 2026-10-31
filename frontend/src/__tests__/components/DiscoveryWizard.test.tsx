import { render, screen } from '@testing-library/react';
import { Form } from 'antd';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

import { DiscoveryWizard } from '@/components/scoping/DiscoveryWizard';
import { DEFAULT_INPUTS } from '@/utils/scopingInputs';

function Wizard() {
  const [form] = Form.useForm();
  return (
    <Form form={form} initialValues={DEFAULT_INPUTS}>
      <DiscoveryWizard
        form={form}
        inputs={DEFAULT_INPUTS}
        onValuesChange={vi.fn()}
        customHoursEnabled={false}
        onCustomHoursToggle={vi.fn()}
      />
    </Form>
  );
}

describe('DiscoveryWizard', () => {
  // jsdom no implementa getComputedStyle con pseudo-elementos (antd lo usa para medir la barra de scroll) y avisa por consola
  const realGetComputedStyle = window.getComputedStyle;
  beforeAll(() => {
    window.getComputedStyle = ((element: Element) => realGetComputedStyle(element)) as typeof window.getComputedStyle;
  });
  afterAll(() => {
    window.getComputedStyle = realGetComputedStyle;
  });

  it('las cuatro pestañas llevan etiquetas cortas para que no se escondan en el menú "…" (I9)', () => {
    render(<Wizard />);

    const labels = ['1 Factibilidad', '2 Sistemas', '3 Volumetría', '4 Propuesta'];
    for (const label of labels) {
      const tab = screen.getByText(label).closest('[role="tab"]');
      expect(tab, label).not.toBeNull();
    }
    expect(document.querySelectorAll('.ant-tabs-tab:not(.ant-tabs-tab-with-remove)')).toHaveLength(4);
    // La etiqueta larga anterior ("Paso 1: Factibilidad & Gate 0 (Min 1-4)") hacía que el menú "…" se tragara los pasos 3 y 4
    expect(Math.max(...labels.map((label) => label.length))).toBeLessThanOrEqual(16);
    expect(screen.queryByText(/Paso \d:/)).not.toBeInTheDocument();
  });

  it('la información de minutos del protocolo queda disponible como ayuda de cada pestaña', () => {
    render(<Wizard />);

    expect(screen.getByText('1 Factibilidad').closest('span[title]')).toHaveAttribute('title', expect.stringContaining('Minutos 1-4'));
    expect(screen.getByText('4 Propuesta').closest('span[title]')).toHaveAttribute('title', expect.stringContaining('Minutos 13-15'));
  });

  it('VDI y OCR se describen como aumento de la dificultad, no como "+60% / +20% de horas" (I1)', () => {
    render(<Wizard />);

    expect(screen.getByText(/Eleva el puntaje de dificultad \(x1,6\)/)).toBeInTheDocument();
    expect(screen.getByText(/Eleva el puntaje de dificultad \(x1,2\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/puede subir el nivel de esfuerzo/)).toHaveLength(2);
    expect(screen.queryByText(/en un 60%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/en un 20%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Aumenta el esfuerzo/)).not.toBeInTheDocument();
  });
});
