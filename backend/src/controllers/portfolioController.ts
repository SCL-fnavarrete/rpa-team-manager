import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';
import { PortfolioFilters, portfolioService } from '../services/portfolioService';

const COMMERCIAL_STAGES: readonly string[] = ['quoting', 'approved', 'lost'];

export class PortfolioController {
    // GET /api/portfolio - Cartera de proyectos con filtros opcionales (solo team_lead)
    getPortfolio = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const filters: PortfolioFilters = {};

            for (const key of ['client_id', 'sales_rep_id', 'area_id'] as const) {
                const raw = req.query[key];
                if (raw === undefined || raw === '') continue;
                const id = typeof raw === 'string' ? Number(raw) : NaN;
                if (!Number.isInteger(id) || id <= 0) {
                    res.status(400).json({ error: `Filtro inválido: ${key}` });
                    return;
                }
                filters[key] = id;
            }

            const stage = req.query.commercial_stage;
            if (stage !== undefined && stage !== '') {
                if (typeof stage !== 'string' || !COMMERCIAL_STAGES.includes(stage)) {
                    res.status(400).json({ error: 'Filtro inválido: commercial_stage' });
                    return;
                }
                filters.commercial_stage = stage as PortfolioFilters['commercial_stage'];
            }

            const data = await portfolioService.getPortfolio(filters);
            res.json({ data });
        } catch (error) {
            logger.error('Get portfolio error:', error);
            res.status(500).json({ error: 'Error al obtener la cartera' });
        }
    };
}
