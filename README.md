# ARMOR Plus

Acquisition Regulation Mission Operations Resource for RFO FAR, DFARS RFO, PGI, and class-deviation analysis.

Built as a production Next.js app around the ARMOR methodology: two-pass gate, source routing, BLUF, STEP output, and self-verification.

## Source Material Found Locally

- GitHub repo: https://github.com/kidkenpo-create/ARMOR-plus.git
- Production example zip: `C:\Users\kidke\Downloads\armor-plus-production.zip`
- Local GitHub working folder: `C:\Users\kidke\OneDrive\Documents\GitHub\ARMOR-plus`
- Current app folder: `C:\Users\kidke\OneDrive\Documents\New project\armor-plus-app`

## Stack

- Next.js 16
- React 19
- OpenAI Node SDK
- TypeScript
- Server-Sent Events streaming

## OpenAI Key

Create or manage an API key here:

https://platform.openai.com/api-keys

The key belongs in `.env.local` or in Vercel environment variables. It is only used by the server route at `/api/analyze`; it is never sent to the browser.

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
```

## Local Development

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open:

```text
http://localhost:3000
```

## Production Check

```bash
npm run build
npm run start
```

Source connectivity check:

```text
http://localhost:3000/api/health/sources
```

This validates live server-side access to `www.acquisition.gov` and the ARMOR GitHub raw source path.

## Deploy to Vercel

1. Push this folder to GitHub.
2. Import the repo in Vercel.
3. Add `OPENAI_API_KEY` and optionally `OPENAI_MODEL` in Vercel Project Settings -> Environment Variables.
4. Redeploy.

## What the App Does

- Accepts a DoD acquisition question.
- Previews likely source routing in the UI.
- Server-fetches approved direct sources from acquisition.gov and the ARMOR GitHub raw files.
- Sends the ARMOR system prompt plus live regulatory context to OpenAI from the server.
- Streams the answer back into structured BLUF and STEP sections.
- Keeps source status visible as Retrieved, UTR, or Planned.

## Residual Notes

`npm audit` currently reports a moderate PostCSS advisory through the latest `next` package available from npm. The suggested forced fix would downgrade Next and is not applied.
