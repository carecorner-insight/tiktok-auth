import type { Platform } from './state';

export interface NormalizedMessage {
  platform: Platform;
  userId: string;
  text: string;
  timestamp: number;
  raw: unknown;
}

export interface IPlatformAdapter {
  readonly platform: Platform;

  normalizeMessage(raw: unknown): NormalizedMessage;
  sendMessage(userId: string, text: string): Promise<void>;
  sendTypingIndicator(userId: string): Promise<void>;
}
