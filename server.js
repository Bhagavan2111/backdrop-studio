// Backdrop Studio — backend
// Holds the Stability AI key server-side (never sent to the browser) and proxies
// the "Replace Background & Relight" call. The frontend only ever talks to
// this server, never to Stability AI directly.

import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import cors from 'cors';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

app.use(cors());
app.use(express.static('public'));

const STABILITY_API_KEY = process.env.STABILITY_API_KEY;
if (!STABILITY_API_KEY) {
  console.warn('⚠️  STABILITY_API_KEY is not set. Add it to a .env file (see .env.example). The server will refuse generate requests until it is set.');
}

app.post('/api/generate-background', upload.single('photo'), async (req, res) => {
  try {
    if (!STABILITY_API_KEY) {
      return res.status(500).json({ error: 'Server is missing STABILITY_API_KEY. Ask the site owner to configure it.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded.' });
    }
    const prompt = (req.body.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ error: 'Missing background description.' });
    }

    // 1. Kick off the job with Stability AI
    const form = new FormData();
    form.append('subject_image', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname || 'photo.png');
    form.append('background_prompt', prompt);
    form.append('output_format', 'png');

    const startRes = await fetch('https://api.stability.ai/v2beta/stable-image/edit/replace-background-and-relight', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STABILITY_API_KEY}`, Accept: 'application/json' },
      body: form
    });

    if (!startRes.ok) {
      let msg = `Stability AI request failed (${startRes.status})`;
      try { const j = await startRes.json(); if (j.errors) msg = j.errors.join(', '); } catch (_) {}
      return res.status(startRes.status).json({ error: msg });
    }

    const { id } = await startRes.json();
    if (!id) return res.status(502).json({ error: 'No job id returned by Stability AI.' });

    // 2. Poll until the job finishes
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes = await fetch(`https://api.stability.ai/v2beta/results/${id}`, {
        headers: { Authorization: `Bearer ${STABILITY_API_KEY}`, Accept: 'application/json' }
      });
      if (pollRes.status === 202) continue; // still processing
      if (pollRes.status === 200) {
        const json = await pollRes.json();
        const b64 = json.image || json.result || json.output ||
          (json.artifacts && json.artifacts[0] && json.artifacts[0].base64);
        if (!b64) return res.status(502).json({ error: 'Unexpected response shape from Stability AI.' });
        const buffer = Buffer.from(b64, 'base64');
        res.set('Content-Type', 'image/png');
        return res.send(buffer);
      }
      let msg = `Polling failed (${pollRes.status})`;
      try { const j = await pollRes.json(); if (j.errors) msg = j.errors.join(', '); } catch (_) {}
      return res.status(pollRes.status).json({ error: msg });
    }
    return res.status(504).json({ error: 'Timed out waiting for Stability AI — please try again.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unexpected server error.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backdrop Studio server running on http://localhost:${PORT}`));
