import { Router } from 'express';
import { AnalyticsController } from './controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../shared/roles.js';

const router = Router();

router.use(authenticate);
router.get('/finance', requirePermission('read'), AnalyticsController.getFinance);
router.get('/dashboard', requirePermission('read'), AnalyticsController.getDashboard);

export const analyticsRouter = router;
export default router;

