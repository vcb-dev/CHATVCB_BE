import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDocDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  folder?: string;

  @IsOptional()
  @IsBoolean()
  starred?: boolean;
}
