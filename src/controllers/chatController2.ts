import { Request, Response } from "express";
import { query } from "../ai/client";
import logger from "../config/logger";
import pool from "../config/postgres";
import { MAX_RETRY_ATTEMPTS, MAX_EVAL_ITERATION, INITIAL_RETRY_DELAY } from '../config/constants';
import { QUERY_CLASSIFICATION_PROMPT, COLUMN_SELECTION_FROM_USER_QUERY, AVAILABLE_FILE_SELECTION_BASED_ON_QUERY, GENERATE_ANALYSIS_FOR_USER_QUERY_PROMPT, SQL_GENERATION_PROMPT, ANALYSIS_EVAL_PROMPT } from "../config/prompts";
// import { cleanAndParseJson } from "../utils/cleanJSONResponse";
import { jsonrepair } from 'jsonrepair';

interface QueryClassification {
    type: 'general' | 'data_no_chart' | 'data_with_chart';
    message: string;
}

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
            // const delay = initialDelay * Math.pow(2, attempt - 1); // Exponential backoff
            
            // Exponential backoff + jitter
            const delay = Math.min(
                initialDelay * Math.pow(2, attempt - 1) + Math.random() * 1000,
                30000 // Max 30s delay
            );

            logger.warn(`${operationName} failed (attempt ${attempt}/${maxRetries}): ${errorMessage}`);
            
            if (attempt < maxRetries) {
                logger.info(`Retrying ${operationName} in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }
    
    throw new Error(`${operationName} failed after ${maxRetries} attempts. Last error: ${lastError?.message}`);
};

const classifyQuery = async (userQuery: string): Promise<QueryClassification> => {
    const systemPrompt = QUERY_CLASSIFICATION_PROMPT.systemPrompt;
    const userPrompt = `Classify this query: "${userQuery}"`;

    return retryOperation(
        async () => {
            const classificationResponse = await query(userPrompt, systemPrompt);
            
            // logger.info("classificationResponse: ", classificationResponse);
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

// const classifyFiles = async (userQuery: string, availabeFiles: any) => {

//     const systemPrompt = AVAILABLE_FILE_SELECTION_BASED_ON_QUERY.systemPrompt;
//     const userPrompt = `
//         Query: "${userQuery}"
//         Availabe Files: "${availabeFiles}"
//         `;

//     return retryOperation(
//         async () => {
//             const classificationResponse = await query(userPrompt, systemPrompt);
            
//             // First, try to extract JSON from the response if it's wrapped in code blocks
//             let jsonStr = classificationResponse.toString();
//             const jsonMatch = jsonStr.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
//             if (jsonMatch) {
//                 jsonStr = jsonMatch[1];
//             }

//             // Clean the JSON string
//             jsonStr = jsonStr
//                 .replace(/[\n\r]/g, ' ')  // Replace newlines with spaces
//                 .replace(/\s+/g, ' ')     // Replace multiple spaces with single space
//                 .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3')  // Ensure property names are quoted
//                 .trim();

//             try {
//                 const parsed = JSON.parse(jsonStr);
//                 return parsed;
//             } catch (e) {
//                 logger.error('Failed to parse classification response:', jsonStr);
//                 // Return a default classification for general queries if parsing fails
//                 return {
//                     type: 'general',
//                     message: 'Unable to parse classification, defaulting to general query'
//                 };
//             }
//         },
//         'Files Classification'
//     );
// };

const generateSqlQueries = async (userQuery: string, classificationType: string, structuredMetadata: string, llmSuggestions: any) => {
    const systemPrompt = SQL_GENERATION_PROMPT.systemPrompt;
    const userPrompt = `
        ${SQL_GENERATION_PROMPT.userPrompt}

        Table Metadata:
        ${structuredMetadata}

        Classification Type:
        ${classificationType}

        User Question:
        ${userQuery}

        LLM suggestions:
        ${llmSuggestions}
    `;

    return retryOperation(() => query(userPrompt, systemPrompt), 'SQL Multi-Query Generation');
}

const generateAnalysis = async (queryResults: string, userQuery: string) => {
    const systemPrompt = GENERATE_ANALYSIS_FOR_USER_QUERY_PROMPT.systemPrompt;
    const userPrompt = `
        Context:
        - Query Results: ${JSON.stringify(queryResults)}
        - Original User Question: ${userQuery}

        ${GENERATE_ANALYSIS_FOR_USER_QUERY_PROMPT.userPrompt}
    `;

    return retryOperation(
        async () => {
            const analysisResponse = await query(userPrompt, systemPrompt);
            const dirtyString = analysisResponse.toString();

            try {
                // OPTIMISTIC: First, try to parse the string directly or with minimal cleaning.
                // This regex extracts content from ```json ... ``` blocks.
                const match = dirtyString.match(/```json\s*([\s\S]*?)\s*```/);
                const extractedJson = match ? match[1] : dirtyString;
                return JSON.parse(extractedJson);
            } catch (e) {
                // PESSIMISTIC: If standard parsing fails, it's time to repair.
                logger.warn('Standard JSON parsing failed, attempting to repair the string...');
                try {
                    const repairedJson = jsonrepair(dirtyString); // The magic happens here
                    return JSON.parse(repairedJson);
                } catch (repairError) {
                    logger.error(`Failed to parse analysis response even after repair: ${dirtyString}`);
                    // Throw the final error to trigger a retry or fail the operation.
                    throw new Error('Failed to parse analysis response after attempting repair.');
                }
            }
        },
        'LLM Analysis Generation'
    );
};

const analysisEvaluation = async (analysis_data: any, queryResults: string, userQuery: string) => {
    const systemPrompt = ANALYSIS_EVAL_PROMPT.systemPrompt;
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
                logger.info(`Analysis Response is already an object: ${analysisResponse}`);
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
                logger.info(`Cleaned Response: ${cleaned}`);
                return JSON.parse(cleaned);
            } catch (err) {
                logger.error(`Failed to parse analysis response: ${cleaned}`);
                throw new Error('Failed to parse analysis response');
            }
        },
        'LLM Answer Evaluation'
    );
};

// const selectColumnsForSQLGeneration = async (userQuery: string, columnInsight: any, schema: any) => {
//     const systemPrompt = COLUMN_SELECTION_FROM_USER_QUERY.systemPrompt;
//     const userPrompt = `
//     `;

//     return retryOperation(
//         async () => {
//             const classificationResponse = await query(userPrompt, systemPrompt);
            
//             logger.info("classificationResponse: ", classificationResponse);
//             // First, try to extract JSON from the response if it's wrapped in code blocks
//             let jsonStr = classificationResponse.toString();
//             const jsonMatch = jsonStr.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
//             if (jsonMatch) {
//                 jsonStr = jsonMatch[1];
//             }

//             // Clean the JSON string
//             jsonStr = jsonStr
//                 .replace(/[\n\r]/g, ' ')  // Replace newlines with spaces
//                 .replace(/\s+/g, ' ')     // Replace multiple spaces with single space
//                 .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3')  // Ensure property names are quoted
//                 .trim();

//             try {
//                 const parsed = JSON.parse(jsonStr);
                
//                 // Validate the response structure
//                 if (!parsed.type || !parsed.message) {
//                     throw new Error('Invalid classification response structure');
//                 }
                
//                 // Validate the type value
//                 if (!['general', 'data_no_chart', 'data_with_chart'].includes(parsed.type)) {
//                     throw new Error('Invalid classification type');
//                 }

//                 return parsed as QueryClassification;
//             } catch (e) {
//                 logger.error('Failed to parse classification response:', jsonStr);
//                 // Return a default classification for general queries if parsing fails
//                 return {
//                     type: 'general',
//                     message: 'Unable to parse classification, defaulting to general query'
//                 };
//             }
//         },
//         'Query Classification'
//     );
// };

const fetchUserFiles = async (user_id: string) => {
    const result = await pool.query(
        `SELECT file_name
         FROM analysis_data WHERE id = $1`,
        [user_id]
    );
    return result.rows?.length ? result : null;
};

const fetchUserMetadata = async (user_id: string) => {
    const result = await pool.query(
        `SELECT table_name, file_name, schema, column_insights
         FROM analysis_data WHERE id = $1`,
        [user_id]
    );
    return result.rows?.length ? result.rows : null;
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

const executeQuery = async (sqlQuery: string) => {
    return retryOperation(
        async () => {
            const result = await pool.query(sqlQuery);
            return result.rows;
        },
        'SQL Query Execution'
    );
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

export const responseUserQuery = async (req: Request, res: Response) => {
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

        const userFiles = await fetchUserFiles(user_id);
        if (!userFiles) {
            res.status(404).json({ 
                success: false, 
                message: "Add files first" 
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

        // logger.info(`MetaData Column_insight: ${flattenAndFormat(userMetadata)}`);
        
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