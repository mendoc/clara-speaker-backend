
import { google, Auth, gmail_v1 } from 'googleapis';

export interface NewEmail {
  from: string | null | undefined;
  to: string | null | undefined;
  cc: string | null | undefined;
  subject: string | null | undefined;
  body: string;
}

class GmailService {
  private gmail: gmail_v1.Gmail;

  constructor(oauth2Client: Auth.OAuth2Client) {
    this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  }

  async getInitialHistoryId(): Promise<string | null | undefined> {
    const profileResponse = await this.gmail.users.getProfile({ userId: 'me' });
    return profileResponse.data.historyId;
  }

  async getNewEmails(lastHistoryId: string): Promise<{ newEmails: NewEmail[], newHistoryId: string | null | undefined }> {
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

    const unreadEmailsBatch: NewEmail[] = [];
    for (const messageId of newMessagesIds) {
      try {
        const msg = await this.gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });

        if (msg.data.labelIds && msg.data.labelIds.includes('UNREAD') && !msg.data.labelIds.includes('SPAM')) {
          const headers = msg.data.payload?.headers;
          const header = (name: string) =>
            headers?.find((h: gmail_v1.Schema$MessagePartHeader) => h.name === name)?.value || null;
          const body = this.getEmailBody(msg.data.payload);
          unreadEmailsBatch.push({
            from: header('From'),
            to: header('To'),
            cc: header('Cc'),
            subject: header('Subject'),
            body: body,
          });
        }
      } catch (error) {
        if ((error as { code?: number })?.code === 404) {
          console.log(`Email ${messageId} non trouvé (probablement supprimé), ignoré`);
          continue;
        }
        throw error;
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
