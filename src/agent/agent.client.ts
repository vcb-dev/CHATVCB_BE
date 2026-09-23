import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type AgentHistoryItem = {
  role: string;
  authorName: string;
  content: string;
};

export type AgentJob = {
  roomId: string;
  messageId: string;
  userId: string;
  userName: string;
  agentName: string;
  content: string;
  history: AgentHistoryItem[];
};

@Injectable()
export class AgentClientService {
  private readonly logger = new Logger(AgentClientService.name);

  constructor(private readonly config: ConfigService) {}

  async invoke(job: AgentJob): Promise<string> {
    const baseUrl = this.config.get<string>('AGENT_URL');
    if (!baseUrl) {
      throw new Error('AGENT_URL chưa cấu hình');
    }
    const response = await fetch(`${baseUrl}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`Agent HTTP ${response.status}: ${text}`);
      throw new Error(`Agent lỗi ${response.status}`);
    }
    const data = (await response.json()) as { content?: string };
    if (!data.content) {
      throw new Error('Agent không trả nội dung');
    }
    return data.content;
  }
}
