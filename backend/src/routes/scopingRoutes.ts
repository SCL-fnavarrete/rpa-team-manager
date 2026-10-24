import { NextFunction, Response, Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { calculateScopingSchema, createScopingSchema, updateScopingSchema } from '../validation/schemas';
import { ScopingController } from '../controllers/scopingController';
import { UserRole } from '../types/auth';

const router = Router();
const controller = new ScopingController();

// Mismos roles que pueden crear proyectos (POST /api/projects). Guard propio (no `authorize`) para que el
// 403 salga en español y con el formato { success: false, error } del resto del módulo.
const CONVERT_ROLES: UserRole[] = ['team_lead', 'rpa_operations'];
const requireConvertRole = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (!req.user || !CONVERT_ROLES.includes(req.user.role)) {
    res.status(403).json({
      success: false,
      error: 'Solo el jefe de equipo u operaciones pueden convertir un levantamiento en proyecto'
    });
    return;
  }
  next();
};

// Los mensajes del esquema ya van en español: se devuelven tal cual como { success: false, error }
const validateBody = (schema: z.ZodSchema) => validate({ body: schema }, { inlineErrors: true });

router.use(authenticate);

// Catálogo de Arquetipos y Preguntas Guía
router.get('/archetypes', controller.getArchetypes);

// Cálculo reactivo en memoria (para el formulario interactivo en vivo)
router.post('/calculate', validateBody(calculateScopingSchema), controller.calculate);

// CRUD de Levantamientos / Cotizaciones (editar y borrar: solo el autor o team_lead, se verifica en el servicio)
router.get('/', controller.getAll);
router.get('/:id', controller.getById);
router.post('/', validateBody(createScopingSchema), controller.create);
router.put('/:id', validateBody(updateScopingSchema), controller.update);
router.delete('/:id', controller.delete);

// Conversión a Proyecto Formal del Portafolio
router.post('/:id/convert-to-project', requireConvertRole, controller.convertToProject);

export default router;
