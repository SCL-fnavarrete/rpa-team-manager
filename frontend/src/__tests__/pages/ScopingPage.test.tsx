import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { message } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

vi.mock('@/services/scopingService', () => ({
  scopingService: {
    getArchetypes: vi.fn(),
    calculate: vi.fn(),
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    convertToProject: vi.fn()
  }
}));

// Rol y usuario de la sesión: cada prueba puede cambiarlos (por defecto team_lead, que ve todo)
const authState = vi.hoisted(() => ({ user: { id: 1, role: 'team_lead' } as { id: number; role: string } | null }));
vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ user: authState.user })
}));

import { scopingService } from '@/services/scopingService';
import { ScopingPage } from '@/pages/scoping/ScopingPage';
import type { RPAArchetype, ScopingCalculationResult, ScopingInputs, ScopingQuotationRecord } from '@/types/scoping';

// La máquina de CI/desarrollo es lenta con antd + jsdom: cada tecla re-renderiza todo el asistente
vi.setConfig({ testTimeout: 60_000 });

const REFERENCE_HINT = 'Solo referencia, no afecta el cálculo';

// Plantillas con los valores reales del backend (constants/rpaArchetypes.ts) que importan para la prueba
const archetypes: RPAArchetype[] = [
  {
    id: 'contabilizacion_facturas',
    name: 'Contabilización de Facturas de Proveedores (DTE / FCR)',
    category: 'Finanzas',
    description: 'Facturas',
    typical_systems: 'Portal SII, ERP',
    typical_frequency: 'Diario',
    typical_benefits: 'Ahorro',
    recommended_questions: ['¿Las facturas llegan en XML?'],
    default_inputs: {
      data_input_type: 'digital_structured',
      rule_based_level: 'rules_mostly',
      process_stability: 'very_small',
      application_stability: 'no_change',
      frequency: 'daily',
      volume_per_frequency: 250,
      aht_minutes: 9,
      current_ftes: 3,
      error_rate_pct: 5,
      peak_period: 'regular_peak',
      process_steps_count: 'gt_40',
      decision_complexity: 'simple_yes_no',
      applications_count: '4_5_apps',
      uses_vdi: false,
      requires_ocr: true,
      structured_data_pct: '60_80',
      exception_rate_pct: 4
    }
  },
  {
    id: 'recepcion_ordenes_compra',
    name: 'Recepción y Procesamiento de Órdenes de Compra de Clientes',
    category: 'Ventas',
    description: 'OC',
    typical_systems: 'Outlook, ERP',
    typical_frequency: 'Diario',
    typical_benefits: 'Ahorro',
    recommended_questions: ['¿Las OC vienen en PDF?'],
    default_inputs: {
      data_input_type: 'digital_unstructured',
      rule_based_level: 'rules_mostly',
      process_stability: 'no_change',
      application_stability: 'no_change',
      frequency: 'daily',
      volume_per_frequency: 80,
      aht_minutes: 12,
      current_ftes: 2,
      error_rate_pct: 4,
      peak_period: 'rare_predictable',
      process_steps_count: '25_40',
      decision_complexity: 'simple_yes_no',
      applications_count: '2_3_apps',
      uses_vdi: false,
      requires_ocr: true,
      structured_data_pct: '60_80',
      exception_rate_pct: 6
    }
  }
];

const FACTURAS = 'Contabilización de Facturas de Proveedores (DTE / FCR) (Finanzas)';
const RECEPCION_OC = 'Recepción y Procesamiento de Órdenes de Compra de Clientes (Ventas)';

// Un cálculo cuyo resultado depende de las entradas recibidas: con OCR/VDI sube a 492 HH (como el motor real)
const makeCalculation = (inputs: Partial<ScopingInputs> = {}, overrides: Partial<ScopingCalculationResult> = {}): ScopingCalculationResult => {
  const heavy = Boolean(inputs.requires_ocr || inputs.uses_vdi);
  const currency = inputs.currency ?? 'CLP';
  const rate = inputs.target_hourly_rate ?? 36000;
  const total = heavy ? 492 : 236;
  return {
    viability_status: 'viable',
    viability_label: 'Factible para Automatización',
    viability_score: 90,
    is_viable: true,
    blockers: [],
    recommendations: [],
    complexity_score: 0.3,
    difficulty_score: 0.4,
    effort_level: heavy ? 'medium' : 'low',
    effort_label: heavy ? 'Mediano Esfuerzo' : 'Bajo Esfuerzo',
    vdi_multiplier: inputs.uses_vdi ? 1.6 : 1,
    ocr_multiplier: inputs.requires_ocr ? 1.2 : 1,
    annual_runs: 260,
    annual_manual_hours: 4000,
    current_estimated_ftes: 2,
    benefit_score: 0.8,
    benefit_level: 'high',
    benefit_label: 'Alto',
    error_reduction_pct: 90,
    aht_reduction_pct: 95,
    hours_saved_annual: 3800,
    ftes_released: 1.8,
    estimated_weeks: heavy ? 8 : 5,
    hours_pm: 41,
    hours_consultant: 62,
    hours_developer: 303,
    hours_advisor: 22,
    total_hours: total,
    roles_breakdown: [
      { role_code: 'LP', role_name: 'Líder de Proyecto', fte_equivalent: 0.1, total_hours: 41, percentage: 8 },
      { role_code: 'AR', role_name: 'Desarrollador RPA', fte_equivalent: 0.9, total_hours: 303, percentage: 62 }
    ],
    phases_breakdown: [
      { phase_number: 1, name: 'Levantamiento', description: 'Detalle', start_week: 1, end_week: 2, percentage: 20, hours: 98 }
    ],
    currency,
    target_hourly_rate: rate,
    project_internal_cost: total * 18000,
    proposed_price: total * rate,
    projected_margin_pct: 50,
    client_annual_manual_cost: 56000000,
    client_annual_savings: 52000000,
    payback_months: 3,
    roi_first_year_pct: 300,
    ...overrides
  };
};

// Registro tal como lo devuelve GET /scopings/:id para una cotización con OCR, VDI y horas calibradas a mano
const makeRecord = (overrides: Partial<ScopingQuotationRecord> = {}): ScopingQuotationRecord => ({
  id: 7,
  code: 'COT-2026-007',
  client_name: 'Acme Ltda.',
  process_name: 'Recepción de OC de Acme',
  business_unit: 'Ventas',
  client_contact: 'Juana Pérez',
  process_archetype: 'recepcion_ordenes_compra',
  data_input_type: 'digital_unstructured',
  rule_based_level: 'rules_mostly',
  process_stability: 'no_change',
  application_stability: 'no_change',
  frequency: 'daily',
  volume_per_frequency: 80,
  aht_minutes: 12,
  current_ftes: 2,
  error_rate_pct: 4,
  peak_period: 'rare_predictable',
  process_steps_count: '25_40',
  decision_complexity: 'simple_yes_no',
  applications_count: '2_3_apps',
  applications_detail: 'Outlook, ERP',
  uses_vdi: true,
  requires_ocr: true,
  structured_data_pct: '60_80',
  exception_rate_pct: 6,
  currency: 'CLP',
  hourly_labor_cost: 14000,
  target_hourly_rate: 36000,
  internal_cost_rate: 18000,
  custom_hours: { lp: 60, crpa: 40, ar: 300, adv: 92, weeks: 9 },
  viability_status: 'viable',
  effort_level: 'medium',
  total_hours: 492,
  estimated_weeks: 9,
  proposed_price: 17712000,
  projected_margin_pct: 50,
  status: 'draft',
  created_at: '2026-10-20T10:00:00Z',
  updated_at: '2026-10-20T10:00:00Z',
  calculation: makeCalculation({ requires_ocr: true, uses_vdi: true }),
  ...overrides
} as ScopingQuotationRecord);

const emptyKpis = { total_scopings: 0, viable_percentage: 0, total_quoted_hours: 0, total_proposed_amount: 0 };

const mocked = {
  getArchetypes: scopingService.getArchetypes as unknown as ReturnType<typeof vi.fn>,
  calculate: scopingService.calculate as unknown as ReturnType<typeof vi.fn>,
  getAll: scopingService.getAll as unknown as ReturnType<typeof vi.fn>,
  getById: scopingService.getById as unknown as ReturnType<typeof vi.fn>,
  create: scopingService.create as unknown as ReturnType<typeof vi.fn>,
  update: scopingService.update as unknown as ReturnType<typeof vi.fn>
};

// Rendimiento: en jsdom con antd, getComputedStyle es muy lento (las consultas ByRole sin `hidden` y la
// verificación de pointer-events de user-event lo llaman por cada ancestro). Por eso se usa un user-event sin esa
// verificación y consultas por texto, etiqueta y aria-label en vez de por rol.
let user: ReturnType<typeof userEvent.setup>;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/scoping']}>
      <ScopingPage />
    </MemoryRouter>
  );
}

// Espera a que el panel en vivo tenga cálculo (aparece el botón de guardar)
const waitForPanel = () => screen.findByText('Guardar Cotización');
const clickSave = () => user.click(screen.getByText('Guardar Cotización'));

const PROPOSAL_TITLE = 'Propuesta Técnico - Económica de Automatización';
const proposalDialog = async () => (await screen.findByText(PROPOSAL_TITLE)).closest('.ant-modal-content') as HTMLElement;
const tabOf = (name: RegExp) => screen.getByText(name).closest('[role="tab"]') as HTMLElement;

const calculateCalls = (): any[] => mocked.calculate.mock.calls.map((call) => call[0]);
const lastCalculateInputs = (): any => calculateCalls().at(-1);

async function selectArchetype(label: string) {
  // antd repite el aria-label en el combobox y en su lista accesible: se abre el combobox
  const candidates = await screen.findAllByLabelText('Plantilla rápida de proceso');
  await user.click(candidates.find((el) => el.getAttribute('role') === 'combobox') as HTMLElement);
  await user.click(await screen.findByText(label));
}

const openTab = (name: RegExp) => user.click(screen.getByText(name));

async function openHistoryAndEdit(code = 'COT-2026-007') {
  await openTab(/Historial de Cotizaciones/);
  const row = (await screen.findByText(code)).closest('tr') as HTMLElement;
  await user.click(within(row).getByLabelText('edit'));
  // Editar termina volviendo al asistente con el registro ya cargado
  await waitFor(() => expect(tabOf(/Protocolo de 15 Minutos/)).toHaveAttribute('aria-selected', 'true'));
}

describe('ScopingPage', () => {
  // jsdom no implementa getComputedStyle con pseudo-elementos (antd lo usa para medir la barra de scroll) y avisa por consola
  const realGetComputedStyle = window.getComputedStyle;
  beforeAll(() => {
    window.getComputedStyle = ((element: Element) => realGetComputedStyle(element)) as typeof window.getComputedStyle;
  });
  afterAll(() => {
    window.getComputedStyle = realGetComputedStyle;
  });

  beforeEach(() => {
    user = userEvent.setup({ pointerEventsCheck: 0 });
    authState.user = { id: 1, role: 'team_lead' };
    vi.clearAllMocks();
    // Los avisos de antd se espían (no se dibujan): evita advertencias de act() y permite verificar el texto exacto
    vi.spyOn(message, 'success').mockImplementation(() => undefined as any);
    vi.spyOn(message, 'warning').mockImplementation(() => undefined as any);
    vi.spyOn(message, 'error').mockImplementation(() => undefined as any);
    mocked.getArchetypes.mockResolvedValue(archetypes);
    mocked.calculate.mockImplementation((inputs: ScopingInputs) => Promise.resolve(makeCalculation(inputs)));
    mocked.getAll.mockResolvedValue({ success: true, data: [makeRecord()], kpis: emptyKpis });
    mocked.getById.mockResolvedValue(makeRecord());
    mocked.create.mockResolvedValue(makeRecord({ id: 9, code: 'COT-2026-009' }));
    mocked.update.mockResolvedValue(makeRecord());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('guardar y calcular con las mismas entradas (C1)', () => {
    it('guardar sin visitar los pasos 2-4 envía las mismas entradas que se enviaron a calculate', async () => {
      renderPage();
      await waitForPanel();

      await selectArchetype(FACTURAS);
      await user.type(screen.getByLabelText(/Nombre del Cliente/), 'Acme');
      await clickSave();

      await waitFor(() => expect(mocked.create).toHaveBeenCalledTimes(1));
      const payload = mocked.create.mock.calls[0][0];

      // Los pasos 2-4 nunca se visitaron: el arquetipo igual debe llegar completo
      expect(payload).toEqual(expect.objectContaining({
        process_archetype: 'contabilizacion_facturas',
        requires_ocr: true,
        uses_vdi: false,
        volume_per_frequency: 250,
        aht_minutes: 9,
        client_name: 'Acme'
      }));
      // Lo guardado es exactamente lo que el panel calculó (solo cambia el campo tipeado después)
      expect(payload).toEqual({ ...lastCalculateInputs(), client_name: 'Acme' });
    });

    it('escribir en Cliente no cambia las entradas enviadas a calculate respecto del arquetipo elegido', async () => {
      renderPage();
      await waitForPanel();

      await selectArchetype(RECEPCION_OC);
      expect(await screen.findByText('492')).toBeInTheDocument();
      const callsAfterArchetype = calculateCalls().length;

      await user.type(screen.getByLabelText(/Nombre del Cliente/), 'Acme');

      // Ningún cálculo posterior al arquetipo pierde OCR, volumen ni AHT
      const afterTyping = calculateCalls().slice(callsAfterArchetype - 1);
      expect(afterTyping.length).toBeGreaterThan(0);
      for (const inputs of afterTyping) {
        expect(inputs).toEqual(expect.objectContaining({
          process_archetype: 'recepcion_ordenes_compra',
          requires_ocr: true,
          volume_per_frequency: 80,
          aht_minutes: 12
        }));
      }
      // El panel sigue mostrando el esfuerzo con OCR
      expect(screen.getByText('492')).toBeInTheDocument();
      expect(screen.queryByText('236')).not.toBeInTheDocument();
    });
  });

  describe('editar un levantamiento (C2, I8)', () => {
    it('restaura arquetipo, OCR/VDI y calibración manual (custom_hours) y no abre el modal de propuesta', async () => {
      renderPage();
      await waitForPanel();

      await openHistoryAndEdit();

      // Vuelve al asistente con todo el registro cargado
      expect(screen.getByLabelText(/Nombre del Cliente/)).toHaveValue('Acme Ltda.');
      expect(screen.getByText(RECEPCION_OC)).toBeInTheDocument();
      expect(screen.getByLabelText(/VDI/i)).toBeChecked();
      expect(screen.getByLabelText(/OCR/i)).toBeChecked();
      expect(screen.getByLabelText(/Calibración manual/i)).toBeChecked();
      expect(screen.getByLabelText('LP (Líder Proyecto)')).toHaveDisplayValue('60');
      expect(screen.getByLabelText('CRPA (Arquitecto)')).toHaveDisplayValue('40');
      expect(screen.getByLabelText('AR (Desarrollador)')).toHaveDisplayValue('300');
      expect(screen.getByLabelText('ADV (Advisor/QA)')).toHaveDisplayValue('92');
      expect(screen.getByLabelText('Semanas')).toHaveDisplayValue('9');

      // Editar no abre la propuesta
      expect(screen.queryByText(PROPOSAL_TITLE)).not.toBeInTheDocument();
      // Y el panel calcula con la calibración manual restaurada
      await waitFor(() => expect(lastCalculateInputs().custom_hours).toEqual({ lp: 60, crpa: 40, ar: 300, adv: 92, weeks: 9 }));
    });

    it('editar y guardar sin tocar nada envía arquetipo y custom_hours originales', async () => {
      renderPage();
      await waitForPanel();

      await openHistoryAndEdit();
      await waitForPanel();
      await clickSave();

      await waitFor(() => expect(mocked.update).toHaveBeenCalledTimes(1));
      expect(mocked.create).not.toHaveBeenCalled();
      const [id, payload] = mocked.update.mock.calls[0];
      expect(id).toBe(7);
      expect(payload).toEqual(expect.objectContaining({
        process_archetype: 'recepcion_ordenes_compra',
        requires_ocr: true,
        uses_vdi: true,
        volume_per_frequency: 80,
        aht_minutes: 12,
        custom_hours: { lp: 60, crpa: 40, ar: 300, adv: 92, weeks: 9 },
        currency: 'CLP',
        hourly_labor_cost: 14000,
        target_hourly_rate: 36000,
        internal_cost_rate: 18000,
        exception_rate_pct: 6,
        current_ftes: 2
      }));
    });

    it('vaciar tarifas o excepciones al editar envía el defecto de la moneda en calculate y en el PUT (el panel coincide con lo guardado)', async () => {
      mocked.getById.mockResolvedValue(makeRecord({ target_hourly_rate: 50000, hourly_labor_cost: 20000, exception_rate_pct: 8 }));
      renderPage();
      await waitForPanel();
      await openHistoryAndEdit();
      expect(screen.getByLabelText(/Tarifa Venta por Hora/)).toHaveDisplayValue('50000');

      await user.clear(screen.getByLabelText(/Tarifa Venta por Hora/));
      await user.clear(screen.getByLabelText(/Costo Hora Analista Cliente/));
      await user.clear(screen.getByLabelText(/Tasa de Excepciones/));

      // El PUT parcial conservaría el valor guardado si la clave se omitiera: va el defecto, igual que a calculate
      await waitFor(() => expect(lastCalculateInputs()).toEqual(expect.objectContaining({
        target_hourly_rate: 36000,
        hourly_labor_cost: 14000,
        exception_rate_pct: 3
      })));
      await waitForPanel();
      await clickSave();

      await waitFor(() => expect(mocked.update).toHaveBeenCalledTimes(1));
      const payload = mocked.update.mock.calls[0][1];
      expect(payload).toEqual(expect.objectContaining({
        currency: 'CLP',
        target_hourly_rate: 36000,
        hourly_labor_cost: 14000,
        exception_rate_pct: 3
      }));
      expect(payload).toEqual(lastCalculateInputs());
    });

    it('apagar la calibración manual y guardar limpia custom_hours (null, no se conserva la anterior)', async () => {
      renderPage();
      await waitForPanel();

      await openHistoryAndEdit();
      await user.click(await screen.findByLabelText(/Calibración manual/i));
      await clickSave();

      await waitFor(() => expect(mocked.update).toHaveBeenCalledTimes(1));
      expect(mocked.update.mock.calls[0][1].custom_hours).toBeNull();
      expect(lastCalculateInputs().custom_hours).toBeNull();
    });

    it('ver la propuesta desde el historial muestra el registro sin pisar el formulario en curso', async () => {
      renderPage();
      await waitForPanel();
      await user.type(screen.getByLabelText(/Nombre del Cliente/), 'Cliente en reunión');

      await openTab(/Historial de Cotizaciones/);
      const row = (await screen.findByText('COT-2026-007')).closest('tr') as HTMLElement;
      await user.click(within(row).getByLabelText('eye'));

      const dialog = await proposalDialog();
      expect(within(dialog).getByText('COT-2026-007')).toBeInTheDocument();
      expect(within(dialog).getByText('Recepción de OC de Acme')).toBeInTheDocument();

      await user.click(within(dialog).getByText('Cerrar'));
      await openTab(/Protocolo de 15 Minutos/);
      expect(screen.getByLabelText(/Nombre del Cliente/)).toHaveValue('Cliente en reunión');
    });
  });

  describe('moneda y tarifas (I2)', () => {
    it('cambiar moneda a USD reemplaza las tarifas por las de USD (no deja las de CLP) y el rótulo coincide con los montos', async () => {
      renderPage();
      await waitForPanel();
      await openTab(/4 Propuesta/);

      expect(screen.getByLabelText(/Tarifa Venta por Hora/)).toHaveDisplayValue('36000');

      await user.click(screen.getByLabelText('USD ($)'));

      expect(screen.getByLabelText(/Tarifa Venta por Hora/)).toHaveDisplayValue('40');
      expect(screen.getByLabelText(/Costo Hora Analista Cliente/)).toHaveDisplayValue('15');
      await waitFor(() => expect(lastCalculateInputs()).toEqual(expect.objectContaining({
        currency: 'USD',
        target_hourly_rate: 40,
        hourly_labor_cost: 15,
        internal_cost_rate: 20
      })));
      // El panel rotula la tarifa con la misma moneda de su monto
      expect(await screen.findByText('USD 40/h')).toBeInTheDocument();
      expect(screen.queryByText(/36\.000/)).not.toBeInTheDocument();

      await user.click(screen.getByLabelText('UF'));
      expect(screen.getByLabelText(/Tarifa Venta por Hora/)).toHaveDisplayValue('0.95');
      expect(screen.getByLabelText(/Costo Hora Analista Cliente/)).toHaveDisplayValue('0.36');
      await waitFor(() => expect(lastCalculateInputs()).toEqual(expect.objectContaining({
        currency: 'UF',
        target_hourly_rate: 0.95,
        hourly_labor_cost: 0.36,
        internal_cost_rate: 0.48
      })));
    });
  });

  describe('campos solo de referencia (I3)', () => {
    it('los campos FTEs actuales, tasa de error y periodos punta muestran la leyenda "Solo referencia, no afecta el cálculo"', async () => {
      renderPage();
      await waitForPanel();
      await openTab(/3 Volumetría/);

      const itemOf = (label: RegExp) => screen.getByText(label).closest('.ant-form-item') as HTMLElement;
      expect(within(itemOf(/Colaboradores Actuales \(FTEs\)/)).getByText(REFERENCE_HINT)).toBeInTheDocument();
      expect(within(itemOf(/Tasa de Error Humano/)).getByText(REFERENCE_HINT)).toBeInTheDocument();
      expect(within(itemOf(/Periodos Punta o Peak/)).getByText(REFERENCE_HINT)).toBeInTheDocument();

      // Solo esos tres: los campos que sí calculan no llevan la leyenda
      expect(screen.getAllByText(REFERENCE_HINT)).toHaveLength(3);
    });
  });

  describe('errores y carga del panel (I4)', () => {
    it('si calculate falla se muestra un Alert de error en el panel y se recupera al corregir', async () => {
      mocked.calculate.mockImplementation((inputs: ScopingInputs) =>
        inputs.volume_per_frequency === undefined
          ? Promise.reject(new Error('El volumen por frecuencia debe ser un número'))
          : Promise.resolve(makeCalculation(inputs))
      );
      renderPage();
      await waitForPanel();
      await openTab(/3 Volumetría/);

      await user.clear(screen.getByLabelText(/Volumen por Ciclo/));

      const alert = (await screen.findByText('No se pudo calcular la estimación')).closest('[role="alert"]') as HTMLElement;
      expect(alert).not.toBeNull();
      expect(within(alert).getByText('El volumen por frecuencia debe ser un número')).toBeInTheDocument();
      // Los números del cálculo anterior no se muestran como si siguieran vigentes
      expect(screen.queryByText('236')).not.toBeInTheDocument();

      await user.type(screen.getByLabelText(/Volumen por Ciclo/), '120');

      await waitForPanel();
      expect(screen.queryByText('No se pudo calcular la estimación')).not.toBeInTheDocument();
      expect(screen.getByText('236')).toBeInTheDocument();
    });

    it('el Alert de error ofrece Reintentar, que vuelve a calcular con las entradas actuales', async () => {
      let failing = true;
      mocked.calculate.mockImplementation((inputs: ScopingInputs) =>
        failing ? Promise.reject(new Error('Servicio no disponible')) : Promise.resolve(makeCalculation(inputs))
      );
      renderPage();
      expect(await screen.findByText('Servicio no disponible')).toBeInTheDocument();
      const callsBefore = mocked.calculate.mock.calls.length;
      const inputsBefore = lastCalculateInputs();

      failing = false;
      await user.click(screen.getByText('Reintentar'));

      await waitForPanel();
      expect(mocked.calculate).toHaveBeenCalledTimes(callsBefore + 1);
      expect(lastCalculateInputs()).toEqual(inputsBefore);
      expect(screen.queryByText('No se pudo calcular la estimación')).not.toBeInTheDocument();
      expect(screen.queryByText('Reintentar')).not.toBeInTheDocument();
    });

    it('el panel indica carga mientras calcula', async () => {
      renderPage();
      await waitForPanel();
      await openTab(/3 Volumetría/);

      let resolveCalculation: (value: ScopingCalculationResult) => void = () => undefined;
      mocked.calculate.mockImplementationOnce(() => new Promise<ScopingCalculationResult>((resolve) => {
        resolveCalculation = resolve;
      }));
      expect(screen.queryByText('Calculando…')).not.toBeInTheDocument();

      await user.type(screen.getByLabelText(/Tiempo Manual \(AHT\)/), '5');

      expect(await screen.findByText('Calculando…')).toBeInTheDocument();
      await act(async () => resolveCalculation(makeCalculation()));
      await waitFor(() => expect(screen.queryByText('Calculando…')).not.toBeInTheDocument());
    });
  });

  describe('calibración manual y errores del servidor (I5)', () => {
    it('vaciar un campo de calibración manual no envía null: usa el valor calculado', async () => {
      renderPage();
      await waitForPanel();
      await openHistoryAndEdit();

      await user.clear(await screen.findByLabelText('LP (Líder Proyecto)'));

      await waitFor(() => expect(lastCalculateInputs().custom_hours).toEqual({ crpa: 40, ar: 300, adv: 92, weeks: 9 }));

      await clickSave();
      await waitFor(() => expect(mocked.update).toHaveBeenCalledTimes(1));
      const customHours = mocked.update.mock.calls[0][1].custom_hours;
      expect(customHours).toEqual({ crpa: 40, ar: 300, adv: 92, weeks: 9 });
      expect(Object.values(customHours)).not.toContain(null);
    });

    it('vaciar todos los campos de calibración equivale a no calibrar (custom_hours null)', async () => {
      renderPage();
      await waitForPanel();
      await openHistoryAndEdit();

      for (const label of ['LP (Líder Proyecto)', 'CRPA (Arquitecto)', 'AR (Desarrollador)', 'ADV (Advisor/QA)', 'Semanas']) {
        await user.clear(await screen.findByLabelText(label));
      }

      await waitFor(() => expect(lastCalculateInputs().custom_hours).toBeNull());
    });

    it('un 400 del backend al guardar se muestra como mensaje legible', async () => {
      mocked.update.mockRejectedValue(new Error('Las horas del Líder de Proyecto (LP) deben ser un número mayor o igual a cero'));
      renderPage();
      await waitForPanel();
      await openHistoryAndEdit();

      await waitForPanel();
      await clickSave();

      await waitFor(() => expect(message.error).toHaveBeenCalledWith('Las horas del Líder de Proyecto (LP) deben ser un número mayor o igual a cero'));
      expect(screen.queryByText(PROPOSAL_TITLE)).not.toBeInTheDocument();
    });

    it('guardar con un campo requerido vacío avisa cuál falta aunque esté en otro paso', async () => {
      renderPage();
      await waitForPanel();
      await selectArchetype(FACTURAS);
      await user.type(screen.getByLabelText(/Nombre del Cliente/), 'Acme');
      await user.clear(screen.getByLabelText(/Volumen por Ciclo/));

      await clickSave();

      await waitFor(() => expect(message.error).toHaveBeenCalledWith('Por favor completa los campos requeridos antes de guardar: Ingresa el volumen'));
      expect(mocked.create).not.toHaveBeenCalled();
    });
  });

  describe('campos de costo interno opcionales', () => {
    it('muestra el margen cuando la API lo envía y no deja un "%" suelto cuando la API lo omite (rol sin costos)', async () => {
      renderPage();
      await waitForPanel();
      expect(screen.getByText('Margen estimado:')).toBeInTheDocument();

      mocked.calculate.mockImplementation((inputs: ScopingInputs) => {
        const { projected_margin_pct: _margin, project_internal_cost: _cost, ...withoutCosts } = makeCalculation(inputs);
        return Promise.resolve(withoutCosts);
      });
      await openTab(/3 Volumetría/);
      await user.type(screen.getByLabelText(/Tiempo Manual \(AHT\)/), '5');

      await waitFor(() => expect(screen.queryByText('Margen estimado:')).not.toBeInTheDocument());
      expect(screen.getByText('Guardar Cotización')).toBeInTheDocument();
    });
  });

  describe('visibilidad por rol (I10)', () => {
    it('un rpa_developer no ve el margen en el panel aunque la respuesta lo traiga; team_lead sí', async () => {
      authState.user = { id: 5, role: 'rpa_developer' };
      const view = renderPage();
      await waitForPanel();
      expect(screen.queryByText('Margen estimado:')).not.toBeInTheDocument();
      // Lo que ve el cliente sigue visible
      expect(screen.getByText('Precio Sugerido Venta')).toBeInTheDocument();
      view.unmount();

      authState.user = { id: 1, role: 'team_lead' };
      renderPage();
      await waitForPanel();
      expect(screen.getByText('Margen estimado:')).toBeInTheDocument();
    });

    it('en el historial, un rpa_developer no ve el margen y solo puede editar y borrar lo propio', async () => {
      authState.user = { id: 5, role: 'rpa_developer' };
      mocked.getAll.mockResolvedValue({
        success: true,
        data: [
          makeRecord({ id: 1, code: 'COT-2026-001', created_by: 5 }),
          makeRecord({ id: 2, code: 'COT-2026-002', created_by: 9 })
        ],
        kpis: emptyKpis
      });
      renderPage();
      await waitForPanel();
      await openTab(/Historial de Cotizaciones/);
      await screen.findByText('COT-2026-001');

      expect(screen.queryByText(/Margen/)).not.toBeInTheDocument();
      const own = screen.getByText('COT-2026-001').closest('tr') as HTMLElement;
      const foreign = screen.getByText('COT-2026-002').closest('tr') as HTMLElement;
      expect(within(own).getByLabelText('delete')).toBeInTheDocument();
      expect(within(own).getByLabelText('edit')).toBeInTheDocument();
      expect(within(foreign).queryByLabelText('delete')).not.toBeInTheDocument();
      expect(within(foreign).queryByLabelText('edit')).not.toBeInTheDocument();
      // Convertir en proyecto: el rol no puede, ni siquiera en lo propio
      expect(within(own).queryByLabelText('rocket')).not.toBeInTheDocument();
    });

    it('en el historial, team_lead ve el margen y puede convertir una cotización viable', async () => {
      renderPage();
      await waitForPanel();
      await openTab(/Historial de Cotizaciones/);
      const row = (await screen.findByText('COT-2026-007')).closest('tr') as HTMLElement;

      expect(within(row).getByText('Margen ~50%')).toBeInTheDocument();
      expect(within(row).getByLabelText('rocket').closest('button')).toBeEnabled();
    });

    it('la propuesta del asistente ofrece convertir solo a team_lead y rpa_operations, y solo si ya está guardada', async () => {
      authState.user = { id: 5, role: 'rpa_developer' };
      const developerView = renderPage();
      await waitForPanel();
      await selectArchetype(FACTURAS);
      await user.type(screen.getByLabelText(/Nombre del Cliente/), 'Acme');
      await clickSave();
      const devDialog = await proposalDialog();
      expect(within(devDialog).getByText('COT-2026-009')).toBeInTheDocument();
      expect(within(devDialog).queryByText(/Convertir en Proyecto/)).not.toBeInTheDocument();
      developerView.unmount();

      authState.user = { id: 2, role: 'rpa_operations' };
      renderPage();
      await waitForPanel();
      // Sin guardar todavía no hay nada que convertir: el botón no se ofrece
      await user.click(screen.getByText('Ver Propuesta Técnico-Económica'));
      const unsavedDialog = await proposalDialog();
      expect(within(unsavedDialog).queryByText(/Convertir en Proyecto/)).not.toBeInTheDocument();
      await user.click(within(unsavedDialog).getByText('Cerrar'));

      await selectArchetype(FACTURAS);
      await user.type(screen.getByLabelText(/Nombre del Cliente/), 'Acme');
      await clickSave();
      const savedDialog = await proposalDialog();
      expect(within(savedDialog).getByText(/Convertir en Proyecto/).closest('button')).toBeEnabled();
    });

    it('la propuesta de un registro no viable del historial no permite convertirlo', async () => {
      mocked.getAll.mockResolvedValue({
        success: true,
        data: [makeRecord({ viability_status: 'not_viable' })],
        kpis: emptyKpis
      });
      mocked.getById.mockResolvedValue(makeRecord({
        viability_status: 'not_viable',
        calculation: makeCalculation({}, {
          viability_status: 'not_viable',
          viability_label: 'No se puede automatizar con RPA',
          is_viable: false,
          blockers: ['Los datos de entrada no son digitales ni estructurados.']
        })
      }));
      renderPage();
      await waitForPanel();
      await openTab(/Historial de Cotizaciones/);
      const row = (await screen.findByText('COT-2026-007')).closest('tr') as HTMLElement;
      expect(within(row).getByLabelText('rocket').closest('button')).toBeDisabled();

      await user.click(within(row).getByLabelText('eye'));
      const dialog = await proposalDialog();
      expect(within(dialog).getByText('NO SE PUEDE AUTOMATIZAR CON RPA').closest('.ant-alert')).toHaveClass('ant-alert-error');
      expect(within(dialog).queryByText('VALOR TOTAL DEL PROYECTO')).not.toBeInTheDocument();
      expect(within(dialog).getByText(/Convertir en Proyecto/).closest('button')).toBeDisabled();
    });

    it('la propuesta de una fila "convertida" cuyo proyecto fue borrado sí ofrece convertir de nuevo', async () => {
      mocked.getById.mockResolvedValue(makeRecord({ status: 'converted_to_project', converted_project_id: null }));
      renderPage();
      await waitForPanel();
      await openTab(/Historial de Cotizaciones/);
      const row = (await screen.findByText('COT-2026-007')).closest('tr') as HTMLElement;
      await user.click(within(row).getByLabelText('eye'));

      const dialog = await proposalDialog();
      expect(within(dialog).getByText(/Convertir en Proyecto/).closest('button')).toBeEnabled();
    });

    it('la propuesta de una cotización ya convertida no ofrece convertirla otra vez', async () => {
      mocked.getById.mockResolvedValue(makeRecord({ status: 'converted_to_project', converted_project_id: 12 }));
      renderPage();
      await waitForPanel();
      await openTab(/Historial de Cotizaciones/);
      const row = (await screen.findByText('COT-2026-007')).closest('tr') as HTMLElement;
      await user.click(within(row).getByLabelText('eye'));

      const dialog = await proposalDialog();
      expect(within(dialog).queryByText(/Convertir en Proyecto/)).not.toBeInTheDocument();
    });
  });

  describe('código y fecha de la propuesta (I7)', () => {
    it('la propuesta del historial muestra el código y la fecha del registro, no la de hoy', async () => {
      mocked.getById.mockResolvedValue(makeRecord({ created_at: '2025-01-15T12:00:00Z' }));
      renderPage();
      await waitForPanel();
      await openTab(/Historial de Cotizaciones/);
      const row = (await screen.findByText('COT-2026-007')).closest('tr') as HTMLElement;
      await user.click(within(row).getByLabelText('eye'));

      const dialog = await proposalDialog();
      expect(within(dialog).getByText('COT-2026-007')).toBeInTheDocument();
      expect(within(dialog).getByText(/Fecha: 15-01-2025/)).toBeInTheDocument();
    });

    it('un levantamiento sin guardar se rotula como borrador y, al guardarlo, toma el código y la fecha del registro', async () => {
      mocked.create.mockResolvedValue(makeRecord({ id: 9, code: 'COT-2026-009', created_at: '2025-03-02T12:00:00Z' }));
      renderPage();
      await waitForPanel();

      await user.click(screen.getByText('Ver Propuesta Técnico-Económica'));
      const draftDialog = await proposalDialog();
      expect(within(draftDialog).getByText('Borrador sin guardar')).toBeInTheDocument();
      expect(within(draftDialog).queryByText(/COT-2026/)).not.toBeInTheDocument();
      await user.click(within(draftDialog).getByText('Cerrar'));

      await selectArchetype(FACTURAS);
      await user.type(screen.getByLabelText(/Nombre del Cliente/), 'Acme');
      await clickSave();

      const savedDialog = await proposalDialog();
      expect(within(savedDialog).getByText('COT-2026-009')).toBeInTheDocument();
      expect(within(savedDialog).getByText(/Fecha: 02-03-2025/)).toBeInTheDocument();
      expect(within(savedDialog).queryByText('Borrador sin guardar')).not.toBeInTheDocument();
    });

    it('al editar una cotización antigua, la propuesta conserva su código y su fecha originales', async () => {
      mocked.getById.mockResolvedValue(makeRecord({ created_at: '2025-01-15T12:00:00Z' }));
      renderPage();
      await waitForPanel();
      await openHistoryAndEdit();
      await waitForPanel();

      await user.click(screen.getByText('Ver Propuesta Técnico-Económica'));

      const dialog = await proposalDialog();
      expect(within(dialog).getByText('COT-2026-007')).toBeInTheDocument();
      expect(within(dialog).getByText(/Fecha: 15-01-2025/)).toBeInTheDocument();
    });
  });

  describe('historial', () => {
    it('la búsqueda del historial espera ~400 ms (debounce) antes de llamar a la API', async () => {
      renderPage();
      await waitForPanel();
      await openTab(/Historial de Cotizaciones/);
      await screen.findByText('COT-2026-007');
      const searched = () => mocked.getAll.mock.calls.map((call) => call[0]?.search).filter(Boolean);
      const searchInput = screen.getByPlaceholderText(/Buscar por cliente/);

      // El reloj avanza solo cuando el test lo dice: las teclas se simulan seguidas, sin depender de la velocidad de la máquina
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        for (const value of ['A', 'Ac', 'Acm', 'Acme']) fireEvent.change(searchInput, { target: { value } });

        // Cuatro teclas seguidas no disparan ninguna petición todavía...
        expect(searched()).toEqual([]);
        await act(async () => { vi.advanceTimersByTime(300); });
        expect(searched()).toEqual([]);
        // ...y pasados los 400 ms sale una sola, con el texto completo
        await act(async () => { vi.advanceTimersByTime(150); });
        await waitFor(() => expect(searched()).toEqual(['Acme']));
      } finally {
        vi.useRealTimers();
      }
    });

    it('si falla la carga del historial se muestra el error del servidor', async () => {
      mocked.getAll.mockRejectedValue(new Error('No se pudo leer el historial'));
      renderPage();
      await waitForPanel();

      await openTab(/Historial de Cotizaciones/);

      await waitFor(() => expect(message.error).toHaveBeenCalledWith('No se pudo leer el historial'));
    });
  });

  describe('Nuevo Levantamiento (M8)', () => {
    it('al editar o iniciar uno nuevo no se muestran los números de la sesión anterior mientras calcula', async () => {
      renderPage();
      await waitForPanel();
      expect(screen.getByText('236')).toBeInTheDocument();

      // Editar (el registro tiene OCR y VDI: 492 HH): mientras calcula no queda el 236 anterior
      let finishCalculation: (value: ScopingCalculationResult) => void = () => undefined;
      mocked.calculate.mockImplementationOnce(() => new Promise<ScopingCalculationResult>((resolve) => {
        finishCalculation = resolve;
      }));
      await openHistoryAndEdit();
      expect(await screen.findByText('Calculando…')).toBeInTheDocument();
      expect(screen.queryByText('236')).not.toBeInTheDocument();
      await act(async () => finishCalculation(makeCalculation({ requires_ocr: true })));
      expect(await screen.findByText('492')).toBeInTheDocument();

      // Nuevo Levantamiento: tampoco queda el 492 del registro editado
      mocked.calculate.mockImplementationOnce(() => new Promise<ScopingCalculationResult>((resolve) => {
        finishCalculation = resolve;
      }));
      await openTab(/Historial de Cotizaciones/);
      await user.click(await screen.findByText(/Nuevo Levantamiento \(15 min\)/));
      expect(await screen.findByText('Calculando…')).toBeInTheDocument();
      expect(screen.queryByText('492')).not.toBeInTheDocument();
      await act(async () => finishCalculation(makeCalculation()));
      expect(await screen.findByText('236')).toBeInTheDocument();
    });

    it('reinicia cronómetro, vuelve al paso 1 y limpia el código mostrado', async () => {
      renderPage();
      await waitForPanel();

      // Guarda una cotización: su código queda en la propuesta
      await selectArchetype(FACTURAS);
      await user.type(screen.getByLabelText(/Nombre del Cliente/), 'Acme');
      await clickSave();
      const dialog = await proposalDialog();
      expect(within(dialog).getByText('COT-2026-009')).toBeInTheDocument();
      await user.click(within(dialog).getByText('Cerrar'));

      // La reunión avanza: cronómetro corriendo y el asistente en el Paso 3
      await user.click(screen.getByLabelText('play-circle'));
      expect(await screen.findByText('00:01', {}, { timeout: 3000 })).toBeInTheDocument();
      await openTab(/3 Volumetría/);
      expect(tabOf(/3 Volumetría/)).toHaveAttribute('aria-selected', 'true');

      await openTab(/Historial de Cotizaciones/);
      await user.click(await screen.findByText(/Nuevo Levantamiento \(15 min\)/));

      expect(screen.getByText('00:00')).toBeInTheDocument();
      expect(screen.getByLabelText('play-circle')).toBeInTheDocument();
      expect(tabOf(/1 Factibilidad/)).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByLabelText(/Nombre del Cliente/)).toHaveValue('');

      // El código de la cotización anterior no se arrastra a la propuesta nueva
      await user.click(await screen.findByText('Ver Propuesta Técnico-Económica'));
      const newDialog = await proposalDialog();
      expect(within(newDialog).queryByText('COT-2026-009')).not.toBeInTheDocument();
    });
  });
});
