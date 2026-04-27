const PROVIDER_DEFAULTS = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    label: "OpenAI"
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    label: "OpenRouter"
  },
  claude: {
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-6",
    label: "Claude (Anthropic)"
  }
};

export const SUPPORTED_PROVIDERS = Object.keys(PROVIDER_DEFAULTS);

export function getProviderDefaults(provider) {
  return PROVIDER_DEFAULTS[provider] || null;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : ""
  }));
}

function extractSystemAndMessages(input) {
  const messages = normalizeMessages(input.messages || []);
  let systemPrompt = input.system || "";
  const filtered = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      systemPrompt = systemPrompt
        ? `${systemPrompt}\n\n${msg.content}`
        : msg.content;
    } else {
      filtered.push(msg);
    }
  }
  return { systemPrompt, messages: filtered };
}

async function readErrorBody(response) {
  try {
    const text = await response.text();
    if (!text) return "";
    try {
      const parsed = JSON.parse(text);
      return parsed.error?.message || parsed.error || JSON.stringify(parsed);
    } catch {
      return text.slice(0, 500);
    }
  } catch {
    return "";
  }
}

async function chatOpenAiCompatible({ baseUrl, apiKey, model, temperature, maxTokens, system, messages, fetchImpl, extraHeaders = {} }) {
  const finalMessages = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders
    },
    body: JSON.stringify({
      model,
      messages: finalMessages,
      temperature,
      max_tokens: maxTokens
    })
  });

  if (!response.ok) {
    const detail = await readErrorBody(response);
    throw new Error(`AI request failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  return {
    content,
    model: data.model || model,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? null,
      output_tokens: data.usage?.completion_tokens ?? null,
      total_tokens: data.usage?.total_tokens ?? null
    },
    finishReason: data.choices?.[0]?.finish_reason || null,
    raw: data
  };
}

async function chatClaude({ baseUrl, apiKey, model, temperature, maxTokens, system, messages, fetchImpl }) {
  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      ...(system ? { system } : {}),
      messages
    })
  });

  if (!response.ok) {
    const detail = await readErrorBody(response);
    throw new Error(`AI request failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  const content = (data.content || [])
    .filter((part) => part.type === "text")
    .map((part) => part.text || "")
    .join("");
  return {
    content,
    model: data.model || model,
    usage: {
      input_tokens: data.usage?.input_tokens ?? null,
      output_tokens: data.usage?.output_tokens ?? null,
      total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0) || null
    },
    finishReason: data.stop_reason || null,
    raw: data
  };
}

export function createAiClient({
  provider,
  apiKey,
  baseUrl,
  model,
  temperature = 0.7,
  maxTokens = 1024,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
  if (!apiKey) {
    throw new Error("Missing API key for AI provider");
  }
  const defaults = PROVIDER_DEFAULTS[provider];
  const effectiveBaseUrl = baseUrl || defaults.baseUrl;
  const effectiveModel = model || defaults.model;

  async function chat(input = {}) {
    const { systemPrompt, messages } = extractSystemAndMessages(input);
    if (messages.length === 0) {
      throw new Error("messages array is empty");
    }
    const params = {
      baseUrl: effectiveBaseUrl,
      apiKey,
      model: input.model || effectiveModel,
      temperature: Number.isFinite(input.temperature) ? input.temperature : temperature,
      maxTokens: Number.isFinite(input.maxTokens) ? input.maxTokens : maxTokens,
      system: systemPrompt,
      messages,
      fetchImpl
    };

    if (provider === "claude") {
      return chatClaude(params);
    }
    if (provider === "openrouter") {
      return chatOpenAiCompatible({
        ...params,
        extraHeaders: {
          "HTTP-Referer": "https://github.com/cogloballtd-afk/uploadautoRedbubble",
          "X-Title": "uploadautoRedbubble"
        }
      });
    }
    return chatOpenAiCompatible(params);
  }

  return {
    provider,
    baseUrl: effectiveBaseUrl,
    model: effectiveModel,
    chat
  };
}
