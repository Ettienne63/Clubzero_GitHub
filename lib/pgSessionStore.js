const session = require("express-session");
const { Pool } = require("pg");
const { logger } = require("./logger");

class PostgresSessionStore extends session.Store {
  constructor(options = {}) {
    super();

    this.pool = options.pool || new Pool({ connectionString: options.connectionString });
    this.schema = options.schema || "public";
    this.tableName = options.tableName || "user_sessions";
    this.ttlMs = Number.parseInt(options.ttlMs || "", 10) || 1000 * 60 * 60 * 24;
    this.tableRef = `"${this.schema}"."${this.tableName}"`;
    this.ready = this.initialize();
    this.cleanupInterval = setInterval(() => {
      this.pruneExpiredSessions().catch((error) => {
        logger.warn("session_prune_failed", { error: error.message });
      });
    }, options.cleanupIntervalMs || 1000 * 60 * 15);
    this.cleanupInterval.unref?.();
  }

  async initialize() {
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableRef} (
        sid TEXT PRIMARY KEY,
        sess JSONB NOT NULL,
        expire TIMESTAMPTZ NOT NULL
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS "${this.tableName}_expire_idx"
      ON ${this.tableRef} (expire)
    `);
  }

  getExpiration(sessionData = {}) {
    const cookieExpires = sessionData.cookie?.expires;
    if (cookieExpires) {
      return new Date(cookieExpires);
    }

    return new Date(Date.now() + this.ttlMs);
  }

  async pruneExpiredSessions() {
    await this.ready;
    await this.pool.query(`DELETE FROM ${this.tableRef} WHERE expire < NOW()`);
  }

  get(sid, callback) {
    this.ready
      .then(async () => {
        const result = await this.pool.query(
          `SELECT sess FROM ${this.tableRef} WHERE sid = $1 AND expire >= NOW()`,
          [sid],
        );

        callback(null, result.rows[0]?.sess || null);
      })
      .catch((error) => callback(error));
  }

  set(sid, sessionData, callback = () => {}) {
    this.ready
      .then(async () => {
        const expire = this.getExpiration(sessionData);
        await this.pool.query(
          `
            INSERT INTO ${this.tableRef} (sid, sess, expire)
            VALUES ($1, $2::jsonb, $3)
            ON CONFLICT (sid)
            DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire
          `,
          [sid, JSON.stringify(sessionData), expire],
        );

        callback(null);
      })
      .catch((error) => callback(error));
  }

  destroy(sid, callback = () => {}) {
    this.ready
      .then(async () => {
        await this.pool.query(`DELETE FROM ${this.tableRef} WHERE sid = $1`, [sid]);
        callback(null);
      })
      .catch((error) => callback(error));
  }

  touch(sid, sessionData, callback = () => {}) {
    this.ready
      .then(async () => {
        const expire = this.getExpiration(sessionData);
        await this.pool.query(
          `UPDATE ${this.tableRef} SET expire = $2, sess = $3::jsonb WHERE sid = $1`,
          [sid, expire, JSON.stringify(sessionData)],
        );
        callback(null);
      })
      .catch((error) => callback(error));
  }
}

module.exports = { PostgresSessionStore };
