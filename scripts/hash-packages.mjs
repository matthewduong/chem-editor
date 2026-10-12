import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const bundle = 'src-tauri/target/release/bundle';
const packages = [];
for (const [directory, extension] of [
  ['deb', '.deb'],
  ['nsis', '.exe'],
]) {
  const folder = path.join(bundle, directory);
  if (existsSync(folder))
    packages.push(
      ...readdirSync(folder)
        .filter((file) => file.endsWith(extension))
        .map((file) => path.join(folder, file)),
    );
}
const macArchive = 'ChemEditor-macos-arm64.app.tar.gz';
if (existsSync(macArchive)) packages.push(macArchive);
if (!packages.length) throw new Error('No installer or app archive to hash');
const artifacts = [];
for (const file of packages) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  artifacts.push({ file, sha256: hash.digest('hex') });
}
writeFileSync(
  'package-hashes.json',
  JSON.stringify(
    {
      commit: process.env.GITHUB_SHA,
      platform: process.platform,
      architecture: process.arch,
      artifacts,
    },
    null,
    2,
  ),
);
