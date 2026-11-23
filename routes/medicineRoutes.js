import express from 'express';
import { protect, allowRoles } from '../middleware/authMiddleware.js';
import { validateCatalogId, validateCatalogInput, validateCatalogQuery } from '../middleware/medicineValidation.js';
import { createMedicine, getMedicines, getMedicineById, updateMedicine } from '../controller/medicineController.js';

const router = express.Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  req.catalogType = 'medicine';
  next();
});
router.use(protect, allowRoles('hospital_admin', 'hospital_pharmacist', 'doctor'));
router.post('/', allowRoles('hospital_admin', 'hospital_pharmacist'), validateCatalogInput, createMedicine);
router.get('/', validateCatalogQuery, getMedicines);
router.get('/:id', validateCatalogId, getMedicineById);
router.patch('/:id', allowRoles('hospital_admin', 'hospital_pharmacist'), validateCatalogId, validateCatalogInput, updateMedicine);
export default router;
