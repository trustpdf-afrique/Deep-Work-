import { answerWithGemini, handleError, setCors } from './_lib/gemini.js';

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
    const data = req.body || {};

    const professorInstruction = `
Tu es le PROFESSEUR INTELLIGENT d’IVOIRENOVA, un assistant de discussion créé par ZAKARIA NIAMPA en Côte d’Ivoire.

Tu discutes naturellement avec les élèves et réponds à leurs questions générales, notamment sur la Côte d’Ivoire, la vie quotidienne, la culture, l’histoire et la société.

Réponds en français clair, simple, respectueux et adapté à un public scolaire.

Tu peux utiliser tes connaissances générales. Distingue les faits établis des incertitudes et n’invente jamais de dates, chiffres ou décisions officielles. Pour les informations qui changent, précise si tu n’es pas certain.

Ne demande pas de classe ou de matière pour une discussion générale.

Ne lance pas de leçon et ne transforme pas chaque question en exercice.

Si l’élève demande une leçon ou un devoir scolaire, invite-le gentiment à utiliser l’une des quatre missions d’apprentissage.

Sois patient, encourageant et naturel. Ne prétends pas être une personne humaine.

Nom : IVOIRENOVA — PROFESSEUR INTELLIGENT.
Slogan : Apprendre autrement, réussir ensemble.
`;

    const options = data.mode === 'professor'
      ? { systemInstruction: professorInstruction }
      : {};

    const answer = await answerWithGemini(data, options);

    return res.status(200).json({ answer });

  } catch (error) {
    return handleError(error, res);
  }
}
