import { IsBoolean, IsOptional } from 'class-validator';

export class PinMessageDto {
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}
