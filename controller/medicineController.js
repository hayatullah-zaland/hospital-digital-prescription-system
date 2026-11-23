import Ingredient, { catalogSource } from '../models/Ingredient.js';
import Medicine from '../models/Medicine.js';

const ingredientFields = 'code name mode source sourceVersion notice';

function catalogSearchFilter(search) {
  if (!search) return {};
  // د لټون نښې عادي متن ګڼو، نه د regex دستور.
  const text = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { $or: [{ name: { $regex: text, $options: 'i' } }, { code: { $regex: text, $options: 'i' } }] };
}

function catalogError(res, error) {
  if (error.code === 11000) return res.status(409).json({ message: 'This catalog code already exists' });
  if (error.name === 'VersionError') return res.status(409).json({ message: 'Catalog changed; reload and try again' });
  if (error.name === 'ValidationError') return res.status(400).json({ message: 'Invalid catalog details' });
  return res.status(500).json({ message: 'Unable to process the catalog request' });
}

export async function createIngredient(req, res) {
  try {
    await Ingredient.init();
    const ingredient = await Ingredient.create({ code: req.body.code, name: req.body.name, createdBy: req.user._id });
    res.status(201).json({ ingredient, catalog: catalogSource });
  } catch (error) { catalogError(res, error); }
}

export async function getIngredients(req, res) {
  try {
    const { page, limit, skip, search } = req.catalogList;
    const filter = catalogSearchFilter(search);
    const ingredients = await Ingredient.find(filter).sort({ name: 1, _id: 1 }).skip(skip).limit(limit);
    const total = await Ingredient.countDocuments(filter);
    res.json({ ingredients, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }, catalog: catalogSource });
  } catch (error) { catalogError(res, error); }
}

export async function getIngredientById(req, res) {
  try {
    const ingredient = await Ingredient.findById(req.params.id);
    if (!ingredient) return res.status(404).json({ message: 'Ingredient not found' });
    res.json({ ingredient, catalog: catalogSource });
  } catch (error) { catalogError(res, error); }
}

export async function createMedicine(req, res) {
  try {
    // هر ټاکل شوی جزء باید په همدې ازمایښتي فهرست کې موجود وي.
    const count = await Ingredient.countDocuments({ _id: { $in: req.body.ingredientIds }, mode: 'simulated' });
    if (count !== req.body.ingredientIds.length) return res.status(404).json({ message: 'One or more ingredients were not found' });
    await Medicine.init();
    const medicine = await Medicine.create({
      code: req.body.code,
      name: req.body.name,
      strength: req.body.strength,
      form: req.body.form,
      ingredients: req.body.ingredientIds,
      notes: req.body.notes,
      isActive: req.body.isActive,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    await medicine.populate('ingredients', ingredientFields);
    res.status(201).json({ medicine, catalog: catalogSource });
  } catch (error) { catalogError(res, error); }
}

export async function getMedicines(req, res) {
  try {
    const { page, limit, skip, search } = req.catalogList;
    const filter = catalogSearchFilter(search);
    if (req.user.role === 'doctor') {
      if (req.query.isActive === 'false') return res.status(403).json({ message: 'Doctors can view active medicines only' });
      filter.isActive = true;
    } else if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }
    if (req.query.ingredientId) filter.ingredients = req.query.ingredientId;
    if (req.query.form) filter.form = req.query.form;
    const medicines = await Medicine.find(filter).populate('ingredients', ingredientFields).sort({ name: 1, _id: 1 }).skip(skip).limit(limit);
    const total = await Medicine.countDocuments(filter);
    res.json({ medicines, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }, catalog: catalogSource });
  } catch (error) { catalogError(res, error); }
}

export async function getMedicineById(req, res) {
  try {
    const filter = { _id: req.params.id };
    if (req.user.role === 'doctor') filter.isActive = true;
    const medicine = await Medicine.findOne(filter).populate('ingredients', ingredientFields);
    if (!medicine) return res.status(404).json({ message: 'Medicine not found' });
    res.json({ medicine, catalog: catalogSource });
  } catch (error) { catalogError(res, error); }
}

export async function updateMedicine(req, res) {
  try {
    const medicine = await Medicine.findById(req.params.id);
    if (!medicine) return res.status(404).json({ message: 'Medicine not found' });
    if (medicine.version !== req.body.version) return res.status(409).json({ message: 'Catalog changed; reload and try again' });
    if (req.body.ingredientIds !== undefined) {
      const count = await Ingredient.countDocuments({ _id: { $in: req.body.ingredientIds }, mode: 'simulated' });
      if (count !== req.body.ingredientIds.length) return res.status(404).json({ message: 'One or more ingredients were not found' });
      medicine.ingredients = req.body.ingredientIds;
    }
    // یوازې رالېږل شوي مجاز fields بدلوو؛ code او سرچینه ثابت دي.
    if (req.body.name !== undefined) medicine.name = req.body.name;
    if (req.body.strength !== undefined) medicine.strength = req.body.strength;
    if (req.body.form !== undefined) medicine.form = req.body.form;
    if (req.body.notes !== undefined) medicine.notes = req.body.notes;
    if (req.body.isActive !== undefined) medicine.isActive = req.body.isActive;
    medicine.updatedBy = req.user._id;
    await medicine.save();
    await medicine.populate('ingredients', ingredientFields);
    res.json({ medicine, catalog: catalogSource });
  } catch (error) { catalogError(res, error); }
}
