
import { google, Auth, gmail_v1 } from 'googleapis';

class GmailService {
  private gmail: gmail_v1.Gmail;

  constructor(oauth2Client: Auth.OAuth2Client) {
    this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  }

  async getInitialHistoryId(): Promise<string | null | undefined> {
    const profileResponse = await this.gmail.users.getProfile({ userId: 'me' });
    return profileResponse.data.historyId;
  }

  async getNewEmails(lastHistoryId: string): Promise<{ newEmails: { from: string | null | undefined, subject: string | null | undefined, body: string }[], newHistoryId: string | null | undefined }> {
    const historyResponse = await this.gmail.users.history.list({
      userId: 'me',
      startHistoryId: lastHistoryId,
      historyTypes: ['messageAdded'],
    });

    const newHistoryId = historyResponse.data.historyId;
    if (!historyResponse.data.history) {
      return { newEmails: [], newHistoryId };
    }

    const newMessagesIds: string[] = historyResponse.data.history
      .flatMap((h: gmail_v1.Schema$History) => h.messagesAdded || [])
      .map((m: gmail_v1.Schema$HistoryMessageAdded) => m.message?.id || '');

    if (newMessagesIds.length === 0) {
      return { newEmails: [], newHistoryId };
    }

    const unreadEmailsBatch: { from: string | null | undefined, subject: string | null | undefined, body: string }[] = [];
    for (const messageId of newMessagesIds) {
      const msg = await this.gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });

      if (msg.data.labelIds && msg.data.labelIds.includes('UNREAD') && !msg.data.labelIds.includes('SPAM')) {
        const headers = msg.data.payload?.headers;
        const body = this.getEmailBody(msg.data.payload);
        unreadEmailsBatch.push({
          from: headers?.find((h: gmail_v1.Schema$MessagePartHeader) => h.name === 'From')?.value || null,
          subject: headers?.find((h: gmail_v1.Schema$MessagePartHeader) => h.name === 'Subject')?.value || null,
          body: body,
        });
      }
    }

    return { newEmails: unreadEmailsBatch, newHistoryId };
  }

  getEmailBody(payload: gmail_v1.Schema$MessagePart | undefined | null): string {
    if (payload?.body && payload.body.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
    if (payload?.parts) {
      const part = payload.parts.find((p: gmail_v1.Schema$MessagePart) => p.mimeType === 'text/plain');
      if (part && part.body && part.body.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }
    return "Contenu non trouvé.";
  }
}

export { GmailService };
