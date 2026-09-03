// ---------------------------------------------------------------------------
// Analyse IA d'une photo d'objet — fournisseur : Hugging Face.
//
// On passe par le routeur "Inference Providers" de Hugging Face, qui expose une
// API compatible OpenAI (/v1/chat/completions). Aucun SDK n'est necessaire :
// un simple fetch suffit, et changer de modele ne demande que de changer une
// chaine de caracteres (reglage ai.model, editable par un admin).
//
// Le modele choisi doit accepter des messages multimodaux (texte + image).
//
// Les prompts ne vivent pas ici : voir src/aiSettings.ts (table app_settings,
// editable depuis /admin-ai.html).
// ---------------------------------------------------------------------------
import { getAiSettings, renderUserPrompt } from "./aiSettings";

// Les etats possibles, en miroir de l'ENUM item_condition (voir listings.ts /
// db/init/01-schema-v2.sql). Duplique ici pour garder ai.ts autonome.
const ITEM_CONDITIONS = [
  "neuf",
  "tres_bon",
  "bon",
  "usage",
  "a_reparer",
] as const;

// Point d'entree du routeur Hugging Face. Surchargeable pour viser un
// fournisseur precis (ex. https://router.huggingface.co/hf-inference/v1) ou un
// endpoint dedie.
const HF_BASE_URL = (
  process.env.HUGGINGFACE_BASE_URL ?? "https://router.huggingface.co/v1"
).replace(/\/+$/, "");

// Un appel vision peut etre lent (chargement du modele cote fournisseur). On
// coupe quand meme, pour ne pas laisser la requete du navigateur pendue.
const HF_TIMEOUT_MS = Number(process.env.HUGGINGFACE_TIMEOUT_MS ?? 60_000);

export interface PhotoAnalysis {
  categorySlug: string | null;
  itemCondition: (typeof ITEM_CONDITIONS)[number] | null;
  description: string;
}

// Deux noms acceptes : HUGGINGFACE_API_KEY (explicite, cf. .env.example) et
// HF_TOKEN (nom standard des outils Hugging Face).
export function huggingFaceToken(): string | undefined {
  return process.env.HUGGINGFACE_API_KEY ?? process.env.HF_TOKEN;
}

// L'analyse IA est optionnelle : sans jeton, l'app fonctionne, seule la
// pre-saisie automatique est indisponible (l'endpoint repond 503).
export function aiConfigured(): boolean {
  return Boolean(huggingFaceToken());
}

interface Category {
  slug: string;
  label: string;
}

interface ChatCompletion {
  choices?: { message?: { content?: string | null } }[];
  error?: unknown;
}

/**
 * Extrait le premier objet JSON d'une reponse de modele. Les modeles ouverts
 * respectent moins bien la consigne "JSON seul" que les modeles proprietaires :
 * on tolere donc un bloc ```json, ou une phrase d'introduction avant l'objet.
 */
function extractJson(raw: string): Partial<PhotoAnalysis> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return {};
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return {};
  }
}

// Envoie la photo au modele vision et recupere une categorie, un etat et une
// description proposee pour pre-remplir le formulaire d'annonce.
export async function analyzeItemPhoto(
  base64Data: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif",
  categories: Category[]
): Promise<PhotoAnalysis> {
  const token = huggingFaceToken();
  if (!token) throw new Error("jeton Hugging Face absent");

  const settings = await getAiSettings();
  const categorySlugs = categories.map((c) => c.slug);

  const userPrompt = renderUserPrompt(settings.userPrompt, {
    categories: categories.map((c) => `- ${c.slug} : ${c.label}`).join("\n"),
    conditions: ITEM_CONDITIONS.join(", "),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HF_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${HF_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 512,
        // Peu de creativite attendue : on decrit ce qui est sur la photo.
        temperature: 0.2,
        messages: [
          { role: "system", content: settings.systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                // Le routeur accepte une data-URL : pas besoin d'heberger la
                // photo quelque part pour la faire analyser.
                image_url: { url: `data:${mediaType};base64,${base64Data}` },
              },
              { type: "text", text: userPrompt },
            ],
          },
        ],
      }),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Hugging Face a repondu ${response.status} : ${detail.slice(0, 300)}`
    );
  }

  const payload = (await response.json()) as ChatCompletion;
  const raw = payload.choices?.[0]?.message?.content ?? "";
  const parsed = extractJson(raw);

  // Le modele reste libre de repondre n'importe quoi : on ne garde que des
  // valeurs qui existent reellement cote base, le reste retombe a null et le
  // formulaire garde son choix par defaut.
  const categorySlug =
    typeof parsed.categorySlug === "string" &&
    categorySlugs.includes(parsed.categorySlug)
      ? parsed.categorySlug
      : null;

  const itemCondition =
    typeof parsed.itemCondition === "string" &&
    (ITEM_CONDITIONS as readonly string[]).includes(parsed.itemCondition)
      ? (parsed.itemCondition as PhotoAnalysis["itemCondition"])
      : null;

  return {
    categorySlug,
    itemCondition,
    description:
      typeof parsed.description === "string" ? parsed.description.trim() : "",
  };
}
