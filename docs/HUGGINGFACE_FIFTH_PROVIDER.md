# Hugging Face Inference Providers fifth fallback

BembaHub's intended translation fallback order is:

1. Gemini (primary)
2. Groq
3. OpenRouter free-model router
4. Mistral
5. Hugging Face Inference Providers (last-resort fallback)

This is an optional best-effort fallback, not a promise of unlimited free production capacity. Hugging Face currently lists **$0.10 monthly credits for free accounts**, subject to change. Those credits are small and intended for experimentation; when exhausted, requests may fail unless credits are purchased. Do not purchase credits or enable paid usage for this project without explicit approval.

## Create a token

1. Sign in at https://huggingface.co/settings/tokens
2. Create a fine-grained access token with permission to **make calls to Inference Providers**.
3. Keep the token private. Never commit it to GitHub or paste it into chat.

## Configure Render

In Render, open the `bembahub-backend` service → **Environment**, and add:

- `HF_TOKEN` — your fine-grained Hugging Face token with Inference Providers permission
- `HF_MODEL` — optional; defaults to `openai/gpt-oss-120b:fastest`

Save the environment change and let Render deploy/restart. The code makes ordinary HTTP requests and adds no npm dependency.

**Cost guardrail:** Hugging Face's free-account credit is limited. Do not buy credits or switch to paid usage. Treat this as an emergency best-effort fallback only; if its monthly credit is exhausted, it should fail and BembaHub should return its existing translation-unavailable response rather than incur an intentional purchase.

## Verification

A normal successful translation usually uses Gemini, so it does not prove this fallback works. Look for safe status markers:

- `[AI_FAILOVER]`
- `[HUGGINGFACE_TRANSLATION_SUCCESS]`
- `[AI_FAILOVER_HUGGINGFACE_FAILED]`

Do not deliberately break production API keys to test failover. Verify during a naturally occurring provider failure or in a separate staging deployment. Logs must not contain API keys or translation text.

## Translation quality

The router may select different models/providers depending on availability. Validate English↔Bemba and other supported Zambian language pairs before relying on the output. An HTTP success does not guarantee an accurate translation.
