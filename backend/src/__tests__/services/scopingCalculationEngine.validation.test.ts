import { ScopingCalculationEngine, ScopingInputs } from '../../services/scopingCalculationEngine';
import { ValidationError } from '../../utils/errors';

const valid: ScopingInputs = {
  data_input_type: 'digital_structured',
  rule_based_level: 'rules_mostly',
  process_stability: 'no_change',
  application_stability: 'no_change',
  frequency: 'daily',
  volume_per_frequency: 100,
  aht_minutes: 10,
  process_steps_count: '15_25',
  decision_complexity: 'simple_yes_no',
  applications_count: '2_3_apps',
  uses_vdi: false,
  requires_ocr: false,
  structured_data_pct: 'gte_80'
};

const withOverrides = (overrides: Record<string, unknown>): ScopingInputs => ({ ...valid, ...overrides } as ScopingInputs);

describe('ScopingCalculationEngine - validación de entradas', () => {
  it('acepta las entradas completas válidas', () => {
    expect(() => ScopingCalculationEngine.calculate(valid)).not.toThrow();
  });

  it.each([
    ['moneda EUR (antes: "Cannot read properties of undefined (reading \'labor\')")', { currency: 'EUR' }, 'La moneda debe ser CLP, USD o UF'],
    ['frecuencia inválida', { frequency: 'hourly' }, 'La frecuencia del proceso no es válida'],
    ['frecuencia ausente', { frequency: undefined }, 'La frecuencia del proceso no es válida'],
    ['tipo de entrada inválido', { data_input_type: 'otro' }, 'El tipo de entrada de datos no es válido'],
    ['volumen no numérico', { volume_per_frequency: 'abc' }, 'El volumen por frecuencia debe ser un número mayor que cero'],
    ['volumen null', { volume_per_frequency: null }, 'El volumen por frecuencia debe ser un número mayor que cero'],
    ['AHT negativo', { aht_minutes: -1 }, 'El tiempo promedio por ejecución (AHT) debe ser un número mayor que cero'],
    ['interruptor no booleano', { uses_vdi: 'true' }, 'El indicador de VDI debe ser verdadero o falso'],
    ['tarifa negativa', { target_hourly_rate: -5 }, 'La tarifa de venta por hora debe ser un número mayor o igual a cero'],
    ['horas manuales negativas', { custom_hours: { lp: -10 } }, 'Las horas calibradas del rol LP deben ser un número mayor o igual a cero'],
    ['horas manuales null', { custom_hours: { ar: null } }, 'Las horas calibradas del rol AR deben ser un número mayor o igual a cero'],
    ['semanas en cero (dividiría por cero)', { custom_hours: { weeks: 0 } }, 'Las semanas calibradas deben ser un número mayor o igual a 1']
  ])('rechaza %s con un error de validación en español', (_label, overrides, message) => {
    let error: unknown;
    try {
      ScopingCalculationEngine.calculate(withOverrides(overrides));
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe(message);
    expect((error as ValidationError).statusCode).toBe(400);
  });

  it('rechaza una entrada que ni siquiera es un objeto', () => {
    expect(() => ScopingCalculationEngine.calculate(undefined as unknown as ScopingInputs)).toThrow(ValidationError);
  });

  it('expone las tarifas por defecto de cada moneda sin dejar mutar la tabla interna', () => {
    expect(ScopingCalculationEngine.getDefaultRates('USD')).toEqual({ labor: 15, target: 40, internal: 20 });
    expect(ScopingCalculationEngine.getDefaultRates('UF')).toEqual({ labor: 0.36, target: 0.95, internal: 0.48 });

    const clp = ScopingCalculationEngine.getDefaultRates('CLP');
    clp.target = 1;
    expect(ScopingCalculationEngine.getDefaultRates('CLP').target).toBe(36000);
  });
});
