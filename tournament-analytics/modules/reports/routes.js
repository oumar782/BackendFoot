import { Router } from 'express';
import { ReportsController } from './controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../shared/roles.js';

const router = Router();

router.use(authenticate);
router.get('/financial', requirePermission('read'), ReportsController.getFinancialReport);
router.get('/tournament/:tournamentId', requirePermission('read'), ReportsController.getTournamentReport);

export const reportsRouter = router;
export default router;

