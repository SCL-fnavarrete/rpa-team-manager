import { describe, it, expect } from 'vitest';
import {
  canConvertScoping,
  canDeleteScoping,
  canModifyScoping,
  canSeeInternalCosts,
  isConvertibleRecord
} from '@/utils/scopingPermissions';

const roles = ['team_lead', 'rpa_developer', 'rpa_operations', 'it_support', 'billing'] as const;
const userWith = (role: string, id = 1) => ({ id, role });

describe('canSeeInternalCosts', () => {
  it('costos internos y márgenes solo para team_lead', () => {
    expect(roles.filter((role) => canSeeInternalCosts(userWith(role)))).toEqual(['team_lead']);
  });

  it('sin sesión no se ve nada', () => {
    expect(canSeeInternalCosts(null)).toBe(false);
    expect(canSeeInternalCosts(undefined)).toBe(false);
  });
});

describe('canConvertScoping', () => {
  it('convertir en proyecto: solo team_lead y rpa_operations (igual que el backend)', () => {
    expect(roles.filter((role) => canConvertScoping(userWith(role)))).toEqual(['team_lead', 'rpa_operations']);
  });

  it('sin sesión no se puede', () => {
    expect(canConvertScoping(null)).toBe(false);
  });
});

describe('canModifyScoping / canDeleteScoping', () => {
  const own = { created_by: 5, status: 'draft' };
  const foreign = { created_by: 9, status: 'draft' };

  it('el autor modifica y borra su borrador', () => {
    expect(canModifyScoping(userWith('rpa_developer', 5), own)).toBe(true);
    expect(canDeleteScoping(userWith('rpa_developer', 5), own)).toBe(true);
  });

  it('un rol sin jefatura no toca lo ajeno', () => {
    for (const role of ['rpa_developer', 'rpa_operations', 'it_support', 'billing']) {
      expect(canModifyScoping(userWith(role, 5), foreign)).toBe(false);
      expect(canDeleteScoping(userWith(role, 5), foreign)).toBe(false);
    }
  });

  it('team_lead modifica y borra borradores ajenos', () => {
    expect(canModifyScoping(userWith('team_lead', 1), foreign)).toBe(true);
    expect(canDeleteScoping(userWith('team_lead', 1), foreign)).toBe(true);
  });

  it('solo se borran borradores, aunque sea el autor o team_lead', () => {
    const sent = { created_by: 5, status: 'sent_to_client' };
    expect(canDeleteScoping(userWith('rpa_developer', 5), sent)).toBe(false);
    expect(canDeleteScoping(userWith('team_lead', 1), sent)).toBe(false);
    // modificar sí sigue permitido (el backend solo bloquea las ya convertidas)
    expect(canModifyScoping(userWith('rpa_developer', 5), sent)).toBe(true);
  });

  it('un registro sin autor solo lo modifica team_lead', () => {
    expect(canModifyScoping(userWith('rpa_developer', 5), { status: 'draft' })).toBe(false);
    expect(canModifyScoping(userWith('team_lead', 1), { status: 'draft' })).toBe(true);
  });

  it('sin sesión no se puede nada', () => {
    expect(canModifyScoping(null, own)).toBe(false);
    expect(canDeleteScoping(undefined, own)).toBe(false);
  });
});

describe('isConvertibleRecord', () => {
  it('solo es convertible lo viable que aún no se convirtió (el backend responde 409 en cualquier otro caso)', () => {
    expect(isConvertibleRecord({ viability_status: 'viable', status: 'draft' })).toBe(true);
    expect(isConvertibleRecord({ viability_status: 'viable', status: 'approved' })).toBe(true);
    for (const viability_status of ['digitize_first', 'postpone', 'low_viability', 'not_viable']) {
      expect(isConvertibleRecord({ viability_status, status: 'draft' })).toBe(false);
    }
    expect(isConvertibleRecord({ viability_status: 'viable', status: 'converted_to_project' })).toBe(false);
  });
});
