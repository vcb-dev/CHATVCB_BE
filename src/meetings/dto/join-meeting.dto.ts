import { IsString, Length } from 'class-validator';

export class JoinMeetingDto {
  @IsString()
  @Length(6, 12)
  code: string;
}
