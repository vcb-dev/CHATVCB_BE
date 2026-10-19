import { IsIn, IsString } from "class-validator";

export const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"] as const;

export class ReactMessageDto {
  @IsString()
  @IsIn(REACTION_EMOJIS)
  emoji!: string;
}
