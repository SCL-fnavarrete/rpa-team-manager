import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INPUTS,
  DEFAULT_RATES,
  affectsCalculation,
  buildScopingInputs,
  normalizeCustomHours,
  ratesForCurrency,
  recordToFormValues
} from '@/utils/scopingInputs';
import type { ScopingQuotationRecord } from '@/types/scoping';

describe('DEFAULT_RATES / ratesForCurrency', () => {
  // Espejo de getDefaultRates() en backend/src/services/scopingCalculationEngine.ts: si el backend cambia, esto debe cambiar con él
  it('coincide con las tarifas por defecto del motor para CLP, USD y UF', () => {
    expect(ratesForCurrency('CLP')).toEqual({ hourly_labor_cost: 14000, target_hourly_rate: 36000, internal_cost_rate: 18000 });
    expect(ratesForCurrency('USD')).toEqual({ hourly_labor_cost: 15, target_hourly_rate: 40, internal_cost_rate: 20 });
    expect(ratesForCurrency('UF')).toEqual({ hourly_labor_cost: 0.36, target_hourly_rate: 0.95, internal_cost_rate: 0.48 });
  });

  it('devuelve una copia: quien la modifica no altera la tabla', () => {
    const rates = ratesForCurrency('USD');
    rates.target_hourly_rate = 999;
    expect(DEFAULT_RATES.USD.target_hourly_rate).toBe(40);
    expect(ratesForCurrency('USD').target_hourly_rate).toBe(40);
  });

  it('el formulario nuevo parte con las tarifas de CLP y excepciones en 3%', () => {
    expect(DEFAULT_INPUTS).toEqual(expect.objectContaining({ currency: 'CLP', ...DEFAULT_RATES.CLP, exception_rate_pct: 3 }));
  });
});

describe('normalizeCustomHours', () => {
  it('conserva solo las claves con número (incluido el 0)', () => {
    expect(normalizeCustomHours({ lp: 60, crpa: 0, ar: 300, adv: 92, weeks: 9 })).toEqual({ lp: 60, crpa: 0, ar: 300, adv: 92, weeks: 9 });
  });

  it('omite las claves vaciadas (null, undefined, NaN, texto): nunca viaja un null dentro del objeto', () => {
    const result = normalizeCustomHours({ lp: null, crpa: undefined, ar: 300, adv: Number.NaN, weeks: '9' });
    expect(result).toEqual({ ar: 300 });
    expect(Object.values(result as object)).not.toContain(null);
  });

  it('sin ninguna clave con número devuelve null (sin calibración)', () => {
    expect(normalizeCustomHours({})).toBeNull();
    expect(normalizeCustomHours({ lp: null, weeks: undefined })).toBeNull();
    expect(normalizeCustomHours(undefined)).toBeNull();
    expect(normalizeCustomHours(null)).toBeNull();
    expect(normalizeCustomHours('60')).toBeNull();
  });

  it('ignora claves ajenas a la calibración', () => {
    expect(normalizeCustomHours({ lp: 10, foo: 5 })).toEqual({ lp: 10 });
  });
});

describe('buildScopingInputs', () => {
  it('con el formulario vacío completa las entradas obligatorias con defecto y no inventa volumen ni AHT', () => {
    const inputs = buildScopingInputs({});

    expect(inputs).toEqual(expect.objectContaining({
      data_input_type: 'digital_structured',
      rule_based_level: 'rules_mostly',
      process_stability: 'no_change',
      application_stability: 'no_change',
      frequency: 'daily',
      process_steps_count: '15_25',
      decision_complexity: 'simple_yes_no',
      applications_count: '2_3_apps',
      structured_data_pct: 'gte_80',
      uses_vdi: false,
      requires_ocr: false,
      custom_hours: null
    }));
    // Volumen y AHT vacíos no se envían: la API responde su error en español y el panel lo muestra
    expect(inputs).not.toHaveProperty('volume_per_frequency');
    expect(inputs).not.toHaveProperty('aht_minutes');
  });

  it('toma los valores del formulario, incluido false en los interruptores y 0 en números', () => {
    const inputs = buildScopingInputs({
      ...DEFAULT_INPUTS,
      process_archetype: 'contabilizacion_facturas',
      volume_per_frequency: 250,
      aht_minutes: 9,
      requires_ocr: true,
      uses_vdi: false,
      error_rate_pct: 0,
      current_ftes: 0
    });

    expect(inputs).toEqual(expect.objectContaining({
      process_archetype: 'contabilizacion_facturas',
      volume_per_frequency: 250,
      aht_minutes: 9,
      requires_ocr: true,
      uses_vdi: false,
      error_rate_pct: 0,
      current_ftes: 0
    }));
  });

  it('un campo numérico vaciado (null, undefined o NaN) nunca viaja como null', () => {
    const inputs = buildScopingInputs({
      ...DEFAULT_INPUTS,
      volume_per_frequency: null,
      aht_minutes: Number.NaN,
      current_ftes: null,
      error_rate_pct: undefined
    });

    expect(inputs).not.toHaveProperty('volume_per_frequency');
    expect(inputs).not.toHaveProperty('aht_minutes');
    expect(inputs).not.toHaveProperty('current_ftes');
    expect(inputs).not.toHaveProperty('error_rate_pct');
    expect(Object.values(inputs).filter((value) => value === null)).toEqual([null]); // solo custom_hours: null
    expect(inputs.custom_hours).toBeNull();
  });

  it.each([
    ['CLP', 14000, 36000, 18000],
    ['USD', 15, 40, 20],
    ['UF', 0.36, 0.95, 0.48]
  ] as const)('tarifas vaciadas con moneda %s toman el defecto de esa moneda (el mismo que usa el motor)', (currency, labor, target, internal) => {
    const inputs = buildScopingInputs({
      ...DEFAULT_INPUTS,
      currency,
      hourly_labor_cost: null,
      target_hourly_rate: undefined,
      internal_cost_rate: null
    });

    expect(inputs).toEqual(expect.objectContaining({
      currency,
      hourly_labor_cost: labor,
      target_hourly_rate: target,
      internal_cost_rate: internal
    }));
  });

  it('la tasa de excepciones vaciada vale 3 (como el motor); una explícita, incluso 0, se respeta', () => {
    expect(buildScopingInputs({ ...DEFAULT_INPUTS, exception_rate_pct: null }).exception_rate_pct).toBe(3);
    expect(buildScopingInputs({ ...DEFAULT_INPUTS, exception_rate_pct: undefined }).exception_rate_pct).toBe(3);
    expect(buildScopingInputs({ ...DEFAULT_INPUTS, exception_rate_pct: 0 }).exception_rate_pct).toBe(0);
    expect(buildScopingInputs({ ...DEFAULT_INPUTS, exception_rate_pct: 8 }).exception_rate_pct).toBe(8);
  });

  it('las tarifas explícitas se respetan, incluso 0, y sin moneda rige CLP', () => {
    const explicit = buildScopingInputs({ ...DEFAULT_INPUTS, currency: 'USD', target_hourly_rate: 55, hourly_labor_cost: 0, internal_cost_rate: 22 });
    expect(explicit).toEqual(expect.objectContaining({ target_hourly_rate: 55, hourly_labor_cost: 0, internal_cost_rate: 22 }));

    const noCurrency = buildScopingInputs({ target_hourly_rate: null });
    expect(noCurrency.target_hourly_rate).toBe(36000);
  });

  it('los textos vacíos se conservan y los null se omiten', () => {
    const inputs = buildScopingInputs({ ...DEFAULT_INPUTS, client_name: '', notes: '', business_unit: null, assumptions: undefined });

    expect(inputs.client_name).toBe('');
    expect(inputs.notes).toBe('');
    expect(inputs).not.toHaveProperty('business_unit');
    expect(inputs).not.toHaveProperty('assumptions');
  });

  it('normaliza custom_hours y siempre lo envía (objeto o null)', () => {
    expect(buildScopingInputs({ ...DEFAULT_INPUTS, custom_hours: { lp: 60, crpa: null, weeks: 9 } }).custom_hours).toEqual({ lp: 60, weeks: 9 });
    expect(buildScopingInputs({ ...DEFAULT_INPUTS, custom_hours: { lp: null } }).custom_hours).toBeNull();
    expect(buildScopingInputs({ ...DEFAULT_INPUTS }).custom_hours).toBeNull();
  });

  it('solo envía campos de entrada: ignora lo que quede en el formulario de un registro cargado', () => {
    const inputs = buildScopingInputs({
      ...DEFAULT_INPUTS,
      id: 7,
      code: 'COT-2026-007',
      status: 'approved',
      calculation: { total_hours: 492 },
      created_at: '2026-10-20'
    });

    for (const key of ['id', 'code', 'status', 'calculation', 'created_at']) {
      expect(inputs).not.toHaveProperty(key);
    }
  });

  it('no modifica el objeto recibido', () => {
    const values = { ...DEFAULT_INPUTS, target_hourly_rate: null, custom_hours: { lp: 5, ar: null } };
    const snapshot = JSON.parse(JSON.stringify(values));

    buildScopingInputs(values);

    expect(JSON.parse(JSON.stringify(values))).toEqual(snapshot);
  });
});

describe('recordToFormValues', () => {
  const record = {
    id: 7,
    code: 'COT-2026-007',
    status: 'approved',
    client_name: 'Acme',
    client_email: null,
    process_archetype: 'recepcion_ordenes_compra',
    volume_per_frequency: 80,
    aht_minutes: 12,
    requires_ocr: true,
    uses_vdi: false,
    currency: 'USD',
    target_hourly_rate: 50,
    hourly_labor_cost: 18,
    internal_cost_rate: 22,
    custom_hours: { lp: 60, ar: 300 },
    calculation: { total_hours: 492 }
  } as unknown as ScopingQuotationRecord;

  it('restaura las entradas del registro, incluido false, y la calibración manual', () => {
    const values = recordToFormValues(record);

    expect(values).toEqual(expect.objectContaining({
      client_name: 'Acme',
      process_archetype: 'recepcion_ordenes_compra',
      volume_per_frequency: 80,
      requires_ocr: true,
      uses_vdi: false,
      currency: 'USD',
      target_hourly_rate: 50,
      hourly_labor_cost: 18,
      internal_cost_rate: 22,
      custom_hours: { lp: 60, ar: 300 }
    }));
  });

  it('omite null y lo que no es entrada (id, código, estado, cálculo)', () => {
    const values = recordToFormValues(record);

    for (const key of ['id', 'code', 'status', 'calculation', 'client_email']) {
      expect(values).not.toHaveProperty(key);
    }
  });

  it('sin calibración manual no deja custom_hours en el formulario', () => {
    expect(recordToFormValues({ ...record, custom_hours: null })).not.toHaveProperty('custom_hours');
    expect(recordToFormValues({ ...record, custom_hours: {} })).not.toHaveProperty('custom_hours');
  });

  it('sin tarifa interna (rol distinto de team_lead) rige la de la moneda del registro', () => {
    const { internal_cost_rate: _hidden, ...withoutInternal } = record;

    expect(recordToFormValues(withoutInternal as ScopingQuotationRecord).internal_cost_rate).toBe(20);
    expect(recordToFormValues({ ...withoutInternal, currency: 'UF' } as ScopingQuotationRecord).internal_cost_rate).toBe(0.48);
    expect(recordToFormValues({ ...withoutInternal, currency: undefined } as unknown as ScopingQuotationRecord).internal_cost_rate).toBe(18000);
  });
});

describe('affectsCalculation', () => {
  it('los campos de entrada y la calibración recalculan', () => {
    expect(affectsCalculation({ volume_per_frequency: 5 })).toBe(true);
    expect(affectsCalculation({ requires_ocr: true })).toBe(true);
    expect(affectsCalculation({ currency: 'USD' })).toBe(true);
    expect(affectsCalculation({ custom_hours: { lp: 5 } })).toBe(true);
  });

  it('los textos del levantamiento no recalculan', () => {
    expect(affectsCalculation({ client_name: 'A' })).toBe(false);
    expect(affectsCalculation({ notes: 'x' })).toBe(false);
    expect(affectsCalculation({ applications_detail: 'SAP' })).toBe(false);
    expect(affectsCalculation({})).toBe(false);
  });
});
