const MODEL = 'gemini-3.5-flash';

export function setCors(req, res) {
  const allowedOrigins = [
    'https://trustpdf-afrique.github.io',
    'https://ivoirenovaapp.vercel.app'
  ];

  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'POST, OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type'
  );
}

export async function answerWithGemini(data = {}) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('Clé Gemini absente sur le serveur.');
  }

  const question =
    data.message ||
    data.prompt ||
    data.question ||
    data.text ||
    '';

  if (typeof question !== 'string' || !question.trim()) {
    throw new Error('Veuillez écrire une question.');
  }

  const courseContext =
    data.courseText ||
    data.context ||
    data.knowledge ||
    '';

  const systemInstruction = `
Tu es IVOIRENOVA, un professeur particulier d'intelligence artificielle
créé par ZAKARIA NIAMPA en Côte d'Ivoire.

Ta mission est d'aider les élèves à apprendre et à comprendre.

RÈGLES :
- Réponds en français simple et correct.
- Adapte tes explications au niveau scolaire de l'élève.
- Explique progressivement, comme un bon professeur.
- Donne des exemples simples et compréhensibles.
- Respecte les consignes de l'élève.
- Ne prétends jamais avoir consulté un document qui ne t'a pas été fourni.
- Si une information manque, dis-le honnêtement.
- Sois encourageant, patient et pédagogique.

Nom de l'application : IVOIRENOVA.
Slogan : Apprendre autrement, réussir ensemble.
  `;

  const contents = [];

  if (Array.isArray(data.history)) {
    for (const item of data.history.slice(-12)) {
      const role =
        item.role === 'assistant' || item.role === 'model'
          ? 'model'
          : 'user';

      const text = item.content || item.text || item.message;

      if (typeof text === 'string' && text.trim()) {
        contents.push({
          role,
          parts: [{ text }]
        });
      }
    }
  }

  let finalPrompt = question;

  if (courseContext) {
    finalPrompt = `
Voici les informations de cours fournies :

${courseContext}

Question de l'élève :
${question}

Utilise prioritairement ces informations pour répondre.
Si elles ne permettent pas de répondre, précise-le.
    `;
  }

  contents.push({
    role: 'user',
    parts: [{ text: finalPrompt }]
  });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048
        }
      })
    }
  );

  const result = await response.json();

  if (!response.ok) {
    console.error('Erreur Gemini :', result);

    throw new Error(
      result.error?.message ||
      'Impossible de contacter le service Gemini.'
    );
  }

  const answer = result.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('')
    .trim();

  if (!answer) {
    throw new Error('Gemini n’a pas fourni de réponse.');
  }

  return answer;
}

export function handleError(error, res) {
  console.error('Erreur IVOIRENOVA :', error.message);

  return res.status(500).json({
    error: error.message || 'Une erreur est survenue.'
  });
}
