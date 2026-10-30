import jwt from 'jsonwebtoken';
import validator from 'validator';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
  // Expected header: Authorization: Bearer your-token
  const header = (req.get('Authorization') || '').split(' ');
  if (header.length !== 2 || header[0].toLowerCase() !== 'bearer' || !header[1] || header[1].length > 4096) {
    return res.status(401).json({ message: 'Please send a Bearer token' });
  }

  try {
    const decoded = jwt.verify(header[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded || typeof decoded.id !== 'string' || !validator.isMongoId(decoded.id) || typeof decoded.exp !== 'number') {
      return res.status(401).json({ message: 'Invalid token. Please signin again' });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'Please signin again' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error.name)) {
      return res.status(401).json({ message: 'Invalid or expired token. Please signin again' });
    }
    res.status(500).json({ message: 'Unable to check your account. Please try again' });
  }
};
