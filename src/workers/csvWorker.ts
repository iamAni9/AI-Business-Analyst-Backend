import fs from 'fs';
import pool from '../config/postgres';
import logger from '../config/logger';
import { SAMPLE_ROW_LIMIT, DATA_TIME_FORMAT } from '../config/constants';
import { queueManager } from './queueManager';
import { generateAnalysis } from '../controllers/dataController';
import readline from 'readline';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);


export interface CSVJobData {
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

const updateProgress = (uploadId: string, progress: number) => {
  const currentStatus = queueManager.getJobStatus(uploadId);
  if (currentStatus) {
    queueManager.updateJobStatus(uploadId, {
      ...currentStatus,
      progress
    });
  }
};

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
  const values: any[] = batch.map(row => columns.map(col => row[col]));

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

export const processCSV = async (jobData: CSVJobData): Promise<void> => {
  const { filePath, tableName, userid, email, uploadId } = jobData;
  
  try {
    // Updaying progress to 10% - Starting CSV processing
    updateProgress(uploadId, 10);
    logger.info('Starting CSV processing:', { filePath, tableName, uploadId });

    // Generating Analysis
    const sampleRows = await getSampleRows(filePath, SAMPLE_ROW_LIMIT);
    logger.info("Sample Rows: ", sampleRows);

    updateProgress(uploadId, 40);
    const analysis = await generateAnalysis(userid, tableName, Object.values(sampleRows));
    if (!analysis) {
      throw new Error('generateAnalysis failed or returned undefined');
    }
    const { schema, contain_columns } = analysis;

    logger.info("SCHEMA: ", schema);  
    logger.info("COLUMN: ", contain_columns);  
    updateProgress(uploadId, 50);

    //Creating table 
    await createTableFromSchema(tableName, schema);
    updateProgress(uploadId, 70);
    
    // Import data with schema validation
    await addDataIntoTableFromCSV(filePath, tableName, schema, contain_columns.contain_column);
    updateProgress(uploadId, 90);

    // Delete the file after successful upload
    try {
      fs.unlinkSync(filePath);
      logger.info('File deleted successfully:', { filePath });
    } catch (deleteError) {
      logger.error('Error deleting file:', { 
        error: deleteError instanceof Error ? deleteError.message : 'Unknown error',
        stack: deleteError instanceof Error ? deleteError.stack : undefined,
        filePath
      });
    }

    // Update progress to 100% - All operations completed
    updateProgress(uploadId, 100);
    logger.info('CSV processing completed successfully:', { uploadId });

  } catch (error) {
    logger.error('Error processing CSV:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      jobData: {
        filePath,
        tableName,
        email,
        uploadId
      }
    });

    // Update job status to failed
    const currentStatus = queueManager.getJobStatus(uploadId);
    if (currentStatus) {
      queueManager.updateJobStatus(uploadId, {
        ...currentStatus,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    throw error;
  }
}; 