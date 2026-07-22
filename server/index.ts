import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import swaggerUi from 'swagger-ui-express';
import { PGlite } from '@electric-sql/pglite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const port = Number(process.env.APIPORT || 3001);
const host = process.env.HOST || '0.0.0.0';
const dataDir = process.env.DATA_DIR || './Examples';
const dbPath = process.env.DB_PATH || './data/pglite.db';
const scanIntervalHours = Number(process.env.SCAN_INTERVAL_HOURS || 1);
const scanOnStart = process.env.SCAN_ON_START !== 'false';

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new PGlite(dbPath);

await db.query(`
  CREATE TABLE IF NOT EXISTS ping_records (
    id SERIAL PRIMARY KEY,
    computer_name TEXT NOT NULL,
    domain TEXT NOT NULL,
    location_ip TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    latency_ms INTEGER NOT NULL,
    source_file TEXT NOT NULL,
    ingested_at TEXT NOT NULL
  );
`);

await db.query(`
  CREATE TABLE IF NOT EXISTS ingested_files (
    source_file TEXT PRIMARY KEY,
    file_size INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const FILE_GROWTH_THRESHOLD_BYTES = 1024;

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'btpingapi' });
});

app.get('/api/summary', async (_req, res) => {
  const result = await db.query(`
    SELECT COUNT(*)::int AS total_rows,
           COUNT(DISTINCT computer_name) AS unique_computers,
           COUNT(DISTINCT location_ip) AS unique_ips
    FROM ping_records;
  `);

  res.json(result.rows[0]);
});

app.get('/api/pings', async (req, res) => {
  const { computer, ip, start, end, limit = '100', offset = '0' } = req.query;

  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (computer) {
    whereClauses.push(`computer_name ILIKE $${params.length + 1}`);
    params.push(`%${computer}%`);
  }
  if (ip) {
    whereClauses.push(`location_ip ILIKE $${params.length + 1}`);
    params.push(`%${ip}%`);
  }
  if (start) {
    whereClauses.push(`timestamp >= $${params.length + 1}`);
    params.push(String(start));
  }
  if (end) {
    whereClauses.push(`timestamp <= $${params.length + 1}`);
    params.push(String(end));
  }

  const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const query = `
    SELECT id, computer_name, domain, location_ip, timestamp, latency_ms, source_file, ingested_at
    FROM ping_records
    ${where}
    ORDER BY timestamp DESC, id DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2};
  `;

  params.push(Number(limit));
  params.push(Number(offset));

  const result = await db.query(query, params);
  res.json({ rows: result.rows, total: result.rows.length });
});

app.get('/api/pings/:id', async (req, res) => {
  const result = await db.query(
    `SELECT id, computer_name, domain, location_ip, timestamp, latency_ms, source_file, ingested_at FROM ping_records WHERE id = $1`,
    [Number(req.params.id)]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Ping record not found' });
    return;
  }

  res.json(result.rows[0]);
});

app.post('/api/ingest/scan', async (_req, res) => {
  try {
    const summary = await scanDataDirectory();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Scan failed' });
  }
});

const pingRecordSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    computer_name: { type: 'string' },
    domain: { type: 'string' },
    location_ip: { type: 'string' },
    timestamp: { type: 'string' },
    latency_ms: { type: 'integer' },
    source_file: { type: 'string' },
    ingested_at: { type: 'string' }
  }
};

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'BTPingAPI',
    version: '1.0.0',
    description: 'API for ingesting and querying ping CSV data.'
  },
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        responses: {
          '200': {
            description: 'Service is up',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean' }, service: { type: 'string' } }
                }
              }
            }
          }
        }
      }
    },
    '/api/summary': {
      get: {
        summary: 'Aggregate counts across all ingested ping records',
        responses: {
          '200': {
            description: 'Summary counts',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    total_rows: { type: 'integer' },
                    unique_computers: { type: 'integer' },
                    unique_ips: { type: 'integer' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/pings': {
      get: {
        summary: 'List ping records',
        parameters: [
          { name: 'computer', in: 'query', schema: { type: 'string' }, description: 'Filter by computer name (partial match)' },
          { name: 'ip', in: 'query', schema: { type: 'string' }, description: 'Filter by location IP (partial match)' },
          { name: 'start', in: 'query', schema: { type: 'string' }, description: 'Only include timestamps >= this value' },
          { name: 'end', in: 'query', schema: { type: 'string' }, description: 'Only include timestamps <= this value' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }
        ],
        responses: {
          '200': {
            description: 'Matching ping records',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    rows: { type: 'array', items: pingRecordSchema },
                    total: { type: 'integer' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/pings/{id}': {
      get: {
        summary: 'Get a single ping record by id',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          '200': {
            description: 'The ping record',
            content: { 'application/json': { schema: pingRecordSchema } }
          },
          '404': { description: 'Ping record not found' }
        }
      }
    },
    '/api/ingest/scan': {
      post: {
        summary: 'Scan the configured data directory for ingestible ping files',
        responses: {
          '200': {
            description: 'Scan summary',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    scanned: { type: 'boolean' },
                    files: { type: 'array', items: { type: 'string' } },
                    inserted: { type: 'integer' },
                    skipped: { type: 'integer' }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use(express.static(path.join(__dirname, '../client/dist')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

async function scanDataDirectory() {
  if (!fs.existsSync(dataDir)) {
    return { scanned: false, reason: 'Data directory does not exist', files: [] };
  }

  const files = fs.readdirSync(dataDir)
    .filter((name) => /^result_\d{8}-[A-Za-z0-9-]+\.csv$/i.test(name))
    .sort()
    .map((name) => path.join(dataDir, name));

  let inserted = 0;
  let skipped = 0;

  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const currentSize = fs.statSync(filePath).size;

    const tracked = await db.query('SELECT file_size FROM ingested_files WHERE source_file = $1', [fileName]);

    let rowsToSkip = 0;
    if (tracked.rows.length > 0) {
      const lastSize = Number((tracked.rows[0] as { file_size: number }).file_size);
      if (currentSize - lastSize < FILE_GROWTH_THRESHOLD_BYTES) {
        skipped += 1;
        continue;
      }

      const countResult = await db.query(
        'SELECT COUNT(*)::int AS count FROM ping_records WHERE source_file = $1',
        [fileName]
      );
      rowsToSkip = (countResult.rows[0] as { count: number }).count;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const rows = content
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .filter(Boolean)
      .slice(rowsToSkip);

    for (const row of rows) {
      const [computerName, domain, locationIp, dateTime, latency] = row
        .split(',')
        .map((value) => value.replace(/^"|"$/g, '').trim());

      if (!computerName || !domain || !locationIp || !dateTime || !latency) {
        continue;
      }

      await db.query(
        `INSERT INTO ping_records (computer_name, domain, location_ip, timestamp, latency_ms, source_file, ingested_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [computerName, domain, locationIp, dateTime, Number(latency), fileName, new Date().toISOString()]
      );
      inserted += 1;
    }

    await db.query(
      `INSERT INTO ingested_files (source_file, file_size, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (source_file) DO UPDATE SET file_size = EXCLUDED.file_size, updated_at = EXCLUDED.updated_at`,
      [fileName, currentSize, new Date().toISOString()]
    );
  }

  return { scanned: true, files: files.map((file) => path.basename(file)), inserted, skipped };
}

app.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});

if (scanOnStart) {
  scanDataDirectory().then((summary) => {
    console.log('Initial scan complete', summary);
  }).catch((error) => {
    console.error('Initial scan failed', error);
  });
}

if (scanIntervalHours > 0) {
  setInterval(() => {
    scanDataDirectory().catch((error) => {
      console.error('Scheduled scan failed', error);
    });
  }, scanIntervalHours * 60 * 60 * 1000);
}
