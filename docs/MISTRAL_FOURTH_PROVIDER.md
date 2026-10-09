# Mistral fourth-provider fallback

BembaHub's translation provider order is:

1. Gemini (primary)
2. Groq (first backup)
3. OpenRouter free-model router (second backup)
4. Mistral (fourth provider)

## Configure Render

In the Render dashboard, open the `bembahub-backend` service, select **Environment**, and add:

- `MISTRAL_API_KEY` — your API key from Mistral Studio
- `MISTRAL_MODEL` — optional; defaults to `mistral-small-latest`

Never commit API keys to GitHub or share them in chat. Save the environment change and let Render deploy/restart the service.

Mistral documents a Free mode for API access with no credit card required, but usage and rate limits apply. Confirm the current limits in your Mistral Studio account before depending on it for production traffic.

## Verify

A regular successful translation will normally use Gemini, so it does not prove fallback. The backend emits safe provider-status logs such as:

- `[AI_FAILOVER]`
- `[MISTRAL_TRANSLATION_SUCCESS]`
- `[AI_FAILOVER_MISTRAL_FAILED]`

Do not deliberately break production API keys to test fallback. Verify during a naturally occurring provider failure or test in a separate staging deployment. Logs should not contain translation text or API keys.

## Language-quality note

Free models and their availability can change. Test English↔Bemba and any other supported Zambian language pairs before relying on Mistral as a fallback. A successful API response is not a guarantee that every translation is accurate.
