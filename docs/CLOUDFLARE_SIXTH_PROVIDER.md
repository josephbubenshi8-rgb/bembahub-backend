# Cloudflare Workers AI — sixth fallback

Cloudflare Workers AI is BembaHub's sixth optional text-translation provider, after Gemini, Groq, OpenRouter, Mistral, and Hugging Face.

## Create the credentials

1. Sign in to the Cloudflare dashboard.
2. Open **Workers AI** and follow Cloudflare's REST API setup guide.
3. Create an API token with the Workers AI permissions Cloudflare recommends for REST API calls.
4. Copy your account ID from the account dashboard.
5. Keep the token private. Never commit it to GitHub or paste it into chat.

Official setup guide: https://developers.cloudflare.com/workers-ai/get-started/rest-api/

## Configure Render

In Render, open the `bembahub-backend` service → **Environment**, and add:

- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN` — your Workers AI API token.
- `CLOUDFLARE_AI_MODEL` — optional; defaults to `@cf/meta/llama-3.1-8b-instruct`.

Save the environment changes and allow Render to restart/redeploy. The provider is skipped unless both required variables are configured.

## Free usage and safety

Workers AI has a limited free daily allocation (commonly documented as 10,000 Neurons/day; verify current Cloudflare terms). This is not unlimited capacity. Do not enable paid billing or purchase extra capacity for BembaHub without explicit approval.

A successful HTTP response does not guarantee accurate Bemba or other Zambian-language translation. Test with a fluent speaker before relying on output for important material. Logs should never contain the token or translated user text.
