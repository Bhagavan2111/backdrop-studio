// Backdrop Studio — backend (fal.ai version)
// Holds the fal.ai key server-side (never sent to the browser) and proxies
// the "iclight-v2" relight + background-replace call. The frontend only ever
// talks to this server, never to fal.ai directly.

import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import cors from 'cors';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

app.use(cors());
app.use(express.static('public'));

const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) {
  console.warn('⚠️  FAL_KEY is not set. Add it to a .env file locally, or as an environment variable on Render. The server will refuse generate requests until it is set.');
}

app.post('/api/generate-background', upload.single('photo'), async (req, res) => {
  try {
    if (!FAL_KEY) {
      return res.status(500).json({ error: 'Server is missing FAL_KEY. Ask the site owner to configure it.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded.' });
    }
    const prompt = (req.body.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ error: 'Missing background description.' });
    }

    // fal.ai's queue endpoints accept a data URI directly in image_url,
    // so we don't need a separate upload step.
    const dataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    // 1. Submit the job to fal.ai's queue
    const submitRes = await fetch('https://queue.fal.run/fal-ai/iclight-v2', {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image_url: dataUri,
        prompt
      })
    });

    if (!submitRes.ok) {
      let msg = `fal.ai request failed (${submitRes.status})`;
      try { const j = await submitRes.json(); if (j.detail) msg = JSON.stringify(j.detail); } catch (_) {}
      return res.status(submitRes.status).json({ error: msg });
    }

    const submitJson = await submitRes.json();
    const statusUrl = submitJson.status_url;
    const responseUrl = submitJson.response_url;
    if (!statusUrl || !responseUrl) {
      return res.status(502).json({ error: 'Unexpected response from fal.ai when submitting the job.' });
    }

    // 2. Poll until the job finishes
    let done = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const statusRes = await fetch(statusUrl, { headers: { Authorization: `Key ${FAL_KEY}` } });
      if (!statusRes.ok) continue;
      const statusJson = await statusRes.json();
      if (statusJson.status === 'COMPLETED') { done = true; break; }
      if (statusJson.status === 'FAILED' || statusJson.status === 'ERROR') {
        return res.status(502).json({ error: 'fal.ai reported the generation failed. Try a different description.' });
      }
      // otherwise: IN_QUEUE / IN_PROGRESS — keep polling
    }
    if (!done) {
      return res.status(504).json({ error: 'Timed out waiting for fal.ai — please try again.' });
    }

    // 3. Fetch the final result
    const resultRes = await fetch(responseUrl, { headers: { Authorization: `Key ${FAL_KEY}` } });
    if (!resultRes.ok) {
      let msg = `Fetching fal.ai result failed (${resultRes.status})`;
      try {
        const j = await resultRes.json();
        if (j.detail) msg = JSON.stringify(j.detail);
        // Surface billing/credit errors with a friendly message instead of raw text
        if (resultRes.status === 402 || resultRes.status === 403) {
          msg = 'Generation is temporarily unavailable — please try again shortly.';
        }
      } catch (_) {}
      return res.status(resultRes.status).json({ error: msg });
    }
    const resultJson = await resultRes.json();
    const imageUrl = resultJson.images?.[0]?.url || resultJson.image?.url;
    if (!imageUrl) {
      return res.status(502).json({ error: 'fal.ai returned an unexpected response shape.' });
    }

    // 4. Stream the generated image back to the browser
    const imgRes = await fetch(imageUrl);
    const arrayBuffer = await imgRes.arrayBuffer();
    res.set('Content-Type', imgRes.headers.get('content-type') || 'image/png');
    return res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Generation is temporarily unavailable — please try again shortly.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backdrop Studio server running on http://localhost:${PORT}`));
