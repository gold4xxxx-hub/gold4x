// Server-side image pinning, shared by the KYC document upload and the P2P
// trade screenshot upload.
//
// The PINATA_JWT is read from the environment here and never leaves the
// server. Putting it in the browser would let anyone reading the page use your
// Pinata account, and would leak the private gateway subdomain.
//
// Only the returned CID is written to the contract. The image itself is content
// addressed on IPFS and never touches the blockchain.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Image types a phone camera or screenshot tool will actually produce. Kept
// explicit rather than image/* so a mislabelled file cannot be pinned.
const ALLOWED = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/heic', 'heic'],
  ['image/heif', 'heif'],
]);

export class PinError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'PinError';
    this.status = status;
  }
}

type PinataResponse = {
  IpfsHash?: string;
  PinSize?: number;
  Timestamp?: string;
};

/**
 * Pins one image and returns its CID.
 *
 * `prefix` becomes the start of the public file name. Every file is renamed
 * before pinning, because the original name is permanently public once pinned:
 * "upi_screenshot_9876543210.jpg" would leak the payer's UPI id to anyone who
 * sees the CID.
 */
export async function pinImage(
  file: File,
  prefix: string,
  group: string,
): Promise<{ cid: string; size: number; name: string }> {
  // Validate the file before touching configuration. Order matters for the
  // error a user sees: with the credential checked first, an unsupported file
  // type reports "upload is not configured", which sends them looking for a
  // server problem instead of the real cause.
  const ext = ALLOWED.get(file.type);
  if (!ext) {
    throw new PinError('Only JPG, PNG, WEBP, HEIC or HEIF images are accepted.', 415);
  }

  if (file.size === 0) {
    throw new PinError('The selected file is empty.', 400);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new PinError(
      `Image is too large. Maximum size is ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB.`,
      413,
    );
  }

  const jwt = process.env.PINATA_JWT?.trim();
  if (!jwt) {
    throw new PinError(
      'Upload is not configured. Set PINATA_JWT on the server.',
      503,
    );
  }

  const safeName = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const outbound = new File([buffer], safeName, { type: file.type });

  const upstream = new FormData();
  upstream.append('file', outbound);
  upstream.append('pinataMetadata', JSON.stringify({ name: safeName, group }));

  let res: Response;
  try {
    res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: upstream,
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new PinError('Could not reach the storage service. Please try again.', 502);
  }

  if (!res.ok) {
    // Never echo the upstream body verbatim; it can contain key hints.
    if (res.status === 401 || res.status === 403) {
      throw new PinError('Storage credentials were rejected.', 502);
    }
    throw new PinError('The storage service rejected this image.', 502);
  }

  let data: PinataResponse;
  try {
    data = (await res.json()) as PinataResponse;
  } catch {
    throw new PinError('Upload finished but the response could not be read.', 502);
  }

  if (!data?.IpfsHash) {
    throw new PinError('Upload finished but no file reference was returned.', 502);
  }

  return { cid: data.IpfsHash, size: data.PinSize ?? buffer.length, name: safeName };
}

/** Reads the single `file` entry out of a multipart body. */
export async function readUpload(request: Request): Promise<File> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new PinError('Invalid upload request.', 400);
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    throw new PinError('No file received.', 400);
  }
  return file;
}
