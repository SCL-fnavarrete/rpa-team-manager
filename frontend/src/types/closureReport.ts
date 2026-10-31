// Espejo de ClosureChecklistItem / ClosureReport de backend/src/services/closureReportService.ts

export interface ClosureChecklistItem {
  key: 'delivery_accepted' | 'payment_milestones' | 'invoices_paid' | 'timesheets_approved' | 'tasks_done' | 'required_documents';
  label: string;
  ok: boolean;
  pending_count: number;
  blocking: boolean;
}

export interface ClosureReport {
  project: {
    id: number;
    name: string;
    client_name: string | null;
    sales_rep_name: string | null;
    status: string;
    start_date: string | null;
    end_date: string | null;
    delivery_accepted_at: string | null;
    financial_closed_at: string | null;
  };
  checklist: ClosureChecklistItem[];
  can_close_financials: boolean;
  quoted: {
    amount_clp: number;
    hours: number;
    estimated_cost_clp: number;
    margin_percent: number | null;
    version: number | null;
  };
  actual: {
    sale_price: number;
    real_cost: number;
    real_profit: number;
    real_margin_percentage: number;
    approved_hours: number;
    real_hours_source: 'approved' | 'projected';
    planned_hours: number;
    variance_impact: number;
  };
  team: { user_name: string; budgeted_hours: number; actual_hours: number }[];
  milestones: { name: string; amount: number; currency: string; status: string; planned_date: string | null }[];
  generated_at: string;
}
