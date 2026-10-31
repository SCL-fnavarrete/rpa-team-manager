import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { ScopingActor, ScopingService, sanitizeScopingForRole } from '../services/scopingService';
import { APIError } from '../utils/errors';
import { logger } from '../utils/logger';

export class ScopingController {
  private scopingService: ScopingService;

  constructor() {
    this.scopingService = new ScopingService();
  }

  // Los errores esperados (APIError) salen con su código y su mensaje en español; cualquier otro se
  // registra y nunca expone texto interno (por ejemplo, errores SQL) al usuario.
  private fail(res: Response, error: unknown, context: string, fallback: string): void {
    if (error instanceof APIError && error.isOperational) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    logger.error(`${context}:`, error);
    res.status(500).json({ success: false, error: fallback });
  }

  private parseId(raw: string): number | null {
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  private actorOf(req: AuthenticatedRequest, res: Response): ScopingActor | null {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Autenticación requerida' });
      return null;
    }
    return { id: req.user.id, role: req.user.role };
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
      this.fail(res, error, 'Error fetching RPA archetypes', 'Error al obtener arquetipos de procesos');
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
        data: sanitizeScopingForRole(result, req.user?.role)
      });
    } catch (error) {
      this.fail(res, error, 'Error calculating scoping draft', 'Error al calcular la cotización');
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
        data: result.items.map((item) => sanitizeScopingForRole(item, req.user?.role)),
        kpis: result.kpis
      });
    } catch (error) {
      this.fail(res, error, 'Error fetching scopings', 'Error al listar levantamientos');
    }
  };

  /**
   * GET /api/scopings/:id
   */
  public getById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const id = this.parseId(req.params.id);
      if (id === null) {
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
        data: sanitizeScopingForRole(scoping, req.user?.role)
      });
    } catch (error) {
      this.fail(res, error, 'Error fetching scoping by id', 'Error al obtener el levantamiento');
    }
  };

  /**
   * POST /api/scopings
   */
  public create = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const actor = this.actorOf(req, res);
      if (!actor) return;

      const created = await this.scopingService.create(req.body, actor);
      res.status(201).json({
        success: true,
        message: 'Levantamiento guardado exitosamente',
        data: sanitizeScopingForRole(created, actor.role)
      });
    } catch (error) {
      this.fail(res, error, 'Error creating scoping', 'No se pudo guardar el levantamiento. Intenta nuevamente.');
    }
  };

  /**
   * PUT /api/scopings/:id
   * Cuerpo parcial: lo que no llega se conserva del registro guardado
   */
  public update = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const id = this.parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: 'ID inválido' });
        return;
      }
      const actor = this.actorOf(req, res);
      if (!actor) return;

      const updated = await this.scopingService.update(id, req.body, actor);
      res.json({
        success: true,
        message: 'Levantamiento actualizado exitosamente',
        data: sanitizeScopingForRole(updated, actor.role)
      });
    } catch (error) {
      this.fail(res, error, 'Error updating scoping', 'No se pudo actualizar el levantamiento. Intenta nuevamente.');
    }
  };

  /**
   * DELETE /api/scopings/:id
   */
  public delete = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const id = this.parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: 'ID inválido' });
        return;
      }
      const actor = this.actorOf(req, res);
      if (!actor) return;

      await this.scopingService.delete(id, actor);
      res.json({
        success: true,
        message: 'Levantamiento eliminado exitosamente'
      });
    } catch (error) {
      this.fail(res, error, 'Error deleting scoping', 'No se pudo eliminar el levantamiento. Intenta nuevamente.');
    }
  };

  /**
   * POST /api/scopings/:id/convert-to-project
   * El acceso (team_lead / rpa_operations) lo restringe la ruta.
   */
  public convertToProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const id = this.parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: 'ID inválido' });
        return;
      }
      const actor = this.actorOf(req, res);
      if (!actor) return;

      const result = await this.scopingService.convertToProject(id, actor);
      res.json({
        success: true,
        message: result.message,
        data: {
          project_id: result.project_id,
          message: result.message
        }
      });
    } catch (error) {
      this.fail(
        res,
        error,
        'Error converting scoping to project',
        'No se pudo convertir el levantamiento en proyecto. No se creó ningún dato; intenta nuevamente.'
      );
    }
  };
}
