import {
  answerWithGemini,
  handleError,
  setCors
} from '../_lib/gemini.js';

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');

    return res.status(405).json({
      error: 'Méthode non autorisée.'
    });
  }

  try {
    const answer = await answerWithGemini(req.body || {});

    return res.status(200).json({
      answer
    });

  } catch (error) {
    return handleError(error, res);
  }
}
