import { Request, Response } from "express";
import { query } from "../ai/client";
import logger from "../config/logger";
import pool from "../config/postgres";

interface UserData {
    table_name: string;
    table_id: string;       
    email: string;
}

interface AnalysisData {
    table_description: string;
    schema: string;
    column_insights: string;
}

interface QueryClassification {
    type: 'general' | 'data_no_chart' | 'data_with_chart';
    explanation: string;
}

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const retryOperation = async <T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = MAX_RETRIES,
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

const generateAnalysis = async (queryResults: any[], userQuery: string, analysis: AnalysisData) => {
    const systemPrompt = `You are an expert data analyst. Your task is to analyze the query results and provide clear, actionable insights.
    Follow these guidelines:
    1. Focus on patterns, trends, and anomalies in the data
    2. Provide specific numbers and percentages where relevant
    3. Explain the business implications clearly
    4. Keep the analysis concise but comprehensive
    
    Format your response as a JSON object with the following structure:
    {
        "summary": "A clear, one-paragraph overview of the key findings",
        "key_insights": ["List of 3-5 main findings with specific numbers"],
        "trends_anomalies": ["List of notable trends or unusual patterns with context"],
        "recommendations": ["List of 2-3 specific, actionable recommendations"],
        "business_impact": ["List of concrete business implications with potential impact"]
    }`;

    const userPrompt = `
    Context:
    - Query Results: ${JSON.stringify(queryResults)}
    - Original User Question: ${userQuery}
    - Table Description: ${analysis.table_description}
    - Schema: ${analysis.schema}
    - Column Insights: ${analysis.column_insights}

    Please analyze this data and provide insights that directly address the user's question.
    Focus on actionable insights and clear business implications.
    Return the response in the exact JSON structure specified above.`;

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

const executeQuery = async (sqlQuery: string, table_name: string) => {
    return retryOperation(
        async () => {
            // If the query contains $1, use parameterized query, otherwise execute directly
            if (sqlQuery.includes('$1')) {
                const result = await pool.query(sqlQuery, [table_name]);
                return result.rows;
            } else {
                const result = await pool.query(sqlQuery);
                return result.rows;
            }
        },
        'SQL Query Execution'
    );
};

const logAnalysis = (analysis: string, userQuery: string, analysisData: AnalysisData) => {
    const timestamp = new Date().toISOString();
    const logMessage = `
=== Analysis Log ===
Timestamp: ${timestamp}
Query: ${userQuery}

Analysis Results:
${analysis}

Table Context:
Description: ${analysisData.table_description}
Schema: ${analysisData.schema}
Column Insights: ${analysisData.column_insights}

=== End Analysis Log ===
`;

    // Log with proper formatting
    logger.info('Analysis Log Start');
    logger.info(`Timestamp: ${timestamp}`);
    logger.info(`Query: ${userQuery}`);
    logger.info('Analysis Results:');
    logger.info(analysis);
    logger.info('Table Context:');
    logger.info(`Description: ${analysisData.table_description}`);
    logger.info(`Schema: ${analysisData.schema}`);
    logger.info(`Column Insights: ${analysisData.column_insights}`);
    logger.info('Analysis Log End');
};

const transformDataForCharts = (results: any[], chartType: string) => {
    if (!results || results.length === 0) return [];
    
    switch (chartType.toLowerCase()) {
        case 'area':
            // For area charts, we need name and multiple value columns
            return results.map(row => ({
                name: row.name || row.category || row.date || Object.keys(row)[0] || 'Unknown',
                crybs: Number(row.crybs || 0),
                eth: Number(row.eth || 0),
                other: Number(row.other || 0)
            }));
            
        case 'bar':
            // For bar charts, we need name and value
            return results.map(row => {
                // Get the first non-count column as the name
                const nameColumn = Object.keys(row).find(key => key.toLowerCase() !== 'count');
                return {
                    name: nameColumn ? row[nameColumn] : 'Unknown',
                    value: Number(row.count || 0)
                };
            });
            
        case 'pie':
            // For pie charts, we need name and value
            return results.map(row => {
                // Get the first non-count column as the name
                const nameColumn = Object.keys(row).find(key => key.toLowerCase() !== 'count');
                return {
                    name: nameColumn ? row[nameColumn] : 'Unknown',
                    value: Number(row.count || 0)
                };
            });
            
        default:
            // Default to bar chart format
            return results.map(row => {
                const nameColumn = Object.keys(row).find(key => key.toLowerCase() !== 'count');
                return {
                    name: nameColumn ? row[nameColumn] : 'Unknown',
                    value: Number(row.count || 0)
                };
            });
    }
};

const getTableColumns = async (table_name: string): Promise<string[]> => {
    const result = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [table_name]
    );
    return result.rows.map((row: any) => row.column_name);
};

const classifyQuery = async (userQuery: string): Promise<QueryClassification> => {
    const systemPrompt = `You are an expert at classifying user queries. Classify the query into one of three categories:
    1. 'general' - General questions, greetings, or queries not related to data analysis
    2. 'data_no_chart' - Data-related questions that don't require visualization
    3. 'data_with_chart' - Data-related questions that would benefit from visualization
    
    Return a JSON object with this structure:
    {
        "type": "general|data_no_chart|data_with_chart",
        "explanation": "Brief explanation of why this classification was chosen"
    }`;

    const userPrompt = `Classify this query: "${userQuery}"`;

    return retryOperation(
        async () => {
            const classificationResponse = await query(userPrompt, systemPrompt);
            
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
                if (!parsed.type || !parsed.explanation) {
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
                    explanation: 'Unable to parse classification, defaulting to general query'
                };
            }
        },
        'Query Classification'
    );
};

const responseUserQuery = async(req:Request, res:Response)=>{
    try {
        const {userQuery, email} = req.body
        logger.info(`Processing query request for email: ${email}, query: ${userQuery}`);

        // First, classify the query
        const classification = await classifyQuery(userQuery);
        logger.info(`Query classification: ${JSON.stringify(classification)}`);

        // If it's a general query, return early with a friendly response
        if (classification.type === 'general') {
            return res.status(200).json({
                success: true,
                data: {
                    type: 'general',
                    message: "I'm here to help you analyze your data. Feel free to ask questions about your data, and I'll help you understand it better!",
                    explanation: classification.explanation
                }
            });
        }

        // Fetch user data with retry
        const userResult = await pool.query(
            'SELECT * FROM users_data WHERE email = $1',
            [email]
        )
        logger.info(`User result: ${userResult.rows[0]}`);
        
        if(!userResult.rows || userResult.rows.length === 0){
            logger.warn(`User not found for email: ${email}`);
            return res.status(404).json({success:false, message:"User not found"})
        }

        const userData = userResult.rows[0]
        const table_name = userData.table_name
        console.log("--------------------------------", table_name)
        if (!table_name) {
            logger.warn(`No table_name found for user: ${email}`);
            return res.status(404).json({success:false, message:"No table associated with user"})
        }

        // Fetch analysis data with retry
        const analysisResult = await pool.query('SELECT * FROM analysis_data',[]) 
        logger.info(`Analysis result: ${JSON.stringify(analysisResult.rows)}`);
        if(!analysisResult.rows || analysisResult.rows.length === 0){
            logger.warn(`Analysis not found for table: ${table_name}`);
            return res.status(404).json({success:false, message:"Analysis not found"})
        }
        const analysis = analysisResult.rows[0] as AnalysisData
        console.log("--------------------------------", table_name, analysis.table_description, analysis.schema, analysis.column_insights)

        // Generate SQL queries using AI with retry
        const generatedQueriesRaw = await retryOperation(
            async () => {
                const systemPrompt = `You are an expert PostgreSQL query generator. Generate 4 different PostgreSQL queries based on the user's question and table context.
                Follow these guidelines:
                1. Each query should be valid PostgreSQL syntax (NOT SQLite)
                2. To list tables in PostgreSQL, use: SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
                3. Include relevant columns in SELECT statements, not just aggregates
                4. Use appropriate JOINs if needed
                5. Include proper WHERE clauses based on the user's question
                6. Use appropriate GROUP BY and ORDER BY clauses
                7. ${classification.type === 'data_with_chart' ? 'Suggest the most suitable chart type for visualization' : 'No chart visualization needed'}
                8. IMPORTANT: Always add LIMIT 100 to your queries unless the user specifically requests a different limit
                9. For aggregate queries (using GROUP BY), you may omit the LIMIT clause
                10. When searching for specific IDs, use exact matches and include error handling
                11. CRITICAL: Column names with spaces must be enclosed in double quotes (e.g., "Column Name")
                12. CRITICAL: Use EXACT column names as provided in the schema, including spaces and special characters
                13. CRITICAL: Do not modify or transform column names (e.g., don't convert spaces to underscores)
                14. CRITICAL: Always verify column names against the provided schema before using them
                
                Return a JSON array of objects with this structure:
                [{
                    "query": "SELECT ...",
                    ${classification.type === 'data_with_chart' ? '"chart": "bar|line|pie|area|table",' : ''}
                    "explanation": "Brief explanation of what this query shows"
                }]`;
                
                const userPrompt = `
                Table Name: ${table_name}
                Table Description: ${analysis.table_description}
                Schema: ${JSON.stringify(analysis.schema, null, 2)}
                Column Insights: ${JSON.stringify(analysis.column_insights, null, 2)}
                
                User Question: ${userQuery}
                
                Generate 4 different SQL queries that would help answer this question.
                Each query should be valid SQL and include proper column names.
                ${classification.type === 'data_with_chart' ? 'Also suggest the most appropriate chart type for visualizing each result.' : ''}
                Remember to add LIMIT 100 to non-aggregate queries unless a specific limit is requested.
                For ID lookups, ensure exact matching and include error handling.
                
                IMPORTANT: Use the exact column names from the schema, including spaces and special characters.
                Column names with spaces must be enclosed in double quotes (e.g., "Column Name").
                Do not modify or transform column names.`;
                
                return await query(userPrompt, systemPrompt);
            },
            'SQL Multi-Query Generation'
        );

        // Parse and validate the LLM response
        let queriesWithCharts: {query: string, chart?: string, explanation: string}[] = [];
        try {
            const cleaned = generatedQueriesRaw.toString()
                .replace(/```json\n|```/g, '')
                .replace(/\n/g, '')
                .trim();
            queriesWithCharts = JSON.parse(cleaned);
            
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
            return res.status(500).json({success: false, message: 'Failed to generate valid SQL queries'});
        }

        // Execute each query and collect results
        const results: any[] = [];
        for (let i = 0; i < queriesWithCharts.length; i++) {
            const {query: sqlQuery, chart, explanation} = queriesWithCharts[i];
            try {
                const queryResults = await executeQuery(sqlQuery, table_name);
                const transformedData = classification.type === 'data_with_chart' ? transformDataForCharts(queryResults, chart || 'bar') : null;
                results.push({
                    query: sqlQuery, 
                    ...(classification.type === 'data_with_chart' ? { chart, chartData: transformedData } : {}),
                    results: queryResults,
                    explanation
                });
            } catch (err) {
                logger.error(`Error executing query ${i+1}:`, err);
                results.push({
                    query: sqlQuery, 
                    ...(classification.type === 'data_with_chart' ? { chart, chartData: [] } : {}),
                    results: null, 
                    error: 'Query execution failed',
                    explanation
                });
            }
        }

        // Generate analysis with improved context
        let analysisResults = null;
        if (results[0] && results[0].results) {
            const enhancedAnalysis = {
                ...analysis,
                user_question: userQuery,
                query_results: results.map(r => ({
                    query: r.query,
                    results: r.results,
                    error: r.error
                }))
            };
            analysisResults = await generateAnalysis(results[0].results, userQuery, enhancedAnalysis);
            logAnalysis(JSON.stringify(analysisResults), userQuery, enhancedAnalysis);
        }

        res.status(200).json({
            success: true,
            data: {
                type: classification.type,
                queries: results.map(r => ({query: r.query, ...(classification.type === 'data_with_chart' ? {chart: r.chart} : {})})),
                results: results.map(r => ({
                    results: r.results, 
                    ...(classification.type === 'data_with_chart' ? {chartData: r.chartData} : {}),
                    error: r.error || null,
                    explanation: r.explanation
                })),
                analysis: analysisResults,
                table_info: {
                    table_name: table_name,
                    table_id: userData.id
                }
            }
        });
        logger.info('Response sent successfully');

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error("Error in responseUserQuery:", error);
        res.status(500).json({
            success: false,
            message: "Error processing your query",
            error: errorMessage
        });
    }
}

export {responseUserQuery}