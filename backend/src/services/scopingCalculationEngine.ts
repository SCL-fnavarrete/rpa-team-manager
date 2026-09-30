/**
 * Motor Matemático de Scoring, Viabilidad y Cubicación de Esfuerzo para RPA
 * Basado fielmente en:
 * 1. "Herramienta de Evaluación de Procesos para RPA.xlsx" (Scorecard UiPath/Rocketbot)
 * 2. "CL - FACTURAS PROVEEDORES - Esfuerzo v0.3.xlsx" (Cubicación real de equipo por semanas y roles)
 */

export type DataInputType = 
  | 'digital_structured'
  | 'digital_unstructured'
  | 'non_digital_structured'
  | 'non_digital_unstructured';

export type RuleBasedLevel =
  | 'rules_exclusive'
  | 'rules_mostly'
  | 'some_subjectivity'
  | 'mostly_subjective'
  | 'purely_subjective';

export type ProcessStability =
  | 'no_change'
  | 'very_small'
  | 'some_change'
  | 'medium_change'
  | 'significant_change';

export type ProcessFrequency =
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'annual';

export type PeakPeriod =
  | 'regular_peak'
  | 'rare_predictable'
  | 'rare_unpredictable'
  | 'no_peaks';

export type StepsCount =
  | 'lte_10'
  | '10_15'
  | '15_25'
  | '25_40'
  | 'gt_40';

export type DecisionComplexity =
  | 'linear'
  | 'simple_yes_no'
  | 'complex';

export type ApplicationsCount =
  | '1_app'
  | '2_3_apps'
  | '4_5_apps'
  | 'gt_5_apps';

export type StructuredDataPct =
  | 'gte_80'
  | '60_80'
  | '40_60'
  | 'lt_40';

export type ViabilityStatus =
  | 'viable'
  | 'digitize_first'
  | 'postpone'
  | 'low_viability'
  | 'not_viable';

export type EffortLevel = 'low' | 'medium' | 'high';
export type BenefitLevel = 'low' | 'medium' | 'medium_high' | 'high';

export interface ScopingInputs {
  data_input_type: DataInputType;
  rule_based_level: RuleBasedLevel;
  process_stability: ProcessStability;
  application_stability: ProcessStability;
  
  frequency: ProcessFrequency;
  volume_per_frequency: number;
  aht_minutes: number;
  current_ftes?: number;
  error_rate_pct?: number; // 0 to 100
  peak_period?: PeakPeriod;
  
  process_steps_count: StepsCount;
  decision_complexity: DecisionComplexity;
  applications_count: ApplicationsCount;
  uses_vdi: boolean;
  requires_ocr: boolean;
  structured_data_pct: StructuredDataPct;
  exception_rate_pct?: number; // 0 to 100
  
  // Opciones económicas opcionales
  currency?: 'CLP' | 'USD' | 'UF';
  hourly_labor_cost?: number; // Costo hora analista del cliente
  target_hourly_rate?: number; // Tarifa venta hora del equipo RPA
  internal_cost_rate?: number; // Costo hora interno del equipo RPA
  custom_hours?: {
    lp?: number;
    crpa?: number;
    ar?: number;
    adv?: number;
    weeks?: number;
  };
}

export interface ProjectPhaseEstimate {
  phase_number: number;
  name: string;
  description: string;
  start_week: number;
  end_week: number;
  percentage: number;
  hours: number;
}

export interface RoleHoursEstimate {
  role_code: 'LP' | 'CRPA' | 'AR' | 'ADV';
  role_name: string;
  fte_equivalent: number;
  total_hours: number;
  percentage: number;
}

export interface ScopingCalculationResult {
  // Viabilidad y Filtros
  viability_status: ViabilityStatus;
  viability_label: string;
  viability_score: number; // 0 to 1
  is_viable: boolean;
  blockers: string[];
  recommendations: string[];
  
  // Complejidad
  complexity_score: number; // 0 to 1
  difficulty_score: number; // Factor final con multiplicadores
  effort_level: EffortLevel;
  effort_label: string;
  vdi_multiplier: number;
  ocr_multiplier: number;
  
  // Volumetría y Beneficios
  annual_runs: number;
  annual_manual_hours: number;
  current_estimated_ftes: number;
  benefit_score: number; // 0 to 1
  benefit_level: BenefitLevel;
  benefit_label: string;
  error_reduction_pct: number;
  aht_reduction_pct: number;
  hours_saved_annual: number;
  ftes_released: number;
  
  // Cubicación de Horas y Cronograma
  estimated_weeks: number;
  hours_pm: number;
  hours_consultant: number;
  hours_developer: number;
  hours_advisor: number;
  total_hours: number;
  roles_breakdown: RoleHoursEstimate[];
  phases_breakdown: ProjectPhaseEstimate[];
  
  // Propuesta Económica & ROI
  currency: 'CLP' | 'USD' | 'UF';
  target_hourly_rate: number;
  project_internal_cost: number;
  proposed_price: number;
  projected_margin_pct: number;
  client_annual_manual_cost: number;
  client_annual_savings: number;
  payback_months: number;
  roi_first_year_pct: number;
}

export class ScopingCalculationEngine {
  // Frecuencias anuales según Scorecard
  private static readonly FREQUENCY_ANNUAL_MAP: Record<ProcessFrequency, number> = {
    daily: 260, // 52 * 5
    weekly: 52,
    biweekly: 26,
    monthly: 12,
    quarterly: 4,
    annual: 1
  };

  // Puntuación de estabilidad
  private static readonly STABILITY_SCORE_MAP: Record<ProcessStability, number> = {
    no_change: 0.0,
    very_small: 0.2,
    some_change: 0.4,
    medium_change: 0.8,
    significant_change: 1.0 // Posponer
  };

  // Puntuación de pasos de proceso
  private static readonly STEPS_SCORE_MAP: Record<StepsCount, number> = {
    lte_10: 0.1,
    '10_15': 0.2,
    '15_25': 0.4,
    '25_40': 0.6,
    gt_40: 1.0
  };

  // Puntuación de dificultad de decisiones
  private static readonly DECISION_SCORE_MAP: Record<DecisionComplexity, number> = {
    linear: 0.1,
    simple_yes_no: 0.2,
    complex: 0.7
  };

  // Puntuación de cantidad de aplicaciones
  private static readonly APPS_SCORE_MAP: Record<ApplicationsCount, number> = {
    '1_app': 0.1,
    '2_3_apps': 0.3,
    '4_5_apps': 0.6,
    gt_5_apps: 1.0
  };

  // Puntuación de datos estructurados
  private static readonly STRUCTURED_DATA_SCORE_MAP: Record<StructuredDataPct, number> = {
    gte_80: 0.0,
    '60_80': 0.4,
    '40_60': 0.7,
    lt_40: 1.0
  };

  // Valores predeterminados de tarifas según moneda
  private static readonly DEFAULT_RATES: Record<'CLP' | 'USD' | 'UF', { labor: number; target: number; internal: number }> = {
    CLP: { labor: 14000, target: 36000, internal: 18000 },
    USD: { labor: 15, target: 40, internal: 20 },
    UF: { labor: 0.36, target: 0.95, internal: 0.48 }
  };

  /**
   * Ejecuta el cálculo completo del levantamiento
   */
  public static calculate(inputs: ScopingInputs): ScopingCalculationResult {
    const blockers: string[] = [];
    const recommendations: string[] = [];
    const currency = inputs.currency || 'CLP';
    const rates = this.DEFAULT_RATES[currency];

    const hourlyLaborCost = inputs.hourly_labor_cost ?? rates.labor;
    const targetHourlyRate = inputs.target_hourly_rate ?? rates.target;
    const internalCostRate = inputs.internal_cost_rate ?? rates.internal;

    // 1. Viabilidad y Eliminación (Gate 0)
    let viability_status: ViabilityStatus = 'viable';
    let viability_label = 'Factible para Automatización';
    let is_viable = true;

    if (inputs.data_input_type === 'non_digital_unstructured') {
      viability_status = 'not_viable';
      viability_label = 'No se puede automatizar con RPA';
      is_viable = false;
      blockers.push('Los datos de entrada no son digitales ni estructurados. Requiere rediseño previo del proceso.');
    } else if (inputs.data_input_type === 'non_digital_structured') {
      viability_status = 'digitize_first';
      viability_label = 'Digitalizar Primero';
      is_viable = false;
      blockers.push('Los datos son físicos/en papel. Se requiere digitalización o portal de captura previa al robot.');
    } else if (inputs.process_stability === 'significant_change' || inputs.application_stability === 'significant_change') {
      viability_status = 'postpone';
      viability_label = 'Posponer Proyecto';
      is_viable = false;
      blockers.push('Se esperan cambios significativos en procesos o aplicaciones en los próximos 6 meses. Construir ahora generará alto retrabajo.');
    } else if (inputs.rule_based_level === 'mostly_subjective' || inputs.rule_based_level === 'purely_subjective') {
      viability_status = 'low_viability';
      viability_label = 'Baja Viabilidad por Alta Subjetividad';
      is_viable = false;
      blockers.push('El proceso depende predominantemente del criterio o juicio humano no estructurado.');
    }

    if (inputs.uses_vdi) {
      recommendations.push('Aplicación en VDI/Citrix detectada (Multiplicador 1.6x): Se requerirá automatización de superficie, OCR o canal dedicado.');
    }
    if (inputs.requires_ocr) {
      recommendations.push('Documentos escaneados detectados (Multiplicador 1.2x): Requiere módulo de Inteligencia Documental / OCR.');
    }

    // 2. Volumetría y Horas Manuales
    const annualRuns = this.FREQUENCY_ANNUAL_MAP[inputs.frequency];
    const safeVolume = Math.max(1, inputs.volume_per_frequency || 1);
    const safeAht = Math.max(0.1, inputs.aht_minutes || 1);
    const annualManualHours = Math.round(annualRuns * safeVolume * (safeAht / 60));
    
    // 1 FTE = 260 días * 8 horas = 2080 horas anuales
    const currentEstimatedFtes = inputs.current_ftes && inputs.current_ftes > 0 
      ? inputs.current_ftes 
      : Number((annualManualHours / 2080).toFixed(2));

    // 3. Complejidad y Dificultad (Scorecard)
    const procStabilityScore = this.STABILITY_SCORE_MAP[inputs.process_stability];
    const appStabilityScore = this.STABILITY_SCORE_MAP[inputs.application_stability];
    const avgStability = (procStabilityScore + appStabilityScore) / 2;

    const appsScore = this.APPS_SCORE_MAP[inputs.applications_count];
    const stepsScore = this.STEPS_SCORE_MAP[inputs.process_steps_count];
    const logicScore = this.DECISION_SCORE_MAP[inputs.decision_complexity];
    const dataScore = this.STRUCTURED_DATA_SCORE_MAP[inputs.structured_data_pct];

    // Fórmulas exactas del Scorecard Excel:
    // (10%*Stability + 10%*Applications + 10%*Process_Steps + 30%*Process_Logic + 40%*Input_Data) * Thin_Client * Scanned
    const vdiMultiplier = inputs.uses_vdi ? 1.6 : 1.0;
    const ocrMultiplier = inputs.requires_ocr ? 1.2 : 1.0;

    const baseDifficulty = (
      0.10 * avgStability +
      0.10 * appsScore +
      0.10 * stepsScore +
      0.30 * logicScore +
      0.40 * dataScore
    );

    const difficultyScore = Math.min(1.0, Number((baseDifficulty * vdiMultiplier * ocrMultiplier).toFixed(4)));
    const complexityScore = Number(baseDifficulty.toFixed(4));

    let effort_level: EffortLevel = 'low';
    let effort_label = 'Bajo Esfuerzo';

    if (difficultyScore > 0.65) {
      effort_level = 'high';
      effort_label = 'Alto Esfuerzo';
    } else if (difficultyScore > 0.35) {
      effort_level = 'medium';
      effort_label = 'Mediano Esfuerzo';
    }

    // 4. Nivel de Beneficio y Reducciones
    // Nivel de beneficio: Digital * (1 - Exceptions - 50%*Input_Data - 10%*Process_Logic)
    const isDigital = inputs.data_input_type === 'digital_structured' || inputs.data_input_type === 'digital_unstructured';
    const exceptionRateFraction = (inputs.exception_rate_pct ?? 3) / 100;
    
    let rawBenefit = isDigital 
      ? (1 - exceptionRateFraction - 0.50 * dataScore - 0.10 * logicScore)
      : 0.1;
    rawBenefit = Math.max(0.05, Math.min(0.95, rawBenefit));
    const benefit_score = Number(rawBenefit.toFixed(4));

    let benefit_level: BenefitLevel = 'low';
    let benefit_label = 'Bajo Beneficio';
    if (benefit_score >= 0.65) {
      benefit_level = 'high';
      benefit_label = 'Alto Beneficio';
    } else if (benefit_score >= 0.35) {
      benefit_level = 'medium_high';
      benefit_label = 'Mediano a Alto Beneficio';
    } else if (benefit_score > 0.10) {
      benefit_level = 'medium';
      benefit_label = 'Mediano Beneficio';
    }

    const error_reduction_pct = Math.round(benefit_score * 100);
    const aht_reduction_pct = Math.round((2 / 3) * benefit_score * 100);
    const hours_saved_annual = Math.round(annualManualHours * (aht_reduction_pct / 100));
    const ftes_released = Number((hours_saved_annual / 2080).toFixed(2));

    // 5. Cubicación de Esfuerzo (HH por Rol y Semanas)
    // Basado fielmente en:
    // - "CL - FACTURAS PROVEEDORES - Esfuerzo v0.3.xlsx" (Caso Alto Esfuerzo: 10 semanas, 666 HH, LP 72h, CRPA 216h, AR 324h, ADV 54h)
    // - Tabla Esfuerzos Supuestos: Bajo ~230h, Medio ~490h, Alto ~666h
    let estimatedWeeks = 6;
    let hoursPm = 24;
    let hoursConsultant = 54;
    let hoursDeveloper = 140;
    let hoursAdvisor = 18;

    if (effort_level === 'medium') {
      estimatedWeeks = 8;
      hoursPm = 48;
      hoursConsultant = 120;
      hoursDeveloper = 288;
      hoursAdvisor = 36;
    } else if (effort_level === 'high') {
      estimatedWeeks = 10;
      hoursPm = 72;
      hoursConsultant = 216;
      hoursDeveloper = 324;
      hoursAdvisor = 54;
    }

    // Sobrescritura si el usuario calibró manualmente las horas
    if (inputs.custom_hours) {
      if (inputs.custom_hours.weeks !== undefined) estimatedWeeks = inputs.custom_hours.weeks;
      if (inputs.custom_hours.lp !== undefined) hoursPm = inputs.custom_hours.lp;
      if (inputs.custom_hours.crpa !== undefined) hoursConsultant = inputs.custom_hours.crpa;
      if (inputs.custom_hours.ar !== undefined) hoursDeveloper = inputs.custom_hours.ar;
      if (inputs.custom_hours.adv !== undefined) hoursAdvisor = inputs.custom_hours.adv;
    }

    const totalHours = hoursPm + hoursConsultant + hoursDeveloper + hoursAdvisor;

    // Desglose de Roles
    const roles_breakdown: RoleHoursEstimate[] = [
      {
        role_code: 'LP',
        role_name: 'Líder de Proyecto / PM',
        fte_equivalent: Number((hoursPm / (estimatedWeeks * 36)).toFixed(2)),
        total_hours: hoursPm,
        percentage: totalHours > 0 ? Math.round((hoursPm / totalHours) * 100) : 0
      },
      {
        role_code: 'CRPA',
        role_name: 'Consultor RPA / Arquitecto de Solución',
        fte_equivalent: Number((hoursConsultant / (estimatedWeeks * 36)).toFixed(2)),
        total_hours: hoursConsultant,
        percentage: totalHours > 0 ? Math.round((hoursConsultant / totalHours) * 100) : 0
      },
      {
        role_code: 'AR',
        role_name: 'Automatizador / Desarrollador RPA SSR',
        fte_equivalent: Number((hoursDeveloper / (estimatedWeeks * 36)).toFixed(2)),
        total_hours: hoursDeveloper,
        percentage: totalHours > 0 ? Math.round((hoursDeveloper / totalHours) * 100) : 0
      },
      {
        role_code: 'ADV',
        role_name: 'Advisors on-demand / QA / DevOps',
        fte_equivalent: Number((hoursAdvisor / (estimatedWeeks * 36)).toFixed(2)),
        total_hours: hoursAdvisor,
        percentage: totalHours > 0 ? Math.round((hoursAdvisor / totalHours) * 100) : 0
      }
    ];

    // Desglose de Fases (Cronograma)
    const phases_breakdown: ProjectPhaseEstimate[] = [
      {
        phase_number: 1,
        name: 'Levantamiento y Validación de Requerimientos',
        description: 'Reuniones de detalle, reglas de negocio, matrices de excepción y confirmación de accesos.',
        start_week: 1,
        end_week: Math.max(1, Math.round(estimatedWeeks * 0.2)),
        percentage: 15,
        hours: Math.round(totalHours * 0.15)
      },
      {
        phase_number: 2,
        name: 'Desarrollo y Construcción del Robot RPA',
        description: 'Construcción de componentes, integración con sistemas ERP/Web, selectores y lógica de validación.',
        start_week: Math.max(1, Math.round(estimatedWeeks * 0.2)),
        end_week: Math.max(2, Math.round(estimatedWeeks * 0.65)),
        percentage: 45,
        hours: Math.round(totalHours * 0.45)
      },
      {
        phase_number: 3,
        name: 'Pruebas de Ejecución y Calidad (Testing & QA)',
        description: 'Pruebas unitarias, escenarios de excepción, volumen controlado y validación de datos.',
        start_week: Math.max(2, Math.round(estimatedWeeks * 0.55)),
        end_week: Math.max(3, Math.round(estimatedWeeks * 0.8)),
        percentage: 20,
        hours: Math.round(totalHours * 0.20)
      },
      {
        phase_number: 4,
        name: 'Ajustes y Pruebas de Aceptación (UAT)',
        description: 'Acompañamiento a usuarios del cliente en pruebas UAT y refinamiento de discrepancias.',
        start_week: Math.max(3, Math.round(estimatedWeeks * 0.75)),
        end_week: Math.max(4, Math.round(estimatedWeeks * 0.9)),
        percentage: 10,
        hours: Math.round(totalHours * 0.10)
      },
      {
        phase_number: 5,
        name: 'Puesta en Marcha Productiva y Estabilización (Hipercare)',
        description: 'Pase a producción, monitoreo activo de ejecuciones, traspaso a soporte y entrega de actas.',
        start_week: Math.max(4, Math.round(estimatedWeeks * 0.85)),
        end_week: estimatedWeeks,
        percentage: 10,
        hours: Math.round(totalHours * 0.10)
      }
    ];

    // 6. Impacto Económico y ROI
    const projectInternalCost = Math.round(totalHours * internalCostRate);
    const proposedPrice = Math.round(totalHours * targetHourlyRate);
    const projectedMarginPct = proposedPrice > 0 
      ? Math.round(((proposedPrice - projectInternalCost) / proposedPrice) * 100) 
      : 0;

    const clientAnnualManualCost = Math.round(annualManualHours * hourlyLaborCost);
    const clientAnnualSavings = Math.round(hours_saved_annual * hourlyLaborCost);
    
    const paybackMonths = clientAnnualSavings > 0 
      ? Number(((proposedPrice / clientAnnualSavings) * 12).toFixed(1)) 
      : 0;

    const roiFirstYearPct = proposedPrice > 0 
      ? Math.round(((clientAnnualSavings - proposedPrice) / proposedPrice) * 100) 
      : 0;

    const viabilityScore = is_viable ? Number((1 - difficultyScore * 0.4).toFixed(2)) : 0.2;

    return {
      viability_status,
      viability_label,
      viability_score: viabilityScore,
      is_viable,
      blockers,
      recommendations,

      complexity_score: complexityScore,
      difficulty_score: difficultyScore,
      effort_level,
      effort_label,
      vdi_multiplier: vdiMultiplier,
      ocr_multiplier: ocrMultiplier,

      annual_runs: annualRuns,
      annual_manual_hours: annualManualHours,
      current_estimated_ftes: currentEstimatedFtes,
      benefit_score,
      benefit_level,
      benefit_label,
      error_reduction_pct,
      aht_reduction_pct,
      hours_saved_annual,
      ftes_released,

      estimated_weeks: estimatedWeeks,
      hours_pm: hoursPm,
      hours_consultant: hoursConsultant,
      hours_developer: hoursDeveloper,
      hours_advisor: hoursAdvisor,
      total_hours: totalHours,
      roles_breakdown,
      phases_breakdown,

      currency,
      target_hourly_rate: targetHourlyRate,
      project_internal_cost: projectInternalCost,
      proposed_price: proposedPrice,
      projected_margin_pct: projectedMarginPct,
      client_annual_manual_cost: clientAnnualManualCost,
      client_annual_savings: clientAnnualSavings,
      payback_months: paybackMonths,
      roi_first_year_pct: roiFirstYearPct
    };
  }
}
