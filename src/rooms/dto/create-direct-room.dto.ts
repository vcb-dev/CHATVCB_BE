import { IsUUID } from "class-validator";

export class CreateDirectRoomDto {
  @IsUUID()
  userId: string;
}
