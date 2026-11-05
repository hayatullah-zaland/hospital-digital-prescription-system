import mongoose from 'mongoose';

// هر login خپل session لري؛ خام token دلته نه ساتو.
const authSessionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  revokedAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

// MongoDB وروسته زاړه sessions پاکوي؛ protect د وخت چک سمدستي کوي.
authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('AuthSession', authSessionSchema);
