// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, check]);
}

function png(image, size) {
  const rowSize = size * 4 + 1;
  const rows = Buffer.alloc(rowSize * size);
  for (let y = 0; y < size; y++) {
    const sy = Math.floor((y * image.height) / size);
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x * image.width) / size);
      const color = image.colors[sy * image.width + sx];
      if (!color) continue;
      const p = y * rowSize + 1 + x * 4;
      rows[p] = Number.parseInt(color.slice(1, 3), 16);
      rows[p + 1] = Number.parseInt(color.slice(3, 5), 16);
      rows[p + 2] = Number.parseInt(color.slice(5, 7), 16);
      rows[p + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function svg(image) {
  const paths = new Map();
  image.colors.forEach((color, i) => {
    if (!color) return;
    const x = i % image.width;
    const y = Math.floor(i / image.width);
    paths.set(color, (paths.get(color) ?? "") + `M${x} ${y}h1v1h-1z`);
  });
  const body = [...paths].map(([color, path]) => `<path fill="${color}" d="${path}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}" shape-rendering="crispEdges">${body}</svg>`;
}

export async function writeIcons(out, image) {
  await Promise.all([
    writeFile(out + "favicon.svg", svg(image)),
    writeFile(out + "favicon-32.png", png(image, 32)),
    writeFile(out + "apple-touch-icon.png", png(image, 180)),
    writeFile(out + "icon-192.png", png(image, 192)),
    writeFile(out + "icon-512.png", png(image, 512)),
  ]);
}
