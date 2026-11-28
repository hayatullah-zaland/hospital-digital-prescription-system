import validator from 'validator';

export function validatePrescriptionSafety(req, res, next) {
  if (!validator.isMongoId(req.params.id)) return res.status(400).json({ message: 'Invalid prescription ID' });
  if (req.params.checkId && !validator.isMongoId(req.params.checkId)) return res.status(400).json({ message: 'Invalid safety check ID' });
  if (Object.keys(req.query).length > 0) return res.status(400).json({ message: 'Query parameters are not accepted' });
  if (req.method === 'POST') {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'revision')) {
      return res.status(400).json({ message: 'Send only the current numeric revision' });
    }
    if (!Number.isSafeInteger(body.revision) || body.revision < 1) return res.status(400).json({ message: 'Send the current numeric revision' });
  }
  next();
}
