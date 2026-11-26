import express from 'express';
import { protect, allowRoles } from '../middleware/authMiddleware.js';
import { validateCatalogId } from '../middleware/medicineValidation.js';
import { validateInteractionRule, validateInteractionQuery } from '../middleware/interactionValidation.js';
import { createInteractionRule, getInteractionRules, getInteractionRuleById } from '../controller/interactionController.js';

const router = express.Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.use(protect, allowRoles('hospital_admin', 'hospital_pharmacist', 'doctor'));
router.post('/', allowRoles('hospital_admin', 'hospital_pharmacist'), validateInteractionRule, createInteractionRule);
router.get('/', validateInteractionQuery, getInteractionRules);
router.get('/:id', validateCatalogId, getInteractionRuleById);
export default router;
