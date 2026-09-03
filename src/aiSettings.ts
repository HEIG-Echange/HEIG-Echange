// ---------------------------------------------------------------------------
// Reglages de l'analyse IA des photos, modifiables par un administrateur.
//
// Les prompts envoyes au modele ne sont pas figes dans le code : ils vivent
// dans la table app_settings et sont editables depuis /admin-ai.html (routes
// GET/PUT /admin/ai-settings). Une cle absente en base = valeur par defaut
// ci-dessous, elle-meme surchargeable par variable d'environnement au
// deploiement. Trois niveaux, du plus fort au plus faible :
//
//   base de donnees  >  variable d'environnement  >  defaut du code
//
// Supprimer la ligne en base (PUT avec null) revient donc au reglage de
// deploiement, sans redemarrage.
// ---------------------------------------------------------------------------
import type { RowDataPacket } from "mysql2";
import { pool } from "./db";

export const AI_SETTING_KEYS = [
  "ai.model",
  "ai.system_prompt",
  "ai.user_prompt",
] as const;
export type AiSettingKey = (typeof AI_SETTING_KEYS)[number];

// Modele vision par defaut sur Hugging Face. Doit accepter des messages
// multimodaux (texte + image) via l'API compatible OpenAI du routeur.
const DEFAULT_MODEL = "Qwen/Qwen2.5-VL-7B-Instruct";

const DEFAULT_SYSTEM_PROMPT =
  "Tu es l'assistant de HEIG-Echange, une plateforme de don d'objets entre " +
  "etudiants de la HEIG-VD. Tu observes la photo d'un objet et tu remplis la " +
  "fiche de l'annonce a la place de l'etudiant. Tu reponds UNIQUEMENT par un " +
  "objet JSON valide, sans texte autour et sans bloc de code.";

// Les deux placeholders sont remplaces au moment de l'appel :
//   {{categories}} — la liste "slug : libelle" lue en base
//   {{conditions}} — les valeurs autorisees de l'ENUM item_condition
// Un prompt personnalise qui ne les contient pas reste valide : le modele n'a
// alors simplement pas la liste sous les yeux (et la reponse risque d'etre
// rejetee a la validation).
const DEFAULT_USER_PROMPT = [
  "A partir de la photo de cet objet a donner :",
  "1. choisis la categorie la plus adaptee, en reprenant exactement un des slugs suivants :",
  "{{categories}}",
  "2. estime l'etat de l'objet parmi : {{conditions}} ;",
  "3. propose une courte description en francais (1 a 2 phrases), factuelle,",
  "   decrivant l'objet visible et son etat apparent.",
  "",
  'Reponds par ce JSON exact : {"categorySlug": "...", "itemCondition": "...", "description": "..."}',
].join("\n");

export interface AiSettings {
  model: string;
  systemPrompt: string;
  userPrompt: string;
}

// Defauts effectifs : code, surcharges par l'environnement s'il en definit.
export function defaultAiSettings(): AiSettings {
  return {
    model: process.env.AI_MODEL ?? DEFAULT_MODEL,
    systemPrompt: process.env.AI_SYSTEM_PROMPT ?? DEFAULT_SYSTEM_PROMPT,
    userPrompt: process.env.AI_USER_PROMPT ?? DEFAULT_USER_PROMPT,
  };
}

interface SettingRow extends RowDataPacket {
  setting_key: string;
  setting_value: string | null;
}

// Valeurs stockees en base, cle par cle (absente = non surchargee).
export async function readAiOverrides(): Promise<Partial<AiSettings>> {
  const [rows] = await pool.query<SettingRow[]>(
    `SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?, ?, ?)`,
    [...AI_SETTING_KEYS]
  );

  const overrides: Partial<AiSettings> = {};
  for (const row of rows) {
    if (row.setting_value === null || row.setting_value === "") continue;
    if (row.setting_key === "ai.model") overrides.model = row.setting_value;
    if (row.setting_key === "ai.system_prompt") overrides.systemPrompt = row.setting_value;
    if (row.setting_key === "ai.user_prompt") overrides.userPrompt = row.setting_value;
  }
  return overrides;
}

// Reglages effectivement utilises pour un appel : defauts + surcharges base.
export async function getAiSettings(): Promise<AiSettings> {
  return { ...defaultAiSettings(), ...(await readAiOverrides()) };
}

/**
 * Ecrit (ou efface) une surcharge. `value === null` supprime la ligne, ce qui
 * fait revenir la cle a son defaut.
 */
export async function setAiSetting(
  key: AiSettingKey,
  value: string | null,
  updatedBy: number | undefined
): Promise<void> {
  if (value === null) {
    await pool.query("DELETE FROM app_settings WHERE setting_key = ?", [key]);
    return;
  }
  await pool.query(
    `INSERT INTO app_settings (setting_key, setting_value, updated_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value),
                             updated_by    = VALUES(updated_by)`,
    [key, value, updatedBy ?? null]
  );
}

/**
 * Remplace les placeholders du prompt utilisateur. Utilise une fonction de
 * remplacement (et non une chaine) : le texte injecte peut contenir des "$&"
 * ou "$1", que String.replace interpreterait sinon comme des references.
 */
export function renderUserPrompt(
  template: string,
  values: { categories: string; conditions: string }
): string {
  return template
    .replace(/\{\{\s*categories\s*\}\}/g, () => values.categories)
    .replace(/\{\{\s*conditions\s*\}\}/g, () => values.conditions);
}
