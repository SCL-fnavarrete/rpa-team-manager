/**
 * Tipos TypeScript para el Cotizador y Levantamiento Express de RPA
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
  client_name?: string;
  client_contact?: string;
  client_email?: string;
  process_name?: string;
  business_unit?: string;
  process_archetype?: string;

  data_input_type: DataInputType;
  rule_based_level: RuleBasedLevel;
  process_stability: ProcessStability;
  application_stability: ProcessStability;
  
  frequency: ProcessFrequency;
  volume_per_frequency: number;
  aht_minutes: number;
  current_ftes?: number;
  error_rate_pct?: number;
  peak_period?: PeakPeriod;
  
  process_steps_count: StepsCount;
  decision_complexity: DecisionComplexity;
  applications_count: ApplicationsCount;
  applications_detail?: string;
  uses_vdi: boolean;
  requires_ocr: boolean;
  structured_data_pct: StructuredDataPct;
  exception_rate_pct?: number;
  
  currency?: 'CLP' | 'USD' | 'UF';
  hourly_labor_cost?: number;
  target_hourly_rate?: number;
  internal_cost_rate?: number;

  assumptions?: string;
  exclusions?: string;
  notes?: string;
  status?: 'draft' | 'sent_to_client' | 'approved' | 'rejected' | 'converted_to_project';

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
  viability_status: ViabilityStatus;
  viability_label: string;
  viability_score: number;
  is_viable: boolean;
  blockers: string[];
  recommendations: string[];
  
  complexity_score: number;
  difficulty_score: number;
  effort_level: EffortLevel;
  effort_label: string;
  vdi_multiplier: number;
  ocr_multiplier: number;
  
  annual_runs: number;
  annual_manual_hours: number;
  current_estimated_ftes: number;
  benefit_score: number;
  benefit_level: BenefitLevel;
  benefit_label: string;
  error_reduction_pct: number;
  aht_reduction_pct: number;
  hours_saved_annual: number;
  ftes_released: number;
  
  estimated_weeks: number;
  hours_pm: number;
  hours_consultant: number;
  hours_developer: number;
  hours_advisor: number;
  total_hours: number;
  roles_breakdown: RoleHoursEstimate[];
  phases_breakdown: ProjectPhaseEstimate[];
  
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

export interface RPAArchetype {
  id: string;
  name: string;
  category: 'Finanzas' | 'Operaciones' | 'Ventas' | 'TI & Datos';
  description: string;
  typical_systems: string;
  typical_frequency: string;
  typical_benefits: string;
  default_inputs: Partial<ScopingInputs>;
  recommended_questions: string[];
}

export interface ScopingQuotationRecord extends ScopingInputs {
  id: number;
  code: string;
  client_name: string;
  process_name: string;
  business_unit?: string;
  process_archetype: string;
  created_by?: number;
  author_name?: string;
  project_name?: string;
  created_at: string;
  updated_at: string;

  viability_status: ViabilityStatus;
  viability_score: number;
  complexity_score: number;
  difficulty_score: number;
  effort_level: EffortLevel;
  benefit_level: BenefitLevel;
  annual_manual_hours: number;
  hours_saved_annual: number;
  ftes_released: number;
  error_reduction_pct: number;
  aht_reduction_pct: number;

  estimated_weeks: number;
  hours_pm: number;
  hours_consultant: number;
  hours_developer: number;
  hours_advisor: number;
  total_hours: number;

  currency: 'CLP' | 'USD' | 'UF';
  hourly_labor_cost: number;
  target_hourly_rate: number;
  internal_cost_rate: number;
  project_internal_cost: number;
  proposed_price: number;
  projected_margin_pct: number;
  client_annual_manual_cost: number;
  client_annual_savings: number;
  payback_months: number;
  roi_first_year_pct: number;

  status: 'draft' | 'sent_to_client' | 'approved' | 'rejected' | 'converted_to_project';
  converted_project_id?: number | null;

  calculation?: ScopingCalculationResult;
}

export interface ScopingKpis {
  total_scopings: number;
  viable_percentage: number;
  total_quoted_hours: number;
  total_proposed_amount: number;
}
