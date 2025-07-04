import admin from "firebase-admin";

// --- 1. Initialisation SÉCURISÉE de Firebase Admin ---
// On vérifie si l'application est déjà initialisée pour éviter les erreurs sur les "warm starts".
if (admin.apps.length === 0) {
  // On récupère les identifiants depuis les variables d'environnement
  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.GCP_PROJECT_ID,
      clientEmail: serviceAccount.client_email,
      // Le replace est une bonne pratique pour gérer les sauts de ligne dans les variables d'environnement
      privateKey: serviceAccount.private_key.replace(/\\n/g, '\n'),
    }),
    projectId: process.env.GCP_PROJECT_ID,
  });
}

/**
 * Handler principal de la fonction Netlify.
 * Il attend une requête POST avec un corps JSON.
 */
export default async (request: Request) => {
  // On s'assure que la méthode est bien POST
  if (request.method !== 'POST') {
    return Response.json(
      { error: "Méthode non autorisée. Seules les requêtes POST sont acceptées." },
      { status: 405 }
    );
  }

  try {
    // --- 2. Lecture des données depuis le corps JSON de la requête (méthode POST) ---
    const { deviceToken, summary } = await request.json();

    // Validation des données d'entrée
    if (!deviceToken || !summary) {
      return Response.json(
        { error: "Les champs 'deviceToken' et 'summary' sont requis dans le corps JSON." },
        { status: 400 }
      );
    }

    // --- 3. Envoi du message via notre fonction helper ---
    const result = await sendMessage(deviceToken, summary);
    if (!result.success) {
      console.error(`Erreur lors de l'envoi FCM : ${result.error}`);
      return Response.json(
        { error: `Erreur lors de l'envoi du message : ${result.error}` },
        { status: 500 }
      );
    }

    // Réponse de succès
    console.log(`Message de données envoyé avec succès à ${deviceToken}`);
    return Response.json(
      { message: `Message de données envoyé avec succès à ${deviceToken}` },
      { status: 200 }
    );

  } catch (error) {
    // Gère les erreurs de parsing JSON ou autres erreurs inattendues
    console.error("Erreur inattendue : ", error);
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
};

/**
 * Prépare et envoie un message de type "données uniquement" (data-only) à un appareil.
 * @param {string} deviceToken - Le token FCM de l'appareil cible.
 * @param {string} summary - Le texte de résumé à envoyer.
 * @returns {Promise<object>} - Résultat de l'envoi.
 */
async function sendMessage(deviceToken: string, summary: string) {
  // --- 4. Création d'un message "data-only" ---
  // Pas de clé "notification" ! Uniquement la clé "data".
  const message = {
    token: deviceToken,
    data: {
      // La clé ici, "summaryText", doit correspondre EXACTEMENT
      // à ce que vous lisez dans votre code Android : remoteMessage.data["summaryText"]
      summaryText: summary,
    },
    android: {
      // Mettre la priorité à 'high' aide à délivrer le message rapidement,
      // même si l'appareil est en mode Doze.
      priority: 'high' as const,
    },
  };

  try {
    const response = await admin.messaging().send(message);
    return { success: true, response };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export const config = {
  path: "/sendmessage",
};
