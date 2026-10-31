import { formatSpanishNumber } from './numberFormat';

/**
 * Formato y etiquetas legibles del Cotizador RPA (propuesta, panel en vivo e historial).
 * Los identificadores de la API (`2_3_apps`, `daily`...) nunca se muestran al usuario.
 */

// "CLP 17.712.000", "USD 40", "UF 0,95": código de la moneda por delante, punto de miles y coma decimal
export function formatMoney(value: number | null | undefined, currency: string = 'CLP'): string {
  const amount = currency === 'CLP' ? Math.round(Number(value) || 0) : value;
  return `${currency} ${formatSpanishNumber(amount)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

// Fecha DD-MM-AAAA de una marca de la API. SQLite guarda CURRENT_TIMESTAMP en UTC y sin zona ("2026-10-20 12:00:00")
export function formatQuoteDate(value?: string | null): string {
  if (!value) return '';
  // Una fecha sin hora se formatea tal cual: pasarla por Date la correría un día hacia atrás en Chile
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return `${dateOnly[3]}-${dateOnly[2]}-${dateOnly[1]}`;

  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const date = new Date(hasZone ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

const DATA_INPUT_LABELS: Record<string, string> = {
  digital_structured: 'Digital estructurada',
  digital_unstructured: 'Digital mixta (con datos no estructurados)',
  non_digital_structured: 'No digital estructurada (papel o formularios físicos)',
  non_digital_unstructured: 'No digital y no estructurada'
};

const APPLICATIONS_LABELS: Record<string, string> = {
  '1_app': '1 aplicación',
  '2_3_apps': '2-3 aplicaciones',
  '4_5_apps': '4-5 aplicaciones',
  gt_5_apps: 'Más de 5 aplicaciones'
};

const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'Diaria',
  weekly: 'Semanal',
  biweekly: 'Bisemanal',
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  annual: 'Anual'
};

export const dataInputLabel = (type: string): string => DATA_INPUT_LABELS[type] ?? type;
export const applicationsLabel = (count: string): string => APPLICATIONS_LABELS[count] ?? count;
export const frequencyLabel = (frequency?: string): string => (frequency ? FREQUENCY_LABELS[frequency] ?? frequency : '');

// El motor devuelve payback 0 tanto sin ahorro (nunca se recupera) como sin inversión; solo el segundo es "Inmediato"
export function paybackLabel(calculation: { payback_months: number; client_annual_savings: number }): string {
  if (calculation.client_annual_savings <= 0) return 'Sin retorno';
  if (calculation.payback_months > 0) return `${formatSpanishNumber(calculation.payback_months)} meses`;
  return 'Inmediato';
}
