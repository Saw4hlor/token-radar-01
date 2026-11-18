// Launch Radar v2: a token-radar-01 entry (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// fits the value model in lib/model.ts on the snapshot's own traded protocols — choosing
// among candidate models by leave-one-out cross-validation, in the open — writes the
// ranked board to /output/board.json and the dashboard's data to /output/data.js, copies
// this repository's dashboard/ and screenshots/ into /output, and writes /output/dossier.json
// with the vendored make.fun library, byte for byte the scorer's own copy. Before anything
// is written the board is checked against the gate's shape; a board the gate would refuse
// stops the run.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The run is deterministic: the same snapshot writes the same bytes, twice over.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps, as the rules state them: the dossier is rebuilt and compared byte for byte. */
const DOSSIER_CAPS = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> or --name=<value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`launch radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`launch radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping dotfiles; returns the names copied. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const pageFiles = copyTree(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyTree(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  fail(`screenshots/ holds ${shots.length} images: hand in 3 or 4, the board, a detail view and a filtered view among them`);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, DOSSIER_CAPS));

process.stdout.write(
  `launch radar: ${snapshot.protocols.length} protocols scanned, ${radar.meta.no_token} record no token, ${board.length} ranked ` +
    `(${radar.meta.watchlist_covered}/${snapshot.watchlist.length} watchlist), model "${radar.model.chosen}" on ${radar.model.n} peers, ` +
    `leave-one-out median error x${radar.model.loo.median_factor.toFixed(2)}\n` +
    `launch radar: wrote board.json, data.js, dashboard/ (${pageFiles.length} files), screenshots/ (${shots.length} images) and dossier.json under ${out}\n`,
);
