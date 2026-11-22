import pdfParse from 'pdf-parse';
import { answerWithGemini, handleError, setCors } from '../_lib/gemini.js';

const PROJECT_ID = 'ivoirenova-33758';
const MAX_DOCS = 20;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_PDFS_TO_READ = 5;
const MAX_CONTEXT_CHARS = 30000;

function decodeValue(value) {
  if (!value || typeof value !== 'object') return value;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  return value;
}
function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

async function readAdminInformation(idToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/informations?pageSize=100`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('Lecture Firestore informations impossible:', result.error?.message || response.status);
    throw new Error('Impossible de consulter les informations de l’administrateur dans Firebase. Vérifiez les règles Firestore.');
  }
  return (result.documents || []).slice(0, MAX_DOCS).map(doc => ({
    id: doc.name.split('/').pop(),
    ...decodeFields(doc.fields || {})
  }));
}

async function pdfTextFromUrl(url) {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return '';
  const response = await fetch(url);
  if (!response.ok) return '';
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_PDF_BYTES) return '';
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_PDF_BYTES || buffer.length < 5 || buffer.subarray(0, 5).toString() !== '%PDF-') return '';
  try {
    const parsed = await pdfParse(buffer);
    return String(parsed.text || '').slice(0, 12000);
  } catch (error) {
    console.warn('Extraction d’un PDF d’information impossible:', error.message);
    return '';
  }
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  try {
    const authorization = req.headers.authorization || '';
    const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Connexion élève requise pour accéder au Professeur intelligent.' });

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const lastQuestion = [...messages].reverse().find(item => item?.role === 'user');
    const question = String(lastQuestion?.text || lastQuestion?.content || req.body?.message || '').trim();
    if (!question) return res.status(400).json({ error: 'Veuillez écrire une question.' });

    const documents = await readAdminInformation(idToken);
    const knowledgeParts = [];
    let pdfsRead = 0;
    for (const doc of documents) {
      const title = String(doc.title || doc.titre || doc.fileName || 'Information').slice(0, 180);
      const text = String(doc.text || doc.content || doc.description || '').trim();
      if (text) knowledgeParts.push(`DOCUMENT : ${title}\n${text.slice(0, 9000)}`);
      const pdfUrl = doc.downloadURL || doc.url || '';
      if (pdfUrl && pdfsRead < MAX_PDFS_TO_READ) {
        pdfsRead++;
        const extracted = await pdfTextFromUrl(pdfUrl);
        if (extracted.trim()) knowledgeParts.push(`PDF : ${title}\n${extracted}`);
      }
      if (knowledgeParts.join('\n\n').length >= MAX_CONTEXT_CHARS) break;
    }
    const context = knowledgeParts.join('\n\n').slice(0, MAX_CONTEXT_CHARS);

    const systemInstruction = `
Tu es le PROFESSEUR INTELLIGENT d’IVOIRENOVA, un assistant de discussion créé par ZAKARIA NIAMPA en Côte d’Ivoire.
Tu n’es PAS le professeur de cours de l’élève et tu ne dois PAS lancer une leçon, imposer un programme scolaire, demander une classe ou transformer chaque question en exercice.

TON RÔLE : discuter naturellement avec les élèves, répondre à leurs questions générales, les aider à réfléchir, leur donner des conseils prudents et bienveillants, expliquer des sujets de la vie quotidienne et répondre aux questions sur la Côte d’Ivoire (histoire, géographie, culture, société, institutions, vie citoyenne et autres sujets).

RÈGLES :
- Réponds en français clair, simple, respectueux et adapté à un public scolaire.
- Tu peux utiliser tes connaissances générales, mais distingue les faits établis des incertitudes.
- Pour les informations administratives, locales ou d’actualité qui peuvent changer, indique clairement si tu n’es pas certain et recommande une source officielle lorsque nécessaire.
- Les informations fournies par l’administrateur d’IVOIRENOVA sont une source de référence prioritaire lorsqu’elles répondent à la question. Ne prétends pas avoir consulté un document qui n’est pas présent dans le contexte.
- Si les documents de l’administrateur ne contiennent pas la réponse, tu peux répondre avec tes connaissances générales en précisant si nécessaire que cela ne vient pas des documents fournis.
- N’invente jamais le contenu d’un document, une décision officielle, une date ou un chiffre.
- Ne donne pas de cours scolaires structurés. Si l’élève veut étudier une leçon, résumer un cours, préparer un cours ou faire des devoirs, indique-lui gentiment de choisir l’une des quatre niches d’apprentissage d’IVOIRENOVA.
- Ne demande pas à l’élève de choisir une classe ou une matière pour une discussion générale.
- Sois patient, encourageant et naturel. Ne prétends pas être une personne humaine.

Nom : IVOIRENOVA — PROFESSEUR INTELLIGENT.
Slogan : Apprendre autrement, réussir ensemble.
`;

    const answer = await answerWithGemini({ messages }, { systemInstruction, context });
    return res.status(200).json({ answer, knowledgeDocumentsUsed: knowledgeParts.length });
  } catch (error) {
    return handleError(error, res);
  }
}
