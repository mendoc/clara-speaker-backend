
import { google } from 'googleapis';

class GmailService {
  constructor(oauth2Client) {
    this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  }

  async getInitialHistoryId() {
    const profileResponse = await this.gmail.users.getProfile({ userId: 'me' });
    return profileResponse.data.historyId;
  }

  async getNewEmails(lastHistoryId) {
    const historyResponse = await this.gmail.users.history.list({
      userId: 'me',
      startHistoryId: lastHistoryId,
      historyTypes: ['messageAdded'],
    });

    const newHistoryId = historyResponse.data.historyId;
    if (!historyResponse.data.history) {
      return { newEmails: [], newHistoryId };
    }

    const newMessagesIds = historyResponse.data.history
      .flatMap(h => h.messagesAdded || [])
      .map(m => m.message.id);

    if (newMessagesIds.length === 0) {
      return { newEmails: [], newHistoryId };
    }

    const unreadEmailsBatch = [];
    for (const messageId of newMessagesIds) {
      const msg = await this.gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });

      if (msg.data.labelIds && msg.data.labelIds.includes('UNREAD')) {
        const headers = msg.data.payload.headers;
        const body = this.getEmailBody(msg.data.payload);
        unreadEmailsBatch.push({
          from: headers.find(h => h.name === 'From').value,
          subject: headers.find(h => h.name === 'Subject').value,
          body: body,
        });
      }
    }

    return { newEmails: unreadEmailsBatch, newHistoryId };
  }

  getEmailBody(payload) {
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
}

export { GmailService };
