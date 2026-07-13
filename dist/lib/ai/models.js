/** Centralized AI model registry — all AI calls across the codebase import from here. */
export const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";
/** Cheap, fast — classification, scoring, email drafting */
export const MODEL_FAST = "deepseek/deepseek-v4-pro";
/** Balanced — translation, complex drafting */
export const MODEL_DEFAULT = "openai/gpt-5.5";
/** Image generation */
export const MODEL_IMAGE = "google/gemini-3.1-flash-image-preview";
/** Legal text processing */
export const MODEL_LEGAL = "google/gemini-3.1-flash-lite-preview";
//# sourceMappingURL=models.js.map