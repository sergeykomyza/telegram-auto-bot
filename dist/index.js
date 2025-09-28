import 'dotenv/config';
import cron from 'node-cron';
import { z } from 'zod';
import { extractPhotoUrls, resolveGroupId, wallGet } from './vk';
import { Poster } from './poster';
import { BotDatabase } from './database';
// Инициализируем БД
const botDatabase = new BotDatabase();
const envSchema = z.object({
    TELEGRAM_BOT_TOKEN: z.string().min(10),
    CHANNEL_ID: z.string().optional(),
    CHANNEL_USERNAME: z.string().optional(),
    VK_ACCESS_TOKEN: z.string().min(10),
    VK_API_VERSION: z.string().default('5.199'),
    VK_GROUPS: z.string(),
    KEYWORDS: z.string().optional().default(''),
    EXCLUDE: z.string().optional().default(''),
    CRON: z.string().default('*/2 * * * *'),
    FETCH_COUNT: z.string().optional().default('50'),
});
const env = envSchema.parse(process.env);
// Куда постим
const channelTarget = env.CHANNEL_ID && env.CHANNEL_ID.trim() !== ''
    ? Number(env.CHANNEL_ID) || env.CHANNEL_ID
    : (env.CHANNEL_USERNAME ?? '').trim() || (() => { throw new Error('Provide CHANNEL_ID or CHANNEL_USERNAME'); })();
const groupsInput = env.VK_GROUPS.split(',').map(s => s.trim()).filter(Boolean);
const keywords = env.KEYWORDS ? env.KEYWORDS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
const excludes = env.EXCLUDE ? env.EXCLUDE.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
const fetchCount = Math.min(Math.max(parseInt(env.FETCH_COUNT || '50', 10) || 50, 1), 100);
// Безопасный запас для проверки постов
const SAFETY_MARGIN = 10;
// Ограничение для первого запуска
const FIRST_RUN_POSTS_LIMIT = 5;
const poster = new Poster(env.TELEGRAM_BOT_TOKEN);
const bot = poster.raw;
// Команды бота
bot.command('start', ctx => ctx.reply('Bot is running. Use /status or /force.'));
bot.command('status', async (ctx) => {
    let statusMessage = 'Bot status:\n';
    for (const group of groupsInput) {
        const lastPostId = botDatabase.getLastPostId(group);
        statusMessage += `${group}: last ID ${lastPostId}\n`;
    }
    await ctx.reply(statusMessage);
});
bot.command('force', async (ctx) => {
    await ctx.reply('Forcing a fetch...');
    await pollAndPost();
    await ctx.reply('Done.');
});
// Формируем текст
function buildMessage(groupName, ownerId, postId, text) {
    const url = `https://vk.com/wall${ownerId}_${postId}`;
    const clean = (text || '').trim().slice(0, 3500);
    return `#${groupName}\n${clean}\n\nИсточник: ${url}`;
}
// Проверяем, первый ли это запуск (база пустая)
function isFirstRun() {
    for (const group of groupsInput) {
        const lastPostId = botDatabase.getLastPostId(group);
        if (lastPostId > 0) {
            return false;
        }
    }
    return true;
}
// Основная логика
async function pollAndPost() {
    const firstRun = isFirstRun();
    if (firstRun) {
        console.log('=== FIRST RUN DETECTED - LIMITING TO 5 POSTS PER GROUP ===');
    }
    for (const group of groupsInput) {
        try {
            const ownerId = await resolveGroupId(group, env.VK_ACCESS_TOKEN, env.VK_API_VERSION);
            // Получаем последний ID из БД
            const lastProcessedId = botDatabase.getLastPostId(group);
            // Определяем сколько постов загружать
            let postsToLoad = fetchCount + SAFETY_MARGIN;
            if (firstRun) {
                postsToLoad = FIRST_RUN_POSTS_LIMIT + 2; // Небольшой запас для фильтрации
                console.log(`[${group}] First run - loading ${postsToLoad} posts`);
            }
            const posts = await wallGet(ownerId, postsToLoad, env.VK_ACCESS_TOKEN, env.VK_API_VERSION);
            if (!posts.length) {
                console.log(`[${group}] no posts found.`);
                continue;
            }
            // Сортируем по убыванию ID (новые первыми)
            const sortedPosts = [...posts].sort((a, b) => b.id - a.id);
            console.log(`[${group}] Last processed ID: ${lastProcessedId}, Newest post ID: ${sortedPosts[0]?.id}, Loaded: ${posts.length} posts`);
            // Фильтруем только новые посты (ID больше последнего обработанного)
            let newPosts = sortedPosts.filter(p => p.id > lastProcessedId);
            // ОГРАНИЧЕНИЕ ДЛЯ ПЕРВОГО ЗАПУСКА
            if (firstRun && newPosts.length > FIRST_RUN_POSTS_LIMIT) {
                console.log(`[${group}] First run - limiting to ${FIRST_RUN_POSTS_LIMIT} newest posts`);
                newPosts = newPosts.slice(0, FIRST_RUN_POSTS_LIMIT);
            }
            console.log(`[${group}] Found ${newPosts.length} new posts since last check`);
            if (!newPosts.length) {
                console.log(`[${group}] no new posts to process.`);
                continue;
            }
            // Сортируем новые посты по возрастанию ID (старые первыми)
            newPosts.sort((a, b) => a.id - b.id);
            for (const p of newPosts) {
                const postDate = p.date ? new Date(p.date * 1000).toISOString() : 'unknown';
                // Проверяем в БД, не обработан ли уже пост
                if (botDatabase.isPostProcessed(group, p.id)) {
                    console.log(`[${group}] post ${p.id} already processed, skipping`);
                    continue;
                }
                console.log(`[${group}] processing post ${p.id} | date: ${postDate}`);
                // Детальная проверка фильтров с логированием
                const lowText = (p.text || '').toLowerCase();
                const excludedWord = excludes.find(ex => lowText.includes(ex));
                const includedWord = keywords.length > 0 ? keywords.find(kw => lowText.includes(kw)) : null;
                if (excludedWord) {
                    console.log(`[${group}] post ${p.id} filtered out - excluded word: "${excludedWord}"`);
                    console.log(`[${group}] Post text: "${p.text?.substring(0, 100)}..."`);
                    botDatabase.markPostProcessed(group, p.id, 'filtered');
                    continue;
                }
                if (keywords.length > 0 && !includedWord) {
                    console.log(`[${group}] post ${p.id} filtered out - no keywords found`);
                    console.log(`[${group}] Post text: "${p.text?.substring(0, 100)}..."`);
                    botDatabase.markPostProcessed(group, p.id, 'filtered');
                    continue;
                }
                if (includedWord) {
                    console.log(`[${group}] post ${p.id} passed filters - found keyword: "${includedWord}"`);
                }
                else {
                    console.log(`[${group}] post ${p.id} passed filters - no keyword filter`);
                }
                const photos = extractPhotoUrls(p, 10);
                const msg = buildMessage(group, p.owner_id, p.id, p.text || '');
                let sent = false;
                let attempts = 0;
                const maxAttempts = 3;
                while (!sent && attempts < maxAttempts) {
                    try {
                        attempts++;
                        await poster.sendPost({ channelId: channelTarget, text: msg, photos });
                        sent = true;
                        // Обновляем последний ID и помечаем как отправленный
                        botDatabase.updateLastPostId(group, p.id);
                        botDatabase.markPostProcessed(group, p.id, 'posted');
                        console.log(`[${group}] successfully posted ${p.id}`);
                        await new Promise(r => setTimeout(r, 2000)); // пауза между постами
                    }
                    catch (err) {
                        console.error(`Error sending post ${p.id} (attempt ${attempts}):`, err.message || err);
                        if (err.parameters?.retry_after) {
                            const wait = (err.parameters.retry_after + 1) * 1000;
                            console.log(`[${group}] Rate limited. Waiting ${wait / 1000}s...`);
                            await new Promise(r => setTimeout(r, wait));
                        }
                        else if (attempts >= maxAttempts) {
                            console.log(`[${group}] skipping post ${p.id} after ${maxAttempts} failed attempts`);
                            botDatabase.markPostProcessed(group, p.id, 'error');
                            break;
                        }
                    }
                }
            }
        }
        catch (e) {
            console.error('Error for group', group, e);
        }
    }
    // Периодическая очистка старых записей
    botDatabase.cleanupOldRecords();
}
// Cron
cron.schedule(env.CRON, async () => {
    console.log('Cron tick -> polling VK...');
    await pollAndPost();
}, { timezone: 'Europe/Berlin' });
// Обработка завершения процесса
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    botDatabase.close();
    process.exit(0);
});
process.on('SIGTERM', () => {
    console.log('Shutting down gracefully...');
    botDatabase.close();
    process.exit(0);
});
// Один запуск сразу
console.log('Starting initial poll...');
pollAndPost().catch(console.error);
// Запуск бота
bot.start();
console.log('Bot started successfully!');
//# sourceMappingURL=index.js.map