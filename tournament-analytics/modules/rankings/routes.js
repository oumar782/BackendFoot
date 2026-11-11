import { Router } from 'express';
import { RankingsController } from './controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../shared/roles.js';

const router = Router();

router.use(authenticate);
router.get('/:tournamentId', requirePermission('read'), RankingsController.getRankings);

export const rankingsRouter = router;
export default router;

