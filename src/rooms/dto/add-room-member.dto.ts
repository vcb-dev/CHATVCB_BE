import { IsUUID } from "class-validator";

export class AddRoomMemberDto {
  @IsUUID()
  userId: string;
}
