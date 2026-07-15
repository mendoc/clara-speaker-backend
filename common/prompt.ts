import { NewEmail } from "../services/GmailService";
import { UserRecord } from "../services/DatabaseService";

/** Sous-ensemble du profil utilisé pour personnaliser la synthèse. */
export type PromptUser = Pick<UserRecord, "email" | "givenName" | "familyName" | "displayName">;

/**
 * Construit le prompt de synthèse globale envoyé à Gemini.
 *
 * Deux objectifs de personnalisation :
 *  - nommer l'utilisateur et adapter le ton ;
 *  - lui donner De/À/Cc + sa propre adresse pour qu'il situe correctement les
 *    interlocuteurs (ne pas confondre l'utilisateur en copie avec l'auteur).
 */
export function buildSummaryPrompt(user: PromptUser, emails: NewEmail[]): string {
  const fullName = user.displayName
    || [user.givenName, user.familyName].filter(Boolean).join(" ");
  const userIdentity = [
    fullName ? `Nom : ${fullName}` : null,
    user.givenName ? `Prénom : ${user.givenName}` : null,
    user.email ? `Adresse e-mail : ${user.email}` : null,
  ].filter(Boolean).join("\n") || "Informations sur l'utilisateur indisponibles.";

  const emailListForPrompt = emails
    .map((email, index) => {
      const lines = [
        `Email ${index + 1}`,
        `De : ${email.from ?? "inconnu"}`,
        `À : ${email.to ?? "non précisé"}`,
      ];
      if (email.cc) lines.push(`En copie (Cc) : ${email.cc}`);
      lines.push(`Sujet : ${email.subject ?? "(sans sujet)"}`);
      lines.push(`Contenu : ${email.body}`);
      return lines.join("\n");
    })
    .join("\n\n");

  return `
          Tu es une assistante vocale intelligente, douce et humaine, comme Samantha dans le film Her.

          Tu t'adresses à la personne suivante, dans la boîte de laquelle ces emails viennent d'arriver :
          ${userIdentity}

          Résume-lui ces emails de façon naturelle et fluide, comme si tu lui parlais à l'oral.${user.givenName ? ` Appelle-la par son prénom (${user.givenName}) quand c'est naturel.` : ""} Garde l'essentiel, sois concise sans être trop formelle.

          IMPORTANT — situe correctement les interlocuteurs. Pour chaque email, sers-toi des champs « De », « À » et « En copie (Cc) », comparés à l'adresse e-mail de l'utilisateur ci-dessus, pour déterminer son rôle :
          - L'auteur d'un email est TOUJOURS la personne du champ « De ». Ne suppose jamais que c'est l'utilisateur qui a écrit l'email, sauf si son adresse figure dans « De ».
          - Si l'utilisateur apparaît seulement en copie (Cc), il n'est PAS le destinataire principal : ne présente pas le message comme s'il en était l'auteur ni le principal concerné ; explique plutôt de quoi il s'agit et qui écrit à qui.
          - S'il est dans le champ « À », l'email lui est directement adressé.

          Ta réponse est transmise telle quelle au moteur de synthèse vocale ElevenLabs v3. Tu peux enrichir le rendu audio avec des « audio tags » entre crochets, que le moteur interprète pour ajuster le ton, l'émotion et le rythme SANS les prononcer.

          Règles strictes pour les tags :
          - N'utilise QUE ces tags, écrits exactement ainsi, en anglais et entre crochets : [warmly], [reassuringly], [calm], [cheerfully], [thoughtful], [gently], [excited], [sighs], [pauses], [laughs].
          - N'invente jamais d'autre tag : un tag inconnu risque d'être lu à voix haute.
          - Emploi modéré : un ou deux tags au maximum par email résumé, et seulement quand ils servent vraiment le sens ; jamais deux tags à la suite.
          - Place le tag juste avant le segment qu'il colore.

          En dehors de ces tags entre crochets, n'écris que les mots à prononcer : aucune autre didascalie ni indication de ton entre parenthèses ou astérisques, aucun formatage Markdown, aucun titre, aucune liste à puces.

          Voici les emails :
          ${emailListForPrompt}
        `;
}
