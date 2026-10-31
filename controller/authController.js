import bcrypt from 'bcrypt';
import validator from 'validator';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const signup = async (req, res) => {
  try {
    const { name, email, password, role = 'patient' } = req.body || {};
    // Only the protected administrator route can choose a different role.
    const userRole = req.user?.role === 'hospital_admin' ? role : 'patient';

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
    if (!User.schema.path('role').enumValues.includes(userRole)) {
      return res.status(400).json({ message: 'Please select a valid user role' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, password: hashedPassword, role: userRole });

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

export const signin = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    if (!validator.isEmail(email.trim()) || validator.isEmpty(password) || !validator.isByteLength(password, { max: 72 })) {
      return res.status(400).json({ message: 'Please enter a valid email and password' });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');
    if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '1h',
    });

    res.set('Cache-Control', 'no-store');
    res.json({
      message: 'Signin successful',
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    res.status(500).json({ message: 'Signin failed. Please try again' });
  }
};

export const getMe = (req, res) => {
  const { id, name, email, role } = req.user;
  res.set('Cache-Control', 'no-store');
  res.json({ user: { id, name, email, role } });
};

export const getAdmin = (req, res) => {
  res.json({ message: 'Admin access granted' });
};

