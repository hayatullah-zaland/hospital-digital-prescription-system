import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js';
import patientRoutes from './routes/patientRoutes.js';
import prescriptionRoutes from './routes/prescriptionRoutes.js';
import doctorRoutes from './routes/doctorRoutes.js';
import appointmentRoutes from './routes/appointmentRoutes.js';
import medicalRecordRoutes from './routes/medicalRecordRoutes.js';
import ingredientRoutes from './routes/ingredientRoutes.js';
import medicineRoutes from './routes/medicineRoutes.js';
import interactionRuleRoutes from './routes/interactionRuleRoutes.js';
import { handleJsonErrors } from './middleware/jsonErrorHandler.js';

dotenv.config();

const app = express();

app.use(express.json());
app.use(handleJsonErrors);
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/medical-records', medicalRecordRoutes);
app.use('/api/ingredients', ingredientRoutes);
app.use('/api/medicines', medicineRoutes);
app.use('/api/interaction-rules', interactionRuleRoutes);

app.get('/', (req, res) => res.send('Server is running'));

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected successfully');
    app.listen(5000, () => console.log('Server running on port 5000'));
  })
  .catch((error) => console.error('MongoDB connection failed:', error.message));
