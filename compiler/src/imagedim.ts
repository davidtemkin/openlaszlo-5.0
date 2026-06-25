// Read intrinsic pixel dimensions from a raster image's header bytes — no
// decoding. PNG (IHDR), GIF (logical screen), JPEG (SOFn marker). The original
// oracle routed every image through its Flash/SWF pipeline; GIFs there pick up a
// sub-pixel `.999`-scale artifact (GIF89a.gifToSwf) — we emit honest pixel dims
// instead and the differential harness rounds resource dimensions.

export interface Dim { width: number; height: number; format: "png" | "gif" | "jpeg"; }

function u16be(b: Uint8Array, i: number): number { return (b[i] << 8) | b[i + 1]; }
function u16le(b: Uint8Array, i: number): number { return b[i] | (b[i + 1] << 8); }
function u32be(b: Uint8Array, i: number): number {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

/** Parse image dimensions, or null if the format isn't a recognized raster. */
export function imageDim(b: Uint8Array): Dim | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A, then IHDR (width/height at offset 16/20).
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return { width: u32be(b, 16), height: u32be(b, 20), format: "png" };
  // GIF: "GIF87a"/"GIF89a", logical-screen width/height at offset 6/8 (LE).
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46)
    return { width: u16le(b, 6), height: u16le(b, 8), format: "gif" };
  // JPEG: scan markers for a Start-Of-Frame (SOF0..SOF15 except DHT/DAC/SOI/etc).
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      // SOF markers carrying frame dimensions (skip 0xC4 DHT, 0xC8 JPG, 0xCC DAC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { height: u16be(b, i + 5), width: u16be(b, i + 7), format: "jpeg" };
      const len = u16be(b, i + 2); // segment length (excludes the 0xFF marker byte)
      i += 2 + len;
    }
  }
  return null;
}
