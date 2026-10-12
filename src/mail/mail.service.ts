import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { PrismaService } from '../prisma/prisma.service.js';
import { decryptSecret, encryptSecret } from './mail-crypto.js';
import {
  exchangeGoogleCode,
  gmailInbox,
  gmailMessage,
  frontendUrl,
  googleAuthUrl,
  googleProfile,
  refreshGoogleAccess,
} from './mail-google.js';

function guessImap(email: string) {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (['gmail.com', 'googlemail.com'].includes(domain)) {
    return { host: 'imap.gmail.com', port: 993 };
  }
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(domain) || domain.endsWith('.onmicrosoft.com')) {
    return { host: 'outlook.office365.com', port: 993 };
  }
  if (domain === 'yahoo.com' || domain.endsWith('.yahoo.com')) {
    return { host: 'imap.mail.yahoo.com', port: 993 };
  }
  return { host: `imap.${domain}`, port: 993 };
}

function address(value?: { name?: string; address?: string } | null) {
  if (!value) {
    return '';
  }
  return value.name && value.address ? `${value.name} <${value.address}>` : value.address || value.name || '';
}

function isoDate(value?: Date | string | null) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function addressText(value: unknown): string {
  if (!value) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => addressText(item)).filter(Boolean).join(', ');
  }
  if (typeof value === 'object' && value && 'text' in value) {
    return String((value as { text?: string }).text || '');
  }
  return '';
}

type TokenCache = { token: string; exp: number };

@Injectable()
export class MailService {
  private readonly googleTokens = new Map<string, TokenCache>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  listAccounts(userId: string) {
    return this.prisma.mailAccount.findMany({
      where: { userId },
      select: {
        id: true,
        email: true,
        provider: true,
        imapHost: true,
        imapPort: true,
        displayName: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  googleStartUrl(userId: string) {
    const state = this.jwt.sign({ sub: userId, purpose: 'mail-google' }, { expiresIn: '10m' });
    return { url: googleAuthUrl(state) };
  }

  appUrl() {
    return frontendUrl();
  }

  async finishGoogle(code: string, state: string) {
    let userId = '';
    try {
      const payload = this.jwt.verify<{ sub: string; purpose?: string }>(state);
      if (payload.purpose !== 'mail-google' || !payload.sub) {
        throw new Error('bad state');
      }
      userId = payload.sub;
    } catch {
      throw new BadRequestException('Phiên Google hết hạn. Thử đăng nhập lại.');
    }
    const tokens = await exchangeGoogleCode(code);
    if (!tokens.refresh_token) {
      throw new BadRequestException('Google không cấp quyền lâu dài. Chọn tài khoản rồi cho phép quyền Gmail.');
    }
    const profile = await googleProfile(tokens.access_token!);
    const account = await this.prisma.mailAccount.upsert({
      where: { userId_email: { userId, email: profile.email } },
      create: {
        userId,
        email: profile.email,
        provider: 'google',
        imapHost: 'gmail.googleapis.com',
        imapPort: 443,
        secret: encryptSecret(tokens.refresh_token),
        displayName: profile.name,
      },
      update: {
        provider: 'google',
        imapHost: 'gmail.googleapis.com',
        imapPort: 443,
        secret: encryptSecret(tokens.refresh_token),
        displayName: profile.name,
      },
    });
    this.googleTokens.set(account.id, {
      token: tokens.access_token!,
      exp: Date.now() + (tokens.expires_in || 3600) * 1000,
    });
    return account;
  }

  async connect(userId: string, input: {
    email: string;
    password: string;
    imapHost?: string;
    imapPort?: number;
    displayName?: string;
  }) {
    const email = input.email.trim().toLowerCase();
    const guessed = guessImap(email);
    const domain = email.split('@')[1] || '';
    const hosts = input.imapHost
      ? [input.imapHost.trim()]
      : [guessed.host, `mail.${domain}`, `imap.${domain}`, 'imap.gmail.com', 'outlook.office365.com'];
    const port = input.imapPort || guessed.port;
    let lastError = 'Không kết nối được IMAP.';
    for (const host of [...new Set(hosts.filter(Boolean))]) {
      try {
        await this.withClient(host, port, email, input.password, async (client) => {
          await client.status('INBOX', { messages: true });
        });
        const account = await this.prisma.mailAccount.upsert({
          where: { userId_email: { userId, email } },
          create: {
            userId,
            email,
            imapHost: host,
            imapPort: port,
            secret: encryptSecret(input.password),
            displayName: input.displayName?.trim() || email,
          },
          update: {
            imapHost: host,
            imapPort: port,
            secret: encryptSecret(input.password),
            displayName: input.displayName?.trim() || email,
          },
          select: { id: true, email: true, imapHost: true, imapPort: true, displayName: true, createdAt: true },
        });
        return account;
      } catch (err) {
        lastError = err instanceof Error ? err.message : lastError;
        if (/auth|login|credentials|invalid/i.test(lastError)) {
          throw new BadRequestException('Sai email hoặc mật khẩu IMAP. Gmail cần mật khẩu ứng dụng.');
        }
      }
    }
    throw new BadRequestException(
      `${lastError} Gmail cần mật khẩu ứng dụng. Domain riêng hãy nhập IMAP host (ví dụ imap.vienchibao.com).`,
    );
  }

  async remove(userId: string, id: string) {
    await this.owned(userId, id);
    await this.prisma.mailAccount.delete({ where: { id } });
    return { ok: true };
  }

  async inbox(userId: string, id: string, limit = 40) {
    const account = await this.owned(userId, id);
    if (account.provider === 'google') {
      return gmailInbox(await this.googleAccess(account), limit);
    }
    return this.withAccount(account, async (client) => {
      const box = await client.mailboxOpen('INBOX');
      const total = box.exists || 0;
      if (!total) {
        return { total, items: [] };
      }
      const from = Math.max(1, total - Math.max(1, Math.min(limit, 80)) + 1);
      const items: {
        uid: string;
        subject: string;
        from: string;
        date: string | null;
        seen: boolean;
      }[] = [];
      for await (const message of client.fetch(`${from}:${total}`, { envelope: true, flags: true, uid: true })) {
        items.push({
          uid: String(message.uid),
          subject: message.envelope?.subject || '(Không tiêu đề)',
          from: address(message.envelope?.from?.[0]),
          date: isoDate(message.envelope?.date),
          seen: [...(message.flags || [])].includes('\\Seen'),
        });
      }
      items.reverse();
      return { total, items };
    });
  }

  async message(userId: string, id: string, uid: string) {
    const account = await this.owned(userId, id);
    if (account.provider === 'google') {
      return gmailMessage(await this.googleAccess(account), uid);
    }
    return this.withAccount(account, async (client) => {
      await client.mailboxOpen('INBOX');
      const raw = await client.fetchOne(uid, { source: true, envelope: true, uid: true }, { uid: true });
      if (!raw || !raw.source) {
        throw new NotFoundException('Không tìm thấy thư.');
      }
      const parsed = await simpleParser(raw.source);
      return {
        uid: String(uid),
        subject: parsed.subject || '(Không tiêu đề)',
        from: parsed.from?.text || '',
        to: addressText(parsed.to),
        date: isoDate(parsed.date),
        text: parsed.text || '',
        html: typeof parsed.html === 'string' ? parsed.html : '',
      };
    });
  }

  private async googleAccess(account: { id: string; secret: string }) {
    const cached = this.googleTokens.get(account.id);
    if (cached && cached.exp > Date.now() + 30_000) {
      return cached.token;
    }
    const next = await refreshGoogleAccess(decryptSecret(account.secret));
    this.googleTokens.set(account.id, {
      token: next.access_token!,
      exp: Date.now() + (next.expires_in || 3600) * 1000,
    });
    return next.access_token!;
  }

  private async owned(userId: string, id: string) {
    const account = await this.prisma.mailAccount.findFirst({ where: { id, userId } });
    if (!account) {
      throw new NotFoundException('Chưa liên kết hộp thư này.');
    }
    return account;
  }

  private async withAccount<T>(
    account: { email: string; imapHost: string; imapPort: number; secret: string },
    work: (client: ImapFlow) => Promise<T>,
  ) {
    return this.withClient(account.imapHost, account.imapPort, account.email, decryptSecret(account.secret), work);
  }

  private async withClient<T>(
    host: string,
    port: number,
    user: string,
    pass: string,
    work: (client: ImapFlow) => Promise<T>,
  ) {
    const client = new ImapFlow({
      host,
      port,
      secure: true,
      auth: { user, pass },
      logger: false,
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
    });
    try {
      await client.connect();
      return await work(client);
    } finally {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }
  }
}
