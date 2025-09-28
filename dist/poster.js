// poster.ts
import { Bot } from "grammy";
// Лимиты Telegram
const CAPTION_LIMIT = 1024; // max caption per media
const MESSAGE_LIMIT = 4096; // max length of a normal message
export class Poster {
    raw;
    queue = [];
    working = false;
    delayMs = 4000; // пауза между постами
    constructor(token) {
        this.raw = new Bot(token);
    }
    // Разбивает большой текст на куски <= limit
    splitText(text, limit) {
        if (!text)
            return [];
        const chunks = [];
        let i = 0;
        while (i < text.length) {
            chunks.push(text.slice(i, i + limit));
            i += limit;
        }
        return chunks;
    }
    async processQueue() {
        if (this.working)
            return;
        this.working = true;
        while (this.queue.length > 0) {
            const task = this.queue.shift();
            if (!task)
                continue;
            try {
                await task();
                // пауза после каждой успешной отправки
                await new Promise(r => setTimeout(r, this.delayMs));
            }
            catch (err) {
                if (err.parameters?.retry_after) {
                    const wait = (err.parameters.retry_after + 1) * 1000;
                    console.log(`[Poster] Rate limited. Waiting ${wait / 1000}s...`);
                    await new Promise(r => setTimeout(r, wait));
                    // пробуем снова (ставим задачу обратно в очередь)
                    this.queue.unshift(task);
                }
                else {
                    console.error("[Poster] Error sending post:", err.message || err);
                }
            }
        }
        this.working = false;
    }
    async sendPost({ channelId, text, photos = [] }) {
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
                await this.raw.api.sendPhoto(channelId, photos[0], { caption });
                if (remaining) {
                    const more = this.splitText(remaining, MESSAGE_LIMIT);
                    for (const chunk of more)
                        await this.raw.api.sendMessage(channelId, chunk);
                }
                return;
            }
            // 3) МНОГО ФОТО
            const caption = text.slice(0, CAPTION_LIMIT);
            const remaining = text.slice(caption.length).trim();
            const media = photos.slice(0, 10).map((url, idx) => ({
                type: "photo",
                media: url,
                caption: idx === 0 ? caption : undefined,
            }));
            await this.raw.api.sendMediaGroup(channelId, media);
            if (remaining) {
                const more = this.splitText(remaining, MESSAGE_LIMIT);
                for (const chunk of more)
                    await this.raw.api.sendMessage(channelId, chunk);
            }
        });
        this.processQueue();
    }
}
//# sourceMappingURL=poster.js.map