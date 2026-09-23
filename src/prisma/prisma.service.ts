import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const SEED_ROOMS = [
  { slug: 'sale', name: 'Sale', team: 'sale', agentName: 'SalesAgent' },
  { slug: 'kho', name: 'Kho', team: 'kho', agentName: 'WarehouseAgent' },
];

const SEED_USERS = [
  {
    email: 'sale1@chatvcb.vn',
    name: 'Sale Một',
    password: 'Password123',
    team: 'sale',
  },
  {
    email: 'sale2@chatvcb.vn',
    name: 'Sale Hai',
    password: 'Password123',
    team: 'sale',
  },
];

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    try {
      await this.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS chatvcb');
    } catch {
      this.logger.warn('Skip CREATE SCHEMA on pooler');
    }
    await this.seedRooms();
    await this.seedUsers();
  }

  private async seedRooms() {
    const legacySales = await this.room.findUnique({ where: { slug: 'sales' } });
    if (legacySales) {
      await this.room.update({
        where: { id: legacySales.id },
        data: {
          slug: 'sale',
          name: 'Sale',
          team: 'sale',
          agentName: 'SalesAgent',
        },
      });
    }

    for (const room of SEED_ROOMS) {
      await this.room.upsert({
        where: { slug: room.slug },
        update: {
          name: room.name,
          team: room.team,
          agentName: room.agentName,
        },
        create: room,
      });
    }
  }

  private async seedUsers() {
    for (const item of SEED_USERS) {
      const passwordHash = await bcrypt.hash(item.password, 12);
      const user = await this.user.upsert({
        where: { email: item.email },
        update: { name: item.name, team: item.team },
        create: {
          email: item.email,
          name: item.name,
          team: item.team,
          passwordHash,
        },
      });
      await this.syncTeamMemberships(user.id, user.team);
    }
    this.logger.log('Seeded team sale and test users sale1 / sale2');
  }

  async syncTeamMemberships(userId: string, team: string) {
    const rooms = await this.room.findMany({ where: { team } });
    for (const room of rooms) {
      await this.roomMember.upsert({
        where: { roomId_userId: { roomId: room.id, userId } },
        update: {},
        create: { roomId: room.id, userId },
      });
    }
    await this.roomMember.deleteMany({
      where: {
        userId,
        room: { team: { not: team } },
      },
    });
  }
}
