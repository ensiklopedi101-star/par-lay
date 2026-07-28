import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("GEMINI_API_KEY is not set");
  process.exitCode = 1;
} else {
  // Keep the SDK client initialized so this utility uses the configured SDK.
  new GoogleGenerativeAI(apiKey);

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body?.error?.message ?? `Google API ${response.status}`);
    }

    const supported = (body.models ?? [])
      .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
      .map((model) => model.name?.replace(/^models\//, ""))
      .filter(Boolean);

    for (const model of supported) console.log(model);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}