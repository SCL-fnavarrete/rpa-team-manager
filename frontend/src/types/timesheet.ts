export interface TimeEntryRow {
  id: number;
  project_id: number;
  project_name: string;
  task_id: number | null;
  task_title: string | null;
  description: string | null;
  hours: number;
  date: string;
  is_billable: boolean;
  approval_status: 'draft' | 'submitted' | 'approved' | 'rejected';
  is_locked: boolean;
}

export interface TimesheetWeekDay {
  date: string;
  entries: TimeEntryRow[];
  total_hours: number;
}

export interface TimesheetPeriod {
  id: number;
  user_id: number;
  period_start: string;
  period_end: string;
  status: 'open' | 'submitted' | 'approved' | 'rejected';
  submitted_at: string | null;
  approved_by: number | null;
  approved_at: string | null;
  rejection_reason: string | null;
  user_name?: string;
  total_hours?: number;
  entries?: TimeEntryRow[];
}

export interface TimesheetWeek {
  period: TimesheetPeriod | null;
  days: TimesheetWeekDay[];
  total_hours: number;
}

export interface SaveWeekEntryInput {
  id?: number;
  project_id: number;
  task_id?: number | null;
  description?: string | null;
  date: string;
  hours: number;
  is_billable?: boolean;
}

export interface EffectivenessByPerson {
  user_id: number;
  user_name: string;
  estimated_hours: number;
  real_hours: number;
  utilization_pct: number;
  billable_pct: number;
}

export interface EffectivenessByTask {
  task_id: number;
  task_title: string;
  project_name: string;
  estimated_hours: number;
  real_hours: number;
  variance_hours: number;
}

export interface EffectivenessMetrics {
  from: string;
  to: string;
  by_person: EffectivenessByPerson[];
  by_task: EffectivenessByTask[];
}

export interface PendingReminders {
  missing_dates: string[];
  open_period: TimesheetPeriod | null;
}
