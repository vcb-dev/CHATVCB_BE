import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';

const AVATAR_TYPES: Record<string, true> = {
  'image/jpeg': true,
  'image/png': true,
  'image/gif': true,
  'image/webp': true,
};

type PublicUser = {
  id: string;
  name: string;
  email: string;
  team: string;
  avatarUrl: string;
  createdAt?: Date;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async register(dto: RegisterDto) {
    const email = this.resolveEmail(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('Email đã được sử dụng');
    }
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        team: this.normalizeTeam(dto.team),
        passwordHash: await bcrypt.hash(dto.password, 10),
      },
    });
    await this.prisma.syncTeamMemberships(user.id, user.team);
    return this.issue(user);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: this.requireUserId(userId) },
      select: {
        id: true,
        name: true,
        email: true,
        team: true,
        avatarUrl: true,
        createdAt: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException('Không tìm thấy tài khoản');
    }
    return this.toPublic(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const id = this.requireUserId(userId);
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        team: true,
        avatarUrl: true,
        createdAt: true,
        passwordHash: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException('Không tìm thấy tài khoản');
    }

    const name = dto.name?.trim();
    const email = dto.email ? this.resolveEmail(dto.email) : undefined;
    const password = dto.password?.trim();
    const currentPassword = dto.currentPassword?.trim();

    const nextName = name && name !== user.name ? name : undefined;
    const nextEmail = email && email !== user.email ? email : undefined;

    if (!nextName && !nextEmail && !password) {
      throw new BadRequestException('Không có thông tin nào để cập nhật');
    }

    if (nextEmail) {
      const taken = await this.prisma.user.findFirst({
        where: { email: nextEmail, NOT: { id: user.id } },
        select: { id: true },
      });
      if (taken) {
        throw new BadRequestException('Email đã được sử dụng');
      }
    }

    if (password) {
      if (!currentPassword) {
        throw new BadRequestException('Nhập mật khẩu hiện tại để đổi mật khẩu');
      }
      if (!user.passwordHash) {
        throw new BadRequestException('Tài khoản chưa có mật khẩu hợp lệ.');
      }
      const ok = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!ok) {
        throw new UnauthorizedException('Mật khẩu hiện tại không đúng');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(nextName ? { name: nextName } : {}),
        ...(nextEmail ? { email: nextEmail } : {}),
        ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        team: true,
        avatarUrl: true,
        createdAt: true,
      },
    });
    const issued = await this.issue(updated);
    return { token: issued.token, user: this.toPublic(updated) };
  }

  async uploadAvatar(userId: string, file: Express.Multer.File | undefined) {
    const id = this.requireUserId(userId);
    if (!file?.buffer?.length) {
      throw new BadRequestException('Chưa chọn ảnh.');
    }
    if (!AVATAR_TYPES[file.mimetype]) {
      throw new BadRequestException('Chỉ nhận ảnh JPG, PNG, GIF, WebP.');
    }
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) {
      throw new UnauthorizedException('Không tìm thấy tài khoản');
    }
    const uploaded = await this.cloudinary.uploadAvatarBuffer(file.buffer, `user-${user.id}`);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: uploaded.url },
      select: {
        id: true,
        name: true,
        email: true,
        team: true,
        avatarUrl: true,
        createdAt: true,
      },
    });
    const issued = await this.issue(updated);
    return { token: issued.token, user: this.toPublic(updated) };
  }

  async login(dto: LoginDto) {
    const email = this.resolveEmail(dto.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        team: true,
        avatarUrl: true,
        isActive: true,
        passwordHash: true,
      },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Tài khoản hoặc mật khẩu không đúng');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Tài khoản đã bị khóa');
    }
    void this.rehashIfNeeded(user.id, dto.password, user.passwordHash);
    return this.issue(user);
  }

  private async rehashIfNeeded(id: string, password: string, hash: string) {
    if (!id || bcrypt.getRounds(hash) <= 10) {
      return;
    }
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(password, 10) },
    });
  }

  private requireUserId(userId: string) {
    const id = userId?.trim();
    if (!id) {
      throw new UnauthorizedException('Thiếu thông tin tài khoản');
    }
    return id;
  }

  private resolveEmail(input: string) {
    const trimmed = input.trim().toLowerCase();
    if (trimmed.includes('@')) {
      return trimmed;
    }
    return `${trimmed}@chatvcb.vn`;
  }

  private normalizeTeam(team?: string) {
    const value = team?.trim().toLowerCase();
    return value || 'sale';
  }

  private toPublic(user: {
    id: string;
    name: string;
    email: string;
    team: string;
    avatarUrl?: string | null;
    createdAt?: Date;
  }): PublicUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      team: user.team,
      avatarUrl: user.avatarUrl || '',
      createdAt: user.createdAt,
    };
  }

  private async issue(user: {
    id: string;
    name: string;
    email: string;
    team: string;
    avatarUrl?: string | null;
    createdAt?: Date;
  }) {
    const token = await this.jwt.signAsync({
      sub: user.id,
      name: user.name,
      email: user.email,
      team: user.team,
    });
    return {
      token,
      user: this.toPublic(user),
    };
  }
}
