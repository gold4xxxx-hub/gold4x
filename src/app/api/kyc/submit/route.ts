import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { toPublicKyc, upsertKyc } from '@/lib/kycStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024;

function reqField(value: FormDataEntryValue | null, label: string): string {
  const v = String(value || '').trim();
  if (!v) {
    throw new Error(`${label} is required`);
  }
  return v;
}

async function reqFile(form: FormData, field: string, label: string) {
  const value = form.get(field);
  if (!(value instanceof File) || value.size <= 0) {
    throw new Error(`${label} is required`);
  }
  if (value.size > MAX_DOCUMENT_SIZE) {
    throw new Error(`${label} is too large (max 5 MB)`);
  }

  return {
    name: String(value.name || `${field}.bin`),
    mimeType: String(value.type || 'application/octet-stream'),
    sizeBytes: Number(value.size || 0),
    base64: Buffer.from(await value.arrayBuffer()).toString('base64'),
  };
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();

    const wallet = reqField(form.get('wallet'), 'Wallet');
    if (!ethers.isAddress(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    const fullName = reqField(form.get('fullName'), 'Full name');
    const email = reqField(form.get('email'), 'Email');
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }
    const mobileNo = reqField(form.get('mobileNo'), 'Mobile number');
    const bankAccountName = reqField(form.get('bankAccountName'), 'Account holder name');
    const bankName = reqField(form.get('bankName'), 'Bank name');
    const bankAccountNumber = reqField(form.get('bankAccountNumber'), 'Account number');
    const bankIfscSwift = reqField(form.get('bankIfscSwift'), 'IFSC / SWIFT code');
    const bankBranch = reqField(form.get('bankBranch'), 'Branch name');
    const idFront = await reqFile(form, 'idFrontFile', 'ID front file');
    const idBack = await reqFile(form, 'idBackFile', 'ID back file');
    const pan = await reqFile(form, 'panFile', 'PAN file');
    const bankStatement = await reqFile(form, 'bankStatementFile', 'Bank statement file');

    const record = upsertKyc({
      wallet,
      fullName,
      email,
      mobileNo,
      bankAccountName,
      bankName,
      bankAccountNumber,
      bankIfscSwift,
      bankBranch,
      idFront,
      idBack,
      pan,
      bankStatement,
    });

    return NextResponse.json({ ok: true, record: toPublicKyc(record) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to submit KYC' },
      { status: 400 },
    );
  }
}
