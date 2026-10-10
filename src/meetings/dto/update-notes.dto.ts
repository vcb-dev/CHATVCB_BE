import { IsString, MaxLength } from 'class-validator';

export class UpdateNotesDto {
  @IsString()
  @MaxLength(8000)
  notes: string;
}
