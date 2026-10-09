# BembaHub AI translation failover

## Provider order

Text translation tries configured providers in this order:

1. **Gemini** — primary provider.
2. **Groq** — enabled when `GROQ_API_KEY` is configured.
3. **OpenRouter** — enabled when `OPENROUTER_API_KEY` is configured; default model is `openrouter/free`.
4. **Mistral** — enabled when `MISTRAL_API_KEY` is configured.
5. **Hugging Face Inference Providers** — enabled when `HF_TOKEN` is configured.
6. **Cloudflare Workers AI** — enabled when both `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are configured; default model is `@cf/meta/llama-3.1-8b-instruct`.

Providers without their required environment variables are skipped. The first provider to return a non-empty response wins. The existing `POST /translate` request and response formats are unchanged, and dictionary/translation-memory lookups still run before AI.

## Configure providers

Add keys only in Render Dashboard → `bembahub-backend` → **Environment**. Never put keys in frontend code, commit them to GitHub, or paste them into chat.

- Groq: `GROQ_API_KEY`; optional `GROQ_MODEL`.
- OpenRouter: `OPENROUTER_API_KEY`; optional `OPENROUTER_MODEL`.
- Mistral: `MISTRAL_API_KEY`; optional `MISTRAL_MODEL`.
- Hugging Face: `HF_TOKEN`; optional `HF_MODEL`.
- Cloudflare: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`; optional `CLOUDFLARE_AI_MODEL`.

After saving environment variables, allow Render to restart/redeploy. See the provider-specific documentation in this folder for account/token setup and limits.

## Cost guardrails

A provider appearing in this chain does **not** mean it is unlimited or guaranteed free. Free quotas, model access, and token limits can change. Cloudflare Workers AI has a daily free allocation with limits; Hugging Face free-account credits are limited; OpenRouter's free models can be unavailable or rate-limited. Check each vendor's current terms before configuring it.

Do not purchase credits, enable paid billing, or switch to paid API plans for BembaHub without explicit approval. If all configured providers fail, the backend returns a service-unavailable response instead of pretending translation succeeded.

## Scope and quality

This failover chain covers text translation, including long-page chunks. OCR and chat still use their existing Gemini paths. A successful HTTP response does not guarantee an accurate Bemba or other Zambian-language translation; validate representative phrases with a fluent speaker before using output for important material.

Logs should contain provider/status markers and language-pair/character-count metadata only—not API keys or users' translation text. Do not deliberately break production API keys to test failover; use staging or observe naturally occurring failures.
