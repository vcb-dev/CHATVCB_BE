import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { decryptSecret, encryptSecret } from '../mail/mail-crypto.js';
import { frontendUrl } from '../mail/mail-google.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  createSpreadsheet,
  exchangeSheetsCode,
  googleProfile,
  googleReady,
  refreshGoogleAccess,
  sheetsAuthUrl,
} from './docs-google.js';
import { kindPreset, type DocKind } from './doc-kinds.js';

@Injectable()
export class DocsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  googleStatus(userId: string) {
    return this.prisma.googleAccount.findUnique({
      where: { userId },
      select: { email: true },
    }).then((row) => ({
      ready: googleReady(),
      connected: Boolean(row),
      email: row?.email || '',
    }));
  }

  googleStartUrl(userId: string, intent = 'connect') {
    const state = this.jwt.sign({ sub: userId, purpose: 'docs-google', intent }, { expiresIn: '15m' });
    return { url: sheetsAuthUrl(state) };
  }

  appUrl() {
    return frontendUrl();
  }

  async finishGoogle(code: string, state: string) {
    let userId = '';
    let intent = 'connect';
    try {
      const payload = this.jwt.verify<{ sub: string; purpose?: string; intent?: string }>(state);
      if (payload.purpose !== 'docs-google' || !payload.sub) {
        throw new Error('bad state');
      }
      userId = payload.sub;
      intent = payload.intent || 'connect';
    } catch {
      throw new BadRequestException('Phiên Google hết hạn. Thử lại.');
    }
    const tokens = await exchangeSheetsCode(code);
    if (!tokens.refresh_token) {
      throw new BadRequestException('Google không cấp quyền lâu dài. Cho phép quyền Sheets rồi thử lại.');
    }
    const profile = await googleProfile(tokens.access_token!);
    await this.prisma.googleAccount.upsert({
      where: { userId },
      create: { userId, email: profile.email, secret: encryptSecret(tokens.refresh_token) },
      update: { email: profile.email, secret: encryptSecret(tokens.refresh_token) },
    });
    if (intent === 'sheet') {
      return this.create(userId, (await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })).team, {
        kind: 'sheet',
      });
    }
    return null;
  }

  async list(userId: string, team: string, tab = 'recent', query = '') {
    const q = query.trim();
    const where = {
      team,
      ...(q
        ? { title: { contains: q, mode: 'insensitive' as const } }
        : {}),
      ...(tab === 'shared' ? { ownerId: { not: userId } } : {}),
      ...(tab === 'starred' ? { stars: { some: { userId } } } : {}),
    };
    const rows = await this.prisma.doc.findMany({
      where,
      select: {
        id: true,
        team: true,
        ownerId: true,
        title: true,
        kind: true,
        folder: true,
        googleId: true,
        googleUrl: true,
        createdAt: true,
        updatedAt: true,
        owner: { select: { id: true, name: true, avatarUrl: true } },
        stars: { where: { userId }, select: { userId: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 80,
    });
    return rows.map((row) => this.toPublic({ ...row, content: '' }, false));
  }

  async create(
    userId: string,
    team: string,
    input: { title?: string; kind?: DocKind; template?: 'blank' | 'meeting' | 'weekly'; content?: string },
  ) {
    const kind = input.kind || 'doc';
    const preset = kindPreset(kind, input.template);
    const title = input.title?.trim() || preset.title;
    let googleId = '';
    let googleUrl = '';
    if (kind === 'sheet') {
      const linked = await this.createGoogleSheet(userId, title);
      googleId = linked.googleId;
      googleUrl = linked.googleUrl;
    }
    const doc = await this.prisma.doc.create({
      data: {
        team,
        ownerId: userId,
        kind,
        title,
        content: input.content ?? preset.content,
        googleId,
        googleUrl,
      },
      include: {
        owner: { select: { id: true, name: true, avatarUrl: true } },
        stars: { where: { userId }, select: { userId: true } },
      },
    });
    return this.toPublic(doc);
  }

  async get(userId: string, team: string, id: string) {
    return this.toPublic(await this.ownedTeam(userId, team, id));
  }

  async update(
    userId: string,
    team: string,
    id: string,
    input: { title?: string; content?: string; folder?: string; starred?: boolean },
  ) {
    await this.ownedTeam(userId, team, id);
    if (typeof input.starred === 'boolean') {
      if (input.starred) {
        await this.prisma.docStar.upsert({
          where: { userId_docId: { userId, docId: id } },
          create: { userId, docId: id },
          update: {},
        });
      } else {
        await this.prisma.docStar.deleteMany({ where: { userId, docId: id } });
      }
    }
    const doc = await this.prisma.doc.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() || 'Tài liệu không tiêu đề' } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.folder !== undefined ? { folder: input.folder.trim() || 'Docs của tôi' } : {}),
      },
      include: {
        owner: { select: { id: true, name: true, avatarUrl: true } },
        stars: { where: { userId }, select: { userId: true } },
      },
    });
    return this.toPublic(doc);
  }

  async remove(userId: string, team: string, id: string) {
    const doc = await this.ownedTeam(userId, team, id);
    if (doc.ownerId !== userId) {
      throw new ForbiddenException('Chỉ chủ sở hữu được xóa tài liệu.');
    }
    await this.prisma.doc.delete({ where: { id } });
    return { ok: true };
  }

  private async createGoogleSheet(userId: string, title: string) {
    const account = await this.prisma.googleAccount.findUnique({ where: { userId } });
    if (!account) {
      throw new BadRequestException('GOOGLE_CONNECT');
    }
    const token = await refreshGoogleAccess(decryptSecret(account.secret));
    return createSpreadsheet(token.access_token!, title);
  }

  private async ownedTeam(userId: string, team: string, id: string) {
    const doc = await this.prisma.doc.findFirst({
      where: { id, team },
      include: {
        owner: { select: { id: true, name: true, avatarUrl: true } },
        stars: { where: { userId }, select: { userId: true } },
      },
    });
    if (!doc) {
      throw new NotFoundException('Không tìm thấy tài liệu.');
    }
    return doc;
  }

  private toPublic(
    doc: {
      id: string;
      team: string;
      ownerId: string;
      title: string;
      kind?: string;
      content?: string;
      folder: string;
      googleId?: string;
      googleUrl?: string;
      createdAt: Date;
      updatedAt: Date;
      owner: { id: string; name: string; avatarUrl: string };
      stars: { userId: string }[];
    },
    withContent = true,
  ) {
    return {
      id: doc.id,
      team: doc.team,
      ownerId: doc.ownerId,
      title: doc.title,
      kind: doc.kind || 'doc',
      content: withContent ? doc.content || '' : '',
      folder: doc.folder,
      googleId: doc.googleId || '',
      googleUrl: doc.googleUrl || '',
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      starred: doc.stars.length > 0,
      owner: doc.owner,
    };
  }
}
