export type KycStatus = 'pending' | 'approved' | 'rejected';

export type KycDocumentKind = 'idFront' | 'idBack' | 'pan' | 'bankStatement';

export type KycDocument = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  base64: string;
};

export type KycSubmission = {
  wallet: string;
  fullName: string;
  email: string;
  mobileNo: string;
  bankAccountName: string;
  bankName: string;
  bankAccountNumber: string;
  bankIfscSwift: string;
  bankBranch: string;
  idFront: KycDocument;
  idBack: KycDocument;
  pan: KycDocument;
  bankStatement: KycDocument;
  status: KycStatus;
  reference: string;
  createdAt: string;
  updatedAt: string;
};

export type KycSubmissionPublic = Omit<KycSubmission, 'idFront' | 'idBack' | 'pan' | 'bankStatement' | 'bankAccountNumber'> & {
  maskedAccountNumber: string;
  hasIdFront: boolean;
  hasIdBack: boolean;
  hasPan: boolean;
  hasBankStatement: boolean;
  idFrontName: string;
  idBackName: string;
  panName: string;
  bankStatementName: string;
};

type KycStore = Map<string, KycSubmission>;

type GlobalWithKycStore = typeof globalThis & {
  __jsaviorKycStore?: KycStore;
};

function getStore(): KycStore {
  const g = globalThis as GlobalWithKycStore;
  if (!g.__jsaviorKycStore) {
    g.__jsaviorKycStore = new Map<string, KycSubmission>();
  }
  return g.__jsaviorKycStore;
}

export function normalizeWallet(wallet: string): string {
  return String(wallet || '').trim().toLowerCase();
}

export function getKyc(wallet: string): KycSubmission | null {
  const key = normalizeWallet(wallet);
  if (!key) return null;
  return getStore().get(key) || null;
}

export function getKycByReference(reference: string): KycSubmission | null {
  const ref = String(reference || '').trim();
  if (!ref) return null;

  for (const entry of getStore().values()) {
    if (entry.reference === ref) return entry;
  }

  return null;
}

export function getKycDocumentByReference(reference: string, kind: KycDocumentKind): KycDocument | null {
  const entry = getKycByReference(reference);
  if (!entry) return null;
  return entry[kind] || null;
}

function maskAccount(v: string): string {
  const s = String(v || '').trim();
  if (s.length <= 4) return s;
  return `${'*'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

export function toPublicKyc(entry: KycSubmission): KycSubmissionPublic {
  return {
    wallet: entry.wallet,
    fullName: entry.fullName,
    email: entry.email,
    mobileNo: entry.mobileNo,
    bankAccountName: entry.bankAccountName,
    bankName: entry.bankName,
    maskedAccountNumber: maskAccount(entry.bankAccountNumber),
    bankIfscSwift: entry.bankIfscSwift,
    bankBranch: entry.bankBranch,
    status: entry.status,
    reference: entry.reference,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    hasIdFront: Boolean(entry.idFront?.base64),
    hasIdBack: Boolean(entry.idBack?.base64),
    hasPan: Boolean(entry.pan?.base64),
    hasBankStatement: Boolean(entry.bankStatement?.base64),
    idFrontName: entry.idFront?.name || '',
    idBackName: entry.idBack?.name || '',
    panName: entry.pan?.name || '',
    bankStatementName: entry.bankStatement?.name || '',
  };
}

export function upsertKyc(input: Omit<KycSubmission, 'createdAt' | 'updatedAt' | 'reference' | 'status'>): KycSubmission {
  const key = normalizeWallet(input.wallet);
  const store = getStore();
  const existing = store.get(key);
  const now = new Date().toISOString();

  const next: KycSubmission = {
    wallet: key,
    fullName: input.fullName,
    email: input.email,
    mobileNo: input.mobileNo,
    bankAccountName: input.bankAccountName,
    bankName: input.bankName,
    bankAccountNumber: input.bankAccountNumber,
    bankIfscSwift: input.bankIfscSwift,
    bankBranch: input.bankBranch,
    idFront: input.idFront,
    idBack: input.idBack,
    pan: input.pan,
    bankStatement: input.bankStatement,
    status: existing?.status ?? 'pending',
    reference: existing?.reference ?? `KYC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  store.set(key, next);
  return next;
}

export function listKyc(status?: KycStatus): KycSubmission[] {
  const entries = [...getStore().values()];
  const filtered = status ? entries.filter((entry) => entry.status === status) : entries;
  return filtered.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function setKycStatus(reference: string, status: KycStatus): KycSubmission | null {
  const ref = String(reference || '').trim();
  if (!ref) return null;

  const store = getStore();
  for (const [wallet, entry] of store.entries()) {
    if (entry.reference !== ref) continue;

    const next: KycSubmission = {
      ...entry,
      status,
      updatedAt: new Date().toISOString(),
    };

    store.set(wallet, next);
    return next;
  }

  return null;
}
