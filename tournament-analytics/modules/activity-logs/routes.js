import { Router } from 'express';
import { ActivityLogsController } from './controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRoles } from '../../shared/roles.js';

const router = Router();

router.use(authenticate);
router.get('/', requireRoles('owner', 'admin', 'manager'), ActivityLogsController.listLogs);

export const activityLogsRouter = router;
export default router;

