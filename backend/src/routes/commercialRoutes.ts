import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { commercialController } from '../controllers/commercialController';

const wrap = (fn: (req: any, res: Response, next?: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res, next)).catch(next);

const router = Router();
router.use(authenticate);
router.get('/projects/:projectId/meetings', wrap(commercialController.getMeetings));
router.post('/projects/:projectId/meetings', wrap(commercialController.createMeeting));
router.get('/projects/:projectId/quotes', wrap(commercialController.getQuotes));
router.post('/projects/:projectId/quotes', wrap(commercialController.createQuote));
router.post('/quotes/:quoteId/approve', authorize(['team_lead']), wrap(commercialController.approveQuote));
router.post('/quotes/:quoteId/reject', authorize(['team_lead']), wrap(commercialController.rejectQuote));
router.post('/projects/:projectId/client-approval', authorize(['team_lead']), wrap(commercialController.approveClient));
router.post('/projects/:projectId/start-execution', wrap(commercialController.startExecution));
router.post('/projects/:projectId/lost', authorize(['team_lead']), wrap(commercialController.markLost));
router.patch('/projects/:projectId/requirements', wrap(commercialController.updateRequirements));
router.get('/projects/:projectId/documents', wrap(commercialController.getDocuments));
router.post('/projects/:projectId/documents', wrap(commercialController.addDocument));
router.post('/projects/:projectId/delivery-acceptance', wrap(commercialController.acceptDelivery));
router.post('/projects/:projectId/financial-close', authorize(['team_lead']), wrap(commercialController.closeFinancials));
router.get('/projects/:projectId/closure-report', authorize(['team_lead']), wrap(commercialController.getClosureReport));
router.get('/projects/:projectId/closure-report.pdf', authorize(['team_lead']), wrap(commercialController.getClosureReportPdf));
router.get('/projects/:projectId/capacity', wrap(commercialController.getCapacity));
router.post('/projects/:projectId/capacity', wrap(commercialController.saveCapacity));
router.delete('/projects/:projectId/capacity/:userId', wrap(commercialController.deleteCapacity));
router.get('/team-capacity', wrap(commercialController.getTeamCapacity));
router.get('/projects/:projectId/quote-cost-estimate', authorize(['team_lead']), wrap(commercialController.estimateQuoteCost));
router.post('/projects/:projectId/transition-to-support', wrap(commercialController.transitionToSupport));

export default router;
