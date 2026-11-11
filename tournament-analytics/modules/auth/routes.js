import { Router } from 'express';
import { AuthController } from './controller.js';
import { validateBody } from '../../middleware/validate.js';
import { validateRegister, validateLogin } from '../../validation/schemas.js';
import { authenticate } from '../../middleware/auth.js';

const router = Router();

router.post('/register', validateBody(validateRegister), AuthController.register);
router.post('/login', validateBody(validateLogin), AuthController.login);
router.get('/me', authenticate, AuthController.me);
router.post('/logout', authenticate, AuthController.logout);

export default router;
