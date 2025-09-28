// poster.ts

import { Bot } from "grammy";

type SendPostParams = {
  channelId: string | number;
  text: string;
  photos?: string[];
};

// Лимиты Telegram
const CAPTION_LIMIT = 1024;   // max caption per media
const MESSAGE_LIMIT = 4096;   // max length of a normal message

export class Poster {
  raw: Bot;
  private queue: Array<() => Promise<void>> = [];
  private working = false;
  private delayMs = 4000; // пауза между постами

  constructor(token: string) {
    this.raw = new Bot(token);
  }

  // Разбивает большой текст на куски <= limit
  private splitText(text: string, limit: number): string[] {
    if (!text) return [];
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + limit));
      i += limit;
    }
    return chunks;
  }

  private async processQueue() {
    if (this.working) return;
    this.working = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) continue;

      try {
        await task();
        // пауза после каждой успешной отправки
        await new Promise(r => setTimeout(r, this.delayMs));
      } catch (err: any) {
        if (err.parameters?.retry_after) {
          const wait = (err.parameters.retry_after + 1) * 1000;
          console.log(`[Poster] Rate limited. Waiting ${wait / 1000}s...`);
          await new Promise(r => setTimeout(r, wait));
          // пробуем снова (ставим задачу обратно в очередь)
          this.queue.unshift(task);
        } else {
          console.error("[Poster] Error sending post:", err.message || err);
        }
      }
    }

    this.working = false;
  }

  async sendPost({ channelId, text, photos = [] }: SendPostParams) {
    this.queue.push(async () => {
      text = (text || '').trim();

      // 1) ТОЛЬКО ТЕКСТ
      if (!photos.length) {
        const chunks = this.splitText(text, MESSAGE_LIMIT);
        for (const chunk of chunks) {
          await this.raw.api.sendMessage(channelId, chunk);
        }
        return;
      }

      // 2) ОДНА ФОТО
      if (photos.length === 1) {
        const caption = text.slice(0, CAPTION_LIMIT);
        const remaining = text.slice(caption.length).trim();
        
        try {
          await this.raw.api.sendPhoto(channelId, photos[0], { caption });
        } catch (err: any) {
          console.error('Error sending photo, sending as text:', err.message);
          await this.raw.api.sendMessage(channelId, text);
        }
        
        if (remaining) {
          const more = this.splitText(remaining, MESSAGE_LIMIT);
          for (const chunk of more) await this.raw.api.sendMessage(channelId, chunk);
        }
        return;
      }

      // 3) МНОГО ФОТО - ДОБАВЛЕНА ОБРАБОТКА ОШИБОК
      const caption = text.slice(0, CAPTION_LIMIT);
      const remaining = text.slice(caption.length).trim();

      const media = photos.slice(0, 10).map((url, idx) => ({
        type: "photo" as const,
        media: url,
        caption: idx === 0 ? caption : undefined,
      }));

      // ⭐ ДОБАВЛЕН TRY-CATCH ДЛЯ sendMediaGroup
      try {
        await this.raw.api.sendMediaGroup(channelId, media);
      } catch (err: any) {
        console.error('Error sending media group, sending as text:', err.message);
        // Fallback: отправить как текст
        await this.raw.api.sendMessage(channelId, text);
        return; // выходим, так как уже отправили текст
      }

      if (remaining) {
        const more = this.splitText(remaining, MESSAGE_LIMIT);
        for (const chunk of more) await this.raw.api.sendMessage(channelId, chunk);
      }
    });

    this.processQueue();
  }
}