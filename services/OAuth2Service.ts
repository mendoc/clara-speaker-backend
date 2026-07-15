import { google, Auth, oauth2_v2 } from "googleapis";
import { gmailConfig } from "../common/config";

export class OAuth2Service {
  private oauth2Client: Auth.OAuth2Client;

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      gmailConfig.clientId,
      gmailConfig.clientSecret,
      gmailConfig.redirectUri
    );
  }

  getOAuth2Client(): Auth.OAuth2Client {
    // Retourner l'instance OAuth2Client
    return this.oauth2Client;
  }

  setRefreshToken(refreshToken: string): void {
    // Mettre à jour le token de rafraîchissement
    this.oauth2Client.setCredentials({ refresh_token: refreshToken });
  }

  async getToken(code: string): Promise<{ tokens: Auth.Credentials }> {
    return await this.oauth2Client.getToken(code);
  }

  /**
   * Échange un server auth code issu de l'Authorization API mobile (requestOfflineAccess).
   * Un tel code est émis SANS redirect_uri : l'échange doit donc se faire sans redirect_uri,
   * sinon Google rejette avec invalid_grant. On utilise un client dédié construit sans
   * redirectUri — passer `redirect_uri: ''` ne suffit pas, google-auth-library évalue
   * `options.redirect_uri || this.redirectUri` et la chaîne vide (falsy) retombe sur le
   * redirectUri du constructeur.
   */
  async exchangeMobileCode(code: string): Promise<{ tokens: Auth.Credentials, userInfo: oauth2_v2.Schema$Userinfo }> {
    const client = new google.auth.OAuth2(gmailConfig.clientId, gmailConfig.clientSecret);
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ auth: client, version: 'v2' });
    const { data: userInfo } = await oauth2.userinfo.get();
    return { tokens, userInfo };
  }

  async getUserInfo(): Promise<oauth2_v2.Schema$Userinfo> {
    const oauth2 = google.oauth2({
      auth: this.oauth2Client,
      version: 'v2'
    });
    const { data } = await oauth2.userinfo.get();
    return data;
  }

  getAuthUrl(): string {
    // Générer l'URL d'autorisation
    return this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/userinfo.profile"
      ],
      prompt: "consent", // Force à redemander le consentement pour obtenir un refresh token
    });
  }
}