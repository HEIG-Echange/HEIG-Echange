import Anthropic from "@anthropic-ai/sdk";

// Les etats possibles, en miroir de l'ENUM item_condition (voir listings.ts /
// db/init/01-schema.sql). Duplique ici pour garder ai.ts autonome.
const ITEM_CONDITIONS = [
  "neuf",
  "tres_bon",
  "bon",
  "usage",
  "a_reparer",
] as const;

// Modele Claude par defaut ; surchargeable pour tester un autre modele.
const AI_MODEL = process.env.AI_MODEL ?? "claude-opus-5";

export interface PhotoAnalysis {
  categorySlug: string | null;
  itemCondition: (typeof ITEM_CONDITIONS)[number] | null;
  description: string;
}

// L'analyse IA est optionnelle : sans clef API, l'app fonctionne, seule la
// pre-saisie automatique est indisponible.
export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

interface Category {
  slug: string;
  label: string;
}

// Envoie la photo a Claude (vision) et recupere une categorie, un etat et une
// description proposee pour pre-remplir le formulaire d'annonce.
export async function analyzeItemPhoto(
  base64Data: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif",
  categories: Category[]
): Promise<PhotoAnalysis> {
  const client = new Anthropic();

  const categorySlugs = categories.map((c) => c.slug);
  const categoryList = categories
    .map((c) => `- ${c.slug} : ${c.label}`)
    .join("\n");

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            categorySlug: { type: "string", enum: categorySlugs },
            itemCondition: {
              type: "string",
              enum: ITEM_CONDITIONS as unknown as string[],
            },
            description: { type: "string" },
          },
          required: ["categorySlug", "itemCondition", "description"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64Data },
          },
          {
            type: "text",
            text:
              "Tu aides un etudiant a mettre en ligne un objet a donner sur une " +
              "plateforme d'echange entre etudiants. A partir de la photo :\n" +
              `1. choisis la categorie la plus adaptee parmi :\n${categoryList}\n` +
              "2. estime l'etat de l'objet (neuf, tres_bon, bon, usage, a_reparer) ;\n" +
              "3. propose une courte description en francais (1 a 2 phrases), " +
              "factuelle, decrivant l'objet visible.",
          },
        ],
      },
    ],
  });

  // En structured outputs, la reponse est un unique bloc texte contenant le JSON.
  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && "text" in textBlock ? textBlock.text : "{}";

  let parsed: Partial<PhotoAnalysis>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

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
    description: typeof parsed.description === "string" ? parsed.description : "",
  };
}
