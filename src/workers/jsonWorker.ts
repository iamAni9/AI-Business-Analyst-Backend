import fs from 'fs';
import logger from '../config/logger';
import { SAMPLE_ROW_LIMIT } from '../config/constants';
import { generateTableSchema } from '../controllers/dataController';
import { createTableFromSchema, typecastValue, insertBatchWithSchema } from '../utils/uploadDBUtils';
import { TableSchema } from '../interfaces/dbUtilsInterfaces';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { deteleTempTable } from '../utils/tableDeleteQuery';

interface JSONJobData {
  filePath: string;
  tableName: string;
  userid: string;
  email: string;
  uploadId: string;
  originalFileName: string;
}

const getSampleRowsFromJSON = (filePath: string, sampleSize: number): Record<string, string> => {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const jsonData = JSON.parse(raw);
  const rows: Record<string, string> = {};

  for (let i = 0; i < Math.min(sampleSize, jsonData.length); i++) {
    const row = jsonData[i];
    const values = Object.values(row).map(val => (val === undefined || val === '') ? 'NULL' : String(val).trim());
    rows[`row${String(i + 1).padStart(2, '0')}`] = values.join(', ');
  }

  return rows;
};

const insertDataFromJSON = async (
  filePath: string,
  tableName: string,
  schema: TableSchema
) => {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  const rows: Record<string, any>[] = [];

  for (const record of data) {
    const row: Record<string, any> = {};
    schema.columns.forEach(col => {
      const rawValue = record[col.column_name] ?? null;
      row[col.column_name] = typecastValue(rawValue, col.data_type);
    });
    rows.push(row);

    if (rows.length >= 1000) {
      await insertBatchWithSchema(rows.splice(0, 1000), tableName, schema);
    }
  }

  if (rows.length > 0) {
    await insertBatchWithSchema(rows, tableName, schema);
  }
};

const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

export const processJSON = new Worker('json-processing', async job => {
  const { filePath, tableName, userid, email, uploadId, originalFileName }: JSONJobData = job.data;

  try {
    logger.info('[JSON Worker] Start:', { tableName, uploadId });
    await job.updateProgress(10);

    const sampleRows = getSampleRowsFromJSON(filePath, SAMPLE_ROW_LIMIT);
    // logger.info("ROWS===: ", sampleRows);

    const tableSchema = await generateTableSchema(userid, tableName, originalFileName, sampleRows);
    if (!tableSchema) throw new Error('Schema generation failed');
    // logger.info("Table Schema: ", tableSchema);

    const { schema } = tableSchema;
    await job.updateProgress(50);

    await createTableFromSchema(tableName, schema);
    await job.updateProgress(70);

    await insertDataFromJSON(filePath, tableName, schema);
    await job.updateProgress(90);

    // fs.unlink(filePath, err => {
    //   if (err) logger.error('File delete error:', err);
    //   else logger.info('File deleted:', { filePath });
    // });

    await job.updateProgress(100);
    logger.info('[JSON Worker] Completed:', { uploadId });
  } catch (err) {
    logger.error('[JSON Worker] Failed:', err);
    logger.error(`[JSON Worker] Deleting table: ${tableName}`);
    deteleTempTable(tableName);
    throw err;
  } finally {
    fs.unlink(filePath, err => {
      if (err) logger.error('File delete error:', err);
      else logger.info('File deleted:', { filePath });
    });
  }
}, { connection, concurrency: 5 });
