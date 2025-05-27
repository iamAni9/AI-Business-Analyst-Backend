import { Request, Response } from "express";
import { query } from "../ai/client";
import logger from "../config/logger";
import pool from "../config/postgres";
import { MAX_RETRY_ATTEMPTS, MAX_EVAL_ITERATION, INITIAL_RETRY_DELAY } from '../config/constants';

interface UserData {
    table_name: string;
    table_id: string;       
    email: string;
}
interface QueryClassification {
    type: 'general' | 'data_no_chart' | 'data_with_chart';
    message: string;
}

// Retry configuration
// const MAX_RETRIES = 1;
// const INITIAL_RETRY_DELAY = 1000; // 1 second

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const retryOperation = async <T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = MAX_RETRY_ATTEMPTS,
    initialDelay: number = INITIAL_RETRY_DELAY
): Promise<T> => {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            lastError = error instanceof Error ? error : new Error(errorMessage);
            const delay = initialDelay * Math.pow(2, attempt - 1); // Exponential backoff
            
            logger.warn(`${operationName} failed (attempt ${attempt}/${maxRetries}): ${errorMessage}`);
            
            if (attempt < maxRetries) {
                logger.info(`Retrying ${operationName} in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }
    
    throw new Error(`${operationName} failed after ${maxRetries} attempts. Last error: ${lastError?.message}`);
};

const analysisEvaluation = async (analysis_data: any, queryResults: string, userQuery: string) => {
    const systemPrompt = `You are an expert in evaluating the results.
    Your task is to:
    - Identify whether the results sufficiently and accurately answer the question.
    - Detect if there are any gaps, misinterpretations, or inconsistencies in the data or logic.
    - Suggest improvements if the current queries or results are insufficient.

    You are given:
    - The original user query.
    - The SQL queries that were generated to answer the question and their results.
    - The analysis over the generated results.

    Your responsibilities:
    - Carefully read and understand the user's intent.
    - Review each SQL query and its corresponding results.
    - Determine whether each result contributes to answering the question accurately and fully.
    - Analyze the quality, relevance, and completeness of the results.

    Format your response as a JSON object with the following structure
    {
        "good_result" : "Yes"|"No",
        "required" : "If good result is 'No' then you need to write the prompt for the correctness."
    }
    `;

    const userPrompt = `
    - Original User Question: ${userQuery}
    - Query and their Results: ${queryResults}
    - Analysis over data: ${analysis_data}
    `;

    return retryOperation(
        async () => {
            const analysisResponse = await query(userPrompt, systemPrompt);

            let rawText: string;

            // Handle Buffer
            if (Buffer.isBuffer(analysisResponse)) {
                rawText = analysisResponse.toString('utf-8');
            }
            // Handle string
            else if (typeof analysisResponse === 'string') {
                rawText = analysisResponse;
            }
            // Handle already-parsed object
            else if (typeof analysisResponse === 'object') {
                logger.info("Analysis Response is already an object:", analysisResponse);
                return analysisResponse;
            } else {
                throw new Error('Unexpected analysis response type');
            }

            // Clean extra markdown code block
            const cleaned = rawText
                .replace(/```json\n?|```/g, '')
                .replace(/\\"/g, '"') // unescape quotes if needed
                .trim();

            try {
                logger.info("Cleaned Response:", cleaned);
                return JSON.parse(cleaned);
            } catch (err) {
                logger.error('Failed to parse analysis response:', cleaned);
                throw new Error('Failed to parse analysis response');
            }
        },
        'LLM Answer Evaluation'
    );
};


const generateAnalysis = async (queryResults: string, userQuery: string) => {
    const systemPrompt = `You are an expert data analyst. Your task is to analyze the query results and provide clear, actionable insights.
    Follow these guidelines:
    1. Focus on patterns, trends, and anomalies in the data
    2. Provide specific numbers and percentages where relevant
    3. Explain the business implications clearly
    4. Keep the analysis concise but comprehensive
    5. Generate a proper data table after analysis
    6. For Visualisation, generate the possible graphs.
    7. Provide the graph type and data for generating the graph. 
    
    Format your response as a JSON object with the following structure:
    {
        "analysis" : {
            "summary": "A clear, one-paragraph overview of the key findings.",
            "key_insights": [
                "List 3-5 main findings with specific numbers."
            ],
            "trends_anomalies": [
                "List notable trends or unusual patterns with context."
            ],
            "recommendations": [
                "List 2-3 specific, actionable recommendations."
            ],
            "business_impact": [
                "List concrete business implications with potential impact."
            ]
        },

        "table_data": {
            table_name : [
                { "column1": "value1", "column2": "value2", ... },
                { "column1": "value3", "column2": "value4", ... }
            ],
            table_name: [......],
            .....
        },

        "graph_data": {
            graph_name: {
                "graph_type": "bar|line|pie|scatter",
                "graph_category": primary|secondary, 
                "graph_data": {
                "labels": ["label1", "label2", ...],
                "values": [value1, value2, ...]
            },
            graph_name : {......},
            .......
        }
    }`;

    const userPrompt = `
    Context:
    - Query Results: ${JSON.stringify(queryResults)}
    - Original User Question: ${userQuery}

    Please analyze this data and provide insights that directly address the user's question.
    Focus on actionable insights and clear business implications.
    Return the response in the exact JSON structure specified above.
    
    Instructions:
    - Generate graph and table data from all the queries results.
    - Categories the best graph data as primary, there will be only one primary other will remain secondary.
    - You can decide number of tables and graphs (from 1 to 4) to generate.
    - Strictly follow the structure given for response, specially the brackets ([] or {}).
    `;

    return retryOperation(
        async () => {
            const analysisResponse = await query(userPrompt, systemPrompt);
            const cleanedResponse = analysisResponse.toString()
                .replace(/```json\n|\n```/g, '')
                .replace(/^\{.*?"|"\s*\}$/g, '')
                .replace(/\\"/g, '"')
                .trim();
            
            try {
                return JSON.parse(cleanedResponse);
            } catch (e) {
                logger.error('Failed to parse analysis response:', cleanedResponse);
                throw new Error('Failed to parse analysis response');
            }
        },
        'LLM Analysis Generation'
    );
};

// const executeQuery = async (sqlQuery: string, table_name: string) => {
const executeQuery = async (sqlQuery: string) => {
    return retryOperation(
        async () => {
            const result = await pool.query(sqlQuery);
            return result.rows;
        },
        'SQL Query Execution'
    );
};

// const logAnalysis = (analysis: string, userQuery: string, analysisData: AnalysisData) => {
//     const timestamp = new Date().toISOString();
//     const logMessage = `
//     === Analysis Log ===
//     Timestamp: ${timestamp}
//     Query: ${userQuery}

//     Analysis Results:
//     ${analysis}

//     Table Context:
//     Description: ${analysisData.table_description}
//     Schema: ${analysisData.schema}
//     Column Insights: ${analysisData.column_insights}

//     === End Analysis Log ===
//     `;

//     // Log with proper formatting
//     logger.info('Analysis Log Start');
//     logger.info(`Timestamp: ${timestamp}`);
//     logger.info(`Query: ${userQuery}`);
//     logger.info('Analysis Results:');
//     logger.info(analysis);
//     logger.info('Table Context:');
//     logger.info(`Description: ${analysisData.table_description}`);
//     logger.info(`Schema: ${analysisData.schema}`);
//     logger.info(`Column Insights: ${analysisData.column_insights}`);
//     logger.info('Analysis Log End');
// };

// const transformDataForCharts = (results: any[], chartType: string) => {
//     if (!results || results.length === 0) return [];
    
//     switch (chartType.toLowerCase()) {
//         case 'area':
//             // For area charts, we need name and multiple value columns
//             return results.map(row => ({
//                 name: row.name || row.category || row.date || Object.keys(row)[0] || 'Unknown',
//                 crybs: Number(row.crybs || 0),
//                 eth: Number(row.eth || 0),
//                 other: Number(row.other || 0)
//             }));
            
//         case 'bar':
//             // For bar charts, we need name and value
//             return results.map(row => {
//                 // Get the first non-count column as the name
//                 const nameColumn = Object.keys(row).find(key => key.toLowerCase() !== 'count');
//                 return {
//                     name: nameColumn ? row[nameColumn] : 'Unknown',
//                     value: Number(row.count || 0)
//                 };
//             });
            
//         case 'pie':
//             // For pie charts, we need name and value
//             return results.map(row => {
//                 // Get the first non-count column as the name
//                 const nameColumn = Object.keys(row).find(key => key.toLowerCase() !== 'count');
//                 return {
//                     name: nameColumn ? row[nameColumn] : 'Unknown',
//                     value: Number(row.count || 0)
//                 };
//             });
            
//         default:
//             // Default to bar chart format
//             return results.map(row => {
//                 const nameColumn = Object.keys(row).find(key => key.toLowerCase() !== 'count');
//                 return {
//                     name: nameColumn ? row[nameColumn] : 'Unknown',
//                     value: Number(row.count || 0)
//                 };
//             });
//     }
// };

// const getTableColumns = async (table_name: string): Promise<string[]> => {
//     const result = await pool.query(
//         `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
//         [table_name]
//     );
//     return result.rows.map((row: any) => row.column_name);
// };

const classifyQuery = async (userQuery: string): Promise<QueryClassification> => {
    const systemPrompt = `You are an expert at classifying user queries. Classify the query into one of three categories:
    1. 'general' - General questions, greetings, or queries not related to data analysis
    2. 'data_no_chart' - Data-related questions that don't require visualization
    3. 'data_with_chart' - Data-related questions that would benefit from visualization
    
    Return a JSON object with this structure:
    {
        "type": "general|data_no_chart|data_with_chart",
        "message": "for 'data_no_chart'/'data_with_chart' classification give brief explanation of why this classification was chosen, if it is general classification then answer query accordingly."
    }`;


    const userPrompt = `Classify this query: "${userQuery}"`;

    return retryOperation(
        async () => {
            const classificationResponse = await query(userPrompt, systemPrompt);
            
            logger.info("classificationResponse: ", classificationResponse);
            // First, try to extract JSON from the response if it's wrapped in code blocks
            let jsonStr = classificationResponse.toString();
            const jsonMatch = jsonStr.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1];
            }

            // Clean the JSON string
            jsonStr = jsonStr
                .replace(/[\n\r]/g, ' ')  // Replace newlines with spaces
                .replace(/\s+/g, ' ')     // Replace multiple spaces with single space
                .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3')  // Ensure property names are quoted
                .trim();

            try {
                const parsed = JSON.parse(jsonStr);
                
                // Validate the response structure
                if (!parsed.type || !parsed.message) {
                    throw new Error('Invalid classification response structure');
                }
                
                // Validate the type value
                if (!['general', 'data_no_chart', 'data_with_chart'].includes(parsed.type)) {
                    throw new Error('Invalid classification type');
                }

                return parsed as QueryClassification;
            } catch (e) {
                logger.error('Failed to parse classification response:', jsonStr);
                // Return a default classification for general queries if parsing fails
                return {
                    type: 'general',
                    message: 'Unable to parse classification, defaulting to general query'
                };
            }
        },
        'Query Classification'
    );
};

const flattenAndFormat = (data: any, indent: number = 0): string => {
  let output = '';
  const indentStr = '  '.repeat(indent);

  if (typeof data === 'object' && data !== null) {
    if (Array.isArray(data)) {
      for (const item of data) {
        if (typeof item === 'object' && item !== null) {
          output += `${indentStr}- ${flattenAndFormat(item, indent + 1)}\n`;
        } else {
          output += `${indentStr}- ${item}\n`;
        }
      }
    } else {
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'object' && value !== null) {
          output += `${indentStr}${key}:\n${flattenAndFormat(value, indent + 1)}\n`;
        } else {
          output += `${indentStr}${key}: ${value}\n`;
        }
      }
    }
  } else {
    output += `${indentStr}${data}\n`;
  }

  return output.trim();
}

const isResultEmpty = (results: any) => {
    const data = JSON.parse(results); 

    for (let i = 0; i < 4; i++) {
        const results = data[i.toString()].results;
        if (results.length > 0) {
            return false;
        }
        return true;
    }   
}


// const responseUserQuery = async(req:Request, res:Response)=>{
//     try {
//         const {userQuery, user_id, immediate} = req.body
//         const isImmediate = immediate ?? false;
//         logger.info(`Processing query request for user with id: ${user_id}, query: ${userQuery}`);

//         // First, classify the query
//         const classification = await classifyQuery(userQuery);
//         logger.info(`Query classification: ${JSON.stringify(classification)}`);

//         // If it's a general query, return early with a friendly response
//         if (classification.type === 'general') {
//             return res.status(200).json({
//                 success: true,
//                 data: {
//                     type: 'general',
//                     message: classification.message,
//                 }
//             });
//         }

//         // Fetching user data with retry
//         // RN fetching all data associated with a particular user. In future, will update it to fetch only user's data associated with chat (using chatid)
//         const userResult = await pool.query(
//             `SELECT table_name, table_description, schema, analysis, data_summary, column_insights, business_context, data_relationships, data_trends
//             FROM analysis_data
//             WHERE id = $1`,
//             [user_id]
//         )
        
//         if(!userResult.rows || userResult.rows.length === 0){
//             logger.warn(`No data fetched for: ${user_id}`);
//             return res.status(404).json({success:false, message:"Either user not exist or data is not present"})
//         }
        
//         const structuredMetadata = flattenAndFormat(userResult);
       
//         // Generate SQL queries using AI with retry
//         const generatedQueriesRaw = await retryOperation(
//             async () => {
//                 const systemPrompt = `You are an expert PostgreSQL query generator. Generate 4 different PostgreSQL queries based on the user's question and the table contexts provided.

//                 Follow these guidelines strictly:
//                 1. Each query must be valid PostgreSQL syntax (NOT SQLite)
//                 2. Multiple tables may be involved — look at all tables included in the "structuredMetadata"
//                 3. Join tables using appropriate JOIN clauses when the user's question requires cross-table analysis
//                 4. Include relevant columns in SELECT statements — not just aggregates
//                 5. Use proper WHERE clauses based on the user's question
//                 6. Use appropriate GROUP BY and ORDER BY clauses when needed
//                 7. ${classification.type === 'data_with_chart' ? 'Suggest the most suitable chart type for visualization' : 'No chart visualization needed'}
//                 8. IMPORTANT: Always add LIMIT 100 to your queries unless the user specifically requests a different limit
//                 9. For aggregate queries (using GROUP BY), the LIMIT clause can be omitted
//                 10. When filtering using IDs, use exact matches and include error handling
//                 11. CRITICAL: Column names with spaces must be enclosed in double quotes (e.g., "Column Name")
//                 12. CRITICAL: Always use EXACT column and table names from the schema — do NOT modify them
//                 13. CRITICAL: When using columns across tables, qualify them with their table names 
//                 14. CRITICAL: Look at all tables and infer relationships between them if possible using naming, foreign keys, or shared columns
//                 15. CRITICAL: Check the column type from schema
//                 16. CRITICAL: NULL values should be handled gracefully in aggregations — do not filter them out unless required by the user
//                 17. Ensure your queries are relevant, well-structured, and capture the user intent

//                 Return a JSON array of objects with this structure:
//                 [{
//                     "query": "SELECT ...",
//                 }]`;


                
//                 const userPrompt = `
//                 The following data includes metadata for one or more tables in a PostgreSQL database, including schemas, columns, data patterns, insights, relationships, and business context.

//                 Your task is to:
//                 - Carefully understand the user's question and intent.
//                 - Thoroughly analyze the provided Table Metadata to extract all relevant information.
//                 - Identify which table(s) from the metadata are relevant to the user's question.
//                 - Note that table_name contains the actual table name to be used in SQL queries.
//                 - Use the exact table name and column names as specified in the metadata. Don't generate new by yourself.
//                 - If needed, perform appropriate joins across related tables based on the metadata's data_relationships to fully answer the question.
//                 - Generate 4 distinct and meaningful PostgreSQL queries that help answer the user's question comprehensively.
//                 - Ensure queries reflect the schema and business context described in the metadata.
//                 - Structure queries to highlight different insights or angles on the data.
                
//                 - Ensure queries are standalone and produce clean outputs so that any relationships or comparisons between tables can be handled programmatically after fetching the data.
//                 - Avoid generating any SQL code that compares columns or filters using values from a different table.
//                 - Do not generate subqueries that reference other tables to filter or compare values.
                
//                 - Format the queries clearly and use best practices for readability and performance.

//                 IMPORTANT: During query generation always check the column type from the respective schema.

//                 NULL values should be handled gracefully in aggregations — they should be ignored automatically in AVG(), SUM(), etc., unless stated otherwise.

//                 Table Metadata:
//                 ${structuredMetadata}

//                 User Question:
//                 ${userQuery}

//                 Instructions:
//                 - Use exact column names, including spaces or special characters, enclosed in double quotes
//                 - Do NOT modify column names (e.g., don’t change spaces to underscores)
//                 - All the data is in 'TEXT' format, you need to typecast the column names explicitly in query based on the schema data
//                 - When joining tables, use intelligent joins based on shared fields, foreign keys, or relationships defined in the metadata
//                 - Add LIMIT 100 to non-aggregate queries
//                 - Round numeric values upto 2 decimal places
//                 - For ID lookups, ensure exact matching and proper error handling
//                 - For each query, provide a brief explanation
//                 - When writing SQL queries involving multiple tables, do not use JOIN/WHERE operations. Instead, fetch the relevant data from each table independently. Ensure each query retrieves only the necessary columns and conditions so that the results can be evaluated or merged later outside of SQL.
//                 - Structure each query to produce clean, standalone outputs. Avoid dependencies between tables in the SQL itself — handle relationships, comparisons, or mappings programmatically after retrieving the data.
//                 `;

//                 return await query(userPrompt, systemPrompt);
//             },
//             'SQL Multi-Query Generation'
//         );

//         // logger.info("SQL generated: ", generatedQueriesRaw);

//         // Parse and validate the LLM response
//         let queriesWithCharts: {query: string, chart?: string, explanation: string}[] = [];
//         try {
//             const cleaned = generatedQueriesRaw.toString()
//                 .replace(/```json\n|```/g, '')
//                 .replace(/\n/g, '')
//                 .trim();
//             queriesWithCharts = JSON.parse(cleaned);
//             // logger.info("SQL generated: ", queriesWithCharts);

//             // Validate each query
//             for (const q of queriesWithCharts) {
//                 if (!q.query) {
//                     throw new Error('Invalid query format');
//                 }
//                 // Basic SQL validation
//                 if (!q.query.toLowerCase().includes('select')) {
//                     throw new Error('Invalid SQL query: missing SELECT statement');
//                 }
                
//                 // Add LIMIT 100 if not present and not an aggregate query
//                 const queryLower = q.query.toLowerCase();
//                 if (!queryLower.includes('limit') && !queryLower.includes('group by')) {
//                     q.query = q.query.trim().replace(/;?$/, '') + ' LIMIT 100';
//                 }

//                 // Add error handling for ID lookups
//                 if (queryLower.includes('where') && queryLower.includes('id')) {
//                     q.query = q.query.replace(/;?$/, '') + ' OR 1=0'; // Ensure no results if ID not found
//                 }
//             }
//         } catch (e) {
//             logger.error('Failed to parse or validate LLM multi-query response:', generatedQueriesRaw);
//             return res.status(500).json({success: false, message: 'Failed to generate valid SQL queries'});
//         }

//         // Executing each query and collecting results
//         const results: any[] = [];
//         for (let i = 0; i < queriesWithCharts.length; i++) {
//             const {query: sqlQuery} = queriesWithCharts[i];
//             try {
//                 // const queryResults = await executeQuery(sqlQuery, table_name);
//                 const queryResults = await executeQuery(sqlQuery);
//                 results.push({
//                     query: sqlQuery, 
//                     results: queryResults,
//                 });
//             } catch (err) {
//                 logger.error(`Error executing query ${i+1}:`, err);
//                 results.push({
//                     query: sqlQuery, 
//                     results: null, 
//                     error: 'Query execution failed',
//                 });
//             }
//         }

//         // logger.info("Result from queries: ", results);
        
//         // const emptyResult = isResultEmpty(results);
//         // logger.info("Is result empty: ", emptyResult);
        

//         // Generate analysis with improved context
//         let analysisResults = null, isGood = true;
//         if (results[0] && results[0].results) {
//             const structuredResult = results.map((val, i) => {
//                 return `Query ${i + 1}:\n${val.query}\nResults:\n${JSON.stringify(val.results, null, 2)}\n`;
//             }).join('\n');

//             logger.info(`Structured Result:\n${structuredResult}`);
//             analysisResults = await generateAnalysis(structuredResult, userQuery);

//             if(isImmediate) {
//                 res.status(200).json({
//                     success: true,
//                     data: {
//                         analysis: analysisResults,
//                     }
//                 });
//                 return;
//             }

//             const analysis_data = analysisResults.analysis;
//             const table_data = analysisResults.table_data;
//             const graph_data = analysisResults.graph_data;

//             // logAnalysis(JSON.stringify(analysisResults), userQuery, structuredResult);
//             const evaluatedResult = await analysisEvaluation(analysis_data, structuredResult, userQuery);
//         }

//         logger.info("Analysis Result: ", analysisResults);

//         res.status(200).json({
//             success: true,
//             data: {
//             //     type: classification.type,
//             //     queries: results.map(r => ({query: r.query, ...(classification.type === 'data_with_chart' ? {chart: r.chart} : {})})),
//             //     results: results.map(r => ({
//             //         results: r.results, 
//             //         ...(classification.type === 'data_with_chart' ? {chartData: r.chartData} : {}),
//             //         error: r.error || null,
//             //         explanation: r.explanation
//             //     })),
//                 analysis: analysisResults,
//             //     table_info: {
//             //         table_name: table_name,
//             //         table_id: userData.id
//             //     }
//             }
//         });
//         logger.info('Response sent successfully');

//     } catch (error: unknown) {
//         const errorMessage = error instanceof Error ? error.message : 'Unknown error';
//         logger.error("Error in responseUserQuery:", error);
//         res.status(500).json({
//             success: false,
//             message: "Error processing your query",
//             error: errorMessage
//         });
//     }
// }

const responseUserQuery = async (req: Request, res: Response) => {
    try {
        const { userQuery, immediate } = req.body;
        const isImmediate = immediate ?? false;
        
        if (!req.session.user) {
            return res.status(401).json({ 
                success: false,
                message: 'Unauthorized' 
            });
        }
        const user_id = req.session.user.id

        logger.info(`Processing query request for user: ${user_id}, query: ${userQuery}`);

        // 1. Classifying user query
        const classification = await classifyQuery(userQuery);
        logger.info(`Query classification: ${JSON.stringify(classification)}`);
        if (classification.type === 'general') {
            res.status(200).json({
                success: true,
                data: {
                    type: 'general',
                    message: classification.message,
                }
            });
            return;
        }

        // 2. Fetching metadata from analysis_table
        const userMetadata = await fetchUserMetadata(user_id);
        if (!userMetadata) {
            res.status(404).json({ 
                success: false, 
                message: "Either user not exist or data is not present" 
            });
            return;
        }

        const structuredMetadata = flattenAndFormat(userMetadata);

        // 3. Try generating + evaluating queries with retry
        let analysisResults = null, llmSuggestions = null;
        for (let attempt = 1; attempt <= MAX_EVAL_ITERATION; attempt++) {
            logger.info(`Attempt ${attempt} to generate and evaluate SQL queries`);

            const generatedQueriesRaw = await generateSqlQueries(userQuery, classification.type, structuredMetadata, llmSuggestions);
            logger.info("These are generated queries", generatedQueriesRaw);
            const parsedQueries = parseGeneratedQueries(generatedQueriesRaw);
            if (!parsedQueries) {
                logger.warn('Failed to parse generated queries');
                continue;
            }

            const queryResults = await executeParsedQueries(parsedQueries);
            // if(isResultEmpty(queryResults))
            //     continue;

            logger.info("Query executed successfully", queryResults);

            if (queryResults[0] && queryResults[0].results) {
                logger.info("Executing in loop");
                const structuredResult = queryResults.map((val, i) => {
                    return `Query ${i + 1}:\n${val.query}\nResults:\n${JSON.stringify(val.results, null, 2)}\n`;
                }).join('\n');

                analysisResults = await generateAnalysis(structuredResult, userQuery);
                
                if (!analysisResults) {
                    logger.warn('Generated analysis failed evaluation');
                    continue; // Retry
                }

                if (isImmediate) {
                    logger.info("Immediate response is required.")
                    res.status(200).json({ 
                        success: true, 
                        data: analysisResults
                    });
                    return;
                }

                const evaluation = await analysisEvaluation(analysisResults, structuredResult, userQuery);
                
                if (evaluation.good_result === 'Yes')
                {
                    logger.info("The evaluation is GOOD to send");
                    break; 
                }
                llmSuggestions = evaluation.required;
            }
        }

        if (!analysisResults) {
            res.status(500).json({ 
                success: false, 
                message: "Failed to generate good analysis after multiple attempts" 
            });
            return;
        }

        logger.info("Analysis Result:", analysisResults);
        res.status(200).json({ 
            success: true, 
            data: analysisResults 
        });
        return;

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error("Error in responseUserQuery:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Error processing your query", 
            error: errorMessage 
        });
    }
};


const fetchUserMetadata = async (user_id: string) => {
    const result = await pool.query(
        `SELECT table_name, table_description, schema, analysis, data_summary, column_insights, business_context, data_relationships, data_trends
         FROM analysis_data WHERE id = $1`,
        [user_id]
    );
    return result.rows?.length ? result : null;
};

const generateSqlQueries = async (userQuery: string, classificationType: string, structuredMetadata: string, llmSuggestions: any) => {
    const systemPrompt = `You are an expert PostgreSQL query generator. Generate 4 different PostgreSQL queries based on the user's question and the table contexts provided.

                Follow these guidelines strictly:
                1. Each query must be valid PostgreSQL syntax (NOT SQLite)
                2. Multiple tables may be involved — look at all tables included in the "structuredMetadata"
                3. Join tables using appropriate JOIN clauses when the user's question requires cross-table analysis
                4. Include relevant columns in SELECT statements — not just aggregates
                5. Use proper WHERE clauses based on the user's question
                6. Use appropriate GROUP BY and ORDER BY clauses when needed
                7. ${classificationType === 'data_with_chart' ? 'Suggest the most suitable chart type for visualization' : 'No chart visualization needed'}
                8. IMPORTANT: Always add LIMIT 100 to your queries unless the user specifically requests a different limit
                9. For aggregate queries (using GROUP BY), the LIMIT clause can be omitted
                10. When filtering using IDs, use exact matches and include error handling
                11. CRITICAL: Column names with spaces must be enclosed in double quotes (e.g., "Column Name")
                12. CRITICAL: Always use EXACT column and table names from the schema — do NOT modify them
                13. CRITICAL: When using columns across tables, qualify them with their table names 
                14. CRITICAL: Look at all tables and infer relationships between them if possible using naming, foreign keys, or shared columns
                15. CRITICAL: Check the column type from schema
                16. CRITICAL: NULL values should be handled gracefully in aggregations — do not filter them out unless required by the user
                17. Ensure your queries are relevant, well-structured, and capture the user intent

                Return a JSON array of objects with this structure:
                [{
                    "query": "SELECT ...",
                }]`; 

    const userPrompt = `
                The following data includes metadata for one or more tables in a PostgreSQL database, including schemas, columns, data patterns, insights, relationships, and business context.

                Your task is to:
                - Carefully understand the user's question and intent.
                - Thoroughly analyze the provided Table Metadata to extract all relevant information.
                - Identify which table(s) from the metadata are relevant to the user's question.
                - Note that table_name contains the actual table name to be used in SQL queries.
                - Use the exact table name and column names as specified in the metadata. Don't generate new by yourself.
                - If needed, perform appropriate joins across related tables based on the metadata's data_relationships to fully answer the question.
                - Generate 4 distinct and meaningful PostgreSQL queries that help answer the user's question comprehensively.
                - Ensure queries reflect the schema and business context described in the metadata.
                - Structure queries to highlight different insights or angles on the data.
                
                - Ensure queries are standalone and produce clean outputs so that any relationships or comparisons between tables can be handled programmatically after fetching the data.
                - Avoid generating any SQL code that compares columns or filters using values from a different table.
                - Do not generate subqueries that reference other tables to filter or compare values.
                
                - Format the queries clearly and use best practices for readability and performance.

                IMPORTANT: During query generation always check the column type from the respective schema.

                NULL values should be handled gracefully in aggregations — they should be ignored automatically in AVG(), SUM(), etc., unless stated otherwise.

                Table Metadata:
                ${structuredMetadata}

                User Question:
                ${userQuery}

                LLM suggestions:
                ${llmSuggestions}

                Instructions:
                - Use exact column names, including spaces or special characters, enclosed in double quotes
                - Do NOT modify column names (e.g., don’t change spaces to underscores)
                - All the data is in 'TEXT' format, you need to typecast the column names explicitly in query based on the schema data
                - When joining tables, use intelligent joins based on shared fields, foreign keys, or relationships defined in the metadata
                - Add LIMIT 100 to non-aggregate queries
                - Round numeric values upto 2 decimal places
                - For ID lookups, ensure exact matching and proper error handling
                - For each query, provide a brief explanation
                - When writing SQL queries involving multiple tables, do not use JOIN/WHERE operations. Instead, fetch the relevant data from each table independently. Ensure each query retrieves only the necessary columns and conditions so that the results can be evaluated or merged later outside of SQL.
                - Structure each query to produce clean, standalone outputs. Avoid dependencies between tables in the SQL itself — handle relationships, comparisons, or mappings programmatically after retrieving the data.
                `;   

    return retryOperation(() => query(userPrompt, systemPrompt), 'SQL Multi-Query Generation');
};

const parseGeneratedQueries = (generatedQueriesRaw: any) => {
    let queriesWithCharts: {query: string, chart?: string, explanation: string}[] = [];
    try {
        const cleaned = generatedQueriesRaw.toString()
            .replace(/```json\n|```/g, '')
            .replace(/\n/g, '')
            .trim();
        queriesWithCharts = JSON.parse(cleaned);
        logger.info("Cleaned SQL queries: ", queriesWithCharts);

        // Validate each query
        for (const q of queriesWithCharts) {
            if (!q.query) {
                throw new Error('Invalid query format');
            }
            // Basic SQL validation
            if (!q.query.toLowerCase().includes('select')) {
                throw new Error('Invalid SQL query: missing SELECT statement');
            }
            
            // Add LIMIT 100 if not present and not an aggregate query
            const queryLower = q.query.toLowerCase();
            if (!queryLower.includes('limit') && !queryLower.includes('group by')) {
                q.query = q.query.trim().replace(/;?$/, '') + ' LIMIT 100';
            }

            // Add error handling for ID lookups
            if (queryLower.includes('where') && queryLower.includes('id')) {
                q.query = q.query.replace(/;?$/, '') + ' OR 1=0'; // Ensure no results if ID not found
            }
        }
    } catch (e) {
        logger.error('Failed to parse or validate LLM multi-query response:', generatedQueriesRaw);
        return null
    }

    return queriesWithCharts;
};

const executeParsedQueries = async (queriesWithCharts: any) => {
    const results: any[] = [];
    for (let i = 0; i < queriesWithCharts.length; i++) {
        const {query: sqlQuery} = queriesWithCharts[i];
        try {
            // const queryResults = await executeQuery(sqlQuery, table_name);
            const queryResults = await executeQuery(sqlQuery);
            results.push({
                query: sqlQuery, 
                results: queryResults,
            });
        } catch (err) {
            logger.error(`Error executing query ${i+1}:`, err);
            results.push({
                query: sqlQuery, 
                results: null, 
                error: 'Query execution failed',
            });
        }
    }
    // logger.info("Queries execution result: ", results);
    return results;
};

const structureQueryResults = (results: any[]) => {
    return results.map((val, i) => `Query ${i + 1}:\n${val.query}\nResults:\n${JSON.stringify(val.results, null, 2)}\n`).join('\n');
};


export {responseUserQuery}