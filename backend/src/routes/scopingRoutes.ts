import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { calculateScopingSchema, createScopingSchema, updateScopingSchema } from '../validation/schemas';
import { ScopingController } from '../controllers/scopingController';

const router = Router();
const controller = new ScopingController();

// Mismos roles que pueden crear proyectos (POST /api/projects)
const convertRoles = authorize(['team_lead', 'rpa_operations']);

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
router.post('/:id/convert-to-project', convertRoles, controller.convertToProject);

export default router;
