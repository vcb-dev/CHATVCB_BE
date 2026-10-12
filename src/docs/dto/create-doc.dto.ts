import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DOC_KINDS } from '../doc-kinds.js';

export class CreateDocDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsIn([...DOC_KINDS])
  kind?: (typeof DOC_KINDS)[number];

  @IsOptional()
  @IsIn(['blank', 'meeting', 'weekly'])
  template?: 'blank' | 'meeting' | 'weekly';

  @IsOptional()
  @IsString()
  content?: string;
}
