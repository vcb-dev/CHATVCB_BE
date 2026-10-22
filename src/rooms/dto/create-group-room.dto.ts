import {
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateGroupRoomDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID("4", { each: true })
  memberIds: string[];
}
