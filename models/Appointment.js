import mongoose from 'mongoose';

export const appointmentStatuses = ['scheduled', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'];

// هر بدلون د هماغه وخت، حالت، کارکوونکي او دلیل سره ساتو.
const historySchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['created', 'status_changed', 'rescheduled'],
    required: true,
  },
  status: { type: String, enum: appointmentStatuses, required: true },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, trim: true, maxlength: 300, default: '' },
  at: { type: Date, default: Date.now },
}, { _id: false });

const appointmentSchema = new mongoose.Schema({
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true,
  },
  // دا د ډاکټر د User حساب ID دی.
  doctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  status: {
    type: String,
    enum: appointmentStatuses,
    default: 'scheduled',
  },
  // یوازې scheduled، checked_in او in_progress وخت نیسي.
  isBooked: { type: Boolean, default: true, select: false },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  history: { type: [historySchema], default: [] },
}, {
  timestamps: true,
  // دوه هممهاله بدلونونه د یو بل تاریخچه نه شي له منځه وړلای.
  optimisticConcurrency: true,
});

// DB هم تکراري booking بندوي، حتی که دوه requests یوځای راشي.
appointmentSchema.index(
  { doctor: 1, startAt: 1 },
  { unique: true, partialFilterExpression: { isBooked: true } },
);
appointmentSchema.index(
  { patient: 1, startAt: 1 },
  { unique: true, partialFilterExpression: { isBooked: true } },
);
appointmentSchema.index({ startAt: 1, _id: 1 });

export default mongoose.model('Appointment', appointmentSchema);
