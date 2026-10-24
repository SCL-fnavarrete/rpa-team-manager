// Espejo de PortfolioFilters / PortfolioRow / PortfolioResult de backend/src/services/portfolioService.ts

export type PortfolioCommercialStage = 'quoting' | 'approved' | 'lost';

export type PortfolioHealthSemaphore = 'green' | 'yellow' | 'red' | 'gray';

export interface PortfolioFilters {
  client_id?: number;
  sales_rep_id?: number;
  commercial_stage?: PortfolioCommercialStage;
  area_id?: number;
}

export interface PortfolioRow {
  project_id: number;
  project_name: string;
  status: string;
  commercial_stage: string;
  client_id: number | null;
  client_name: string | null;
  sales_rep_id: number | null;
  sales_rep_name: string | null;
  area_id: number | null;
  area_name: string | null;
  sale_price: number;
  real_cost: number;
  projected_cost: number;
  real_profit: number;
  projected_profit: number;
  real_margin_percentage: number;
  projected_margin_percentage: number;
  /** 'projected': el costo real es el planificado porque el proyecto aún no tiene horas aprobadas. */
  real_hours_source: 'approved' | 'projected';
  health_semaphore: PortfolioHealthSemaphore;
  invoiced_clp: number;
  collected_clp: number;
  pending_to_invoice_clp: number;
  financials_error: boolean;
}

export interface PortfolioTotals {
  projects: number;
  sale_price: number;
  real_cost: number;
  projected_cost: number;
  projected_profit: number;
  invoiced_clp: number;
  collected_clp: number;
  pending_to_invoice_clp: number;
}

export interface PortfolioPipelineItem {
  project_id: number;
  project_name: string;
  client_name: string | null;
  sales_rep_name: string | null;
  last_quote_amount_clp: number;
  last_quote_version: number | null;
}

export interface PortfolioSalesByRep {
  sales_rep_id: number | null;
  sales_rep_name: string;
  projects: number;
  sale_price: number;
}

export interface PortfolioResult {
  rows: PortfolioRow[];
  totals: PortfolioTotals;
  pipeline: PortfolioPipelineItem[];
  sales_by_rep: PortfolioSalesByRep[];
}
