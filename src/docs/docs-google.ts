import { BadRequestException } from '@nestjs/common';
import { exchangeGoogleCode, googleAuthUrl, googleConfig, googleProfile, refreshGoogleAccess } from '../mail/mail-google.js';

const SHEETS_SCOPE = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

export function sheetsRedirectUri() {
  return process.env.GOOGLE_SHEETS_REDIRECT_URI?.trim() || 'http://localhost:3010/api/docs/google/callback';
}

export function sheetsAuthUrl(state: string) {
  return googleAuthUrl(state, { scope: SHEETS_SCOPE, redirectUri: sheetsRedirectUri() });
}

export async function exchangeSheetsCode(code: string) {
  return exchangeGoogleCode(code, sheetsRedirectUri());
}

export { googleProfile, refreshGoogleAccess };

export async function createSpreadsheet(accessToken: string, title: string) {
  const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
    }),
  });
  const body = (await response.json()) as { spreadsheetId?: string; spreadsheetUrl?: string; error?: { message?: string } };
  if (!response.ok || !body.spreadsheetId) {
    throw new BadRequestException(body.error?.message || 'Không tạo được Google Sheet.');
  }
  return {
    googleId: body.spreadsheetId,
    googleUrl: body.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${body.spreadsheetId}/edit`,
  };
}

export function googleReady() {
  try {
    googleConfig();
    return true;
  } catch {
    return false;
  }
}
