export type PMORolePerspective = 'general_manager' | 'commercial' | 'controller' | 'operations';

// Los campos opcionales de costo, utilidad y margen solo los envía el backend a team_lead
// (rpa_operations y billing no los reciben): las vistas deben ocultar lo que no llega.
export interface PMOGeneralManagerData {
  consolidated_pnl: {
    total_sold_clp: number;
    total_real_cost_clp?: number;
    total_gross_profit_clp?: number;
    avg_margin_pct?: number;
    active_projects_count: number;
    total_projects_count: number;
    billable_hours_ratio: number;
  };
  cashflow_forecast: Array<{
    month: string;
    expected_amount_clp: number;
  }>;
  portfolio_health_summary: {
    healthy: number;
    warning: number;
    critical: number;
  };
  top_risk_projects: Array<{
    id: number;
    name: string;
    client_name: string;
    assigned_to_name: string;
    project_health_status: 'healthy' | 'warning' | 'critical';
    schedule_variance_days: number;
    cost_variance_clp?: number;
    real_cost_clp?: number;
    budgeted_cost_clp?: number;
    progress_pct: number;
    days_to_deadline: number | null;
    critical_reason: string;
    risk_level: string;
  }>;
  team_utilization_summary: {
    total_planned_fte: number;
    total_developers: number;
    overutilized_count: number;
    optimal_count: number;
    underutilized_count: number;
  };
}

export interface PMOCommercialData {
  ready_to_invoice: Array<{
    milestone_id: number;
    milestone_name: string;
    amount: number;
    currency: string;
    amount_clp: number;
    status: string;
    planned_date: string | null;
    billable_at: string | null;
    trigger_type: string;
    project_id: number;
    project_name: string;
    client_name: string;
    source_milestone_name?: string;
    days_since_completed: number;
  }>;
  total_unlocked_revenue_clp: number;
  margin_variance?: Array<{
    project_id: number;
    project_name: string;
    client_name: string;
    quoted_margin_pct: number;
    real_margin_pct: number;
    margin_leakage_pct: number;
    quoted_hours: number;
    real_hours: number;
    hours_exceeded: number;
    quoted_amount_clp: number;
    real_cost_clp: number;
    pricing_model?: string;
  }>;
  scope_creep_alerts: Array<{
    project_id: number;
    project_name: string;
    client_name: string;
    quoted_hours: number;
    real_hours: number;
    overrun_hours: number;
    overrun_cost_clp?: number;
    severity: 'warning' | 'critical';
  }>;
  client_scorecards: Array<{
    client_id: number;
    client_name: string;
    active_projects: number;
    total_sold_clp: number;
    avg_satisfaction: number | null;
    health: 'healthy' | 'critical';
  }>;
}

export interface PMOControllerData {
  triple_conciliation: Array<{
    project_id: number;
    project_name: string;
    client_name: string;
    physical_progress_pct: number;
    cost_consumed_pct?: number;
    billed_pct: number;
    cpi?: number;
    deviation_flag: 'healthy' | 'cost_overrun' | 'unbilled_work' | 'critical_desynchronization';
    sale_price_clp: number;
    budgeted_cost_clp?: number;
    real_cost_clp?: number;
    invoiced_clp: number;
    paid_clp: number;
  }>;
  imputations_audit: {
    users_with_missing_days: Array<{
      user_id: number;
      user_name: string;
      user_role: string;
      missing_days_count: number;
      missing_dates: string[];
    }>;
    pending_approval_periods: Array<{
      period_id: number;
      user_name: string;
      week_start: string;
      total_hours: number;
      submitted_at: string;
    }>;
    billable_breakdown: {
      total_real_hours: number;
      total_billable_hours: number;
      total_internal_hours: number;
      billable_pct: number;
    };
  };
  cost_centers_summary: Array<{
    cost_center_id: number;
    code: string;
    name: string;
    country: string;
    is_rpa: boolean;
    allocated_projects_count: number;
    total_budget_clp: number;
  }>;
  aging_portfolio: {
    current_clp: number;
    overdue_30_clp: number;
    overdue_60_clp: number;
    total_overdue_clp: number;
    overdue_invoices: Array<{
      id: number;
      invoice_number: string;
      project_name: string;
      client_name: string;
      amount: number;
      amount_paid: number;
      currency: string;
      due_date: string;
      days_overdue: number;
    }>;
  };
}

export interface PMOExecutiveSuiteResponse {
  general_manager: PMOGeneralManagerData;
  commercial: PMOCommercialData;
  controller: PMOControllerData;
}
