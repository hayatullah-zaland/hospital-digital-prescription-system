import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js';
import patientRoutes from './routes/patientRoutes.js';

dotenv.config();

const app = express();

app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);

app.get('/', (req, res) => res.send('Server is running'));

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected successfully');
    app.listen(5000, () => console.log('Server running on port 5000'));
  })
  .catch((error) => console.error('MongoDB connection failed:', error.message));
