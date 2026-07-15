# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Vue d'ensemble

Backend serverless de Clara Speaker : des fonctions Netlify qui surveillent les boîtes Gmail des utilisateurs, font résumer les nouveaux emails par Gemini, et poussent le résumé vers l'app Android via Firebase Cloud Messaging (message *data-only*, clé `summaryText`).

## Commandes

```bash
npm run build     # lint + tsc + netlify functions:build (le lint bloque le build)
npm run lint      # eslint sur services/, common/, netlify/functions/
npm start         # netlify functions:serve
npm test          # test.sh : lance `netlify dev` et POST sur /checkemails
npm run create    # netlify functions:create (scaffold d'une nouvelle fonction)
```

Il n'y a pas de suite de tests unitaires. `test.sh` est un simple test de fumée sur `checkemails` ; pour tester une autre fonction, lancer `netlify dev` puis `curl` sur son `path` (voir ci-dessous).

## Architecture

Quatre fonctions Netlify (format v2 : `export default async (request: Request)` + `export const config = { path }`, sans `netlify.toml`) :

- `netlify/functions/checkemails/checkemails.mts` → `POST /checkemails` — le cœur du système, déclenché par un cron externe.
- `netlify/functions/oauth2callback/oauth2callback.mts` → `GET /oauth2callback` — flux web : récupère le refresh token Google via redirection navigateur et le stocke.
- `netlify/functions/oauth2exchange/oauth2exchange.mts` → `POST /oauth2/exchange` — flux mobile : reçoit `{ code }` (server auth code de l'app Android), l'échange contre un refresh token et le stocke sous l'ID Google déduit du token. Même mécanique que `oauth2callback`, mais ne réécrit pas un token existant si Google ne renvoie pas de `refresh_token`.
- `netlify/functions/sendmessage/sendmessage.mts` → `POST /sendmessage` — envoi FCM manuel (`{ deviceToken, summary }`), utile pour déboguer.

Les fonctions sont volontairement minces ; la logique vit dans `services/`, chaque service enveloppant un SDK externe :

- `OAuth2Service` — client OAuth2 Google. Scopes : `gmail.readonly` + `userinfo.profile`.
- `GmailService` — construit avec un `OAuth2Client` déjà authentifié. Utilise l'API **History** de Gmail (pas une liste de messages) : `getNewEmails(lastHistoryId)` renvoie les emails ajoutés depuis cet ID et le nouvel ID.
- `DatabaseService` — Firestore, collection unique `clara_speaker_users`, un document par utilisateur : `{ refreshToken, lastHistoryId, fcmToken }`. `refreshToken` peut être absent : l'app Android crée le document avec son `fcmToken` avant que l'utilisateur ait parcouru le flux OAuth. Ces documents doivent être ignorés, pas traités.
- `TelegramService` — canal d'alerte admin (chat unique via `TELEGRAM_CHAT_ID`), pas une fonctionnalité utilisateur.

### Flux de `checkemails`

Pour **chaque** utilisateur de Firestore : on réhydrate un `OAuth2Client` avec son `refreshToken`, on lit son `lastHistoryId`.

- `lastHistoryId` valant `1` ou absent = premier passage : on enregistre l'`historyId` courant de la boîte et on passe à l'utilisateur suivant sans notifier. Les emails antérieurs ne sont jamais traités.
- Sinon on récupère les nouveaux emails non lus (hors SPAM), on les concatène dans **un seul** prompt Gemini (`gemini-3.1-flash-lite`) pour produire une synthèse globale, et on envoie **une seule** notification FCM. Ne pas revenir à un appel LLM par email : le batching est intentionnel (coût et latence).
- `lastHistoryId` est réécrit à chaque itération, y compris quand aucun email n'est trouvé, sinon l'historique Gmail expire.

Le persona du prompt (« assistante vocale douce et humaine, comme Samantha dans Her ») définit le ton du produit ; le texte généré est lu à voix haute côté Android.

Points de robustesse à préserver : une erreur sur un utilisateur ne doit pas interrompre la boucle ; un `invalid_grant` déclenche un message Telegram contenant l'URL de ré-autorisation ; un email supprimé entre-temps remonte en 404 et doit être ignoré, pas propagé.

### Initialisation Firebase

`admin.initializeApp()` est appelé au niveau module, gardé par `if (admin.apps.length === 0)` à cause des *warm starts* Netlify. Ce garde est dupliqué dans `DatabaseService` et `sendmessage.mts` — toute nouvelle initialisation doit le conserver.

## Variables d'environnement

Lues via `common/config.ts` (Gmail, Telegram, Gemini) ou directement depuis `process.env` (Firebase). `.env.example` est incomplet : `GMAIL_REDIRECT_URI`, `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID` sont également requis.

`GOOGLE_SERVICE_ACCOUNT` contient le JSON complet du compte de service, sur une seule ligne.

## Divers

`index.html`, `politique-confidentialite.html` et `conditions-utilisation.html` sont des pages statiques servant à la validation OAuth de l'app par Google ; elles ne font pas partie du backend.
