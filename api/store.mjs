/* =====================================================================
   A small JSON store on the Render disk.

   ErgonSite's chat and enquiry volume is tiny (dozens of rows a month,
   not millions), so a database server would be cost and moving parts
   for nothing. Everything lives in memory and is written to one file:
   to a temporary file first, then renamed over the real one, so a crash
   mid-write can never leave a half-written database behind. Writes are
   batched (at most one every 250 ms) and flushed on shutdown.
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = () => ({ version: 1, users: [], sessions: [], conversations: [], inquiries: [] });

export function openStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'ergonsite.json');
  let data = EMPTY();

  if (fs.existsSync(file)) {
    try {
      data = { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (err) {
      /* Never silently start from empty over a file we could not read:
         keep the broken copy beside it for a human to look at. */
      const keep = file + '.unreadable-' + Date.now();
      fs.copyFileSync(file, keep);
      console.error('Store file could not be read, kept a copy at', keep, err);
    }
  }

  let timer = null;

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  }

  function save() {
    if (!timer) timer = setTimeout(flush, 250);
  }

  return { data, save, flush, file };
}
