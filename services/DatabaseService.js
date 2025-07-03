import admin from "firebase-admin";

// --- Initialisation des services ---
if (admin.apps.length === 0) {
  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

export class DatabaseService {
  constructor() {
    this.db = admin.firestore();
    if (!this.db) {
      throw new Error("Firestore is not initialized");
    }
  }

  async setUserRefreshToken(userId, refreshToken) {
    // Récupérer l'état depuis Firestore
    const userRef = this.db.collection('clara_speaker_users').doc(userId);
    await userRef.set({ refreshToken }, { merge: true });
  }

  async getUserRefreshToken(userId) {
    const userRef = this.db.collection('clara_speaker_users').doc(userId);
    const doc = await userRef.get();
    if (doc.exists) {
      return doc.data().refreshToken;
    } else {
      throw new Error(`No refresh token found for user ${userId}`);
    }
  }

  async getUserState(userId) {
    const userRef = this.db.collection('clara_speaker_users').doc(userId);
    const doc = await userRef.get();
    if (doc.exists) {
      return doc.data();
    } else {
      throw new Error(`No state found for user ${userId}`);
    }
  }

  async setUserState(userId, state) {
    const userRef = this.db.collection('clara_speaker_users').doc(userId);
    await userRef.set(state, { merge: true });
  }
}
