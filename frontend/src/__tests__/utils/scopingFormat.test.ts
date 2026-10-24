import { describe, it, expect } from 'vitest';
import {
  applicationsLabel,
  dataInputLabel,
  formatMoney,
  formatQuoteDate,
  frequencyLabel,
  paybackLabel
} from '@/utils/scopingFormat';

describe('formatMoney', () => {
  it('usa punto de miles y coma decimal con el código de la moneda por delante', () => {
    expect(formatMoney(17712000, 'CLP')).toBe('CLP 17.712.000');
    expect(formatMoney(40, 'USD')).toBe('USD 40');
    expect(formatMoney(0.95, 'UF')).toBe('UF 0,95');
    expect(formatMoney(1234.567, 'USD')).toBe('USD 1.234,57');
  });

  it('redondea los pesos chilenos (no tienen decimales) y parte en CLP si no hay moneda', () => {
    expect(formatMoney(1234.6, 'CLP')).toBe('CLP 1.235');
    expect(formatMoney(5000)).toBe('CLP 5.000');
  });

  it('un valor ausente se muestra como cero, nunca como NaN', () => {
    expect(formatMoney(undefined, 'CLP')).toBe('CLP 0');
    expect(formatMoney(null, 'USD')).toBe('USD 0');
  });
});

describe('formatQuoteDate', () => {
  it('formatea una marca ISO con zona como DD-MM-AAAA', () => {
    expect(formatQuoteDate('2026-10-20T12:00:00Z')).toBe('20-10-2026');
  });

  it('trata la marca de SQLite (sin zona) como UTC', () => {
    expect(formatQuoteDate('2026-10-20 12:00:00')).toBe('20-10-2026');
  });

  it('una fecha sin hora no se corre un día por la zona horaria', () => {
    expect(formatQuoteDate('2026-10-20')).toBe('20-10-2026');
  });

  it('devuelve vacío si no hay fecha o no es válida', () => {
    expect(formatQuoteDate(undefined)).toBe('');
    expect(formatQuoteDate(null)).toBe('');
    expect(formatQuoteDate('')).toBe('');
    expect(formatQuoteDate('no es una fecha')).toBe('');
  });
});

describe('etiquetas legibles de la propuesta', () => {
  it('distingue las cuatro entradas de datos (antes todo lo que no era estructurado salía como "Digital Mixta")', () => {
    expect(dataInputLabel('digital_structured')).toBe('Digital estructurada');
    expect(dataInputLabel('digital_unstructured')).toMatch(/^Digital mixta/);
    expect(dataInputLabel('non_digital_structured')).toMatch(/^No digital/);
    expect(dataInputLabel('non_digital_unstructured')).toMatch(/^No digital/);
    expect(dataInputLabel('non_digital_structured')).not.toBe(dataInputLabel('non_digital_unstructured'));
  });

  it('traduce la cantidad de aplicaciones sin guiones bajos', () => {
    expect(applicationsLabel('1_app')).toBe('1 aplicación');
    expect(applicationsLabel('2_3_apps')).toBe('2-3 aplicaciones');
    expect(applicationsLabel('4_5_apps')).toBe('4-5 aplicaciones');
    expect(applicationsLabel('gt_5_apps')).toBe('Más de 5 aplicaciones');
  });

  it('traduce la frecuencia al español', () => {
    expect(frequencyLabel('daily')).toBe('Diaria');
    expect(frequencyLabel('weekly')).toBe('Semanal');
    expect(frequencyLabel('biweekly')).toBe('Bisemanal');
    expect(frequencyLabel('monthly')).toBe('Mensual');
    expect(frequencyLabel('quarterly')).toBe('Trimestral');
    expect(frequencyLabel('annual')).toBe('Anual');
  });

  it('un valor desconocido se muestra tal cual en vez de romper', () => {
    expect(dataInputLabel('otro')).toBe('otro');
    expect(applicationsLabel('otro')).toBe('otro');
    expect(frequencyLabel('otro')).toBe('otro');
    expect(frequencyLabel(undefined)).toBe('');
  });
});

describe('paybackLabel (M1)', () => {
  it('sin ahorro anual no hay retorno: "Sin retorno", nunca "Inmediato"', () => {
    expect(paybackLabel({ payback_months: 0, client_annual_savings: 0 })).toBe('Sin retorno');
  });

  it('con ahorro muestra los meses con coma decimal', () => {
    expect(paybackLabel({ payback_months: 4.5, client_annual_savings: 9000000 })).toBe('4,5 meses');
    expect(paybackLabel({ payback_months: 12, client_annual_savings: 9000000 })).toBe('12 meses');
  });

  it('con ahorro y sin inversión que recuperar sí es inmediato', () => {
    expect(paybackLabel({ payback_months: 0, client_annual_savings: 9000000 })).toBe('Inmediato');
  });
});
