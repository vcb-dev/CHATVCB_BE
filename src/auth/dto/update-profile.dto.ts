import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

function emptyToUndef({ value }: { value: unknown }) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export class UpdateProfileDto {
  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(120)
  email?: string;

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MinLength(6)
  @MaxLength(50)
  password?: string;

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  currentPassword?: string;
}
