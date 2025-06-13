import pool from "../config/postgres";
import logger from "../config/logger";
import { query } from "../ai/client";
import { SCHEMA_BATCH_SIZE } from "../config/constants";
import { SCHEMA_GENERATION } from "../config/prompts";

interface SchemaColumn {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
}

interface ColumnInsight {
  patterns: string[];
  anomalies: string[];
  business_significance: string;
}

interface SchemaFormat {
  schema: {
    columns: SchemaColumn[];
  };
  contain_columns: {
    contain_column: string;
  };
  column_insights: Record<string, ColumnInsight>;
}

const getSchema = async (table_name: string, sampleRows: any[], columnNo: number) => {
    logger.info(`Starting analysis for table: ${table_name}`);
    const responseFormat = `
        "schema": {
            "columns": [
            {
                "column_name": "string",
                "data_type": "string", // e.g. POSTGRES Datatype
                "is_nullable": "string"  // e.g. "YES" or "NO"
            }
            ]
        },
        "contain_columns" : {
            contain_column :  "string"  
            // e.g. contain_column: YES or NO
        },
        "column_insights": {
            "insight" : [    
                "column_name":  {
                        "sample_values": any[],
                        "purpose": string,
                        "patterns": string[],
                        "anomalies": string[],
                        "business_significance": string
                    }
                ]
        }
    `
    const systemPrompt = SCHEMA_GENERATION.systemPrompt;
    const userQuery = `
        Table Name: ${table_name}
        Sample Datarows: ${sampleRows}
        Number of Columns: ${columnNo}

        ${SCHEMA_GENERATION.userPrompt}
        
        Response Format:
        ${responseFormat}

        Remember: Respond with ONLY the JSON object, no additional text or formatting.
    `;

    try {
        logger.info('Generating Schema...');
        const aiAnalysis = await query(userQuery, systemPrompt);
        
        // Clean the response by removing markdown formatting and ensuring valid JSON
        let cleanedResponse = aiAnalysis.toString()
            .replace(/```json\n?/g, '')  // Remove opening ```json
            .replace(/```\n?/g, '')      // Remove closing ```
            .replace(/^\s*{\s*/, '{')    // Remove whitespace after opening brace
            .replace(/\s*}\s*$/, '}')    // Remove whitespace before closing brace
            .trim();                     // Remove extra whitespace

        // Ensure all property names are double-quoted
        cleanedResponse = cleanedResponse.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');
        
        // Add missing closing braces if the response was cut off
        const openBraces = (cleanedResponse.match(/{/g) || []).length;
        const closeBraces = (cleanedResponse.match(/}/g) || []).length;
        if (openBraces > closeBraces) {
            cleanedResponse += '}'.repeat(openBraces - closeBraces);
        }

        const analysis = JSON.parse(cleanedResponse);
        logger.info('Schema generated successfully');
        return analysis;
    } catch (error) {
        logger.error("Error in getAnalysis:", error);
        throw error;
    }
};

// const splitSampleRowsByColumnBatch = (sampleRows: Record<string, string>, batchSize: number) => {
//   const rowKeys = Object.keys(sampleRows);
//   if (rowKeys.length === 0) return [];

//   const columnMatrix = rowKeys.map(rowKey => sampleRows[rowKey].split(',').map(col => col.trim()));
//   const totalColumns = columnMatrix[0].length;

//   const batches: Record<string, string>[] = [];

//   for (let start = 0; start < totalColumns; start += batchSize) {
//     const batch: Record<string, string> = {};

//     rowKeys.forEach((rowKey, i) => {
//       const columns = columnMatrix[i].slice(start, start + batchSize);
//       batch[rowKey] = columns.join(', ');
//     });

//     batches.push(batch);
//   }

// //   logger.info("Batches: ", batches);
//   return batches;
// };

// const getAnalysis = async(table_name: string, sampleRows: any[], tableSchema: any) => {
//     logger.info(`Starting analysis for table: ${table_name}`);
//     const responseFormat = `
//     Please provide your analysis in the following JSON format:
//     {
//         "table_description": {
//             "purpose": string,
//             "business_context": string,
//             "key_metrics": string[],
//             "primary_use_cases": string[]
//         },
//         "column_insights": {
//             "column_name": {
//                 "data_type": string,
//                 "sample_values": any[],
//                 "patterns": string[],
//                 "anomalies": string[],
//                 "business_significance": string
//             }
//         },
//         "data_relationships": {
//             "primary_relationships": [
//                 {
//                     "columns": string[],
//                     "relationship_type": string,
//                     "strength": string,
//                     "business_impact": string
//                 }
//             ],
//             "correlations": [
//                 {
//                     "columns": string[],
//                     "correlation_type": string,
//                     "strength": number,
//                     "significance": string
//                 }
//             ]
//         },
//         "data_trends": {
//             "temporal_trends": [
//                 {
//                     "column": string,
//                     "trend_type": string,
//                     "description": string,
//                     "significance": string
//                 }
//             ],
//             "patterns": [
//                 {
//                     "pattern_type": string,
//                     "affected_columns": string[],
//                     "description": string,
//                     "business_implications": string
//                 }
//             ]
//         },
//         "business_context": {
//             "domain_insights": string[],
//             "key_findings": string[],
//             "opportunities": string[],
//             "risks": string[]
//         },
//     }
//     `;
    
//     const systemPrompt = DATA_ANALYSIS.systemPrompt;

//     const userQuery = `
//     Table Name: ${table_name}
//     Sample Datarows: ${sampleRows}
//     Schema: ${tableSchema}
    
//     ${DATA_ANALYSIS.userPrompt}
    
//     Response Format:
//     ${responseFormat}

//     Remember: Respond with ONLY the JSON object, no additional text or formatting.
//     `;


//     try {
//         logger.info('Generating AI analysis...');
//         const aiAnalysis = await query(userQuery, systemPrompt);
        
//         // logger.info("AI ANALYSIS: ", aiAnalysis);
//         logger.info('Parsing AI response...');
//         // Clean the response by removing markdown formatting and ensuring valid JSON
//         let cleanedResponse = aiAnalysis.toString()
//             .replace(/```json\n?/g, '')  // Remove opening ```json
//             .replace(/```\n?/g, '')      // Remove closing ```
//             .replace(/^\s*{\s*/, '{')    // Remove whitespace after opening brace
//             .replace(/\s*}\s*$/, '}')    // Remove whitespace before closing brace
//             .trim();                     // Remove extra whitespace

//         // Ensure all property names are double-quoted
//         cleanedResponse = cleanedResponse.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');
        
//         // Add missing closing braces if the response was cut off
//         const openBraces = (cleanedResponse.match(/{/g) || []).length;
//         const closeBraces = (cleanedResponse.match(/}/g) || []).length;
//         if (openBraces > closeBraces) {
//             cleanedResponse += '}'.repeat(openBraces - closeBraces);
//         }

//         // logger.info('Cleaned response:', cleanedResponse);
//         const analysis = JSON.parse(cleanedResponse);
//         logger.info('AI response parsed successfully');

//         // Structure the response according to our schema
//         const structuredAnalysis = {
//             schema: analysis.schema || {},
//             contain_columns: analysis.contain_columns || {},
//             table_description: analysis.table_description || {},
//             analysis: analysis,
//             data_summary: analysis.data_summary || {},
//             column_insights: analysis.column_insights || {},
//             // data_quality_metrics: analysis.data_quality_metrics || {},
//             business_context: analysis.business_context || {},
//             data_relationships: analysis.data_relationships || {},
//             data_trends: analysis.data_trends || {},
//             // recommendations: analysis.recommendations || []
//         };

//         return structuredAnalysis;
        
//     } catch (error) {
//         logger.error("Error in getAnalysis:", error);
//         throw error;
//     }
// };

// const splitSampleRowsByColumnBatch = (sampleRows: Record<string, string>, batchSize: number) => {
//   const rowKeys = Object.keys(sampleRows);
//   if (rowKeys.length === 0) return [];

//   // Split each row into columns and trim whitespace
//   const columnMatrix = rowKeys.map(rowKey => 
//     sampleRows[rowKey].split(',')
//       .map(col => col.trim())
//       .filter(col => col.length > 0) // Filter out empty columns
//   );

//   // Verify all rows have the same number of columns
//   const columnCounts = new Set(columnMatrix.map(cols => cols.length));
//   if (columnCounts.size > 1) {
//     throw new Error("All rows must have the same number of columns");
//   }

//   const totalColumns = columnMatrix[0].length;
//   const batches: Record<string, string>[] = [];

//   for (let start = 0; start < totalColumns; start += batchSize) {
//     const end = Math.min(start + batchSize, totalColumns);
//     const batch: Record<string, string> = {};

//     rowKeys.forEach((rowKey, i) => {
//       const columns = columnMatrix[i].slice(start, end);
//       batch[rowKey] = columns.join(', ');
//     });

//     // logger.info(`Batch:  ${batch.row01}`);
//     // logger.info(`Batch:  ${batch.row02}`);
//     batches.push(batch);
//   }

//   return batches;
// };

const parseCsvRow = (row: string): string[] => {
  const result: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];

    if (char === '"') {
      // Toggling the inQuotes flag. Assumes quotes are not escaped within fields.
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      // If we see a comma and we're not in quotes, it's a delimiter.
      result.push(currentField.trim());
      currentField = '';
    } else {
      // Appending the character to the current field.
      currentField += char;
    }
  }
  // Adding the last field
  result.push(currentField.trim());

  return result;
};

const splitSampleRowsByColumnBatch = (sampleRows: Record<string, string>, batchSize: number) => {
  const rowKeys = Object.keys(sampleRows);
  if (rowKeys.length === 0) return [];

  // Spliting each row into columns and trim whitespace
  const columnMatrix = rowKeys.map(rowKey =>
    // sampleRows[rowKey].split(',')
    //   .map(col => col.trim())
    parseCsvRow(sampleRows[rowKey])
  );

  // Finding the maximum number of columns in any row
  const maxColumns = Math.max(...columnMatrix.map(cols => cols.length));

  // Padding shorter rows with empty strings or nulls
  const normalizedMatrix = columnMatrix.map(cols => {
    const padded = [...cols];
    while (padded.length < maxColumns) {
      padded.push('NULL'); // or use `null` if you prefer
    }
    return padded;
  });

  const totalColumns = maxColumns;
  const batches: Record<string, string>[] = [];

  for (let start = 0; start < totalColumns; start += batchSize) {
    const end = Math.min(start + batchSize, totalColumns);
    const batch: Record<string, string> = {};

    rowKeys.forEach((rowKey, i) => {
      const columns = normalizedMatrix[i].slice(start, end);
      batch[rowKey] = columns.join(', ');
    });

    batches.push(batch);
  }

  return batches;
};

export const generateTableSchema = async (userid: string, tableName: string, fileName: string, sampleRows: Record<string, string>) => {
    logger.info(`Starting schema generation for table: ${tableName}`);
    try {
        // logger.info("Sample Rows: ", sampleRows);
        const columnBatches = splitSampleRowsByColumnBatch(sampleRows, SCHEMA_BATCH_SIZE);

        const allSchemas = [];

        for (let i = 0; i < columnBatches.length; i++) {
            logger.info(`Processing batch ${i + 1}/${columnBatches.length}`);
            logger.info(`Current Batch Row1 : ${columnBatches[i].row01}`);
            const row1 = columnBatches[i].row01;
            const columns = row1.split(',').map(col => col.trim()); // Trim to clean extra spaces
            logger.info(`Number of columns in Row1: ${columns.length}`);
            // logger.info(`Current Batch Row2: ${columnBatches[i].row02}`);
            // logger.info(`Current Batch Row3: ${columnBatches[i].row03}`);
            // logger.info(`Current Batch Row4: ${columnBatches[i].row04}`);
            const batchSchema = await getSchema(tableName, Object.values(columnBatches[i]), columns.length);
            allSchemas.push(batchSchema);
        }

        //Merging all schemas
        const mergedSchema: SchemaFormat = {
            schema: { columns: [] },
            contain_columns: { contain_column: "NO" },
            column_insights: {},
        };

        for (const part of allSchemas) {
            mergedSchema.schema.columns.push(...part.schema.columns);
            Object.assign(mergedSchema.column_insights, part.column_insights);
            
            if (part.contain_columns?.contain_column === "YES") {
                mergedSchema.contain_columns.contain_column = "YES";
            }
        }

        // Storing analysis in PostgreSQL  
        const created_at = new Date();

        logger.info('Inserting analysis into PostgreSQL...');
        const insertQuery = `
            INSERT INTO analysis_data (
                id, table_name, file_name, schema, column_insights, created_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6
            )
            RETURNING id;
        `;

        const values = [
            userid,
            tableName,
            fileName,
            mergedSchema.schema,
            mergedSchema.column_insights,
            created_at
        ];

        await pool.query(insertQuery, values);
        logger.info('Schema analysis stored successfully in PostgreSQL');

        // logger.info("Merger Schema: ", mergedSchema);
        return {
            schema: mergedSchema.schema,
            contain_columns: mergedSchema.contain_columns
        }
    } catch (error) {
        logger.error("Failed to generate schema from CSV:", error);
        throw error;
  }
};