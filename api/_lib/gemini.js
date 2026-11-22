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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export async function answerWithGemini(data = {}, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('Clé Gemini absente sur le serveur.');
  }

  // Récupération des messages envoyés par IVOIRENOVA
  const messages = Array.isArray(data.messages)
    ? data.messages
    : Array.isArray(data.history)
      ? data.history
      : [];

  // Recherche de la dernière question de l'élève
  const lastUserIndex = messages.map(
    m => m.role === 'user'
  ).lastIndexOf(true);

  const lastUserMessage =
    lastUserIndex >= 0 ? messages[lastUserIndex] : null;

  const question =
    data.message ||
    data.prompt ||
    data.question ||
    data.text ||
    lastUserMessage?.text ||
    lastUserMessage?.content ||
    '';

  if (typeof question !== 'string' || !question.trim()) {
    throw new Error('Veuillez écrire une question.');
  }

  const courseContext =
    options.context ||
    data.courseText ||
    data.context ||
    data.knowledge ||
    '';

  const systemInstruction = options.systemInstruction || `
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

Nom : IVOIRENOVA.
Slogan : Apprendre autrement, réussir ensemble.
`;

  // Conservation de l'historique de conversation
  const contents = [];

  for (const item of messages.slice(-12)) {
    const role = item.role === 'assistant' || item.role === 'model'
      ? 'model'
      : 'user';

    const messageText = item.text || item.content || item.message;

    if (
      typeof messageText === 'string' &&
      messageText.trim()
    ) {
      contents.push({
        role,
        parts: [{ text: messageText }]
      });
    }
  }

  // Évite de répéter la dernière question
  if (lastUserIndex >= 0) {
    contents.splice(
      contents.length - 1,
      1
    );
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
