import { Context } from '@netlify/functions'
import admin from "firebase-admin";
import { google } from "googleapis";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { TelegramService } from "../../../services/TelegramService";
import { OAuth2Service } from "../../../services/OAuth2Service";
import { DatabaseService } from "../../../services/DatabaseService";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const telegramService = new TelegramService();
const oAuth2Service = new OAuth2Service();

const userId = 'ongouadimitri5';

export default async (request: Request, context: Context) => {
  // On s'assure que la méthode est bien POST
  if (request.method !== 'POST') {
    return Response.json(
      { error: "Méthode non autorisée. Seules les requêtes POST sont acceptées." },
      { status: 405 }
    );
  }

  const dbService = new DatabaseService();

  const refreshToken = await dbService.getUserRefreshToken(userId);
  oAuth2Service.setRefreshToken(refreshToken);
  const gmail = google.gmail({ version: 'v1', auth: oAuth2Service.getOAuth2Client() });

  console.log("Démarrage de la vérification des nouveaux emails (mode batch)...");

  try {
    // Récupérer l'état depuis Firestore
    const userState = await dbService.getUserState(userId);

    const { lastHistoryId, fcmToken } = userState;
    if (!fcmToken) throw new Error("Token FCM manquant dans Firestore.");

    // Si lastHistoryId est à sa valeur initiale ("1") ou n'existe pas, on initialise le système.
    if (lastHistoryId == 1 || !lastHistoryId) {
      console.log("Première exécution détectée. Initialisation du History ID...");

      // On récupère le profil pour obtenir l'ID d'historique actuel. 
      const profileResponse = await gmail.users.getProfile({ userId: 'me' });
      const currentHistoryId = profileResponse.data.historyId;

      // On met à jour Firestore avec cet ID de départ.
      dbService.setUserState(userId, {
        lastHistoryId: currentHistoryId,
      });

      console.log(`Initialisation terminée. Le point de départ est fixé à l'History ID : ${currentHistoryId}.`);
      console.log("Le prochain cycle traitera les emails arrivant à partir de maintenant.");

      // On arrête l'exécution pour ce cycle.
      return Response.json(
        { message: `Initialisation terminée. Le point de départ est fixé à l'History ID : ${currentHistoryId}.` },
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
      dbService.setUserState(userId, {
        lastHistoryId: newHistoryId,
      });
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
      dbService.setUserState(userId, {
        lastHistoryId: newHistoryId,
      });
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
      const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });

      // On vérifie si le label 'UNREAD' est présent
      if (msg.data.labelIds && msg.data.labelIds.includes('UNREAD')) {
        // L'email est bien nouveau ET non lu, on l'ajoute au lot
        const headers = msg.data.payload.headers;
        const body = getEmailBody(msg.data.payload);
        unreadEmailsBatch.push({
          from: headers.find(h => h.name === 'From').value,
          subject: headers.find(h => h.name === 'Subject').value,
          body: body,
        });
        console.log(`-> Email ${messageId} est non lu. Ajouté au rapport.`);
      } else {
        // L'email a déjà été lu, on l'ignore
        console.log(`-> Email ${messageId} est déjà lu. Ignoré.`);
      }
    }

    // =================================================================
    // ÉTAPE DE SYNTHÈSE GLOBALE
    // =================================================================
    if (unreadEmailsBatch.length > 0) {
      // On prépare une note de synthèse pour l'IA
      const emailListForPrompt = unreadEmailsBatch
        .map((email, index) => `${index + 1}. De: ${email.from}, Sujet: ${email.subject}\nContenu: ${email.body}`)
        .join("\n\n");

      const prompt = `
        Tu es une assistante vocale intelligente, douce et humaine, comme Samantha dans le film Her. Je viens de recevoir ces emails. Résume-les-moi de façon naturelle et fluide, comme si tu me parlais à l’oral. Garde l’essentiel, sois concis sans être trop formel.
        Voici la liste des emails (expéditeur, sujet et contenu) :
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
    dbService.setUserState(userId, {
      lastHistoryId: newHistoryId,
    });
    console.log(`Dernier ID d'historique mis à jour à ${newHistoryId}.`);

    return Response.json(
      { message: "Traitement terminé." },
      { status: 200 }
    );

  } catch (error) {
    // Gère les erreurs de parsing JSON ou autres erreurs inattendues
    console.error("Erreur lors du traitement par lot des emails:", error);
    if (error.message.includes('invalid_grant')) {
      await telegramService.sendMessage(
        `Token expiré. \nURL d'authentification : \n${oAuth2Service.getAuthUrl()}`
      );
    }
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

export const config = {
  path: "/checkemails",
};
