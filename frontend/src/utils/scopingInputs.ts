/**
 * Entradas del Cotizador RPA: valores por defecto, armado del cuerpo que viaja a la API y
 * conversión de un registro guardado a valores de formulario.
 *
 * La API exige el conjunto completo de entradas en /calculate y al crear, y no acepta `null`
 * en ningún campo numérico ni categórico: lo que el usuario vacía se omite.
 */
import { CustomHours, ScopingInputs, ScopingQuotationRecord } from '../types/scoping';

export type ScopingCurrency = 'CLP' | 'USD' | 'UF';

export interface CurrencyRates {
  hourly_labor_cost: number;
  target_hourly_rate: number;
  internal_cost_rate: number;
}

/** Espejo de DEFAULT_RATES en backend/src/services/scopingCalculationEngine.ts */
export const DEFAULT_RATES: Record<ScopingCurrency, CurrencyRates> = {
  CLP: { hourly_labor_cost: 14000, target_hourly_rate: 36000, internal_cost_rate: 18000 },
  USD: { hourly_labor_cost: 15, target_hourly_rate: 40, internal_cost_rate: 20 },
  UF: { hourly_labor_cost: 0.36, target_hourly_rate: 0.95, internal_cost_rate: 0.48 }
};

/** Tasa de excepciones que usa el motor cuando no se informa (scopingCalculationEngine: exception_rate_pct ?? 3) */
export const DEFAULT_EXCEPTION_RATE_PCT = 3;

export const DEFAULT_INPUTS: ScopingInputs = {
  client_name: '',
  process_name: '',
  business_unit: '',
  client_contact: '',
  process_archetype: 'custom',

  data_input_type: 'digital_structured',
  rule_based_level: 'rules_mostly',
  process_stability: 'no_change',
  application_stability: 'no_change',

  frequency: 'daily',
  volume_per_frequency: 100,
  aht_minutes: 10,
  current_ftes: 1,
  error_rate_pct: 5,
  peak_period: 'regular_peak',

  process_steps_count: '15_25',
  decision_complexity: 'simple_yes_no',
  applications_count: '2_3_apps',
  applications_detail: 'SAP, Excel, Portales Web',
  uses_vdi: false,
  requires_ocr: false,
  structured_data_pct: 'gte_80',
  exception_rate_pct: DEFAULT_EXCEPTION_RATE_PCT,

  currency: 'CLP',
  ...DEFAULT_RATES.CLP
};

/** Tarifas por defecto de una moneda (copia: quien las pida no altera la tabla) */
export const ratesForCurrency = (currency: ScopingCurrency): CurrencyRates => ({ ...DEFAULT_RATES[currency] });

// Entradas que mueven el cálculo (o viajan a /calculate junto con las que lo mueven)
export const CALCULATION_KEYS = [
  'data_input_type', 'rule_based_level', 'process_stability', 'application_stability',
  'frequency', 'volume_per_frequency', 'aht_minutes', 'current_ftes', 'error_rate_pct', 'peak_period',
  'process_steps_count', 'decision_complexity', 'applications_count', 'uses_vdi', 'requires_ocr',
  'structured_data_pct', 'exception_rate_pct',
  'currency', 'hourly_labor_cost', 'target_hourly_rate', 'internal_cost_rate'
] as const;

// Datos del levantamiento que no cambian ningún número
const DETAIL_KEYS = [
  'process_archetype', 'client_name', 'client_contact', 'client_email', 'process_name', 'business_unit',
  'applications_detail', 'assumptions', 'exclusions', 'notes'
] as const;

// Entradas obligatorias con un valor por defecto válido: si faltan en el formulario, rige el defecto.
// Volumen y AHT no están aquí a propósito: vacíos se omiten y la API responde el error en español.
const FALLBACK_KEYS = [
  'data_input_type', 'rule_based_level', 'process_stability', 'application_stability', 'frequency',
  'process_steps_count', 'decision_complexity', 'applications_count', 'structured_data_pct',
  'uses_vdi', 'requires_ocr'
] as const;

// Tarifas y tasa de excepciones: el motor usa su defecto cuando faltan, pero un PUT parcial conservaría el valor guardado.
// Por eso un campo vaciado se rellena con el defecto en el cuerpo, y panel y registro guardado coinciden siempre.
const RATE_KEYS = ['hourly_labor_cost', 'target_hourly_rate', 'internal_cost_rate'] as const;

const CUSTOM_HOURS_KEYS = ['lp', 'crpa', 'ar', 'adv', 'weeks'] as const;

const hasValue = (value: unknown): boolean =>
  value !== undefined && value !== null && !(typeof value === 'number' && !Number.isFinite(value));

/**
 * Calibración manual lista para enviar: solo las claves con número (un campo vaciado se omite
 * y rige el valor calculado). Sin ninguna clave devuelve null = sin calibración.
 */
export function normalizeCustomHours(raw: unknown): CustomHours | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const result: CustomHours = {};
  for (const key of CUSTOM_HOURS_KEYS) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Cuerpo para /calculate y para crear/actualizar, a partir de TODOS los valores del formulario
 * (`form.getFieldsValue(true)`: incluye los campos de pasos aún no visitados).
 * `custom_hours` va siempre: objeto con las claves calibradas, o null para limpiar/no calibrar
 * (en un PUT, omitirlo conservaría la calibración anterior).
 * Tarifas y tasa de excepciones vaciadas llevan el defecto de la moneda / 3, no se omiten (ver RATE_KEYS).
 * Volumen y AHT vacíos sí se omiten: la API responde un 400 legible.
 */
export function buildScopingInputs(values: Record<string, unknown> = {}): ScopingInputs {
  const inputs: Record<string, unknown> = {};
  for (const key of FALLBACK_KEYS) inputs[key] = DEFAULT_INPUTS[key];
  for (const key of [...CALCULATION_KEYS, ...DETAIL_KEYS]) {
    if (hasValue(values[key])) inputs[key] = values[key];
  }
  const rates = DEFAULT_RATES[(inputs.currency as ScopingCurrency | undefined) ?? 'CLP'];
  for (const key of RATE_KEYS) {
    if (inputs[key] === undefined) inputs[key] = rates[key];
  }
  if (inputs.exception_rate_pct === undefined) inputs.exception_rate_pct = DEFAULT_EXCEPTION_RATE_PCT;
  inputs.custom_hours = normalizeCustomHours(values.custom_hours);
  return inputs as unknown as ScopingInputs;
}

/** Valores de formulario de un registro guardado (lo que falta toma el valor por defecto del formulario) */
export function recordToFormValues(record: Partial<ScopingQuotationRecord>): Record<string, unknown> {
  const source = record as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  for (const key of [...CALCULATION_KEYS, ...DETAIL_KEYS]) {
    if (hasValue(source[key])) values[key] = source[key];
  }
  const customHours = normalizeCustomHours(record.custom_hours);
  if (customHours) values.custom_hours = customHours;
  // Solo el team_lead recibe la tarifa interna: sin ella rige la de la moneda del registro
  if (values.internal_cost_rate === undefined) {
    const currency = (values.currency as ScopingCurrency | undefined) ?? 'CLP';
    values.internal_cost_rate = DEFAULT_RATES[currency].internal_cost_rate;
  }
  return values;
}

/** ¿Alguno de los campos cambiados altera el cálculo? (escribir cliente o notas no lo recalcula) */
export function affectsCalculation(changedValues: Record<string, unknown>): boolean {
  return Object.keys(changedValues).some(
    (key) => key === 'custom_hours' || (CALCULATION_KEYS as readonly string[]).includes(key)
  );
}
