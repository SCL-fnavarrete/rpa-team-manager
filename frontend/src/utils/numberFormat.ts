/**
 * Utilidades de formato numérico y monetario en Español
 * 
 * Reglas de formato (CL / ES / LATAM):
 * - Separador de miles: punto (.) -> ej: 1.000, 1.500.000
 * - Separador de decimales: coma (,) -> ej: 1.234,56
 */

export interface FormatNumberOptions {
  decimals?: number;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

/**
 * Formatea un valor numérico con separación de miles por punto (.) y decimales por coma (,)
 */
export function formatSpanishNumber(
  value: number | string | null | undefined,
  options?: FormatNumberOptions
): string {
  if (value === null || value === undefined || value === '') return '0';
  const num = typeof value === 'number' ? value : Number(value);
  if (isNaN(num)) return '0';

  const isInt = Number.isInteger(num);
  let minDec = options?.decimals !== undefined 
    ? options.decimals 
    : (options?.minimumFractionDigits ?? 0);
  let maxDec = options?.decimals !== undefined 
    ? options.decimals 
    : (options?.maximumFractionDigits ?? (isInt ? 0 : 2));

  // Manejar signo negativo correctamente
  const isNegative = num < 0;
  const absNum = Math.abs(num);

  const parts = absNum.toFixed(maxDec).split('.');
  const integerPart = parts[0];
  let decimalPart = parts[1] || '';

  // Quitar ceros a la derecha si no se especificó un mínimo fijo
  if (options?.decimals === undefined && options?.minimumFractionDigits === undefined) {
    decimalPart = decimalPart.replace(/0+$/, '');
  } else if (minDec < maxDec) {
    while (decimalPart.length > minDec && decimalPart.endsWith('0')) {
      decimalPart = decimalPart.slice(0, -1);
    }
  }

  // Separador de miles con punto (.)
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = isNegative ? '-' : '';

  return decimalPart.length > 0 
    ? `${sign}${formattedInteger},${decimalPart}` 
    : `${sign}${formattedInteger}`;
}

/**
 * Formato de moneda CLP ($1.500.000 CLP)
 */
export function formatCLP(amount: number | string | null | undefined): string {
  const rounded = Math.round(Number(amount || 0));
  return `$${formatSpanishNumber(rounded)} CLP`;
}

/**
 * Formato de moneda genérico según código (ej: $1.234.567 CLP o USD 1.234,50)
 */
export function formatCurrency(
  amount: number | string | null | undefined, 
  currency: string = 'CLP',
  options?: FormatNumberOptions
): string {
  const isCLP = currency.toUpperCase() === 'CLP';
  if (isCLP) {
    return formatCLP(amount);
  }
  const formatted = formatSpanishNumber(amount, {
    decimals: options?.decimals ?? 2,
    ...options
  });
  return `${currency} ${formatted}`;
}

/**
 * Formato de porcentaje con coma decimal (ej: 12,5%)
 */
export function formatPercent(value: number | string | null | undefined, decimals: number = 1): string {
  return `${formatSpanishNumber(value, { decimals })}%`;
}

/**
 * Inicializa el reemplazo global de Number.prototype.toLocaleString
 * para garantizar separación de miles por punto (.) en todo el frontend.
 */
export function setupSpanishNumberFormatting(): void {
  if (typeof window === 'undefined') return;

  const originalToLocaleString = Number.prototype.toLocaleString;

  Number.prototype.toLocaleString = function(locales?: string | string[], options?: Intl.NumberFormatOptions) {
    // Si no se especificó locale, o se pide es / es-CL / es-ES, usar formato español con puntos
    const isSpanish = !locales || 
      (typeof locales === 'string' && (locales.startsWith('es') || locales === 'default')) ||
      (Array.isArray(locales) && locales.some(l => l.startsWith('es')));

    if (isSpanish) {
      return formatSpanishNumber(Number(this), {
        minimumFractionDigits: options?.minimumFractionDigits,
        maximumFractionDigits: options?.maximumFractionDigits
      });
    }

    return originalToLocaleString.call(this, locales, options);
  };
}
