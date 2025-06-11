import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import logger from '../config/logger';
import { SAMPLE_ROW_LIMIT } from '../config/constants';
import { generateTableSchema } from '../controllers/dataController';
import { createTableFromSchema, typecastValue, insertBatchWithSchema } from '../utils/uploadDBUtils';
import { TableSchema } from '../interfaces/dbUtilsInterfaces';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { deteleTempTable } from "../utils/tableDeleteQuery";

interface ExcelJobData {
  filePath: string;
  tableName: string;
  userid: string;
  email: string;
  uploadId: string;
  originalFileName: string;
}

const getSampleRowsFromExcel = (filePath: string, sampleSize: number): Record<string, string> => {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });

  const rows: Record<string, string> = {};
  for (let i = 0; i < Math.min(sampleSize, data.length); i++) {
    const row = data[i].map(val => (val === undefined || val === '') ? 'NULL' : String(val).trim());
    rows[`row${String(i + 1).padStart(2, '0')}`] = row.join(', ');
  }

  return rows;
};

const insertDataFromExcel = async (
  filePath: string,
  tableName: string,
  schema: TableSchema,
  contain_columns: string
) => {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });

  const rows: Record<string, any>[] = [];
  const startRow = (contain_columns === 'YES') ? 1 : 0;

  for (let i = startRow; i < data.length; i++) {
    const values = data[i];
    const row: Record<string, any> = {};
    schema.columns.forEach((col, j) => {
      const rawValue = values[j] ?? null;
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

export const processExcel = new Worker('excel-processing', async job => {
  const { filePath, tableName, userid, email, uploadId, originalFileName }: ExcelJobData = job.data;

  try {
    logger.info('[Excel Worker] Start:', { tableName, uploadId });
    await job.updateProgress(10);

    const sampleRows = getSampleRowsFromExcel(filePath, SAMPLE_ROW_LIMIT);
    const tableSchema = await generateTableSchema(userid, tableName, originalFileName, sampleRows);
    if (!tableSchema) throw new Error('Schema generation failed');

    const { schema, contain_columns } = tableSchema;
    await job.updateProgress(50);

    await createTableFromSchema(tableName, schema);
    await job.updateProgress(70);

    await insertDataFromExcel(filePath, tableName, schema, contain_columns.contain_column);
    await job.updateProgress(90);

    // fs.unlink(filePath, err => {
    //   if (err) logger.error('File delete error:', err);
    //   else logger.info('File deleted:', { filePath });
    // });

    await job.updateProgress(100);
    logger.info('[Excel Worker] Completed:', { uploadId });
  } catch (err) {
    logger.error('[Excel Worker] Failed:', err);
    logger.info(`[Excel Worker] Deleting table: ${tableName}`);
    deteleTempTable(tableName);
    throw err;
  } finally {
    fs.unlink(filePath, err => {
      if (err) logger.error('File delete error:', err);
      else logger.info('File deleted:', { filePath });
    });
  }
}, { connection, concurrency: 5 });
