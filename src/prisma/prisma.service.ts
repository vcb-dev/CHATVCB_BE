import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const SEED_ROOMS = [
  { slug: 'sale', name: 'Team Sale', team: 'sale', agentName: 'SalesAgent' },
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
    await this.seedRooms();
    await this.seedUsers();
  }

  private async seedRooms() {
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
      const existing = await this.user.findUnique({
        where: { email: item.email },
        select: { id: true, team: true },
      });
      if (existing) {
        if (existing.team !== item.team) {
          await this.user.update({
            where: { id: existing.id },
            data: { name: item.name, team: item.team },
          });
        }
        continue;
      }
      const user = await this.user.create({
        data: {
          email: item.email,
          name: item.name,
          team: item.team,
          passwordHash: await bcrypt.hash(item.password, 10),
        },
      });
      await this.syncTeamMemberships(user.id, user.team);
    }
    this.logger.log('Seeded team sale and test users sale1 / sale2');
  }

  async syncTeamMemberships(userId: string, team: string) {
    const rooms = await this.room.findMany({
      where: { team },
      select: { id: true },
    });
    await this.roomMember.createMany({
      data: rooms.map((room) => ({ roomId: room.id, userId })),
      skipDuplicates: true,
    });
    await this.roomMember.deleteMany({
      where: {
        userId,
        room: { team: { not: team } },
      },
    });
  }
}
