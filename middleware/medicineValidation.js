import validator from 'validator';
import { medicineForms } from '../models/Medicine.js';

export function validateCatalogId(req, res, next) {
  if (!validator.isMongoId(req.params.id)) return res.status(400).json({ message: 'Invalid catalog ID' });
  next();
}

export function validateCatalogInput(req, res, next) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ message: 'Send a JSON object' });
  }
  const creating = req.method === 'POST';
  const isMedicine = req.catalogType === 'medicine';
  const allowed = ['name'];
  if (creating) allowed.push('code');
  if (isMedicine) allowed.push('strength', 'form', 'ingredientIds', 'notes', 'isActive');
  if (!creating) allowed.push('version');
  let hasDetails = false;
  for (const field of Object.keys(body)) {
    if (!allowed.includes(field)) return res.status(400).json({ message: 'Unknown field: ' + field });
    if (field !== 'version') hasDetails = true;
  }
  if (!hasDetails) return res.status(400).json({ message: 'Send at least one catalog field' });

  // لومړی ډول او اوږدوالی ګورو؛ سرچینه او لیکوال له client نه منو.
  if (creating && (typeof body.code !== 'string' || !validator.matches(body.code.trim(), /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,39}$/))) {
    return res.status(400).json({ message: 'Code must contain 2 to 40 letters, numbers, hyphens or underscores' });
  }
  if ((creating || body.name !== undefined) && (typeof body.name !== 'string' || !validator.isLength(body.name.trim(), { min: 2, max: 150 }))) {
    return res.status(400).json({ message: 'Name must contain 2 to 150 characters' });
  }
  if (isMedicine) {
    if ((creating || body.strength !== undefined) && (typeof body.strength !== 'string' || !validator.isLength(body.strength.trim(), { min: 1, max: 80 }))) {
      return res.status(400).json({ message: 'Strength must contain 1 to 80 characters' });
    }
    if ((creating || body.form !== undefined) && !medicineForms.includes(body.form)) {
      return res.status(400).json({ message: 'Invalid medicine form' });
    }
    if (creating || body.ingredientIds !== undefined) {
      if (!Array.isArray(body.ingredientIds) || body.ingredientIds.length < 1 || body.ingredientIds.length > 10) {
        return res.status(400).json({ message: 'Use 1 to 10 ingredient IDs' });
      }
      const seen = new Set();
      for (const id of body.ingredientIds) {
        if (typeof id !== 'string' || !validator.isMongoId(id) || seen.has(id.toLowerCase())) {
          return res.status(400).json({ message: 'Ingredient IDs must be valid and distinct' });
        }
        seen.add(id.toLowerCase());
      }
    }
    if (body.notes !== undefined && (typeof body.notes !== 'string' || !validator.isLength(body.notes.trim(), { max: 1000 }))) {
      return res.status(400).json({ message: 'Notes must contain at most 1000 characters' });
    }
    if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
      return res.status(400).json({ message: 'isActive must be a boolean' });
    }
  }
  if (!creating && (!Number.isSafeInteger(body.version) || body.version < 0)) {
    return res.status(400).json({ message: 'Send the current numeric version' });
  }
  next();
}

export function validateCatalogQuery(req, res, next) {
  const allowed = ['search', 'page', 'limit'];
  if (req.catalogType === 'medicine') allowed.push('isActive', 'ingredientId', 'form');
  for (const field of Object.keys(req.query)) {
    if (!allowed.includes(field) || typeof req.query[field] !== 'string') {
      return res.status(400).json({ message: 'Invalid query field: ' + field });
    }
  }
  const { search = '', page = '1', limit = '10', ingredientId, form, isActive } = req.query;
  if (!validator.isLength(search.trim(), { max: 100 }) || !validator.isInt(page, { min: 1, max: Number.MAX_SAFE_INTEGER, allow_leading_zeroes: false }) || !validator.isInt(limit, { min: 1, max: 50, allow_leading_zeroes: false })) {
    return res.status(400).json({ message: 'Invalid search or pagination' });
  }
  const pageNumber = Number(page);
  const pageSize = Number(limit);
  const skip = (pageNumber - 1) * pageSize;
  if (!Number.isSafeInteger(skip)) return res.status(400).json({ message: 'Page is too large' });
  if (ingredientId !== undefined && !validator.isMongoId(ingredientId)) return res.status(400).json({ message: 'Invalid ingredient ID' });
  if (form !== undefined && !medicineForms.includes(form)) return res.status(400).json({ message: 'Invalid medicine form' });
  if (isActive !== undefined && isActive !== 'true' && isActive !== 'false') return res.status(400).json({ message: 'isActive must be true or false' });
  req.catalogList = { page: pageNumber, limit: pageSize, skip, search: search.trim() };
  next();
}
