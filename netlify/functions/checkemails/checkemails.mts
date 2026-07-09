import admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { TelegramService } from "../../../services/TelegramService";
import { OAuth2Service } from "../../../services/OAuth2Service";
import { DatabaseService } from "../../../services/DatabaseService";
import { GmailService } from "../../../services/GmailService";
import { geminiConfig } from "../../../common/config";
import { formatError } from "../../../common/errors";


if (!geminiConfig.apiKey) {
  throw new Error("GEMINI_API_KEY is not defined in config.");
}
const genAI = new GoogleGenerativeAI(geminiConfig.apiKey);

const telegramService = new TelegramService();

const dbService = new DatabaseService();
const oAuth2Service = new OAuth2Service();

export default async (request: Request) => {
  // On s'assure que la méthode est bien POST
  if (request.method !== 'POST') {
    return Response.json(
      { error: "Méthode non autorisée. Seules les requêtes POST sont acceptées." },
      { status: 405 }
    );
  }

  const users = await dbService.getAllUsers();

  for (const user of users) {
    const userId = user.id;
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
        await dbService.setUserState(userId, {
          lastHistoryId: currentHistoryId,
        });

        console.log(`Initialisation terminée. Le point de départ est fixé à l'History ID : ${currentHistoryId}.`);
        console.log("Le prochain cycle traitera les emails arrivant à partir de maintenant.");

        continue; // Passe à l'utilisateur suivant
      }

      let newEmails: Awaited<ReturnType<typeof gmailService.getNewEmails>>["newEmails"];
      let newHistoryId: string | null | undefined;

      try {
        ({ newEmails, newHistoryId } = await gmailService.getNewEmails(lastHistoryId));
      } catch (error) {
        // Gmail ne conserve l'historique que quelques jours : un lastHistoryId trop
        // ancien renvoie 404. On repart de l'ID courant, les emails de l'intervalle
        // sont définitivement perdus mais l'utilisateur n'est plus bloqué.
        if ((error as { code?: number })?.code !== 404) throw error;

        const currentHistoryId = await gmailService.getInitialHistoryId();
        await dbService.setUserState(userId, { lastHistoryId: currentHistoryId });

        console.warn(`History ID ${lastHistoryId} expiré pour l'utilisateur ${userId}. Réinitialisé à ${currentHistoryId}.`);
        continue; // Passe à l'utilisateur suivant
      }

      if (newEmails.length === 0) {
        console.log("Aucun nouvel email trouvé dans l'historique.");
        await dbService.setUserState(userId, {
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
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
        const result = await model.generateContent(prompt);
        const globalSummary = result.response.text();

        console.log(`Rapport global généré : "${globalSummary}"`);

        // On envoie UNE SEULE notification
        await sendFcmMessage(fcmToken, globalSummary);
      }

      // On met à jour l'état une seule fois à la fin
      await dbService.setUserState(userId, {
        lastHistoryId: newHistoryId,
      });
      console.log(`Dernier ID d'historique mis à jour à ${newHistoryId}.`);

    } catch (error) {
      // Gère les erreurs de parsing JSON ou autres erreurs inattendues
      console.error(`Erreur lors du traitement par lot des emails pour l'utilisateur ${userId}:`, formatError(error));
      if (error?.message?.includes('invalid_grant')) {
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
