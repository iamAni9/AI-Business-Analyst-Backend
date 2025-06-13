import fs from 'fs';
import logger from '../config/logger';
import { SAMPLE_ROW_LIMIT, CSV_DATA_INSERT_BATCH_SIZE } from '../config/constants';
import { generateTableSchema } from '../controllers/dataController';
import { createTableFromSchema, typecastValue, insertBatchWithSchema, getTypeConversion, alterColumnType } from '../utils/uploadDBUtils';
import { TableSchema } from '../interfaces/dbUtilsInterfaces';
import readline from 'readline';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { deteleTempTable } from '../utils/tableDeleteQuery';
import { Writable } from 'stream';
import { from as copyFrom } from 'pg-copy-streams';
import pool from '../config/postgres';
import chardet from 'chardet';
import iconv from 'iconv-lite';

interface CSVJobData {
  filePath: string;
  tableName: string;
  userid: string;
  email: string;
  uploadId: string;
  originalFileName: string;
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

// const addDataIntoTableFromCSV = async (
//   filePath: string,
//   tableName: string,
//   schema: TableSchema,
//   contain_columns: string
// ): Promise<void> => {
//   return new Promise((resolve, reject) => {
//     const rows: Record<string, any>[] = [];
//     // const batchSize = 1000;
//     let isFirstRow = true;

//     const rl = readline.createInterface({
//       input: fs.createReadStream(filePath),
//       crlfDelay: Infinity,
//     });

//     rl.on('line', async (line: string) => {
//       try {
//         if (contain_columns === 'YES' && isFirstRow) {
//           logger.info("Skipping the header");
//           isFirstRow = false;
//           return; // skip header
//         }

//         isFirstRow = false;

//         const values = line.split(',').map(val => val.trim() === '' ? null : val.trim());

//         // Mapping values to schema columns
//         const rowObject: Record<string, any> = {};
//         schema.columns.forEach((col, i) => {
//           //   rowObject[col.column_name] = values[i] ?? null;
//           const rawValue = values[i] ?? null;
//           rowObject[col.column_name] = typecastValue(rawValue, col.data_type);
//         });

//         rows.push(rowObject);

//         if (rows.length >= CSV_DATA_INSERT_BATCH_SIZE) {
//           rl.pause(); // pause while inserting
//           await insertBatchWithSchema(rows.splice(0, CSV_DATA_INSERT_BATCH_SIZE), tableName, schema);
//           rl.resume(); // resume after insert
//         }
//       } catch (err) {
//         rl.close();
//         reject(err);
//       }
//     });

//     rl.on('close', async () => {
//       try {
//         if (rows.length > 0) {
//           await insertBatchWithSchema(rows, tableName, schema);
//         }
//         resolve();
//       } catch (err) {
//         reject(err);
//       }
//     });

//     rl.on('error', reject);
//   });
// };

const convertFileToUTF8 = async (inputPath: string): Promise<string> => {
    const encoding = chardet.detectFileSync(inputPath) || 'utf-8';
    
    if (encoding.toLowerCase() === 'utf-8') {
        return inputPath; // No need to convert
    }

    const utf8Path = inputPath.replace(/(\.csv)?$/, '_utf8.csv');
    
    return new Promise((resolve, reject) => {
        const inputStream = fs.createReadStream(inputPath).pipe(iconv.decodeStream(encoding));
        const outputStream = fs.createWriteStream(utf8Path);

        inputStream
            .pipe(iconv.encodeStream('utf-8'))
            .pipe(outputStream)
            .on('finish', () => resolve(utf8Path))
            .on('error', reject);
    });
};

const addDataIntoTableFromCSV = async (
    filePath: string,
    tableName: string,
    schema: TableSchema, 
    contain_columns: string,
    maxRetries = 3
): Promise<void> => {
    if (maxRetries <= 0) {
        throw new Error("Failed to load data even after schema correction attempts.");
    }

    const utf8FilePath = await convertFileToUTF8(filePath); // ✅ Ensure UTF-8
    const poolClient = await pool.connect(); 
    try {
        await new Promise((resolve, reject) => {
            // Options for the COPY command
            let copyOptions = `FORMAT CSV, DELIMITER ','`;
            if (contain_columns === 'YES') {
                copyOptions += `, HEADER true`; // Appending the comma and the option together
            }
            // Creating the writable stream to Postgres
            const stream: Writable = poolClient.query(copyFrom(`COPY "${tableName}" FROM STDIN WITH (${copyOptions})`));
            
            // Creating a readable stream from your file
            const fileStream = fs.createReadStream(utf8FilePath);

            // Set up event listeners
            fileStream.on('error', reject);
            stream.on('error', reject); // This will catch the Postgres errors
            stream.on('finish', resolve); // Success!

            // Starting the process by piping the file to the database stream
            fileStream.pipe(stream);
        });

    } catch (error: any) {
        // --- CATCH AND ANALYZE THE ERROR ---
        console.error("Caught COPY error object:", error); 

        const pgErrorDetails = {
            message: error.message || '',
            column: error.column, // Sometimes the driver provides this!
        };

        const conversion = getTypeConversion(pgErrorDetails); 

        if (conversion && conversion.columnName) {
            console.warn(`COPY failed. Detected type error in column "${conversion.columnName}".`);
            console.log(`Altering column "${conversion.columnName}" to ${conversion.newType}...`);
            
            await alterColumnType(tableName, conversion.columnName, conversion.newType);
            
            // --- RETRYING THE COPY COMMAND ---
            console.log("Schema corrected. Retrying COPY operation...");
            poolClient.release(); 
            return addDataIntoTableFromCSV(filePath, tableName, schema, contain_columns, maxRetries - 1);

        } else {
            // If the error is not a fixable type conversion
            throw error;
        }
    } finally {
        poolClient.release();
    }
};


const connection = new Redis(process.env.REDIS_URL!, {
   maxRetriesPerRequest: null,
});

export const processCSV = new Worker('csv-processing', async job => {
  const { filePath, tableName, userid, email, uploadId, originalFileName }: CSVJobData = job.data;
  try {
    logger.info('Starting CSV processing:', { filePath, originalFileName, tableName, uploadId });
    await job.updateProgress(10);

    const sampleRows = await getSampleRows(filePath, SAMPLE_ROW_LIMIT);
    logger.info("Sample Rows: ", sampleRows);
    // const analysis = await generateAnalysis(userid, tableName, Object.values(sampleRows));
    const tableSchema = await generateTableSchema(userid, tableName, originalFileName, sampleRows);
    if (!tableSchema) throw new Error('Schema generation failed');

    const { schema, contain_columns } = tableSchema;
    // logger.info("SCHEMA: ", schema);  
      // logger.info("COLUMN: ", contain_columns);
    await job.updateProgress(50);

    await createTableFromSchema(tableName, schema);
    await job.updateProgress(70);

    await addDataIntoTableFromCSV(filePath, tableName, schema, contain_columns.contain_column);
    await job.updateProgress(90);

    // fs.unlink(filePath, err => {
    //   if (err) logger.error('File delete error:', err);
    //   else logger.info('File deleted:', { filePath });
    // });

    await job.updateProgress(100);
    logger.info('CSV processing completed:', { uploadId });
  } catch (error) {
    logger.error('CSV processing failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      jobData: job.data
    });
    logger.error(`[CSV Worker] Deleting table: ${tableName}`);
    deteleTempTable(tableName);
    throw error;
  } finally {
    fs.unlink(filePath, err => {
      if (err) logger.error('File delete error:', err);
      else logger.info('File deleted:', { filePath });
    });
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