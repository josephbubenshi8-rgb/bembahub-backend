# BembaHub AI translation failover

## What changed

- Gemini remains the primary provider.
- If Gemini errors, is overloaded, reaches quota, or returns an empty result, translation requests can automatically try Groq.
- Groq is only enabled when `GROQ_API_KEY` exists on the backend.
- The existing `POST /translate` request and response formats are unchanged.
- Dictionary and translation-memory lookups still run before an AI provider is called.
- This first rollout covers text translation, including long-page chunks. OCR and chat remain on their existing Gemini paths.

## Enable the backup on Render

1. Create a GroqCloud account and generate an API key: https://console.groq.com/keys
2. Open Render Dashboard → `bembahub-backend` → Environment.
3. Add `GROQ_API_KEY` with the key value. Keep it private; never put it in frontend files or commit it to GitHub.
4. Optionally add `GROQ_MODEL` with a model your Groq account can access. The default is `openai/gpt-oss-20b`.
5. Save changes and let Render redeploy/restart the backend.
6. Test an English→Bemba and Bemba→English sentence. Check Render logs for `[AI_FAILOVER]` and `[GROQ_TRANSLATION_SUCCESS]` only if Gemini fails.

## Cost and language-quality notes

Groq offers a Free Plan, but model availability and request/token limits can change. Check the live Free Plan table before enabling it: https://console.groq.com/docs/rate-limits and https://console.groq.com/docs/models. Do not switch to a paid plan for this setup.

Bemba quality is not guaranteed by the model vendor. Test representative Bemba phrases, longer sentences, names, and punctuation with a fluent speaker before relying on the fallback for important material. Keep the user-facing translation verification notice.

## Safe behavior

- The Groq key is read only from the backend environment.
- Request logs include language pair and character count, not the translated text or API key.
- If both providers fail, the route returns the existing service-unavailable response; it does not claim a translation succeeded.
- If `GROQ_API_KEY` is absent, the backend continues its existing Gemini-only behavior.
- This is an optional provider fallback, not a guarantee of continuous availability; both providers can be unavailable or rate-limited.
