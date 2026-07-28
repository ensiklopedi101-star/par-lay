import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../lib/logger";

export interface GeminiModelInfo {
  name: string;
  supportedGenerationMethods?: string[];
}

let supportedModelsPromise: Promise<string[]> | null = null;

function modelName(name: string): string {
  return name.replace(/^models\//, "");
}

export async function listSupportedGeminiModels(apiKey: string): Promise<string[]> {
  // @google/generative-ai@0.24 has no public listModels() method. Initialize
  // its SDK client here, then use the same official models.list REST resource.
  new GoogleGenerativeAI(apiKey);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
  );
  const body = await response.json() as { models?: GeminiModelInfo[]; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `Gemini models.list failed (${response.status})`);

  return (body.models ?? [])
    .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
    .map((model) => modelName(model.name))
    .filter(Boolean);
}

export async function getGeminiModel(apiKey: string): Promise<string> {
  if (!supportedModelsPromise) {
    supportedModelsPromise = listSupportedGeminiModels(apiKey).catch((error) => {
      supportedModelsPromise = null;
      throw error;
    });
  }
  const models = await supportedModelsPromise;
  const preferred = [
    process.env["GEMINI_MODEL"],
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
  ].filter((value): value is string => Boolean(value));
  const selected = preferred.find((candidate) => models.includes(candidate))
    ?? models.find((candidate) => /flash/i.test(candidate))
    ?? models[0];
  if (!selected) throw new Error("Gemini returned no model supporting generateContent");
  logger.info({ model: selected, supportedModelCount: models.length }, "Selected Gemini generateContent model");
  return selected;
}