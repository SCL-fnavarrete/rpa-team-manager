/**
 * Qué puede ver y hacer cada rol en el Cotizador RPA. Espeja las reglas del backend
 * (scopingService / scopingRoutes): la UI solo evita ofrecer acciones que el servidor rechazaría.
 */

interface ScopingActor {
  id?: number;
  role?: string;
}

interface ScopingRecordLike {
  created_by?: number | null;
  status?: string;
  viability_status?: string;
  converted_project_id?: number | null;
}

type MaybeActor = ScopingActor | null | undefined;

// Costos internos y márgenes: decisión 7 del plan maestro, solo team_lead
export const canSeeInternalCosts = (user: MaybeActor): boolean => user?.role === 'team_lead';

// Convertir en proyecto: igual que crear un proyecto (POST /api/projects)
export const canConvertScoping = (user: MaybeActor): boolean =>
  user?.role === 'team_lead' || user?.role === 'rpa_operations';

// Editar y borrar: el autor o team_lead
export const canModifyScoping = (user: MaybeActor, record: ScopingRecordLike): boolean => {
  if (!user) return false;
  if (user.role === 'team_lead') return true;
  return record.created_by != null && record.created_by === user.id;
};

// Borrar además exige que siga en borrador
export const canDeleteScoping = (user: MaybeActor, record: ScopingRecordLike): boolean =>
  canModifyScoping(user, record) && record.status === 'draft';

// Ligada a un proyecto existente. Lo decide `converted_project_id`, no el estado: si borran el proyecto la fila queda
// en `converted_to_project` con el id NULL y el backend permite editarla y convertirla de nuevo.
export const isLinkedToProject = (record: ScopingRecordLike): boolean => record.converted_project_id != null;

// El backend responde 409 si ya tiene proyecto o si no es exactamente "viable"
export const isConvertibleRecord = (record: ScopingRecordLike): boolean =>
  record.viability_status === 'viable' && !isLinkedToProject(record);
