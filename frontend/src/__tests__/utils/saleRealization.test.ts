import { describe, it, expect } from 'vitest';
import { hasClientApproval, isSaleRealized } from '@/utils/saleRealization';

describe('saleRealization', () => {
  it('una venta realizada requiere el OK del cliente y que el proyecto no esté cancelado', () => {
    expect(isSaleRealized({ commercial_stage: 'approved', status: 'active' })).toBe(true);
    expect(isSaleRealized({ commercial_stage: 'approved', status: 'on_hold' })).toBe(true);
    expect(isSaleRealized({ commercial_stage: 'approved', status: 'completed' })).toBe(true);
    expect(isSaleRealized({ commercial_stage: 'approved', status: 'cancelled' })).toBe(false);
    expect(isSaleRealized({ commercial_stage: 'lost', status: 'active' })).toBe(false);
    expect(isSaleRealized({ commercial_stage: 'quoting', status: 'on_hold' })).toBe(false);
    expect(isSaleRealized({ commercial_stage: 'quoting', status: 'cancelled' })).toBe(false);
  });

  it('un proyecto en cotización ya activo o completado (creado desde una cotización) cuenta como aprobado', () => {
    expect(hasClientApproval({ commercial_stage: 'quoting', status: 'active' })).toBe(true);
    expect(hasClientApproval({ commercial_stage: 'quoting', status: 'completed' })).toBe(true);
    expect(isSaleRealized({ commercial_stage: 'quoting', status: 'active' })).toBe(true);
  });

  it('sin etapa comercial no hay OK del cliente', () => {
    expect(hasClientApproval({ status: 'active' })).toBe(false);
    expect(hasClientApproval({ commercial_stage: 'lost', status: 'completed' })).toBe(false);
  });
});
