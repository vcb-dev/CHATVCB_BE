import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('Email đã được sử dụng');
    }
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        team: this.normalizeTeam(dto.team),
        passwordHash: await bcrypt.hash(dto.password, 12),
      },
    });
    await this.prisma.syncTeamMemberships(user.id, user.team);
    return this.issue(user);
  }

  async login(dto: LoginDto) {
    const email = this.resolveEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Tài khoản hoặc mật khẩu không đúng');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Tài khoản đã bị khóa');
    }
    await this.prisma.syncTeamMemberships(user.id, user.team);
    return this.issue(user);
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

  private async issue(user: { id: string; name: string; email: string; team: string }) {
    const token = await this.jwt.signAsync({
      sub: user.id,
      name: user.name,
      email: user.email,
      team: user.team,
    });
    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        team: user.team,
      },
    };
  }
}
