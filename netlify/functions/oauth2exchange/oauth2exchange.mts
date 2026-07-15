import { OAuth2Service } from "../../../services/OAuth2Service";
import { DatabaseService } from "../../../services/DatabaseService";
import { formatError } from "../../../common/errors";

const databaseService = new DatabaseService();

/**
 * Échange un server auth code envoyé par l'app mobile contre un refresh token.
 * Même mécanique que le flux web /oauth2callback, mais déclenchée par un POST de
 * l'app (flux d'accès hors-ligne) au lieu d'une redirection dans un navigateur.
 * Le code doit avoir été demandé côté Android contre le client OAuth « Web ».
 */
export default async (request: Request) => {
  if (request.method !== 'POST') {
    return Response.json(
      { error: "Méthode non autorisée. Seules les requêtes POST sont acceptées." },
      { status: 405 }
    );
  }

  try {
    const { code } = await request.json();
    if (!code) {
      return Response.json(
        { error: "Le champ 'code' est requis dans le corps JSON." },
        { status: 400 }
      );
    }

    // Échange sans redirect_uri : le code mobile est émis sans, contrairement au flux web.
    const oauth2Service = new OAuth2Service();
    const { tokens, userInfo } = await oauth2Service.exchangeMobileCode(code);

    // L'ID Google déduit du token nomme le document Firestore : l'app n'a pas à l'envoyer.
    const userId = userInfo.id;
    if (!userId) {
      return Response.json(
        { error: "Impossible de déterminer l'identité de l'utilisateur à partir du code." },
        { status: 400 }
      );
    }

    // Google ne renvoie le refresh token qu'au premier consentement (ou avec
    // prompt=consent / forceCodeForRefreshToken). En son absence, on ne touche pas
    // au token déjà stocké : l'écraser par undefined casserait la lecture Gmail.
    if (!tokens.refresh_token) {
      console.warn(`Aucun refresh token renvoyé pour l'utilisateur ${userId} : token existant conservé.`);
      return Response.json(
        { message: "Aucun nouveau refresh token fourni ; le token existant est conservé.", userId, refreshTokenStored: false },
        { status: 200 }
      );
    }

    await databaseService.setUserRefreshToken(userId, tokens.refresh_token);
    console.log(`Refresh token enregistré pour l'utilisateur ${userId}.`);

    return Response.json(
      { message: "Refresh token enregistré avec succès.", userId, refreshTokenStored: true },
      { status: 200 }
    );

  } catch (error) {
    console.error("Erreur lors de l'échange du code OAuth : ", formatError(error));
    return Response.json(
      { error: (error as Error)?.message ?? "Erreur inattendue." },
      { status: 500 }
    );
  }
};

export const config = {
  path: "/oauth2/exchange",
};
