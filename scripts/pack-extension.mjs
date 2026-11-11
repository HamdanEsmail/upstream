// Gets the extension ready to hand out: copies the site's stylesheet into it, so the side
// panel looks like the site, and writes public/assets/upstream-extension.zip, which the
// "Get the extension" page links to. Run with: npm run extension
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";

const root = new URL("..", import.meta.url);
const at = (path) => new URL(path, root);

copyFileSync(at("public/assets/line.css"), at("extension/line.css"));

// A fixed date in every entry, so the same files always give the same zip.
const DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 11;
const FOLDER = "upstream-extension/";

const names = readdirSync(at("extension")).filter((name) => !name.startsWith(".")).sort();
const parts = [];
const directory = [];
let offset = 0;
for (const name of names) {
  const data = readFileSync(at("extension/" + name));
  const packed = deflateRawSync(data, { level: 9 });
  const path = Buffer.from(FOLDER + name, "utf8");
  const sum = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // names are UTF-8
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(sum, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(path.length, 26);
  local.writeUInt16LE(0, 28);
  parts.push(local, path, packed);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(0, 12);
  entry.writeUInt16LE(DOS_DATE, 14);
  entry.writeUInt32LE(sum, 16);
  entry.writeUInt32LE(packed.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(path.length, 28);
  entry.writeUInt32LE(offset, 42);
  directory.push(entry, path);

  offset += local.length + path.length + packed.length;
}

const directorySize = directory.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(names.length, 8);
end.writeUInt16LE(names.length, 10);
end.writeUInt32LE(directorySize, 12);
end.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...parts, ...directory, end]);
writeFileSync(at("public/assets/upstream-extension.zip"), zip);
console.log(`${names.length} files, ${zip.length} bytes: public/assets/upstream-extension.zip`);
