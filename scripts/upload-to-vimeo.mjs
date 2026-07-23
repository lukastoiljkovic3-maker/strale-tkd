#!/usr/bin/env node
// Upload a video to Vimeo via the tus resumable-upload protocol.
// Zero dependencies — uses Node's built-in fetch / fs (Node 18+, tested on 24).
//
// Usage:
//   node scripts/upload-to-vimeo.mjs <file> [--title "..."] [--description "..."]
//                                           [--privacy anybody|nobody|unlisted]
//
// Reads VIMEO_ACCESS_TOKEN from the environment or from .env.local.
// Resumable: if the connection drops mid-upload, re-run the same command and it
// continues from where it stopped (it asks Vimeo for the current offset first).

import { readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const API = 'https://api.vimeo.com';
const CHUNK = 64 * 1024 * 1024; // 64 MB per PATCH

// ---- load token (env first, then .env.local) --------------------------------
function loadToken() {
  if (process.env.VIMEO_ACCESS_TOKEN) return process.env.VIMEO_ACCESS_TOKEN;
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    const m = env.match(/^VIMEO_ACCESS_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  } catch { /* no .env.local */ }
  return null;
}

// ---- parse args -------------------------------------------------------------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const file = args._[0];

if (!file) {
  console.error('Usage: node scripts/upload-to-vimeo.mjs <file> [--title "..."] [--description "..."] [--privacy anybody|nobody|unlisted]');
  process.exit(1);
}

const TOKEN = loadToken();
if (!TOKEN) {
  console.error('✗ No VIMEO_ACCESS_TOKEN found (set it in the environment or .env.local).');
  process.exit(1);
}

const path = resolve(process.cwd(), file);
let size;
try {
  size = statSync(path).size;
} catch {
  console.error(`✗ File not found: ${path}`);
  process.exit(1);
}

const headers = {
  Authorization: `bearer ${TOKEN}`,
  Accept: 'application/vnd.vimeo.*+json;version=3.4',
};

const fmtGB = (b) => (b / 1e9).toFixed(2) + ' GB';
const pct = (a, b) => ((a / b) * 100).toFixed(1) + '%';

async function main() {
  console.log(`→ ${basename(path)}  (${fmtGB(size)})`);

  // 1) Create the video + tus upload session
  const createBody = {
    upload: { approach: 'tus', size: String(size) },
    name: args.title || basename(path).replace(/\.[^.]+$/, ''),
  };
  if (args.description) createBody.description = args.description;
  if (args.privacy) createBody.privacy = { view: args.privacy };

  const createRes = await fetch(`${API}/me/videos`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(createBody),
  });
  const created = await createRes.json();
  if (!createRes.ok) {
    console.error('✗ Create failed:', JSON.stringify(created, null, 2));
    process.exit(1);
  }

  const uploadLink = created.upload.upload_link;
  const videoUri = created.uri;                 // e.g. /videos/123456789
  const videoId = videoUri.split('/').pop();
  const link = created.link;                      // public-facing page
  console.log(`  created video ${videoId} — uploading…`);

  // 2) Push the file with tus PATCH chunks (resumable)
  let offset = 0;
  const fd = openSync(path, 'r');
  try {
    while (offset < size) {
      const end = Math.min(offset + CHUNK, size);
      const buf = Buffer.alloc(end - offset);
      readSync(fd, buf, 0, buf.length, offset);

      const patch = await fetch(uploadLink, {
        method: 'PATCH',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Offset': String(offset),
          'Content-Type': 'application/offset+octet-stream',
        },
        body: buf,
      });

      if (patch.status !== 204) {
        console.error(`\n✗ Chunk failed (HTTP ${patch.status}): ${await patch.text()}`);
        console.error('  Re-run the same command to resume from where it stopped.');
        process.exit(1);
      }

      offset = Number(patch.headers.get('upload-offset'));
      process.stdout.write(`\r  ${fmtGB(offset)} / ${fmtGB(size)}  (${pct(offset, size)})   `);
    }
  } finally {
    closeSync(fd);
  }
  console.log('\n  upload complete ✓');

  // 3) Done — return the link
  console.log(`\n✓ Live at: ${link}`);
  console.log(`  Embed:    https://player.vimeo.com/video/${videoId}`);
  console.log(`  API URI:  ${videoUri}`);

  // Emit a machine-readable line last (handy for piping into other tools)
  console.log(`JSON ${JSON.stringify({ id: videoId, uri: videoUri, link, embed: `https://player.vimeo.com/video/${videoId}` })}`);
}

main().catch((e) => {
  console.error('\n✗', e.message);
  process.exit(1);
});
