// database.ts
import Database from 'better-sqlite3';
import path from 'path';
export class BotDatabase {
    db;
    constructor() {
        // Создаем папку data если ее нет
        const dataDir = path.join(process.cwd(), 'data');
        const dbPath = path.join(dataDir, 'bot.db');
        this.db = new Database(dbPath);
        this.initTables();
    }
    initTables() {
        // Таблица для групп
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vk_name TEXT NOT NULL UNIQUE,
        last_post_id INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
        // Таблица для обработанных постов
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER,
        post_id INTEGER NOT NULL,
        status TEXT NOT NULL, -- 'posted', 'filtered', 'error'
        processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES groups (id),
        UNIQUE(group_id, post_id)
      )
    `);
        // Индекс для быстрого поиска
        this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_processed_posts 
      ON processed_posts(group_id, post_id)
    `);
    }
    // Получаем или создаем группу
    getOrCreateGroup(vkName) {
        const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO groups (vk_name) VALUES (?)
    `);
        stmt.run(vkName);
        const group = this.db.prepare(`
      SELECT * FROM groups WHERE vk_name = ?
    `).get(vkName);
        return group;
    }
    // Получаем последний ID для группы
    getLastPostId(vkName) {
        const group = this.db.prepare(`
      SELECT last_post_id FROM groups WHERE vk_name = ?
    `).get(vkName);
        return group ? group.last_post_id : 0;
    }
    // Обновляем последний ID для группы
    updateLastPostId(vkName, postId) {
        const stmt = this.db.prepare(`
      UPDATE groups SET last_post_id = ? WHERE vk_name = ?
    `);
        stmt.run(postId, vkName);
    }
    // Проверяем, обработан ли пост
    isPostProcessed(vkName, postId) {
        const stmt = this.db.prepare(`
      SELECT 1 FROM processed_posts 
      WHERE group_id = (SELECT id FROM groups WHERE vk_name = ?) 
      AND post_id = ?
    `);
        const result = stmt.get(vkName, postId);
        return !!result;
    }
    // Помечаем пост как обработанный
    markPostProcessed(vkName, postId, status) {
        const group = this.getOrCreateGroup(vkName);
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO processed_posts (group_id, post_id, status)
      VALUES (?, ?, ?)
    `);
        stmt.run(group.id, postId, status);
    }
    // Очищаем старые записи (старше 30 дней)
    cleanupOldRecords() {
        const stmt = this.db.prepare(`
      DELETE FROM processed_posts 
      WHERE processed_at < datetime('now', '-30 days')
    `);
        stmt.run();
    }
    // Закрываем соединение
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=database.js.map