import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findPublic(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        team: true,
        avatarUrl: true,
      },
    });
    if (!user) {
      throw new NotFoundException("Không tìm thấy người dùng.");
    }
    return user;
  }

  // Tìm kiếm người dùng
  search(viewerId: string, q?: string, limit = 30) {
    const term = q?.trim();
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        id: { not: viewerId },
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: "insensitive" } },
                { email: { contains: term, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      take: Math.min(limit, 50),
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        team: true,
        avatarUrl: true,
      },
    });
  }
}
