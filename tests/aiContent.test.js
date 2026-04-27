import test from "node:test";
import assert from "node:assert/strict";
import { generateRedbubbleContent, parseAiContentResponse } from "../src/aiContent.js";

test("parseAiContentResponse parses direct JSON strings", () => {
  const parsed = parseAiContentResponse('{"mainTag":"vintage cat","supportingTags":"cat lover, retro cat","description":"A retro cat design."}');
  assert.deepEqual(parsed, {
    mainTag: "vintage cat",
    supportingTags: "cat lover, retro cat",
    description: "A retro cat design."
  });
});

test("parseAiContentResponse parses fenced JSON and joins tag arrays", () => {
  const parsed = parseAiContentResponse(`Here you go:
\`\`\`json
{"mainTag":"retro frog","supportingTags":["frog gift", "kawaii frog", "frog lover"],"description":"Cute frog art."}
\`\`\``);
  assert.deepEqual(parsed, {
    mainTag: "retro frog",
    supportingTags: "frog gift, kawaii frog, frog lover",
    description: "Cute frog art."
  });
});

test("parseAiContentResponse rejects unparseable content", () => {
  assert.throws(() => parseAiContentResponse("not json"), /parseable JSON/);
});

test("generateRedbubbleContent builds Title-driven prompt and returns parsed fields", async () => {
  const calls = [];
  const result = await generateRedbubbleContent({
    title: "  Vintage T-Rex Birthday Shirt  ",
    aiChat: async (input) => {
      calls.push(input);
      return {
        content: '{"mainTag":"vintage t-rex","supportingTags":"dinosaur birthday, t rex gift","description":"A fun retro dinosaur design for birthdays."}',
        model: "openai/gpt-4o-mini",
        usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 }
      };
    }
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].system, /Redbubble SEO content expert/);
  assert.equal(calls[0].messages.length, 1);
  assert.match(calls[0].messages[0].content, /Phan tich chi tiet cot Title/);
  assert.match(calls[0].messages[0].content, /cot C, D, E/);
  assert.match(calls[0].messages[0].content, /Vintage T-Rex Birthday Shirt/);
  assert.equal(result.mainTag, "vintage t-rex");
  assert.equal(result.supportingTags, "dinosaur birthday, t rex gift");
  assert.equal(result.description, "A fun retro dinosaur design for birthdays.");
  assert.equal(result.aiModel, "openai/gpt-4o-mini");
  assert.deepEqual(result.aiUsage, { input_tokens: 100, output_tokens: 40, total_tokens: 140 });
});

test("generateRedbubbleContent rejects empty Title", async () => {
  await assert.rejects(
    generateRedbubbleContent({ title: "   ", aiChat: async () => ({ content: "{}" }) }),
    /Title is empty/
  );
});
