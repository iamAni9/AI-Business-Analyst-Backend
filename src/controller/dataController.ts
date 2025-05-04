import { Request, Response } from "express";
import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { query } from "../config/db";
import { analyzeTable } from "../helper/tableAnalyzer";
import fs from 'fs';

function isValidDate(value: string): boolean {
    // Handle empty, null values, or non-string values
    if (!value || typeof value !== 'string') return false;
    
    // Never treat values containing letters as dates if they contain special patterns
    // like document IDs with dots (AHIL.0001031967) or slashes
    if (/[a-zA-Z].*?[0-9].*?[\.\/]/.test(value)) {
        return false;
    }
    
    // Check if it's just a plain number (like "19000")
    if (/^\d+$/.test(value)) {
        // Numbers larger than 31 are definitely not days
        if (parseInt(value, 10) > 31) return false;
        
        // Even small numbers could be amounts, not dates
        if (value.length > 2) return false;
    }

    // Check for common date formats with separators
    // DD-MM-YYYY, MM-DD-YYYY, YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, YYYY/MM/DD
    if (/^\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{2,4}$/.test(value) || 
        /^\d{4}[-\/\.]\d{1,2}[-\/\.]\d{1,2}$/.test(value)) {
        return true;
    }
    
    // Check for month abbreviations: Jan, Feb, Mar, etc.
    const monthPattern = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-\s]?\d{2,4}\b/i;
    if (monthPattern.test(value)) {
        return true;
    }
    
    // Check for dates with timestamps
    if (/\d{4}-\d{2}-\d{2}.*?\d{2}:\d{2}/.test(value)) {
        return true;
    }
    
    // For other potential date formats, try parsing with JS Date
    const date = new Date(value);
    if (date instanceof Date && !isNaN(date.getTime())) {
        // Make sure it's not interpreting a number as epoch time
        if (!/^\d+$/.test(value)) {
            return true;
        }
    }

    return false;
}

function normalizeColumnName(column: string): string {
    const reservedKeywords = ['user', 'group', 'order', 'select', 'where', 'from', 'table', 'column'];
    
    let normalized = column.trim()
        .toLowerCase()
        .replace(/[^a-zA-Z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')

    // If it's a reserved keyword, append '1'
    if (reservedKeywords.includes(normalized.toLowerCase())) {
        normalized += '1';
    }

    return normalized;
}

function guessSqlType(values: any[], columnName: string): string {
    // No values to analyze
    if (!values || values.length === 0) return 'TEXT';
    
    console.log(`Analyzing column ${columnName} sample values:`, values.slice(0, 3));
    
    // Special handling for known column patterns
    const lowerColName = columnName.toLowerCase();
    
    // Registration numbers, IDs, phones, etc. should always be TEXT
    if (lowerColName.includes('id') || 
        lowerColName.includes('registration') || 
        lowerColName.includes('no') ||
        lowerColName.includes('phone') || 
        lowerColName.includes('code')) {
        console.log(`Column ${columnName} matches ID/registration pattern - using TEXT`);
        return 'TEXT';
    }
    
    // Amount/monetary values should be NUMERIC
    if (lowerColName.includes('amount') || 
        lowerColName.includes('price') || 
        lowerColName.includes('cost') || 
        lowerColName.includes('fee') ||
        lowerColName.includes('total')) {
        console.log(`Column ${columnName} matches monetary pattern - using NUMERIC`);
        return 'NUMERIC';
    }
    
    // Date fields should be TEXT (safer)
    if (lowerColName.includes('date') || 
        lowerColName.includes('time') || 
        lowerColName.includes('month') ||
        lowerColName.includes('year') ||
        lowerColName.includes('day')) {
        console.log(`Column ${columnName} matches date/time pattern - using TEXT`);
        return 'TEXT';
    }
    
    // First check if any value is a date - but be careful about this detection
    if (values.some(v => typeof v === 'string' && isValidDate(v))) {
        console.log(`Column ${columnName} contains date values - using TEXT`);
        return 'TEXT';
    }
    
    // Filter out null/empty values
    const nonEmptyValues = values.filter(v => v !== null && v !== undefined && v !== '');
    if (nonEmptyValues.length === 0) return 'TEXT';
    
    // Check if all values can be parsed as numbers
    let allNumbers = true;
    for (const v of nonEmptyValues) {
        // Make sure we're not dealing with IDs or alphanumeric codes
        if (typeof v === 'string') {
            // If it contains any non-numeric character (other than decimal point)
            if (/[^0-9.]/.test(v)) {
                allNumbers = false;
                break;
            }
            
            // Look for patterns like codes or IDs with numbers
            if (v.includes('.') && !/^\d+\.\d+$/.test(v)) {
                allNumbers = false;
                break;
            }
        }
        
        // Try parsing as a number
        const num = parseFloat(String(v));
        if (isNaN(num)) {
            allNumbers = false;
            break;
        }
    }
    
    if (allNumbers) {
        // Check if any value has a decimal point
        const hasDecimals = nonEmptyValues.some(v => {
            const str = String(v);
            return str.includes('.') && parseFloat(str) % 1 !== 0;
        });
        
        if (hasDecimals) {
            console.log(`Column ${columnName} contains decimal numbers - using NUMERIC`);
            return 'NUMERIC';
        }
        
        // Check if any value exceeds INTEGER limits
        const exceedsIntLimits = nonEmptyValues.some(v => {
            const num = Number(v);
            return num > 2147483647 || num < -2147483648;
        });
        
        if (exceedsIntLimits) {
            console.log(`Column ${columnName} contains large integers - using BIGINT`);
            return 'BIGINT';
        } else {
            console.log(`Column ${columnName} contains standard integers - using INTEGER`);
            return 'INTEGER';
        }
    }
    
    // Default to TEXT for mixed content
    console.log(`Column ${columnName} contains mixed content - using TEXT (default)`);
    return 'TEXT';
}

// Format dates for PostgreSQL
function formatDateForPostgres(dateStr: string): string {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    
    // Format as YYYY-MM-DD
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const uploadData = async (req: Request & { file?: Express.Multer.File }, res: Response) => {
    try {
        console.log('=== Starting CSV Upload Process ===');
        
        if (!req.file) {
            console.log('❌ Error: No file uploaded');
            res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
            return;
        }

        const tableName = req.body.tableName;
        const user_id = req.body.user_id;
        const email = req.body.email;

        console.log(`📋 Upload Parameters:
        - Table Name: ${tableName}
        - User ID: ${user_id}
        - Email: ${email}
        - File Path: ${req.file.path}`);

        if (!tableName) {
            console.log('❌ Error: Table name is missing');
            res.status(400).json({
                success: false,
                message: 'Table name is required'
            });
            return;
        }

        console.log(`🔄 Step 1: Reading CSV file for table: ${tableName}`);
        
        // First pass: read all rows to determine accurate column types
        const allRows: any[] = [];
        const csvStream = createReadStream(req.file.path);
        const parser = parse({
            columns: true,
            skip_empty_lines: true,
            trim: true,
            // Handle different delimiters
            delimiter: [',', ';', '\t']
        });

        console.log('📊 Reading CSV rows...');
        for await (const record of csvStream.pipe(parser)) {
            allRows.push(record);
            if (allRows.length === 1) {
                console.log("📝 First row sample:", record);
            }
        }

        if (allRows.length === 0) {
            console.log('❌ Error: CSV file is empty');
            return res.status(400).json({
                success: false,
                message: 'CSV file is empty'
            });
        }

        console.log(`✅ Successfully read ${allRows.length} rows from CSV`);

        // Normalize column names and collect values for each column
        const columns = Object.keys(allRows[0]).map(normalizeColumnName);
        const originalColumns = Object.keys(allRows[0]);
        const columnValues: Record<string, any[]> = {};
        
        console.log("📋 Column Information:");
        console.log("- Original columns:", originalColumns);
        console.log("- Normalized columns:", columns);
        
        // Initialize columnValues
        columns.forEach(column => {
            columnValues[column] = [];
        });
        
        console.log('🔄 Step 2: Processing column values...');
        // Collect all values for each column
        allRows.forEach(row => {
            originalColumns.forEach((origCol, index) => {
                const normalizedCol = columns[index];
                columnValues[normalizedCol].push(row[origCol]);
            });
        });
        
        // Determine column types based on all values
        const columnTypes = new Map<string, string>();
        console.log('🔄 Step 3: Determining column types...');
        columns.forEach(column => {
            const type = guessSqlType(columnValues[column], column);
            columnTypes.set(column, type);
            console.log(`- Column "${column}": ${type}`);
        });

        console.log('🔄 Step 4: Creating database table...');
        // Drop table if exists - using proper SQL syntax
        await query(`DROP TABLE IF EXISTS "${tableName}"`);
        console.log(`✅ Dropped existing table "${tableName}" if it existed`);
        
        const createTableSQL = `
            CREATE TABLE "${tableName}" (
                ${columns.map(column => `"${column}" ${columnTypes.get(column)}`).join(',\n')}
            )
        `;

        console.log("📝 Creating table with SQL:", createTableSQL);
        await query(createTableSQL);
        console.log("✅ Table created successfully");

        console.log('🔄 Step 5: Inserting data...');
        // Insert all rows
        let rowsInserted = 0;
        let batchSize = 1000;
        let currentBatch = [];

        for (const record of allRows) {
            const values = columns.map((col, i) => {
                const originalCol = originalColumns[i];
                const value = record[originalCol];
                return value;
            });

            currentBatch.push(values);

            if (currentBatch.length >= batchSize) {
                const insertSQL = `
                    INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(', ')})
                    VALUES ${currentBatch.map((_, i) => 
                        `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(', ')})`
                    ).join(', ')}
                `;
                
                try {
                    await query(insertSQL, currentBatch.flat());
                    rowsInserted += currentBatch.length;
                    console.log(`✅ Inserted batch of ${currentBatch.length} rows (Total: ${rowsInserted})`);
                    currentBatch = [];
                } catch (insertErr) {
                    console.error(`❌ Error inserting batch:`, insertErr);
                    throw insertErr;
                }
            }
        }

        // Insert remaining rows
        if (currentBatch.length > 0) {
            const insertSQL = `
                INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(', ')})
                VALUES ${currentBatch.map((_, i) => 
                    `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(', ')})`
                ).join(', ')}
            `;
            
            try {
                await query(insertSQL, currentBatch.flat());
                rowsInserted += currentBatch.length;
                console.log(`✅ Inserted final batch of ${currentBatch.length} rows (Total: ${rowsInserted})`);
            } catch (insertErr) {
                console.error(`❌ Error inserting final batch:`, insertErr);
                throw insertErr;
            }
        }
        
        console.log(`✅ Successfully inserted all ${rowsInserted} rows`);

        console.log('🔄 Step 6: Analyzing table...');
        // After successful upload, analyze the table and store the results
        const analysis = await analyzeTable(tableName);
        console.log('✅ Table analysis completed');

        console.log('🔄 Step 7: Storing analysis results...');
        try {
            const analysisJson = JSON.stringify(analysis);
            await query(
                `INSERT INTO TABLE_SCHEMA (table_name, analysis)
                VALUES ($1, $2::jsonb)
                ON CONFLICT (table_name) 
                DO UPDATE SET 
                    analysis = $2::jsonb,
                    updated_at = CURRENT_TIMESTAMP`,
                [tableName, analysisJson]
            );
            console.log('✅ Analysis results stored in TABLE_SCHEMA');
        } catch (error) {
            console.error('❌ Error storing analysis:', error);
            throw error;
        }

        console.log('🔄 Step 8: Recording user data...');
        try {
            // Validate and sanitize inputs
            if (!email || !tableName || !user_id) {
                throw new Error('Missing required fields: email, tableName, or user_id');
            }

            const userDataResult = await query(
                `INSERT INTO user_data (email, table_name, user_id) 
                VALUES ($1, $2, $3) 
                RETURNING id`,
                [email.toString(), tableName.toString(), user_id.toString()]
            );
            const uploadId = userDataResult.rows[0].id;
            console.log('✅ User data recorded with ID:', uploadId);

            console.log('=== CSV Upload Process Completed Successfully ===');
            res.status(200).json({
                success: true,
                message: 'CSV data successfully imported to database',
            });

            // Delete the uploaded file after processing
            if (req.file && req.file.path) {
                fs.unlink(req.file.path, (err) => {
                    if (err) {
                        console.error('Failed to delete uploaded file:', err);
                    } else {
                        console.log('Uploaded file deleted:', req.file.path);
                    }
                });
            }
        } catch (error) {
            console.error('❌ Error recording user data:', error);
            console.error('Parameters:', { email, tableName, user_id });
            throw error;
        }

    } catch (error:any) {
        console.error('❌ Error in upload process:', error);
        console.error('Error details:', error.message);
        res.status(500).json({
            success: false,
            message: `Failed to upload data: ${error.message}`
        });
    }
}

const getAllUploadedFiles = async (req: Request, res: Response) => {
    try {
        const { user_id } = req.query;

        if (!user_id) {
             res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
            return
        }

        const result = await query(
            `SELECT ud.id, ud.table_name, ud.created_at, ts.analysis 
             FROM user_data ud 
             LEFT JOIN TABLE_SCHEMA ts ON ud.table_name = ts.table_name 
             WHERE ud.user_id = $1 
             ORDER BY ud.created_at DESC`,
            [user_id]
        );

        res.status(200).json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error('Error fetching uploaded files:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch uploaded files',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

export { uploadData, getAllUploadedFiles };