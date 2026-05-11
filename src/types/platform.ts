import type { Platform } from './state';

export interface NormalizedMessage {
  platform: Platform;
  userId: string;
  text: string;
  timestamp: number;
  raw: unknown;
  // TikTok requires a separate conversationId to send replies; undefined for Telegram
  conversationId?: string;
}

export interface IPlatformAdapter {
  readonly platform: Platform;

  normalizeMessage(raw: unknown): NormalizedMessage;
  // conversationId is required by TikTok, ignored by Telegram
  sendMessage(userId: string, text: string, conversationId?: string): Promise<void>;
  sendTypingIndicator(userId: string): Promise<void>;
}
