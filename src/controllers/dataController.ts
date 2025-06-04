import { Request, Response } from "express";
import pool from "../config/postgres";
import logger from "../config/logger";
import { v4 as uuidv4 } from 'uuid';
import { query } from "../ai/client";
import { DATA_TIME_FORMAT } from "../config/constants";

const getAnalysis = async(table_name: string, sampleRows: any[]) => {
    logger.info(`Starting analysis for table: ${table_name}`);
    const responseFormat = `
    Please provide your analysis in the following JSON format:
    {
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
        "table_description": {
            "purpose": string,
            "business_context": string,
            "key_metrics": string[],
            "primary_use_cases": string[]
        },
        "column_insights": {
            "column_name": {
                "data_type": string,
                "sample_values": any[],
                "patterns": string[],
                "anomalies": string[],
                "business_significance": string
            }
        },
        "data_relationships": {
            "primary_relationships": [
                {
                    "columns": string[],
                    "relationship_type": string,
                    "strength": string,
                    "business_impact": string
                }
            ],
            "correlations": [
                {
                    "columns": string[],
                    "correlation_type": string,
                    "strength": number,
                    "significance": string
                }
            ]
        },
        "data_trends": {
            "temporal_trends": [
                {
                    "column": string,
                    "trend_type": string,
                    "description": string,
                    "significance": string
                }
            ],
            "patterns": [
                {
                    "pattern_type": string,
                    "affected_columns": string[],
                    "description": string,
                    "business_implications": string
                }
            ]
        },
        "business_context": {
            "domain_insights": string[],
            "key_findings": string[],
            "opportunities": string[],
            "risks": string[]
        },
    }
    `;
    
    const systemPrompt = `
    You are an expert data analyst and business intelligence specialist with deep knowledge of data patterns, quality metrics, and optimization strategies.
    Your task is to provide a comprehensive analysis of the provided table data, including business context, relationships, and trends.
    
    Focus on:
    1. Understanding the business context and purpose of the data
    2. Identifying meaningful relationships between columns
    3. Discovering patterns and trends in the data
    4. Providing actionable insights and recommendations
    5. Assessing data quality and suggesting improvements
    
    Be specific and detailed in your analysis, considering both technical and business perspectives.
    `;

    const userQuery = `
    Table Name: ${table_name}
    Sample Datarows: ${sampleRows}
    
    Please provide a comprehensive analysis including:
    1. What this table represents in a business context
    2. How the columns relate to each other
    3. What patterns and trends you observe
    4. What insights can be derived from the data
    5. What improvements could be made
    6. Schema Generation:
        - Use the provided sample rows to generate a database schema.
        - If column names are present in the sample rows, use them; make adjustments if necessary; Make necessary corrections for typos or formatting issues (e.g., 'loc atioc' → 'location', 'em#il' → 'email').
        - If no column names are given, infer them based on the data values.
        - If column name is **NULL**, rename it based on other rows data value of same index.
        - The number of **columns** in the schema should match the number of **columns in the sample rows**.
        - Preserve the original column order as shown in the sample rows.
        - If the sampleRows include column names, update the contain_column with YES otherwise NO only. 
        - For data type inference, use the provided list of PostgreSQL date/time formats below and assign appropriate PostgreSQL types: DATE, TIME, TIMESTAMP, TIMESTAMPTZ.
        - If a column contains multiple date/time formats, choose the most general type to cover all data (e.g., TIMESTAMPTZ over DATE).
    
    Strictly respond ONLY in VALID JSON format.
    - DO NOT include markdown (\`\`\`)
    - DOUBLE-QUOTE all property names and string values
    - Every string must be double-quoted and terminated properly
    - DO NOT include comments inside JSON

    PostgreSQL Date/Time Formats Reference (to use for type inference):
    ${DATA_TIME_FORMAT.join(', ')}
    
    Response Format:
    ${responseFormat}

    Remember: Respond with ONLY the JSON object, no additional text or formatting.
    `;

 

    try {
        logger.info('Generating AI analysis...');
        const aiAnalysis = await query(userQuery, systemPrompt);
        
        // logger.info("AI ANALYSIS: ", aiAnalysis);
        logger.info('Parsing AI response...');
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

        // logger.info('Cleaned response:', cleanedResponse);
        const analysis = JSON.parse(cleanedResponse);
        logger.info('AI response parsed successfully');

        // Structure the response according to our schema
        const structuredAnalysis = {
            schema: analysis.schema || {},
            contain_columns: analysis.contain_columns || {},
            table_description: analysis.table_description || {},
            analysis: analysis,
            data_summary: analysis.data_summary || {},
            column_insights: analysis.column_insights || {},
            // data_quality_metrics: analysis.data_quality_metrics || {},
            business_context: analysis.business_context || {},
            data_relationships: analysis.data_relationships || {},
            data_trends: analysis.data_trends || {},
            // recommendations: analysis.recommendations || []
        };

        return structuredAnalysis;
        
    } catch (error) {
        logger.error("Error in getAnalysis:", error);
        throw error;
    }
};

const generateAnalysis = async (userid: string, tableName: string, sampleRows: any[]) => {
    try {
        // Generating analysis
        const analysis = await getAnalysis(tableName, sampleRows);
        logger.info('Analysis generated successfully');

        // Storing analysis in PostgreSQL  
        const created_at = new Date();

        logger.info('Inserting analysis into PostgreSQL...');
        const insertQuery = `
            INSERT INTO analysis_data (
                id, table_name, table_description, schema, analysis,
                data_summary, column_insights, business_context, data_relationships, data_trends, created_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
            )
            RETURNING id;
        `;

        const values = [
            userid,
            tableName,
            analysis.table_description,
            JSON.stringify(analysis.schema),
            JSON.stringify(analysis.analysis),
            JSON.stringify(analysis.data_summary),
            JSON.stringify(analysis.column_insights),
            // JSON.stringify(analysis.data_quality_metrics),
            JSON.stringify(analysis.business_context),
            JSON.stringify(analysis.data_relationships),
            JSON.stringify(analysis.data_trends),
            // JSON.stringify(analysis.recommendations),
            created_at
        ];

        const { rows } = await pool.query(insertQuery, values);
        logger.info('Analysis stored successfully in PostgreSQL');
        // logger.info('Schema: ', analysis.schema);
        // logger.info('Contain Columns: ', analysis.contain_columns);
        return {
            schema: analysis.schema,
            contain_columns: analysis.contain_columns
        };

    } catch (error: any) {
        logger.error('Error generating analysis:', error);
        return;
    }
};

export { generateAnalysis };

