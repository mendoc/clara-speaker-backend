import { google } from "googleapis";
import { gmailConfig } from "../common/config";

export class OAuth2Service {
  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      gmailConfig.clientId,
      gmailConfig.clientSecret,
      gmailConfig.redirectUri
    );
  }

  getOAuth2Client() {
    // Retourner l'instance OAuth2Client
    return this.oauth2Client;
  }

  setRefreshToken(refreshToken) {
    // Mettre à jour le token de rafraîchissement
    this.oauth2Client.setCredentials({ refresh_token: refreshToken });
  }

  async getToken(code) {
    return await this.oauth2Client.getToken(code);
  }

  getAuthUrl() {
    // Générer l'URL d'autorisation
    return this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/gmail.readonly"],
      prompt: "consent", // Force à redemander le consentement pour obtenir un refresh token
    });
  }
}