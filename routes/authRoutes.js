import express from 'express';
import { signup, signin, logout, getMe, getAdmin } from '../controller/authController.js';
import { protect, allowRoles } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.post('/signup', signup);
router.post('/signin', signin);
router.post('/logout', protect, logout);
router.post('/users', protect, allowRoles('hospital_admin'), signup);
router.get('/me', protect, getMe);
router.get('/admin', protect, allowRoles('hospital_admin'), getAdmin);

export default router;
