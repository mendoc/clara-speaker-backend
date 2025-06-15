import { Context } from '@netlify/functions'
import admin from "firebase-admin";
import { google } from "googleapis";
import { GoogleGenerativeAI } from "@google/generative-ai";

// --- Initialisation des services ---
if (admin.apps.length === 0) {
  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- Configuration du client OAuth2 ---
const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground" // L'URI de redirection
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

export default async (request: Request, context: Context) => {
  // On s'assure que la méthode est bien POST
  if (request.method !== 'POST') {
    return Response.json(
      { error: "Méthode non autorisée. Seules les requêtes POST sont acceptées." },
      { status: 405 }
    );
  }

  console.log("Démarrage de la vérification des nouveaux emails (mode batch)...");

  try {
    // Récupérer l'état depuis Firestore
    const userRef = db.collection('clara_speaker_users').doc('ongouadimitri5');
    const userDoc = await userRef.get();
    if (!userDoc.exists) throw new Error("Document utilisateur non trouvé.");

    const { lastHistoryId, fcmToken } = userDoc.data();
    if (!fcmToken) throw new Error("Token FCM manquant dans Firestore.");

    // Si lastHistoryId est à sa valeur initiale ("1") ou n'existe pas, on initialise le système.
    if (lastHistoryId == 1 || !lastHistoryId) {
      console.log("Première exécution détectée. Initialisation du History ID...");

      // On récupère le profil pour obtenir l'ID d'historique actuel. 
      const profileResponse = await gmail.users.getProfile({ userId: 'me' });
      const currentHistoryId = profileResponse.data.historyId;

      // On met à jour Firestore avec cet ID de départ.
      await userRef.update({ lastHistoryId: currentHistoryId });

      const msg = `Initialisation terminée. Le point de départ est fixé à l'History ID : ${currentHistoryId}.`;
      console.log(msg);
      console.log("Le prochain cycle traitera les emails arrivant à partir de maintenant.");

      // On arrête l'exécution pour ce cycle.
      return Response.json(
        { message: msg },
        { status: 200 }
      );
    }

    // Chercher les nouveaux emails depuis le dernier historique connu
    const historyResponse = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: lastHistoryId,
      historyTypes: ['messageAdded'],
    });

    const newHistoryId = historyResponse.data.historyId;
    if (!historyResponse.data.history) {
      console.log("Aucun nouvel email depuis le dernier historique.");
      // On met quand même à jour l'ID d'historique pour la prochaine fois
      await userRef.update({ lastHistoryId: newHistoryId });
      return Response.json(
        { message: "Aucun nouvel email depuis le dernier historique." },
        { status: 200 }
      );
    }

    // On récupère les ID des nouveaux messages
    const newMessagesIds = historyResponse.data.history
      .flatMap(h => h.messagesAdded || [])
      .map(m => m.message.id);

    if (newMessagesIds.length === 0) {
      console.log("Aucun nouvel email trouvé dans l'historique.");
      await userRef.update({ lastHistoryId: newHistoryId });
      return Response.json(
        { message: "Aucun nouvel email trouvé dans l'historique." },
        { status: 200 }
      );
    }

    console.log(`Trouvé ${newMessagesIds.length} nouvel(s) email(s). Début de la collecte.`);

    // =================================================================
    // ÉTAPE DE COLLECTE
    // =================================================================
    const unreadEmailsBatch = [];
    for (const messageId of newMessagesIds) {
      const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'metadata', metadataHeaders: ['From', 'Subject'] });
      // On demande juste les métadonnées pour être plus rapide
      const headers = msg.data.payload.headers;
      unreadEmailsBatch.push({
        from: headers.find(h => h.name === 'From').value,
        subject: headers.find(h => h.name === 'Subject').value,
      });
    }

    // On vérifie si le label 'UNREAD' est présent
    if (msg.data.labelIds && msg.data.labelIds.includes('UNREAD')) {
      // L'email est bien nouveau ET non lu, on l'ajoute au lot
      const headers = msg.data.payload.headers;
      unreadEmailsBatch.push({
        from: headers.find(h => h.name === 'From').value,
        subject: headers.find(h => h.name === 'Subject').value,
      });
      console.log(`-> Email ${messageId} est non lu. Ajouté au rapport.`);
    } else {
      // L'email a déjà été lu, on l'ignore
      console.log(`-> Email ${messageId} est déjà lu. Ignoré.`);
    }

    // =================================================================
    // ÉTAPE DE SYNTHÈSE GLOBALE
    // =================================================================
    if (unreadEmailsBatch.length > 0) {
      // On prépare une note de synthèse pour l'IA
      const emailListForPrompt = unreadEmailsBatch
        .map((email, index) => `${index + 1}. De: ${email.from}, Sujet: ${email.subject}`)
        .join("\n");

      const prompt = `
        Tu es un assistant personnel vocal. Tu dois créer un rapport de synthèse très court sur les nouveaux emails reçus.
        Commence par dire le nombre total d'emails. Ensuite, mentionne brièvement les plus importants si possible, sans faire de phrases trop longues.
        Sois concis et naturel, comme si tu parlais à quelqu'un.
        Voici la liste des emails :
        ${emailListForPrompt}
      `;

      // On fait UN SEUL appel à l'IA
      console.log("Envoi du batch à Gemini pour synthèse globale...");
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      const globalSummary = result.response.text();

      console.log(`Rapport global généré : "${globalSummary}"`);

      // On envoie UNE SEULE notification
      await sendFcmMessage(fcmToken, globalSummary);
    }

    // On met à jour l'état une seule fois à la fin
    await userRef.update({ lastHistoryId: newHistoryId });
    console.log(`Dernier ID d'historique mis à jour à ${newHistoryId}.`);

    return Response.json(
      { message: "Traitement terminé." },
      { status: 200 }
    );

  } catch (error) {
    // Gère les erreurs de parsing JSON ou autres erreurs inattendues
    console.error("Erreur lors du traitement par lot des emails:", error);
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
};

// --- Fonctions Helpers ---

// Helper pour envoyer le message FCM
async function sendFcmMessage(deviceToken, summary) {
  await admin.messaging().send({
    token: deviceToken,
    data: { summaryText: summary },
    android: { priority: 'high' },
  });
  console.log("Message FCM envoyé avec succès.");
}

// Helper pour extraire le corps du texte d'un email (gère les formats complexes)
function getEmailBody(payload) {
  if (payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }
  if (payload.parts) {
    const part = payload.parts.find(p => p.mimeType === 'text/plain');
    if (part && part.body && part.body.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
  }
  return "Contenu non trouvé.";
}