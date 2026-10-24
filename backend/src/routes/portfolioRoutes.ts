import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { PortfolioController } from '../controllers/portfolioController';

const router = Router();
const portfolioController = new PortfolioController();

router.use(authenticate);

// Cartera de proyectos: cifras comerciales y financieras consolidadas, solo team_lead
router.get('/', authorize(['team_lead']), portfolioController.getPortfolio);

export default router;
