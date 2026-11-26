import validator from 'validator';

export function validateInteractionRule(req, res, next) {
  const body = req.body;
  if (Object.keys(req.query).length > 0 || !body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ message: 'Send a JSON object without query parameters' });
  }
  for (const field of Object.keys(body)) {
    if (!['ingredientIds', 'outcome'].includes(field)) return res.status(400).json({ message: 'Send only ingredientIds and outcome' });
  }
  if (!Array.isArray(body.ingredientIds) || body.ingredientIds.length !== 2) {
    return res.status(400).json({ message: 'Send two distinct ingredient IDs' });
  }
  const ids = [];
  for (const id of body.ingredientIds) {
    if (typeof id !== 'string' || !validator.isMongoId(id) || ids.includes(id.toLowerCase())) {
      return res.status(400).json({ message: 'Ingredient IDs must be valid and distinct' });
    }
    ids.push(id.toLowerCase());
  }
  if (typeof body.outcome !== 'string' || !validator.isIn(body.outcome, ['warning', 'no_demo_interaction'])) {
    return res.status(400).json({ message: 'Outcome must be warning or no_demo_interaction' });
  }
  // د اجزاوو سرچپه ترتیب هماغه یوه جوړه ده.
  ids.sort();
  req.interactionIngredientIds = ids;
  next();
}

export function validateInteractionQuery(req, res, next) {
  for (const field of Object.keys(req.query)) {
    if (!['page', 'limit', 'ingredientId'].includes(field) || typeof req.query[field] !== 'string') {
      return res.status(400).json({ message: 'Invalid interaction query' });
    }
  }
  const { page = '1', limit = '10', ingredientId } = req.query;
  if (!validator.isInt(page, { min: 1, max: Number.MAX_SAFE_INTEGER, allow_leading_zeroes: false }) || !validator.isInt(limit, { min: 1, max: 50, allow_leading_zeroes: false })) {
    return res.status(400).json({ message: 'Invalid pagination' });
  }
  const skip = (Number(page) - 1) * Number(limit);
  if (!Number.isSafeInteger(skip) || (ingredientId !== undefined && !validator.isMongoId(ingredientId))) {
    return res.status(400).json({ message: 'Invalid page or ingredient ID' });
  }
  req.interactionList = { page: Number(page), limit: Number(limit), skip, ingredientId };
  next();
}
