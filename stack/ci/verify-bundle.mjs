import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [bundlePath, executablePath, version] = process.argv.slice(2);
assert(bundlePath && executablePath && version, 'Pass bundled JS, its executable and the release version');
assert(readFileSync(bundlePath).length > 0, 'Bundled JS entry must exist and be nonempty');
const markers = JSON.parse(readFileSync(new URL('./fork-markers.json', import.meta.url), 'utf8'));
function readChunks(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return readChunks(path);
      return entry.isFile() && /\.(?:mjs|js)$/.test(entry.name)
        ? [{ path, text: readFileSync(path, 'utf8') }]
        : [];
    });
}
const chunks = readChunks(dirname(bundlePath));
const bundle = chunks.map(({ text }) => text).join('\n');
console.log(`JS scope: ${chunks.length} chunks in ${dirname(bundlePath)}`);
function reportMatches(name, pattern) {
  for (const { path, text } of chunks) {
    const match = pattern.exec(text);
    if (!match) continue;
    const line = text.slice(0, match.index).split('\n').length;
    console.log(`${name}: ${path}:${line}: ${match[0]} [also embedded in ELF]`);
  }
}
const executable = readFileSync(executablePath);
const checks = [
  ...markers.server.map(({ name, pattern }) => [name, new RegExp(pattern)]),
  ['local version', new RegExp(version.replaceAll('.', '\\.'))],
];
for (const [name, pattern] of checks) {
  const match = pattern.exec(bundle);
  assert(match, `Missing ${name} in JS bundle`);
  assert(executable.includes(Buffer.from(match[0])), `Missing ${name} in executable`);
  reportMatches(name, pattern);
}
assert.equal(executable.subarray(0, 4).toString('hex'), '7f454c46');
assert.equal(executable[4], 2);
assert.equal(executable[5], 1);
assert.equal(executable.readUInt16LE(18), 62);
console.log('ELF: Linux x86-64, 64-bit little-endian');

for (const marker of markers.serverAbsent) {
  assert(!bundle.includes(marker), `${marker} must be absent from JS`);
  assert(!executable.includes(Buffer.from(marker)), `${marker} must be absent from executable`);
  console.log(`${marker}: absent from JS and executable`);
}
