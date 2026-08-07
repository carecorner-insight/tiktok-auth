import type { Platform } from './state';

export interface NormalizedMessage {
  platform: Platform;
  userId: string;
  text: string;
  timestamp: number;
  raw: unknown;
  // TikTok requires a separate conversationId to send replies; undefined for Telegram
  conversationId?: string;
  // Platform-native message ID used for idempotency dedup in the webhook handler
  messageId?: string;
  // Telegram @handle, when the user has one — many do not. Logged so staff can
  // identify a flagged user in the daily safety report (F4). The numeric userId
  // remains the stable identifier; this is a convenience label only, and it can
  // change at any time because users may edit their handle.
  username?: string;
}

export interface IPlatformAdapter {
  readonly platform: Platform;

  normalizeMessage(raw: unknown): NormalizedMessage;
  // conversationId is required by TikTok, ignored by Telegram
  sendMessage(userId: string, text: string, conversationId?: string): Promise<void>;
  sendTypingIndicator(userId: string): Promise<void>;
}
