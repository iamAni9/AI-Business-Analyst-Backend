import { Request, Response } from "express";
import pool from "../config/postgres";
import logger from "../config/logger";
import { v4 as uuidv4 } from 'uuid';
import { query } from "../ai/client";

const getAnalysis = async(table_name: string, schema: any, sampleData: any) => {
    logger.info(`Starting analysis for table: ${table_name}`);
    const responseFormat = `
    Please provide your analysis in the following JSON format:
    {
        "table_description": {
            "purpose": string,
            "business_context": string,
            "key_metrics": string[],
            "primary_use_cases": string[]
        },
        "data_summary": {
            "total_records": number,
            "column_types": [{"name": string, "type": string}],
            "basic_stats": {
                "column_name": {
                    "min": number | null,
                    "max": number | null,
                    "avg": number | null,
                    "unique_count": number | null,
                    "most_common": any | null
                }
            }
        },
        "column_insights": {
            "column_name": {
                "data_type": string,
                "null_count": number,
                "unique_values": number,
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
        "data_quality_metrics": {
            "completeness": {
                "column_name": number
            },
            "consistency": {
                "column_name": {
                    "has_negative": boolean,
                    "has_zero": boolean,
                    "has_decimal": boolean
                }
            },
            "uniqueness": {
                "column_name": number
            }
        },
        "business_context": {
            "domain_insights": string[],
            "key_findings": string[],
            "opportunities": string[],
            "risks": string[]
        },
        "recommendations": [
            {
                "category": string,
                "description": string,
                "priority": string,
                "implementation_notes": string
            }
        ]
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
    
    Schema:
    ${JSON.stringify(schema, null, 2)}
    
    Sample Data (10 rows):
    ${JSON.stringify(sampleData, null, 2)}
    
    Please provide a comprehensive analysis including:
    1. What this table represents in a business context
    2. How the columns relate to each other
    3. What patterns and trends you observe
    4. What insights can be derived from the data
    5. What improvements could be made
    Response Format:
    ${responseFormat}

    Remember: Respond with ONLY the JSON object, no additional text or formatting.
    `;

 

    try {
        logger.info('Generating AI analysis...');
        const aiAnalysis = await query(userQuery, systemPrompt);
        
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

        logger.info('Cleaned response:', cleanedResponse);
        const analysis = JSON.parse(cleanedResponse);
        logger.info('AI response parsed successfully');

        // Structure the response according to our schema
        const structuredAnalysis = {
            table_description: analysis.table_description || {},
            schema: schema,
            analysis: analysis,
            data_summary: analysis.data_summary || {},
            column_insights: analysis.column_insights || {},
            data_quality_metrics: analysis.data_quality_metrics || {},
            business_context: analysis.business_context || {},
            data_relationships: analysis.data_relationships || {},
            data_trends: analysis.data_trends || {},
            recommendations: analysis.recommendations || []
        };

        return structuredAnalysis;
        
    } catch (error) {
        logger.error("Error in getAnalysis:", error);
        throw error;
    }
};

const calculateCompleteness = (data: any[], schema: any[]) => {
    const completeness: any = {};
    schema.forEach((col: any) => {
        const nullCount = data.filter(row => row[col.column_name] === null).length;
        completeness[col.column_name] = ((data.length - nullCount) / data.length) * 100;
    });
    return completeness;
};

const checkDataConsistency = (data: any[], schema: any[]) => {
    const consistency: any = {};
    schema.forEach((col: any) => {
        if (['INTEGER', 'FLOAT', 'NUMERIC'].includes(col.data_type)) {
            const values = data.map(row => row[col.column_name]);
            consistency[col.column_name] = {
                has_negative: values.some(v => v < 0),
                has_zero: values.some(v => v === 0),
                has_decimal: values.some(v => v % 1 !== 0)
            };
        }
    });
    return consistency;
};

const checkUniqueness = (data: any[], schema: any[]) => {
    const uniqueness: any = {};
    schema.forEach((col: any) => {
        const uniqueValues = new Set(data.map(row => row[col.column_name]));
        uniqueness[col.column_name] = (uniqueValues.size / data.length) * 100;
    });
    return uniqueness;
};

const generateAnalysis = async (req: Request, res: Response) => {
    try {
        const { table_name } = req.body;
        if (!table_name) {
            res.status(400).json({
                success: false,
                message: 'Table name is required'
            });
            return;
        }

        logger.info('Fetching table schema...');
        const getTableSchemaQuery = `
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = $1
            ORDER BY ordinal_position;
        `;
        const { rows: schemaRows } = await pool.query(getTableSchemaQuery, [table_name]);
        logger.info(`Schema retrieved with ${schemaRows.length} columns`);

        // Get sample data
        const getTableDataQuery = `
            SELECT *
            FROM ${table_name}
            LIMIT 10;
        `;
        const { rows: dataRows } = await pool.query(getTableDataQuery);
        logger.info(`Retrieved ${dataRows.length} sample rows`);

        // Generate analysis
        const analysis = await getAnalysis(table_name, schemaRows, dataRows);
        logger.info('Analysis generated successfully');

        // Store analysis in PostgreSQL
        const id = uuidv4();
        const created_at = new Date();
        const updated_at = created_at;

        logger.info('Inserting analysis into PostgreSQL...');
        const insertQuery = `
            INSERT INTO analysis_data (
                id, table_id, table_description, schema, analysis,
                data_summary, column_insights, data_quality_metrics,
                business_context, data_relationships, data_trends,
                recommendations, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
            )
            RETURNING id;
        `;

        const values = [
            id,
            table_name,
            analysis.table_description,
            JSON.stringify(analysis.schema),
            JSON.stringify(analysis.analysis),
            JSON.stringify(analysis.data_summary),
            JSON.stringify(analysis.column_insights),
            JSON.stringify(analysis.data_quality_metrics),
            JSON.stringify(analysis.business_context),
            JSON.stringify(analysis.data_relationships),
            JSON.stringify(analysis.data_trends),
            JSON.stringify(analysis.recommendations),
            created_at,
            updated_at
        ];

        const { rows } = await pool.query(insertQuery, values);
        logger.info('Analysis stored successfully in PostgreSQL');

        res.status(200).json({
            success: true,
            message: 'Analysis generated and stored successfully',
            analysis_id: rows[0].id
        });

    } catch (error: any) {
        logger.error('Error generating analysis:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating analysis',
            error: error.message
        });
    }
};

export { generateAnalysis };

