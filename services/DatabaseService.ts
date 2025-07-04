import admin from "firebase-admin";
import { Firestore } from "firebase-admin/firestore";

// --- Initialisation des services ---
if (admin.apps.length === 0) {
  const serviceAccount = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!serviceAccount) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT environment variable is not set.");
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(serviceAccount)) });
}

export class DatabaseService {
  private db: Firestore;

  constructor() {
    this.db = admin.firestore();
    if (!this.db) {
      throw new Error("Firestore is not initialized");
    }
  }

  async setUserRefreshToken(userId: string, refreshToken: string): Promise<void> {
    // Récupérer l'état depuis Firestore
    const userRef = this.db.collection('clara_speaker_users').doc(userId);
    await userRef.set({ refreshToken }, { merge: true });
  }

  async getUserRefreshToken(userId: string): Promise<string> {
    const userRef = this.db.collection('clara_speaker_users').doc(userId);
    const doc = await userRef.get();
    if (doc.exists) {
      return doc.data()?.refreshToken;
    } else {
      throw new Error(`No refresh token found for user ${userId}`);
    }
  }

  async getUserState(userId: string): Promise<{ lastHistoryId?: string, fcmToken?: string }> {
    const userRef = this.db.collection('clara_speaker_users').doc(userId);
    const doc = await userRef.get();
    if (doc.exists) {
      return doc.data() as { lastHistoryId?: string, fcmToken?: string };
    } else {
      throw new Error(`No state found for user ${userId}`);
    }
  }

  async setUserState(userId: string, state: { lastHistoryId?: string, fcmToken?: string }): Promise<void> {
    const userRef = this.db.collection('clara_speaker_users').doc(userId);
    await userRef.set(state, { merge: true });
  }

  async getAllUsers(): Promise<Array<{ id: string, refreshToken: string, lastHistoryId?: string, fcmToken?: string }>> {
    const usersRef = this.db.collection('clara_speaker_users');
    const snapshot = await usersRef.get();
    const users: Array<{ id: string, refreshToken: string, lastHistoryId?: string, fcmToken?: string }> = [];
    snapshot.forEach(doc => {
      users.push({ id: doc.id, ...doc.data() as { refreshToken: string, lastHistoryId?: string, fcmToken?: string } });
    });
    return users;
  }
}
