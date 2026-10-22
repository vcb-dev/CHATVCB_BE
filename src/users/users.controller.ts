import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { actorId, type JwtPayload } from "../auth/jwt-payload.js";
import { UsersService } from "./users.service.js";

@Controller("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload, @Query("q") q?: string) {
    return this.users.search(actorId(user), q);
  }

  @Get(":id")
  one(@Param("id", ParseUUIDPipe) id: string) {
    return this.users.findPublic(id);
  }
}
