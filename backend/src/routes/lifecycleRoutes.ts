import { Router } from 'express';
import * as lifecycleController from '../controllers/lifecycleController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// PM-level roles: manage phases, delays and scope changes
const pmWriteRoles = authorize(['team_lead', 'rpa_operations']);
const activityWriteRoles = authorize(['team_lead', 'rpa_operations', 'rpa_developer']);
// Financial/scope decisions: highest bar
const approvalRoles = authorize(['team_lead']);

// ========================================
// PHASE TEMPLATES (system-level configuration)
// ========================================
router.get('/templates', lifecycleController.getPhaseTemplates);
router.get('/templates/:id', lifecycleController.getPhaseTemplate);
router.post('/templates', approvalRoles, lifecycleController.createPhaseTemplate);
router.put('/templates/:id', approvalRoles, lifecycleController.updatePhaseTemplate);
router.delete('/templates/:id', approvalRoles, lifecycleController.deletePhaseTemplate);

// ========================================
// PROJECT PHASES
// ========================================
router.get('/projects/:projectId/phases', lifecycleController.getProjectPhases);
router.post('/projects/:projectId/phases', pmWriteRoles, lifecycleController.createProjectPhase);
router.post('/projects/:projectId/phases/initialize', pmWriteRoles, lifecycleController.initializeProjectPhases);
router.put('/phases/:phaseId', pmWriteRoles, lifecycleController.updateProjectPhase);
router.delete('/phases/:phaseId', pmWriteRoles, lifecycleController.deleteProjectPhase);

// ========================================
// PHASE ACTIVITIES
// ========================================
router.get('/phases/:phaseId/activities', lifecycleController.getPhaseActivities);
router.post('/phases/:phaseId/activities', activityWriteRoles, lifecycleController.createPhaseActivity);
router.put('/activities/:activityId', activityWriteRoles, lifecycleController.updatePhaseActivity);
router.delete('/activities/:activityId', pmWriteRoles, lifecycleController.deletePhaseActivity);

// ========================================
// PROJECT DELAYS
// ========================================
router.get('/projects/:projectId/delays', lifecycleController.getProjectDelays);
router.post('/delays', pmWriteRoles, lifecycleController.createProjectDelay);
router.put('/delays/:delayId', pmWriteRoles, lifecycleController.updateProjectDelay);
router.delete('/delays/:delayId', pmWriteRoles, lifecycleController.deleteProjectDelay);
router.post('/delays/:delayId/resolve', pmWriteRoles, lifecycleController.resolveProjectDelay);

// ========================================
// SCOPE CHANGES
// ========================================
router.get('/projects/:projectId/scope-changes', lifecycleController.getProjectScopeChanges);
router.post('/scope-changes', pmWriteRoles, lifecycleController.createScopeChange);
router.put('/scope-changes/:changeId', pmWriteRoles, lifecycleController.updateScopeChange);
router.delete('/scope-changes/:changeId', pmWriteRoles, lifecycleController.deleteScopeChange);
router.post('/scope-changes/:changeId/approve', approvalRoles, lifecycleController.approveScopeChange);
router.post('/scope-changes/:changeId/reject', approvalRoles, lifecycleController.rejectScopeChange);

// ========================================
// ANALYTICS & REPORTING
// ========================================
router.get('/projects/:projectId/roi-analysis', approvalRoles, lifecycleController.getProjectROIAnalysis);
router.get('/projects/:projectId/metrics', lifecycleController.getProjectLifecycleMetrics);
router.get('/projects/:projectId/summary', lifecycleController.getProjectLifecycleSummary);

export default router;
