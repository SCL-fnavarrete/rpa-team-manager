// Espejo de isRealizedSale de backend/src/services/portfolioService.ts

/** Proyecto ya en marcha o terminado; una cotización real siempre está 'on_hold'. */
const EXECUTION_STATUSES = ['active', 'completed'];

interface CommercialState {
  commercial_stage?: string;
  status: string;
}

/**
 * El cliente dio el OK: etapa 'approved', o 'quoting' con el proyecto ya activo o completado. Esto último ocurre con
 * "Crear desde cotización", que crea el proyecto activo sin fijar la etapa y la BD le deja 'quoting' por defecto;
 * una cotización real nace 'on_hold' y no se puede activar sin la aprobación del cliente.
 */
export const hasClientApproval = ({ commercial_stage, status }: CommercialState): boolean =>
  commercial_stage === 'approved' || (commercial_stage === 'quoting' && EXECUTION_STATUSES.includes(status));

/** Venta realizada: con OK del cliente y sin cancelar. Solo esta venta suma a los totales de la cartera. */
export const isSaleRealized = (project: CommercialState): boolean => project.status !== 'cancelled' && hasClientApproval(project);
