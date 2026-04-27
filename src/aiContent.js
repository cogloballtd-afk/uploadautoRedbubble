const SYSTEM_PROMPT = `You are a Redbubble SEO content expert helping a print-on-demand seller maximize search visibility.

Your job: given a product Title, produce three Redbubble-optimized fields in this priority order:
1) Main Tag (single most important keyword phrase, 1-3 words, the primary search term buyers would type).
2) Supporting Tags (10-15 comma-separated keyword phrases - niche, audience, occasion, style, synonyms - no hashtags, no quotes, lower priority generic terms last).
3) Description (2-3 natural English sentences for the product page that organically include the main keywords).

Redbubble SEO rules:
- Be specific (e.g. "vintage t-rex" not just "dinosaur"); buyers search long-tail.
- Cover audience (boys, kids, teen, adult), occasion (back to school, birthday), style (vintage, retro, kawaii), product fit (t-shirt, sticker, mug) when implied.
- No banned trademarks; no generic spam words like "best", "buy", "shop now".
- Match the Title's language (default English).

Output format: a SINGLE JSON object, nothing else (no markdown fences, no preamble, no commentary). Exact shape:
{"mainTag": "...", "supportingTags": "tag1, tag2, ...", "description": "..."}`;

function buildUserPrompt(title) {
  return `Title: "${title}"

Phan tich chi tiet cot Title o tren, xac dinh theme, audience, occasion, product type va style. Tu do dien lan luot cac cot C, D, E gom Main Tag, Supporting Tags, Description theo dung chuan SEO Redbubble.

Reply with ONLY the JSON object, no other text.`;
}

function tryParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonBlock(text) {
  if (!text) return null;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    const parsed = tryParseJson(fenceMatch[1].trim());
    if (parsed) return parsed;
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1);
    return tryParseJson(candidate);
  }
  return null;
}

export function parseAiContentResponse(rawContent) {
  const direct = tryParseJson(rawContent);
  const parsed = direct || extractJsonBlock(rawContent);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`AI did not return parseable JSON. Raw: ${String(rawContent || "").slice(0, 200)}`);
  }
  const mainTag = typeof parsed.mainTag === "string" ? parsed.mainTag.trim() : "";
  const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
  let supportingTags = parsed.supportingTags;
  if (Array.isArray(supportingTags)) {
    supportingTags = supportingTags.map((t) => String(t).trim()).filter(Boolean).join(", ");
  } else if (typeof supportingTags === "string") {
    supportingTags = supportingTags.trim();
  } else {
    supportingTags = "";
  }
  if (!mainTag && !supportingTags && !description) {
    throw new Error("AI response missing all three fields");
  }
  return { mainTag, supportingTags, description };
}

export async function generateRedbubbleContent({ title, aiChat, maxTokens = 600 }) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) {
    throw new Error("Title is empty");
  }
  const result = await aiChat({
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(cleanTitle) }],
    maxTokens
  });
  const parsed = parseAiContentResponse(result.content);
  return {
    ...parsed,
    aiModel: result.model,
    aiUsage: result.usage
  };
}
