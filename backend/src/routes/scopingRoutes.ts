import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { ScopingController } from '../controllers/scopingController';

const router = Router();
const controller = new ScopingController();

router.use(authenticate);

// Catálogo de Arquetipos y Preguntas Guía
router.get('/archetypes', controller.getArchetypes);

// Cálculo reactivo en memoria (para el formulario interactivo en vivo)
router.post('/calculate', controller.calculate);

// CRUD de Levantamientos / Cotizaciones
router.get('/', controller.getAll);
router.get('/:id', controller.getById);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.delete);

// Conversión a Proyecto Formal del Portafolio
router.post('/:id/convert-to-project', controller.convertToProject);

export default router;
