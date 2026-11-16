
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "La clé Gemini n'est pas configurée sur Vercel."
    });
  }

  try {
    const {
      messages = [],
      classe = "",
      matiere = "",
      lessonTitle = "",
      sessionTitle = ""
    } = req.body || {};

    const conversation = messages.slice(-12).map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: String(m.text || "") }]
    }));

    const prompt = `
Tu es ZAKARIA AI, un professeur intelligent et patient.

Tu aides les élèves à comprendre leurs cours.
Classe : ${classe}
Matière : ${matiere}
Leçon : ${lessonTitle}
Séance : ${sessionTitle}

Règles :
- Réponds toujours en français, sauf demande contraire.
- Explique simplement, étape par étape.
- Donne des exemples et des exercices si nécessaire.
- Sois pédagogique, précis et encourageant.
- Ne prétends jamais avoir consulté un document absent.
- Si une information manque, dis-le honnêtement.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: prompt }]
          },
          contents: conversation,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        error: "Erreur Gemini : " +
          (data.error?.message || "Service indisponible.")
      });
    }

    const answer =
      data.candidates?.[0]?.content?.parts
        ?.map(p => p.text || "")
        .join("")
        .trim();

    if (!answer) {
      return res.status(502).json({
        error: "Gemini n'a pas fourni de réponse."
      });
    }

    return res.status(200).json({ answer });

  } catch (error) {
    return res.status(500).json({
      error: "Erreur du serveur : " + error.message
    });
  }
}
