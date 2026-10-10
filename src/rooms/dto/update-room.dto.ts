import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;
}
