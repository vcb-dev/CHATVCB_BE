import { BadRequestException } from '@nestjs/common';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SCOPE = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ');

export function frontendUrl() {
  return (process.env.APP_URL || process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
}

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || '';
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() || 'http://localhost:3010/api/mail/google/callback';
  if (!clientId || !clientSecret) {
    throw new BadRequestException(
      'Chưa cấu hình Google OAuth. Thêm GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET vào server.',
    );
  }
  return { clientId, clientSecret, redirectUri, appUrl: frontendUrl() };
}

export function googleAuthUrl(state: string, options?: { scope?: string; redirectUri?: string }) {
  const { clientId, redirectUri } = googleConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: options?.redirectUri || redirectUri,
    response_type: 'code',
    scope: options?.scope || SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH}?${params.toString()}`;
}

export async function exchangeGoogleCode(code: string, redirectUri?: string) {
  const config = googleConfig();
  const response = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri || config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new BadRequestException(body.error_description || body.error || 'Google không cấp quyền.');
  }
  return body;
}

export async function refreshGoogleAccess(refreshToken: string) {
  const { clientId, clientSecret } = googleConfig();
  const response = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new BadRequestException('Hết hạn Google. Đăng nhập lại bằng Google.');
  }
  return body;
}

export async function googleProfile(accessToken: string) {
  const response = await fetch(USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json()) as { email?: string; name?: string };
  if (!response.ok || !body.email) {
    throw new BadRequestException('Không lấy được email Google.');
  }
  return { email: body.email.toLowerCase(), name: body.name || body.email };
}

type GmailHeader = { name?: string; value?: string };
type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: GmailHeader[];
};

function header(headers: GmailHeader[] | undefined, name: string) {
  return headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

function decodePart(data?: string) {
  if (!data) {
    return '';
  }
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function collectBody(part?: GmailPart, acc = { text: '', html: '' }) {
  if (!part) {
    return acc;
  }
  if (part.mimeType === 'text/plain' && part.body?.data && !acc.text) {
    acc.text = decodePart(part.body.data);
  }
  if (part.mimeType === 'text/html' && part.body?.data && !acc.html) {
    acc.html = decodePart(part.body.data);
  }
  for (const child of part.parts || []) {
    collectBody(child, acc);
  }
  return acc;
}

async function gmailGet<T>(accessToken: string, path: string) {
  const response = await fetch(`${GMAIL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new BadRequestException('Không đọc được Gmail.');
  }
  return (await response.json()) as T;
}

export async function gmailInbox(accessToken: string, limit: number) {
  const list = await gmailGet<{ resultSizeEstimate?: number; messages?: { id: string }[] }>(
    accessToken,
    `/messages?maxResults=${Math.max(1, Math.min(limit, 80))}&labelIds=INBOX`,
  );
  const messages = list.messages || [];
  const items = await Promise.all(
    messages.map(async (item) => {
      const detail = await gmailGet<{
        id: string;
        labelIds?: string[];
        payload?: { headers?: GmailHeader[] };
        internalDate?: string;
      }>(
        accessToken,
        `/messages/${item.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      );
      const headers = detail.payload?.headers;
      const dateHeader = header(headers, 'Date');
      return {
        uid: detail.id,
        subject: header(headers, 'Subject') || '(Không tiêu đề)',
        from: header(headers, 'From'),
        date: dateHeader ? new Date(dateHeader).toISOString() : detail.internalDate
          ? new Date(Number(detail.internalDate)).toISOString()
          : null,
        seen: !(detail.labelIds || []).includes('UNREAD'),
      };
    }),
  );
  return { total: list.resultSizeEstimate || items.length, items };
}

export async function gmailMessage(accessToken: string, id: string) {
  const detail = await gmailGet<{
    id: string;
    payload?: GmailPart;
    internalDate?: string;
  }>(accessToken, `/messages/${id}?format=full`);
  const headers = detail.payload?.headers;
  const body = collectBody(detail.payload);
  const dateHeader = header(headers, 'Date');
  return {
    uid: detail.id,
    subject: header(headers, 'Subject') || '(Không tiêu đề)',
    from: header(headers, 'From'),
    to: header(headers, 'To'),
    date: dateHeader ? new Date(dateHeader).toISOString() : detail.internalDate
      ? new Date(Number(detail.internalDate)).toISOString()
      : null,
    text: body.text,
    html: body.html,
  };
}
