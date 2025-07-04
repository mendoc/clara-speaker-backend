import { Context } from '@netlify/functions'
import admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { TelegramService } from "../../../services/TelegramService";
import { OAuth2Service } from "../../../services/OAuth2Service";
import { DatabaseService } from "../../../services/DatabaseService";
import { GmailService } from "../../../services/GmailService";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const telegramService = new TelegramService();

export default async (request: Request, context: Context) => {
  // On s'assure que la méthode est bien POST
  if (request.method !== 'POST') {
    return Response.json(
      { error: "Méthode non autorisée. Seules les requêtes POST sont acceptées." },
      { status: 405 }
    );
  }

  const dbService = new DatabaseService();
  const users = await dbService.getAllUsers();

  for (const user of users) {
    const userId = user.id;
    const oAuth2Service = new OAuth2Service();
    oAuth2Service.setRefreshToken(user.refreshToken);
    const gmailService = new GmailService(oAuth2Service.getOAuth2Client());

    console.log(`Démarrage de la vérification des nouveaux emails pour l'utilisateur ${userId}...`);

    try {
      // Récupérer l'état depuis Firestore
      const userState = await dbService.getUserState(userId);

      const { lastHistoryId, fcmToken } = userState;
      if (!fcmToken) throw new Error("Token FCM manquant dans Firestore.");

      // Si lastHistoryId est à sa valeur initiale ("1") ou n'existe pas, on initialise le système.
      if (lastHistoryId == 1 || !lastHistoryId) {
        console.log("Première exécution détectée. Initialisation du History ID...");

        const currentHistoryId = await gmailService.getInitialHistoryId();

        // On met à jour Firestore avec cet ID de départ.
        dbService.setUserState(userId, {
          lastHistoryId: currentHistoryId,
        });

        console.log(`Initialisation terminée. Le point de départ est fixé à l'History ID : ${currentHistoryId}.`);
        console.log("Le prochain cycle traitera les emails arrivant à partir de maintenant.");

        continue; // Passe à l'utilisateur suivant
      }

      const { newEmails, newHistoryId } = await gmailService.getNewEmails(lastHistoryId);

      if (newEmails.length === 0) {
        console.log("Aucun nouvel email trouvé dans l'historique.");
        dbService.setUserState(userId, {
          lastHistoryId: newHistoryId,
        });
        continue; // Passe à l'utilisateur suivant
      }

      console.log(`Trouvé ${newEmails.length} nouvel(s) email(s). Début de la collecte.`);

      // =================================================================
      // ÉTAPE DE SYNTHÈSE GLOBALE
      // =================================================================
      if (newEmails.length > 0) {
        // On prépare une note de synthèse pour l'IA
        const emailListForPrompt = newEmails
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

    } catch (error) {
      // Gère les erreurs de parsing JSON ou autres erreurs inattendues
      console.error(`Erreur lors du traitement par lot des emails pour l'utilisateur ${userId}:`, error);
      if (error.message.includes('invalid_grant')) {
        await telegramService.sendMessage(
          `Token expiré pour l'utilisateur ${userId}. \nURL d'authentification : \n${new OAuth2Service().getAuthUrl()}`
        );
      }
    }
  }

  return Response.json(
    { message: "Traitement terminé pour tous les utilisateurs." },
    { status: 200 }
  );
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

export const config = {
  path: "/checkemails",
};
