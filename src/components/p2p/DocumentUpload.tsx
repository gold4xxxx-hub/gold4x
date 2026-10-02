'use client';

// File picker for the Aadhaar document fields.
//
// Posts the image to /api/kyc/document, which pins it to IPFS and returns a
// CID. Only the CID is written to the contract — the image never goes on-chain.

import React, { useEffect, useRef, useState } from 'react';

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (cid: string) => void;
};

// image/* rather than an explicit extension list. Mobile browsers use the
// accept filter to decide whether to surface the camera, and a narrow
// extension list suppresses it on iOS and in in-app browsers like SafePal.
const ACCEPT = 'image/*';
const MAX_BYTES = 5 * 1024 * 1024;

// Strip an ipfs:// prefix or a full gateway URL down to the bare CID, so a
// pasted link still satisfies the contract's non-empty check.
function normaliseCid(raw: string): string {
  let v = raw.trim();
  v = v.replace(/^ipfs:\/\//i, '');
  const gateway = v.match(/^(?:ipfs\/|ipns\/)?([^/]+)\/(?:ipfs\/)?(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/i);
  if (gateway?.[2]) return gateway[2];
  return v;
}

export default function DocumentUpload({ id, label, value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLink, setShowLink] = useState(false);

  // Object URLs are revoked when replaced or unmounted, otherwise each
  // selection leaks the previous file for the life of the page.
  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  const setImage = (file: File) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = URL.createObjectURL(file);
    previewRef.current = url;
    setPreview(url);
  };

  const upload = async (file: File) => {
    setError(null);

    if (!file.type.startsWith('image/')) {
      setError('That is not an image file.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('Image is too large. Maximum size is 5 MB.');
      return;
    }

    setBusy(true);
    setImage(file);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/kyc/document', { method: 'POST', body });
      const json = (await res.json()) as { cid?: string; error?: string };

      if (!res.ok || !json.cid) {
        setError(json.error || 'Upload failed. Please try again.');
        return;
      }
      onChange(json.cid);
    } catch {
      setError('Could not reach the upload service. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void upload(file);
  };

  const clear = () => {
    onChange('');
    setError(null);
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    }
    setPreview(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div>
      <label className="p2p-label" htmlFor={id}>{label}</label>

      {/* The input is positioned over the whole card at full size with zero
          opacity, rather than being collapsed with sr-only. Mobile browsers
          only offer the camera for a real, laid-out file input, and a 1px
          hidden one loses that option. The card below is the visible chrome. */}
      <div
        style={{
          position: 'relative',
          borderRadius: '11px',
          border: value
            ? '1px solid rgba(45,139,120,0.3)'
            : '1px dashed rgba(212,168,67,0.28)',
          background: value ? 'rgba(45,139,120,0.05)' : 'rgba(255,255,255,0.02)',
          transition: 'border-color 0.25s ease, background 0.25s ease',
        }}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={ACCEPT}
          onChange={onPick}
          aria-label={label}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: 0,
            // Keep it above the visual layer so a tap anywhere on the card
            // hits the input directly.
            zIndex: 2,
            cursor: 'pointer',
            fontSize: '100px', // stops iOS zooming the page on focus
          }}
        />

        <div
          aria-hidden="true"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.6rem',
            pointerEvents: 'none',
          }}
        >
        {preview ? (
          // Blob URL for a local object, so next/image optimisation does not
          // apply here and plain img is the correct choice.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={`${label} preview`}
            style={{
              width: 52,
              height: 40,
              objectFit: 'cover',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.1)',
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 52,
              height: 40,
              borderRadius: '6px',
              border: '1px dashed rgba(255,255,255,0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: 'var(--fx-ink-subtle)',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 17l5-5 4 4 8-8" />
              <path d="M14 8h6v6" />
            </svg>
          </div>
        )}

        <div style={{ minWidth: 0, flex: 1 }}>
          {busy ? (
            <span style={{ fontSize: '0.82rem', color: 'var(--fx-gold-text)' }}>
              Uploading…
            </span>
          ) : value ? (
            <>
              <div style={{ fontSize: '0.8rem', color: 'var(--fx-emerald-bright)' }}>
                Uploaded
              </div>
              <code
                style={{
                  display: 'block',
                  fontSize: '0.68rem',
                  color: 'var(--fx-ink-subtle)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {value}
              </code>
            </>
          ) : (
            <>
              <div style={{ fontSize: '0.82rem', color: 'var(--fx-ink-muted)' }}>
                Choose image
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--fx-ink-subtle)' }}>
                Take a photo or pick a file · max 5 MB
              </div>
            </>
          )}
          </div>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: '0.72rem', color: '#e08b8b', marginTop: '0.35rem' }}>{error}</p>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.4rem' }}>
        <button
          type="button"
          onClick={() => setShowLink((s) => !s)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            fontSize: '0.7rem',
            color: 'var(--fx-ink-subtle)',
            textDecoration: 'underline',
            cursor: 'pointer',
          }}
        >
          {showLink ? 'Hide' : 'Already have a link?'}
        </button>
        {value && (
          <button
            type="button"
            onClick={clear}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: '0.7rem',
              color: '#e08b8b',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            Remove
          </button>
        )}
      </div>

      {showLink && (
        <input
          type="text"
          className="p2p-input"
          style={{ marginTop: '0.5rem' }}
          placeholder="Qm… or ipfs://…"
          value={value}
          onChange={(e) => onChange(normaliseCid(e.target.value))}
          aria-label={`${label} CID or link`}
        />
      )}
    </div>
  );
}
