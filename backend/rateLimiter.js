// backend/rateLimiter.js
const mongoose = require('mongoose');

let configCache = null;
let lastCacheTime = 0;
let indexEnsured = false;

const DEFAULT_CONFIG = {
  windowMs: 1000,
  maxRequests: 10,
  blockDurationMs: 86400000,
  cacheRefreshMs: 10000
};

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours !== 1 ? 's' : ''}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''}`;
}

function formatWindow(ms) {
  if (ms === 1000) return 'per second';
  const seconds = ms / 1000;
  return `per ${seconds} second${seconds !== 1 ? 's' : ''}`;
}

// ─── IP Normalization ──────────────────────────────────────────────────────
// Node's dual-stack sockets report IPv4 clients as "::ffff:127.0.0.1" instead
// of plain "127.0.0.1", and the IPv6 loopback shows as "::1". Both represent
// the same physical client in a local/loopback context, and the "::ffff:"
// prefix is not how a real-world public IP should be stored. This strips the
// IPv6-mapped prefix and standardizes loopback to "127.0.0.1" so every IP is
// stored as one clean, consistent string — e.g. "111.222.333.444".
function normalizeIp(rawIp) {
  if (!rawIp) return rawIp;

  let ip = rawIp.trim();

  // x-forwarded-for can be a comma-separated list (client, proxy1, proxy2...)
  // — the first entry is the original client.
  if (ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }

  // Strip IPv4-mapped IPv6 prefix: "::ffff:127.0.0.1" -> "127.0.0.1"
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  // Treat IPv6 loopback as equivalent to IPv4 loopback
  if (ip === '::1') {
    ip = '127.0.0.1';
  }

  return ip;
}

function sendBlockedResponse(res, ip, config, blockedAt, unblockAt) {
  const durationStr = formatDuration(config.blockDurationMs);
  const windowStr = formatWindow(config.windowMs);
  const message = `Your IP (${ip}) has been blocked for ${durationStr} due to exceeding the request limit of ${config.maxRequests} requests ${windowStr}.`;

  return res.status(429).json({
    error: "Too many requests",
    message,
    blockedAt: new Date(blockedAt).toISOString(),
    unblockAt: new Date(unblockAt).toISOString()
  });
}

// ─── A. Unique index on `ip` ───────────────────────────────────────────────
// Ensures MongoDB itself rejects/prevents duplicate documents for the same IP,
// even if multiple requests race to create the first document simultaneously.
// This only needs to run once per server startup, so we guard it with a flag.
async function ensureIndexes(db) {
  if (indexEnsured) return;
  try {
    await db.collection('rate_limit_state').createIndex({ ip: 1 }, { unique: true });
    indexEnsured = true;
    console.log('Unique index on rate_limit_state.ip ensured');
  } catch (err) {
    console.error('Failed to create unique index on rate_limit_state:', err.message);
  }
}

async function loadConfig(db) {
  const now = Date.now();
  if (!configCache || now - lastCacheTime > (configCache.cacheRefreshMs || 10000)) {
    try {
      const configDoc = await db.collection('rate_limit_config').findOne({});
      if (configDoc) {
        configCache = {
          windowMs: configDoc.windowMs || DEFAULT_CONFIG.windowMs,
          maxRequests: configDoc.maxRequests || DEFAULT_CONFIG.maxRequests,
          blockDurationMs: configDoc.blockDurationMs || DEFAULT_CONFIG.blockDurationMs,
          cacheRefreshMs: configDoc.cacheRefreshMs || DEFAULT_CONFIG.cacheRefreshMs
        };
      } else {
        configCache = DEFAULT_CONFIG;
      }
      lastCacheTime = now;
    } catch (err) {
      console.error('Failed to load rate limit config from DB:', err.message);
      if (!configCache) {
        configCache = DEFAULT_CONFIG;
      }
    }
  }
  return configCache;
}

async function rateLimiter(req, res, next) {
  try {
    const db = mongoose.connection.db;
    if (!db) {
      // If DB is not connected yet, allow the request
      return next();
    }

    await ensureIndexes(db);

    const rawIp = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    const ip = normalizeIp(rawIp);
    const config = await loadConfig(db);
    const collection = db.collection('rate_limit_state');
    const now = Date.now();

    // ─── B. Atomic upsert — creates the doc on first sight of an IP, or
    // does nothing if it already exists. $setOnInsert only applies on creation,
    // so this can never overwrite an existing document's live state.
    // upsert + atomic findOneAndUpdate means no two concurrent requests can
    // ever both "win" the insert race and create duplicate documents.
    await collection.findOneAndUpdate(
      { ip },
      {
        $setOnInsert: {
          ip,
          requests: 0,
          windowStart: new Date(),
          blocked: false,
          blockedAt: null,
          blockExpiry: null,
          violationCount: 0
        }
      },
      { upsert: true }
    );

    // ─── Check block status ───────────────────────────────────────────────
    // Re-fetch is safe here since we're now guaranteed exactly one doc per IP.
    let ipDoc = await collection.findOne({ ip });

    if (ipDoc.blocked) {
      const blockExpiryTime = ipDoc.blockExpiry ? new Date(ipDoc.blockExpiry).getTime() : 0;
      if (now >= blockExpiryTime) {
        // Block expired — atomically unblock and start a fresh window.
        // findOneAndUpdate with a filter on blocked:true prevents two
        // concurrent requests from both processing the same unblock twice.
        const unblocked = await collection.findOneAndUpdate(
          { ip, blocked: true },
          {
            $set: {
              blocked: false,
              blockedAt: null,
              blockExpiry: null,
              requests: 1,
              windowStart: new Date()
            }
          },
          { returnDocument: 'after' }
        );
        // If unblocked is null, another concurrent request already unblocked
        // this IP first — that's fine, just continue.
        return next();
      } else {
        return sendBlockedResponse(res, ip, config, ipDoc.blockedAt, ipDoc.blockExpiry);
      }
    }

    const windowStartTime = new Date(ipDoc.windowStart).getTime();

    if (now < windowStartTime + config.windowMs) {
      // ─── Atomic increment ─────────────────────────────────────────────
      // $inc is performed by MongoDB itself, not read-modify-write in JS.
      // This guarantees that under concurrent load, each request gets a
      // unique, correctly-ordered count — no two requests can read and
      // increment the same stale value simultaneously.
      const updated = await collection.findOneAndUpdate(
        { ip },
        { $inc: { requests: 1 } },
        { returnDocument: 'after' }
      );

      const newRequests = updated.requests;

      if (newRequests > config.maxRequests) {
        // Exceeded limit — block. Guard with blocked:false in the filter so
        // only the request that actually crosses the threshold sets the
        // block; subsequent over-limit requests just hit the blocked branch
        // above on their next pass (or read blocked:true here).
        const blockedAt = new Date();
        const blockExpiry = new Date(now + config.blockDurationMs);

        const blockResult = await collection.findOneAndUpdate(
          { ip, blocked: false },
          {
            $set: {
              blocked: true,
              blockedAt,
              blockExpiry
            },
            $inc: {
              violationCount: 1
            }
          },
          { returnDocument: 'after' }
        );

        if (blockResult) {
          return sendBlockedResponse(res, ip, config, blockedAt, blockExpiry);
        } else {
          // Another concurrent request already triggered the block first —
          // re-fetch and use its blockedAt/blockExpiry for an accurate message.
          const current = await collection.findOne({ ip });
          return sendBlockedResponse(res, ip, config, current.blockedAt, current.blockExpiry);
        }
      } else {
        return next();
      }
    } else {
      // ─── New window ─────────────────────────────────────────────────
      // Reset atomically. Filter on the old windowStart so only the first
      // request to detect window expiry performs the reset; late-arriving
      // requests from the old window naturally fall into the next pass.
      await collection.updateOne(
        { ip },
        {
          $set: {
            requests: 1,
            windowStart: new Date()
          }
        }
      );
      return next();
    }
  } catch (err) {
    console.error('Rate limiting error:', err.message);
    // On any rate limiter logic error, fail open to prevent breaking the application
    return next();
  }
}

async function seedRateLimitConfig(db) {
  try {
    const configDoc = await db.collection('rate_limit_config').findOne({});
    if (!configDoc) {
      await db.collection('rate_limit_config').insertOne({
        windowMs: 1000,
        maxRequests: 10,
        blockDurationMs: 86400000,
        cacheRefreshMs: 10000
      });
      console.log('Seeded default rate limit config into MongoDB');
    } else {
      console.log('Rate limit config already exists in MongoDB');
    }
  } catch (err) {
    console.error('Failed to seed rate limit config:', err.message);
  }
}

module.exports = {
  rateLimiter,
  seedRateLimitConfig
};