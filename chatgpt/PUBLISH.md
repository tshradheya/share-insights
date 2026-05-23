# Publishing the share-insights Custom GPT on ChatGPT

ChatGPT Custom GPTs can only be created through the ChatGPT web UI by a Plus / Team / Enterprise user. No API. ~5 minutes start-to-finish. Once published, anyone with a Plus account can use it via a shareable link.

## What you'll need open

| Tab | Contents |
|---|---|
| Browser tab | <https://chat.openai.com/gpts/editor> |
| File `chatgpt/instructions.md` | Paste into "Instructions" |
| File `chatgpt/share-insights-template.html` | Upload as a Knowledge file |
| File `chatgpt/openapi.yaml` | Paste into the Action schema box |

## Steps

### 1. Open the GPT editor

Sign in to ChatGPT (Plus required). Click the **sidebar → "Explore GPTs"** then **"+ Create"** in the top right. The editor opens with two tabs at the top: **Create** (a chat-style builder) and **Configure** (a form). Switch to **Configure**.

### 2. Fill in basics

| Field | Value |
|---|---|
| **Name** | `share-insights` |
| **Description** | `Publish a clean, redacted HTML summary of any conversation to a shareable URL. Anonymous, auto-deletes after 90 days.` |
| **Profile picture** | Optional — skip or upload anything |

### 3. Instructions

Paste the entire contents of `chatgpt/instructions.md` into the **Instructions** textarea. (4469 chars; under the 8000 limit.)

### 4. Conversation starters

Add up to four. Suggested:

- `Share what we just discussed`
- `Publish a summary of this conversation`
- `Make a shareable link for this session`
- `Turn this chat into a report`

### 5. Knowledge

Click **Upload files** under "Knowledge" and upload `chatgpt/share-insights-template.html`. The instructions reference this file by name.

### 6. Capabilities

Turn **OFF** all three: Web Browsing, DALL·E Image Generation, Code Interpreter & Data Analysis. The GPT only needs the Action.

### 7. Actions

Click **Create new action**.

- **Authentication**: select **None**
- **Schema**: clear the default placeholder and paste the entire contents of `chatgpt/openapi.yaml`
- ChatGPT will parse it and list two operations: `prepareInsights` and `publishInsights`
- **Privacy policy** (required field at the bottom of the Action editor): `https://share-insights.pages.dev/abuse`

Click **Test** next to `prepareInsights`. Paste this body:

```json
{
  "html": "<!doctype html><html><head><title>gpt-test</title></head><body><h1>hi</h1></body></html>",
  "title": "gpt-test",
  "source": "chatgpt-gpt"
}
```

You should see a 200 response with a `preview_token`. Copy the token, then test `publishInsights` with `{"preview_token": "<that token>", "source": "chatgpt-gpt"}`. You should see a `url` back. Open it — your test page should render.

If the test fails:
- 403 → ChatGPT's Action proxy IP is being challenged by Cloudflare. Check `wrangler tail` for the request and let me know.
- 4xx → check the response body for `error` — usually `secrets_detected` or `html_violations`.

### 8. Save & share

Click **Save** (top-right). Choose:

- **Only me** — for private testing
- **Anyone with the link** — recommended for v0.1, lets you share without going through GPT store review
- **Everyone (GPT store)** — requires you to verify your domain at <https://chat.openai.com/gpts/discovery>; not needed for v0.1

Click **Confirm**. ChatGPT shows the shareable URL — something like `https://chat.openai.com/g/g-AbCdEf12345-share-insights`. Copy it.

### 9. Update the share-insights landing page

Edit `pages/index.html`, find the "ChatGPT.com" card, and replace the placeholder text with the link. Then redeploy Pages:

```sh
cd /Users/sthakre/side-stuff/share-insights
npx wrangler pages deploy pages --project-name share-insights
```

### 10. Smoke test from the outside

Open the GPT link in a private window (still signed in with a Plus account). Ask:

> "Make me a shareable summary of this conversation about how I should plan a vacation to Iceland."

Have a brief back-and-forth so there's content, then say "share this conversation." The GPT should:

1. Summarize into the structured sections.
2. Redact (probably nothing to redact in a vacation chat, but it should produce the section with "no redactions needed" or similar).
3. Call `prepareInsights`.
4. Show you the preview + warnings.
5. Ask "publish? (yes/no)".
6. After yes, call `publishInsights`.
7. Surface the resulting URL.

Click the URL — it should render the page. Done.

## Known gotchas

- **First in-conversation call disables the action if its payload contains PII.** OpenAI's runtime safety classifier flags "user identifying data flowing to a third-party action" and disables the tool for that (user × GPT) pair — *even though no explicit error appears*. The fix is start a fresh conversation; the classifier resets. Tell users not to ask the GPT to publish "my web presence" / "my bio" / their CV as their first interaction. Doing it later in the conversation seems safer than as the first request.
- **YAML 1.1 truthy keys silently become booleans.** Property names like `on:`, `off:`, `yes:`, `no:` get parsed as `true`/`false` and OpenAI's pydantic validator then rejects the schema with `Input should be a valid string`. Quote them: `"on":` etc.

- **Cloudflare may 403 the first ChatGPT call.** The Worker is open to all UAs, but Cloudflare's bot-fight mode (if you enable it) might challenge OpenAI's IP ranges. Check `wrangler tail` and disable bot-fight for `share-insights.tshradheya.workers.dev` if needed.
- **Action requests over 100 KB** (the OpenAPI default) can be rejected by ChatGPT. Our `html` payload can hit 1–2 MB. If you see truncation, in the Action settings increase the max body size, or split the publish into a chunked upload (defer to v0.2).
- **Privacy policy URL is mandatory** for any GPT with an Action. The `/abuse` page satisfies this.
- **ChatGPT caches OpenAPI specs aggressively.** If you edit the YAML and re-paste, delete the old Action first.
