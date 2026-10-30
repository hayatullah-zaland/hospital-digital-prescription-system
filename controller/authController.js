import bcrypt from 'bcrypt';
import validator from 'validator';
import User from '../models/User.js';

export const signup = async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (!validator.isLength(name.trim(), { min: 2, max: 100 })) {
      return res.status(400).json({ message: 'Name must have between 2 and 100 characters' });
    }
    if (!validator.isEmail(email.trim())) {
      return res.status(400).json({ message: 'Please enter a valid email' });
    }
    if (!validator.isLength(password, { min: 12 }) || !validator.isByteLength(password, { max: 72 })) {
      return res.status(400).json({ message: 'Password must have at least 12 characters and at most 72 UTF-8 bytes' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, password: hashedPassword, role: 'patient' });

    res.status(201).json({
      message: 'Signup successful',
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'This email is already registered' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Please check your name, email and password' });
    }
    res.status(500).json({ message: 'Signup failed. Please try again' });
  }
};
