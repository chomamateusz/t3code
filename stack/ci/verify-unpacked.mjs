import assert from 'node:assert/strict';
import { readFileSync, readdirSync, lstatSync, realpathSync, readlinkSync } from 'node:fs';
import { join, isAbsolute, relative } from 'node:path';

const [root, versionFile, version] = process.argv.slice(2);
assert(root && versionFile && version, 'Pass the unpacked runtime, the --version output file and the release version');
const markers = JSON.parse(readFileSync(new URL('./fork-markers.json', import.meta.url), 'utf8'));
assert(lstatSync(join(root, 'client')).isDirectory(), 'client must be a real directory');
let links = 0;
for (const entry of readdirSync(root, { recursive: true })) {
  const path = join(root, entry);
  if (!lstatSync(path).isSymbolicLink()) continue;
  links += 1;
  const target = relative(realpathSync(root), realpathSync(path));
  assert(!isAbsolute(readlinkSync(path)), `Absolute symlink: ${entry}`);
  assert(target !== '..' && !target.startsWith('../') && !isAbsolute(target), `Escaping symlink: ${entry}`);
}
assert.equal(links, 0, 'Runtime must contain no symlinks');
console.log(`Whole-runtime symlink audit: ${links} links, no absolute/escaping/dangling targets; client is a real directory`);
const actualVersion = readFileSync(versionFile, 'utf8').trim();
assert.equal(/\bv(\S+)\s*$/.exec(actualVersion)?.[1], version);
const executable = readFileSync(join(root, 't3'));
assert.equal(executable.subarray(0, 4).toString('hex'), '7f454c46');
assert.equal(executable[4], 2);
assert.equal(executable[5], 1);
assert.equal(executable.readUInt16LE(18), 62);
console.log('ELF: Linux x86-64, 64-bit little-endian');
const executableText = executable.toString('latin1');
for (const { name, pattern } of [...markers.server, { name: 'local version', pattern: version.replaceAll('.', '\\.') }]) {
  const match = new RegExp(pattern).exec(executableText);
  assert(match, `Missing ${name} in unpacked server executable`);
  console.log(`${name}: ${match[0]} [embedded in unpacked t3]`);
}
for (const marker of markers.serverAbsent) {
  assert(!executable.includes(Buffer.from(marker)), `${marker} must be absent from the unpacked executable`);
  console.log(`${marker}: absent from unpacked executable`);
}

assert(!readdirSync(root, { recursive: true }).some((entry) => entry.split('/').at(-1) === 't3-web-override.json'), 'Desktop override file must not ship in server archive');
console.log('t3-web-override.json: absent throughout unpacked runtime');

const client = join(root, 'client');
const clientScripts = readdirSync(client, { recursive: true })
  .filter((entry) => entry.endsWith('.js'))
  .map((entry) => ({ entry, text: readFileSync(join(client, entry), 'utf8') }));
for (const { name, pattern } of markers.web) {
  const regex = new RegExp(pattern);
  const assets = clientScripts.flatMap(({ entry, text }) => {
    const match = regex.exec(text);
    return match ? [{ asset: entry, marker: match[0] }] : [];
  });
  assert(assets.length > 0, `Missing web marker ${name} in bundled web client`);
  console.log(`Web marker ${name}:`, assets);
}
