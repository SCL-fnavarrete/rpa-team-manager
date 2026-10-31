import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { createMilestoneSchema } from '../validation/schemas';
import { PMOController } from '../controllers/pmoController';

const router = Router();
const pmoController = new PMOController();

// All routes require authentication
router.use(authenticate);

// PM-level roles: read PMO data (mirrors frontend /pmo and /pmo/gantt/:id gates)
const pmoReadRoles = authorize(['team_lead', 'rpa_operations', 'rpa_developer']);
// PM-level roles: manage milestones and metrics
const pmoWriteRoles = authorize(['team_lead', 'rpa_operations']);

// ========================================
// PMO DASHBOARD ROUTES
// ========================================

// GET /api/pmo/dashboard - Main PMO dashboard with all projects overview
router.get('/dashboard', authorize(['team_lead', 'rpa_operations']), pmoController.getPMODashboard);

// GET /api/pmo/analytics - Advanced analytics and reporting
router.get('/analytics', authorize(['team_lead', 'rpa_operations']), pmoController.getPMOAnalytics);

// GET /api/pmo/executive-suite - Integrated Executive Suite (General Manager, Commercial, Controller)
router.get('/executive-suite', authorize(['team_lead', 'rpa_operations', 'billing']), pmoController.getPMOExecutiveSuite);

// ========================================
// PROJECT GANTT & TIMELINE ROUTES
// ========================================

// GET /api/pmo/projects/:id/gantt - Gantt chart data for specific project
router.get('/projects/:id/gantt', pmoReadRoles, pmoController.getProjectGantt);

// GET /api/pmo/projects/:id/metrics - Project-specific PMO metrics and analytics
router.get('/projects/:id/metrics', pmoReadRoles, pmoController.getProjectPMOMetrics);

// ========================================
// MILESTONES MANAGEMENT ROUTES
// ========================================

// POST /api/pmo/milestones - Create new milestone
router.post('/milestones', pmoWriteRoles, validate({ body: createMilestoneSchema }), pmoController.createMilestone);

// POST /api/pmo/milestones/batch - Create multiple milestones (MUST be before /:id route)
router.post('/milestones/batch', pmoWriteRoles, pmoController.batchCreateMilestones);

// DELETE /api/pmo/milestones/batch - Delete multiple milestones (MUST be before /:id route)
router.delete('/milestones/batch', pmoWriteRoles, pmoController.batchDeleteMilestones);

// PUT /api/pmo/milestones/:id - Update milestone
router.put('/milestones/:id', pmoWriteRoles, pmoController.updateMilestone);

// DELETE /api/pmo/milestones/:id - Delete milestone
router.delete('/milestones/:id', pmoWriteRoles, pmoController.deleteMilestone);

// ========================================
// PROJECT METRICS ROUTES
// ========================================

// POST /api/pmo/projects/:id/metrics - Update PMO metrics for project
router.post('/projects/:id/metrics', pmoWriteRoles, pmoController.updateProjectMetrics);

export default router;