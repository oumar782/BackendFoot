import { Router } from 'express';
import { OrganizationController } from './controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRoles, requirePermission } from '../../shared/roles.js';

const router = Router();

router.use(authenticate);

router.get('/me', requirePermission('read'), OrganizationController.getMyOrganization);
router.put('/me', requireRoles('owner', 'admin'), OrganizationController.updateMyOrganization);
router.get('/users', requireRoles('owner', 'admin', 'manager'), OrganizationController.listUsers);
router.post('/users', requireRoles('owner', 'admin'), OrganizationController.addUser);

export default router;
