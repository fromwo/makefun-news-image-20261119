/**
 * news-image-20261119 — entry program.
 *
 * Validates the bundled front-page image (entry.png) and copies it to the
 * output directory as entry.png. Node 22, standard library only, no network.
 *
 * Checks, in order:
 *   1. the file exists and is at most 1 MiB (1048576 bytes);
 *   2. the PNG signature (the 8 magic bytes);
 *   3. the IHDR chunk: width and height each at most 1024 pixels;
 *   4. every chunk in turn: its length stays inside the file, its CRC-32
 *      matches the bytes it covers, and chunk types are well formed;
 *   5. the file ends with a proper IEND chunk and nothing trails it.
 * Any failure prints a message to stderr and exits non-zero; nothing is
 * copied. On success the file is copied byte for byte, so repeated runs
 * always produce identical output.
 */
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 1048576;
const MAX_DIMENSION = 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC-32 (IEEE 802.3, polynomial 0xEDB88320), built once at startup.
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function validatePng(data: Buffer): void {
  if (data.length < 8 + 25) {
    fail(`file too short to be a PNG (${data.length} bytes)`);
  }
  if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail("bad PNG signature: first 8 bytes are not the PNG magic");
  }

  let offset = 8;
  let seenIhdr = false;
  let seenIend = false;

  while (offset < data.length) {
    if (offset + 8 > data.length) {
      fail(`truncated chunk header at byte ${offset}`);
    }
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("ascii");
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + length;
    if (chunkEnd + 4 > data.length) {
      fail(`chunk ${type} at byte ${offset} overruns the file`);
    }
    const storedCrc = data.readUInt32BE(chunkEnd);
    const actualCrc = crc32(data.subarray(offset + 4, chunkEnd));
    if (storedCrc !== actualCrc) {
      fail(`chunk ${type} at byte ${offset} fails its CRC check`);
    }

    if (!seenIhdr) {
      if (type !== "IHDR") {
        fail(`first chunk is ${type}, expected IHDR`);
      }
      if (length !== 13) {
        fail(`IHDR length is ${length}, expected 13`);
      }
      const width = data.readUInt32BE(chunkStart);
      const height = data.readUInt32BE(chunkStart + 4);
      if (width === 0 || height === 0) {
        fail(`image has zero dimension (${width}x${height})`);
      }
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        fail(`image is ${width}x${height}, over the ${MAX_DIMENSION}x${MAX_DIMENSION} limit`);
      }
      seenIhdr = true;
    }
    if (type === "IEND") {
      if (length !== 0) {
        fail(`IEND chunk carries ${length} bytes, expected 0`);
      }
      if (chunkEnd + 4 !== data.length) {
        fail("trailing bytes after the IEND chunk");
      }
      seenIend = true;
      break;
    }

    offset = chunkEnd + 4;
  }

  if (!seenIhdr) {
    fail("no IHDR chunk found");
  }
  if (!seenIend) {
    fail("no IEND chunk found: PNG is truncated");
  }
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = join(here, "entry.png");
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? join(here, "out");

  let size: number;
  try {
    size = statSync(source).size;
  } catch {
    fail(`cannot read ${source}: file not found`);
  }
  if (size > MAX_BYTES) {
    fail(`entry.png is ${size} bytes, over the ${MAX_BYTES} byte limit`);
  }

  const data = readFileSync(source);
  validatePng(data);

  mkdirSync(outDir, { recursive: true });
  const target = join(outDir, "entry.png");
  copyFileSync(source, target);

  // Confirm the copy landed byte for byte: re-read it and compare.
  const copied = readFileSync(target);
  if (!copied.equals(data)) {
    fail(`copied file at ${target} does not match entry.png`);
  }
  console.log(`ok: entry.png (${size} bytes) written to ${target}`);
}

main();
