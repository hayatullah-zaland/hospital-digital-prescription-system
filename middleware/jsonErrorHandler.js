// ناسم JSON ته ساده ځواب ورکوو؛ د request متن او stack نه ښکاره کوو.
export const handleJsonErrors = (error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    res.set('Cache-Control', 'no-store');
    return res.status(400).json({ message: 'Please send valid JSON' });
  }
  next(error);
};
