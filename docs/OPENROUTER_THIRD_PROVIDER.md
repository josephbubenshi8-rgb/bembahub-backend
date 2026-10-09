# OpenRouter third-provider fallback

BembaHub translation-provider order is:

1. Gemini (primary)
2. Groq (backup, when `GROQ_API_KEY` is configured)
3. OpenRouter's free-model router (last resort, when `OPENROUTER_API_KEY` is configured)

The OpenRouter backup calls `https://openrouter.ai/api/v1/chat/completions` using the `openrouter/free` model router. OpenRouter selects an available free model; model availability and output quality can change. This is intended as a low-cost resilience option, not a guarantee of professional-grade Bemba translation.

## Configure on Render

In the `bembahub-backend` service, add this environment variable:

- `OPENROUTER_API_KEY`: create a key at https://openrouter.ai/keys and store it only in Render Environment. Never commit it to GitHub or paste it into chat.
- Optional: `OPENROUTER_MODEL`: defaults to `openrouter/free`.

OpenRouter currently advertises free model access with rate limits. Its published free plan lists a limit of 50 requests per day; check the current pricing/limits pages because policies may change:
- https://openrouter.ai/pricing
- https://openrouter.ai/collections/free-models/

## Logging and privacy

The code logs provider attempts, language codes, character counts, HTTP status codes, and the returned model identifier. It does not log translation input, output, or API keys. Translation text is sent to whichever provider handles the request, so review that provider's data policies before using confidential material.

## Validation

After deploying, test a normal translation first. That verifies the primary path only. To verify fallback, observe Render logs during a naturally occurring Gemini failure or perform a controlled test in a safe staging environment. Do not intentionally break production credentials. Expected markers include `[AI_FAILOVER]`, `[AI_FAILOVER_GROQ_FAILED]`, `[OPENROUTER_TRANSLATION_SUCCESS]`, and `[AI_FAILOVER_OPENROUTER_FAILED]`.
