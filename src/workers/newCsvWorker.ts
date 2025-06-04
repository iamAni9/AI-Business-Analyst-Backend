import fs from 'fs';
import pool from '../config/postgres';
import logger from '../config/logger';
import { SAMPLE_ROW_LIMIT, DATA_TIME_FORMAT } from '../config/constants';
import { generateAnalysis } from '../controllers/dataController';
import readline from 'readline';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';

dayjs.extend(customParseFormat);

interface CSVJobData {
  filePath: string;
  tableName: string;
  userid: string;
  email: string;
  uploadId: string;
  originalFileName: string;
}

interface ColumnSchema {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
}

interface TableSchema {
  columns: ColumnSchema[];
}

const getSampleRows = (filePath: string, sampleSize: number): Promise<Record<string, string>> => {
  return new Promise((resolve, reject) => {
    const rows: Record<string, string> = {};
    const stream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: stream });
    let lineIndex = 1;

    rl.on('line', (line: string) => {
      const values = line.split(',').map(val => val.trim() === '' ? 'NULL' : val.trim());
      rows[`row${String(lineIndex).padStart(2, '0')}`] = values.join(', ');
      lineIndex++;

      if (lineIndex >= sampleSize + 1) {
        rl.close(); // stop reading further
      }
    });

    rl.on('close', () => resolve(rows));
    rl.on('error', (err) => reject(err));
  });
};

const createTableFromSchema = async (tableName: string, schema: any) => {
  try {
    // Creating table using the generated schema from analysis
    const columnDefinitions = schema.columns.map((col: any) => 
      // `"${col.column_name}" ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`
      `"${col.column_name}" ${col.data_type}`
    ).join(',\n');

    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        ${columnDefinitions}
      );
    `;

    await pool.query(createTableQuery);
    logger.info(`Table ${tableName} created successfully`);
    return true;
  } catch (error) {
    logger.error('Error creating table from schema:', error);
    throw error;
  }
};

// Typecasting value during insertion
const typecastValue = (value: string | null, type: string): any => {
  if (value === null) return null;

  switch (type.toLowerCase()) {
    case 'integer':
    case 'int':
    case 'smallint':
    case 'bigint':
      return parseInt(value, 10) || null;

    case 'real':
    case 'double precision':
    case 'float':
    case 'numeric':
    case 'decimal':
      return parseFloat(value) || null;

    case 'boolean':
      return ['true', '1', 'yes'].includes(value.toLowerCase()) ? true :
             ['false', '0', 'no'].includes(value.toLowerCase()) ? false :
             null;

    case 'date':
    case 'timestamp':
    case 'timestamp without time zone':
    case 'timestamp with time zone': {
      const formats = DATA_TIME_FORMAT;

      for (const format of formats) {
        const parsed = dayjs(value, format, true); // strict parsing
        if (parsed.isValid()) return parsed.toDate(); // convert to JS Date
      }
      return null; // Unrecognized format
    }

    default:
      return value;
  }
};

const addDataIntoTableFromCSV = async (
  filePath: string,
  tableName: string,
  schema: TableSchema,
  contain_columns: string
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const rows: Record<string, any>[] = [];
    const batchSize = 1000;
    let isFirstRow = true;

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });

    rl.on('line', async (line: string) => {
      try {
        if (contain_columns === 'YES' && isFirstRow) {
          logger.info("Skipping the header");
          isFirstRow = false;
          return; // skip header
        }

        isFirstRow = false;

        const values = line.split(',').map(val => val.trim() === '' ? null : val.trim());

        // Mapping values to schema columns
        const rowObject: Record<string, any> = {};
        schema.columns.forEach((col, i) => {
          //   rowObject[col.column_name] = values[i] ?? null;
          const rawValue = values[i] ?? null;
          rowObject[col.column_name] = typecastValue(rawValue, col.data_type);
        });

        rows.push(rowObject);

        if (rows.length >= batchSize) {
          rl.pause(); // pause while inserting
          await insertBatchWithSchema(rows.splice(0, batchSize), tableName, schema);
          rl.resume(); // resume after insert
        }
      } catch (err) {
        rl.close();
        reject(err);
      }
    });

    rl.on('close', async () => {
      try {
        if (rows.length > 0) {
          await insertBatchWithSchema(rows, tableName, schema);
        }
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    rl.on('error', reject);
  });
};

// Batch insertion
const insertBatchWithSchema = async (
  batch: Record<string, any>[],
  tableName: string,
  schema: TableSchema
): Promise<void> => {
  const columns = schema.columns.map(col => col.column_name);
  // const values: any[] = batch.map(row => columns.map(col => row[col]));
  const values: any[] = batch.map(row =>
    columns.map(col => row[col] !== undefined ? row[col] : null)
  );

  const valuePlaceholders = batch.map((_, i) => {
    const offset = i * columns.length;
    const rowPlaceholders = columns.map((_, j) => `$${offset + j + 1}`);
    return `(${rowPlaceholders.join(', ')})`;
  }).join(', ');

  const query = `
    INSERT INTO "${tableName}" (${columns.map(col => `"${col}"`).join(', ')})
    VALUES ${valuePlaceholders};
  `;

  await pool.query(query, values.flat());
};

const connection = new Redis(process.env.REDIS_URL!, {
   maxRetriesPerRequest: null,
});

export const processCSV = new Worker('csv-processing', async job => {
  const { filePath, tableName, userid, email, uploadId }: CSVJobData = job.data;
  try {
    logger.info('Starting CSV processing:', { filePath, tableName, uploadId });
    await job.updateProgress(10);

    const sampleRows = await getSampleRows(filePath, SAMPLE_ROW_LIMIT);
    const analysis = await generateAnalysis(userid, tableName, Object.values(sampleRows));
    if (!analysis) throw new Error('generateAnalysis failed');

    const { schema, contain_columns } = analysis;
    await job.updateProgress(50);

    await createTableFromSchema(tableName, schema);
    await job.updateProgress(70);

    await addDataIntoTableFromCSV(filePath, tableName, schema, contain_columns.contain_column);
    await job.updateProgress(90);

    fs.unlink(filePath, err => {
      if (err) logger.error('File delete error:', err);
      else logger.info('File deleted:', { filePath });
    });

    await job.updateProgress(100);
    logger.info('CSV processing completed:', { uploadId });
  } catch (error) {
    logger.error('CSV processing failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      jobData: job.data
    });
    throw error;
  }
}, { connection, concurrency: 5 });

// Worker event listeners for debugging
processCSV.on('ready', () => {
  logger.debug('[Worker] Worker is now ready to accept jobs');
});

processCSV.on('active', (job) => {
  logger.debug(`[Worker] Job ${job.id} is now active`);
});

processCSV.on('completed', (job) => {
  logger.debug(`[Worker] Job ${job.id} has completed`);
});

processCSV.on('failed', (job, err) => {
  logger.debug(`[Worker] Job ${job?.id} has failed`, { error: err.message });
});

processCSV.on('error', (err) => {
  logger.error('[Worker] Worker encountered an error', err);
});

logger.debug('[Worker] CSV Worker process started and listening for jobs');