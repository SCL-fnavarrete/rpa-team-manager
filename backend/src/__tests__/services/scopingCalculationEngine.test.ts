import { 
  ScopingCalculationEngine, 
  ScopingInputs 
} from '../../services/scopingCalculationEngine';

describe('ScopingCalculationEngine', () => {
  it('debe calcular correctamente un caso de Alto Esfuerzo (similar a Facturas Proveedores)', () => {
    const input: ScopingInputs = {
      data_input_type: 'digital_structured',
      rule_based_level: 'rules_mostly',
      process_stability: 'very_small',
      application_stability: 'no_change',
      frequency: 'daily',
      volume_per_frequency: 300,
      aht_minutes: 9,
      current_ftes: 3,
      error_rate_pct: 5,
      process_steps_count: 'gt_40',
      decision_complexity: 'complex',
      applications_count: '4_5_apps',
      uses_vdi: true, // VDI activo
      requires_ocr: true, // OCR activo
      structured_data_pct: '60_80',
      exception_rate_pct: 3
    };

    const result = ScopingCalculationEngine.calculate(input);

    expect(result.is_viable).toBe(true);
    expect(result.viability_status).toBe('viable');
    expect(result.effort_level).toBe('high');
    expect(result.vdi_multiplier).toBe(1.6);
    expect(result.ocr_multiplier).toBe(1.2);
    expect(result.estimated_weeks).toBe(10);
    expect(result.total_hours).toBe(666);
    expect(result.hours_pm).toBe(72);
    expect(result.hours_consultant).toBe(216);
    expect(result.hours_developer).toBe(324);
    expect(result.hours_advisor).toBe(54);
    expect(result.annual_manual_hours).toBeGreaterThan(1000);
    expect(result.phases_breakdown).toHaveLength(5);
    expect(result.roles_breakdown).toHaveLength(4);
  });

  it('debe calcular correctamente un caso de Bajo Esfuerzo sin VDI ni OCR', () => {
    const input: ScopingInputs = {
      data_input_type: 'digital_structured',
      rule_based_level: 'rules_exclusive',
      process_stability: 'no_change',
      application_stability: 'no_change',
      frequency: 'monthly',
      volume_per_frequency: 100,
      aht_minutes: 15,
      process_steps_count: 'lte_10',
      decision_complexity: 'linear',
      applications_count: '1_app',
      uses_vdi: false,
      requires_ocr: false,
      structured_data_pct: 'gte_80'
    };

    const result = ScopingCalculationEngine.calculate(input);

    expect(result.is_viable).toBe(true);
    expect(result.effort_level).toBe('low');
    expect(result.vdi_multiplier).toBe(1.0);
    expect(result.ocr_multiplier).toBe(1.0);
    expect(result.estimated_weeks).toBe(6);
    expect(result.total_hours).toBe(236);
  });

  it('debe detectar bloqueo de "Digitalizar Primero" si los datos son en papel físico', () => {
    const input: ScopingInputs = {
      data_input_type: 'non_digital_structured',
      rule_based_level: 'rules_exclusive',
      process_stability: 'no_change',
      application_stability: 'no_change',
      frequency: 'daily',
      volume_per_frequency: 50,
      aht_minutes: 10,
      process_steps_count: '10_15',
      decision_complexity: 'linear',
      applications_count: '1_app',
      uses_vdi: false,
      requires_ocr: false,
      structured_data_pct: 'gte_80'
    };

    const result = ScopingCalculationEngine.calculate(input);

    expect(result.is_viable).toBe(false);
    expect(result.viability_status).toBe('digitize_first');
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it('debe sugerir "Posponer" si se esperan cambios significativos en sistemas', () => {
    const input: ScopingInputs = {
      data_input_type: 'digital_structured',
      rule_based_level: 'rules_exclusive',
      process_stability: 'no_change',
      application_stability: 'significant_change', // Migración a SAP S/4HANA por ejemplo
      frequency: 'weekly',
      volume_per_frequency: 200,
      aht_minutes: 5,
      process_steps_count: '15_25',
      decision_complexity: 'linear',
      applications_count: '2_3_apps',
      uses_vdi: false,
      requires_ocr: false,
      structured_data_pct: 'gte_80'
    };

    const result = ScopingCalculationEngine.calculate(input);

    expect(result.is_viable).toBe(false);
    expect(result.viability_status).toBe('postpone');
    expect(result.blockers.some(b => b.includes('cambios significativos'))).toBe(true);
  });

  it('debe permitir calibrar horas personalizadas si el usuario las sobrescribe', () => {
    const input: ScopingInputs = {
      data_input_type: 'digital_structured',
      rule_based_level: 'rules_mostly',
      process_stability: 'no_change',
      application_stability: 'no_change',
      frequency: 'monthly',
      volume_per_frequency: 500,
      aht_minutes: 20,
      process_steps_count: '15_25',
      decision_complexity: 'simple_yes_no',
      applications_count: '2_3_apps',
      uses_vdi: false,
      requires_ocr: false,
      structured_data_pct: 'gte_80',
      custom_hours: {
        weeks: 7,
        lp: 30,
        crpa: 80,
        ar: 200,
        adv: 20
      }
    };

    const result = ScopingCalculationEngine.calculate(input);

    expect(result.estimated_weeks).toBe(7);
    expect(result.hours_pm).toBe(30);
    expect(result.hours_consultant).toBe(80);
    expect(result.hours_developer).toBe(200);
    expect(result.hours_advisor).toBe(20);
    expect(result.total_hours).toBe(330);
  });
});
