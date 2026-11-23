import express from 'express';
import { protect, allowRoles } from '../middleware/authMiddleware.js';
import { validateCatalogId, validateCatalogInput, validateCatalogQuery } from '../middleware/medicineValidation.js';
import { createIngredient, getIngredients, getIngredientById } from '../controller/medicineController.js';

const router = express.Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  req.catalogType = 'ingredient';
  next();
});
router.use(protect, allowRoles('hospital_admin', 'hospital_pharmacist', 'doctor'));
router.post('/', allowRoles('hospital_admin', 'hospital_pharmacist'), validateCatalogInput, createIngredient);
router.get('/', validateCatalogQuery, getIngredients);
router.get('/:id', validateCatalogId, getIngredientById);
export default router;
