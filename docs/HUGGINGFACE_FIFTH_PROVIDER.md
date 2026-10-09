# Hugging Face Inference Providers — fifth fallback

Hugging Face is BembaHub's fifth optional text-translation provider:

1. Gemini (primary)
2. Groq
3. OpenRouter
4. Mistral
5. Hugging Face Inference Providers
6. Cloudflare Workers AI

This is best-effort fallback capacity, not unlimited free production usage. Hugging Face free-account credits and provider/model availability may change. Do not buy credits or enable paid usage for BembaHub without explicit approval.

## Create a token

1. Sign in to Hugging Face.
2. Create a fine-grained access token with permission to make calls to Inference Providers.
3. Keep the token private. Never commit it to GitHub or paste it into chat.

## Configure Render

In Render, open the `bembahub-backend` service → **Environment**, and add:

- `HF_TOKEN` — your fine-grained token with Inference Providers permission.
- `HF_MODEL` — optional; defaults to `openai/gpt-oss-120b:fastest`.

Save the environment change and let Render restart/redeploy. The code makes ordinary HTTP requests and adds no npm dependency.

## Verification and quality

A normal successful translation usually uses Gemini, so it does not prove this fallback works. Look for safe status markers such as `[AI_FAILOVER]`, `[HUGGINGFACE_TRANSLATION_SUCCESS]`, and `[AI_FAILOVER_HUGGINGFACE_FAILED]`.

Do not deliberately break production API keys to test failover. Verify during a naturally occurring provider failure or in a separate staging deployment. An HTTP success does not guarantee accurate English↔Bemba or other supported Zambian-language output; test representative phrases with a fluent speaker.
