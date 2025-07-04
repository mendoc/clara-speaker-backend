import { Context } from '@netlify/functions'
import { OAuth2Service } from "../../../services/OAuth2Service";
import { DatabaseService } from "../../../services/DatabaseService";
import { TelegramService } from "../../../services/TelegramService";

const databaseService = new DatabaseService();
const telegramService = new TelegramService();

export default async (request: Request, context: Context) => {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get('code') || ''

    const oauth2Service = new OAuth2Service();
    const { tokens } = await oauth2Service.getToken(code);
    console.log("[/oauth2callback] Refresh Token:", tokens.refresh_token);

    await databaseService.setUserRefreshToken('ongouadimitri5', tokens.refresh_token);

    await telegramService.sendMessage(`Token mis à jour avec succès`);

    return new Response(
      "Token mis à jour avec succès ! Vous pouvez fermer cette fenêtre."
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

export const config = {
  path: "/oauth2callback",
};