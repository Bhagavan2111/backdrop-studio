# Backdrop Studio

Upload a photo, describe a new background, hit Generate — no API key entry, no
separate "background removed" step. Matches the flow: **upload → describe → generate → result**.

## ⚠️ First: rotate your Stability AI key

You pasted a Stability AI key in chat earlier. Treat it as compromised —
**revoke it in your Stability AI dashboard and create a new one** before using
this app. Never paste real API keys into a chat, commit them to git, or put
them in any file that ships to a browser.

## Why the key had to move server-side

Your original file put a "Your Stability AI key" input right in the page.
That key was only ever safe there because the *user* typed it into their own
browser tab. Hardcoding a key into that same HTML file instead would make it
public — anyone could open dev tools → view source and copy it, since static
HTML/JS runs entirely on the visitor's machine.

The fix: a tiny backend holds the key as a server-side environment variable
and does the Stability AI call on your app's behalf. The browser never sees it.

```
Browser  →  POST /api/generate-background (photo + prompt)
             │
             ▼
Your server (server.js)  →  Stability AI (key attached here, server-side only)
             │
             ▼
Browser  ←  generated PNG
```

## Project layout

```
backdrop-studio/
├── server.js          # Express backend — holds the key, proxies Stability AI
├── package.json
├── .env.example        # copy to .env and fill in your NEW key
└── public/
    └── index.html       # frontend — upload, prompt, generate (no key field)
```

## Run it locally

```bash
cd backdrop-studio
npm install
cp .env.example .env
# edit .env and paste your NEW (rotated) Stability AI key
npm start
```

Then open http://localhost:3000 — that's it, no key prompt in the UI.

## Deploying so real users can use it

Since this now needs a real server (not just a static HTML file), host it
somewhere that runs Node, e.g. Render, Railway, Fly.io, or a VPS. In all
cases:

1. Push this folder (**without** `.env`, and make sure `.env` is in `.gitignore`).
2. Set `STABILITY_API_KEY` as an environment variable / secret in your host's dashboard — not in the code.
3. Deploy; the platform runs `npm install && npm start`.

If you're actually working inside your existing Lovable project (the one in
your screenshots), Lovable projects typically use Supabase for backend logic.
In that case the same idea applies, just implemented as a Supabase Edge
Function instead of `server.js`: the edge function holds `STABILITY_API_KEY`
as a Supabase secret, and your frontend calls the edge function instead of
Stability AI directly. Let me know if you want that version and I'll write it.

## Notes

- Cost: Stability's Replace Background & Relight is roughly $0.08/image on their platform.
- The gallery is session-only (in-memory) in this version, same as before.
