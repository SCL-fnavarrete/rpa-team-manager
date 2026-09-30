import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { ScopingService } from '../services/scopingService';
import { logger } from '../utils/logger';

export class ScopingController {
  private scopingService: ScopingService;

  constructor() {
    this.scopingService = new ScopingService();
  }

  /**
   * GET /api/scopings/archetypes
   */
  public getArchetypes = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const archetypes = this.scopingService.getArchetypes();
      res.json({
        success: true,
        data: archetypes
      });
    } catch (error) {
      logger.error('Error fetching RPA archetypes:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Error al obtener arquetipos de procesos'
      });
    }
  };

  /**
   * POST /api/scopings/calculate
   * Simulación o cálculo reactivo en memoria
   */
  public calculate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const result = this.scopingService.calculateDraft(req.body);
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Error calculating scoping draft:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Error al calcular cotización'
      });
    }
  };

  /**
   * GET /api/scopings
   */
  public getAll = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { client, status, archetype, search } = req.query;
      const result = await this.scopingService.getAll({
        client: typeof client === 'string' ? client : undefined,
        status: typeof status === 'string' ? status : undefined,
        archetype: typeof archetype === 'string' ? archetype : undefined,
        search: typeof search === 'string' ? search : undefined
      });

      res.json({
        success: true,
        data: result.items,
        kpis: result.kpis
      });
    } catch (error) {
      logger.error('Error fetching scopings:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Error al listar levantamientos'
      });
    }
  };

  /**
   * GET /api/scopings/:id
   */
  public getById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ success: false, error: 'ID inválido' });
        return;
      }

      const scoping = await this.scopingService.getById(id);
      if (!scoping) {
        res.status(404).json({ success: false, error: 'Levantamiento no encontrado' });
        return;
      }

      res.json({
        success: true,
        data: scoping
      });
    } catch (error) {
      logger.error('Error fetching scoping by id:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Error al obtener levantamiento'
      });
    }
  };

  /**
   * POST /api/scopings
   */
  public create = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const created = await this.scopingService.create(req.body, userId);
      res.status(201).json({
        success: true,
        message: 'Levantamiento guardado exitosamente',
        data: created
      });
    } catch (error) {
      logger.error('Error creating scoping:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Error al crear levantamiento'
      });
    }
  };

  /**
   * PUT /api/scopings/:id
   */
  public update = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ success: false, error: 'ID inválido' });
        return;
      }

      const userId = req.user?.id;
      const updated = await this.scopingService.update(id, req.body, userId);
      res.json({
        success: true,
        message: 'Levantamiento actualizado exitosamente',
        data: updated
      });
    } catch (error) {
      logger.error('Error updating scoping:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Error al actualizar levantamiento'
      });
    }
  };

  /**
   * DELETE /api/scopings/:id
   */
  public delete = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ success: false, error: 'ID inválido' });
        return;
      }

      await this.scopingService.delete(id);
      res.json({
        success: true,
        message: 'Levantamiento eliminado exitosamente'
      });
    } catch (error) {
      logger.error('Error deleting scoping:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Error al eliminar levantamiento'
      });
    }
  };

  /**
   * POST /api/scopings/:id/convert-to-project
   */
  public convertToProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ success: false, error: 'ID inválido' });
        return;
      }

      const userId = req.user?.id || 1;
      const result = await this.scopingService.convertToProject(id, userId);
      res.json({
        success: true,
        message: result.message,
        data: {
          project_id: result.project_id
        }
      });
    } catch (error) {
      logger.error('Error converting scoping to project:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Error al convertir cotización a proyecto'
      });
    }
  };
}
