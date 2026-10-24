import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { commercialController } from '../controllers/commercialController';

const router = Router();
router.use(authenticate);
router.get('/projects/:projectId/meetings', commercialController.getMeetings);
router.post('/projects/:projectId/meetings', commercialController.createMeeting);
router.get('/projects/:projectId/quotes', commercialController.getQuotes);
router.post('/projects/:projectId/quotes', commercialController.createQuote);
router.post('/quotes/:quoteId/approve', authorize(['team_lead']), commercialController.approveQuote);
router.post('/quotes/:quoteId/reject', authorize(['team_lead']), commercialController.rejectQuote);
router.post('/projects/:projectId/client-approval', authorize(['team_lead']), commercialController.approveClient);
router.post('/projects/:projectId/start-execution', commercialController.startExecution);
router.post('/projects/:projectId/lost', authorize(['team_lead']), commercialController.markLost);
router.patch('/projects/:projectId/requirements', commercialController.updateRequirements);
router.get('/projects/:projectId/documents', commercialController.getDocuments);
router.post('/projects/:projectId/documents', commercialController.addDocument);
router.post('/projects/:projectId/delivery-acceptance', commercialController.acceptDelivery);
router.post('/projects/:projectId/financial-close', authorize(['team_lead']), commercialController.closeFinancials);
router.get('/projects/:projectId/closure-report', authorize(['team_lead']), commercialController.getClosureReport);
router.get('/projects/:projectId/closure-report.pdf', authorize(['team_lead']), commercialController.getClosureReportPdf);
router.get('/projects/:projectId/capacity', commercialController.getCapacity);
router.post('/projects/:projectId/capacity', commercialController.saveCapacity);
router.delete('/projects/:projectId/capacity/:userId', commercialController.deleteCapacity);
router.get('/team-capacity', commercialController.getTeamCapacity);
router.get('/projects/:projectId/quote-cost-estimate', authorize(['team_lead']), commercialController.estimateQuoteCost);

export default router;
