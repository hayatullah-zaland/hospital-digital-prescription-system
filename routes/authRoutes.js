import express from 'express';
import { signup, signin, getMe, getAdmin } from '../controller/authController.js';
import { protect, allowRoles } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/signup', signup);
router.post('/signin', signin);
router.post('/users', protect, allowRoles('hospital_admin'), signup);
router.get('/me', protect, getMe);
router.get('/admin', protect, allowRoles('hospital_admin'), getAdmin);

export default router;
