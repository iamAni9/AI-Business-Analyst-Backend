"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.responseQuery = void 0;
const prompt_templates_1 = require("../helper/prompt-templates");
const query_ai_1 = require("../helper/query-ai");
const db_1 = require("../config/db");
const responseQuery = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { query: queryString, user_id, email } = req.body;
    let response = '';
    let insights = [];
    let patterns = '';
    let followUpQuestions = [];
    let validAnswer = false;
    let combinedInsights = null;
    try {
        if (!db_1.query || !user_id || !email) {
            res.status(400).json({
                success: false,
                message: "All fields are required"
            });
            return;
        }
        const user = yield (0, db_1.query)('SELECT * FROM users WHERE email = $1', [email]);
        if (!user) {
            res.status(400).json({
                success: false,
                message: "User not found"
            });
            return;
        }
        //get context of schema
        console.log('🚀 Processing query:', db_1.query);
        const { system, user: userPrompt } = prompt_templates_1.prompts.triage(queryString);
        console.log('📋 Step 1 - Triage prompts:', { system, userPrompt });
        const triageResponse = yield (0, query_ai_1.queryAI)(system, userPrompt, true);
        console.log('📋 Step 1 - Triage AI response:', triageResponse);
        const triageResult = JSON.parse(triageResponse);
        console.log('📋 Step 1 - Parsed triage result:', triageResult);
        const queryType = triageResult.queryType;
        switch (queryType) {
            case 'GENERAL_QUESTION':
                console.log('💭 Processing general question');
                const generalPrompt = prompt_templates_1.prompts.generalAnswer(queryString);
                console.log('💭 General prompts:', generalPrompt);
                const generalResponse = yield (0, query_ai_1.queryAI)(generalPrompt.system, generalPrompt.user, true);
                console.log('💭 General AI response:', generalResponse);
                const generalResult = JSON.parse(generalResponse);
                console.log('💭 Parsed general result:', generalResult);
                response = generalResult.answer;
                break;
            case 'DATA_QUESTION':
                console.log('🔍 Processing data question');
                // Step 3: Get schema information
                const schemaResult = yield (0, db_1.query)(`SELECT ud.id, ud.table_name, ud.created_at, ts.analysis 
                     FROM user_data ud 
                     LEFT JOIN TABLE_SCHEMA ts ON ud.table_name = ts.table_name 
                     WHERE ud.user_id = $1 
                     ORDER BY ud.created_at DESC`, [user_id]);
                console.log('📊 Step 3 - Schema query result:', schemaResult);
                const tables = schemaResult.rows.map((row) => ({
                    tableName: row.table_name,
                    analysis: row.analysis
                }));
                console.log('📊 Step 3 - Processed tables:', tables);
                // Step 4: Analyze schema and get context for SQL generation
                const schemaPrompt = prompt_templates_1.prompts.schemaAnalysis({ tables }, queryString);
                console.log('🔎 Step 4 - Schema analysis prompts:', schemaPrompt);
                const schemaAnalysis = yield (0, query_ai_1.queryAI)(schemaPrompt.system, schemaPrompt.user, true);
                console.log('🔎 Step 4 - Schema analysis AI response:', schemaAnalysis);
                const schemaAnalysisResult = JSON.parse(schemaAnalysis);
                console.log('🔎 Step 4 - Parsed schema analysis:', schemaAnalysisResult);
                // Add check for inScope
                if (!schemaAnalysisResult.inScope) {
                    response = `I apologize, but I cannot answer this question using the available database schema. ${schemaAnalysisResult.outOfScopeReason}`;
                    break;
                }
                let attempts = 0;
                const MAX_ATTEMPTS = 3;
                let sqlQueries = [];
                let queryResults = [];
                let lastError = '';
                while (attempts < MAX_ATTEMPTS && !validAnswer) {
                    attempts++;
                    console.log(`📝 Step 5 - SQL generation attempt ${attempts}`);
                    try {
                        // Generate multiple SQL queries (2-3 different approaches)
                        const sqlPrompt = lastError
                            ? prompt_templates_1.prompts.regenerateSQL(schemaAnalysisResult, queryString, sqlQueries[sqlQueries.length - 1], lastError)
                            : prompt_templates_1.prompts.generateSQL(schemaAnalysisResult, queryString);
                        console.log('📝 Step 5 - SQL generation prompts:', sqlPrompt);
                        const sqlResponse = yield (0, query_ai_1.queryAI)(sqlPrompt.system, sqlPrompt.user, true);
                        console.log('📝 Step 5 - SQL AI response:', sqlResponse);
                        const sqlResult = JSON.parse(sqlResponse);
                        // Handle both single query and array of queries
                        const newQueries = Array.isArray(sqlResult) ? sqlResult : [sqlResult];
                        // Add unique queries
                        for (const queryResult of newQueries) {
                            if (queryResult.query && !sqlQueries.includes(queryResult.query)) {
                                sqlQueries.push(queryResult.query);
                            }
                        }
                        console.log('📝 Step 5 - New SQL queries:', sqlQueries);
                        // If we have 2-3 unique queries, proceed with execution
                        if (sqlQueries.length >= 2) {
                            // Execute all SQL queries
                            for (const sql of sqlQueries) {
                                const result = yield (0, db_1.query)(sql);
                                queryResults.push(result.rows);
                            }
                            console.log('⚡ Step 6 - All query results:', queryResults);
                            // Generate insights from all queries
                            const allInsights = [];
                            const visualizationData = [];
                            for (let i = 0; i < sqlQueries.length; i++) {
                                const insightsPrompt = prompt_templates_1.prompts.generateInsights(queryString, sqlQueries[i], queryResults[i]);
                                const insightsResponse = yield (0, query_ai_1.queryAI)(insightsPrompt.system, insightsPrompt.user, true);
                                console.log(`🧠 Step 7 - Insights response for query ${i + 1}:`, insightsResponse);
                                const insightsResult = JSON.parse(insightsResponse);
                                allInsights.push(insightsResult);
                                // Generate visualization suggestions and prepare data
                                const vizPrompt = prompt_templates_1.prompts.generateVisualization(queryString, sqlQueries[i], queryResults[i]);
                                const vizResponse = yield (0, query_ai_1.queryAI)(vizPrompt.system, vizPrompt.user, true);
                                console.log(`📊 Step 8 - Visualization response for query ${i + 1}:`, vizResponse);
                                const vizResult = JSON.parse(vizResponse);
                                visualizationData.push(vizResult);
                            }
                            // Combine insights from all queries
                            combinedInsights = {
                                directAnswer: allInsights[0].directAnswer, // Use first query's direct answer
                                insights: allInsights.flatMap((result) => result.insights),
                                patterns: allInsights.map((result) => result.patterns).filter(Boolean).join(' '),
                                followUpQuestions: [...new Set(allInsights.flatMap((result) => result.followUpQuestions || []))],
                                visualizations: visualizationData
                            };
                            // Validate the combined answer
                            console.log('🔍 Step 7 - Validating combined answer');
                            const validatePrompt = prompt_templates_1.prompts.validateAnswer(queryString, combinedInsights.directAnswer);
                            const validationResponse = yield (0, query_ai_1.queryAI)(validatePrompt.system, validatePrompt.user, true);
                            const validationResult = JSON.parse(validationResponse);
                            console.log('🔍 Step 7 - Validation result:', validationResult);
                            if (validationResult.isAnswered) {
                                validAnswer = true;
                                response = combinedInsights.directAnswer;
                                insights = combinedInsights.insights;
                                patterns = combinedInsights.patterns;
                                followUpQuestions = combinedInsights.followUpQuestions;
                            }
                            else {
                                lastError = validationResult.reason || 'Answer does not address the question';
                                console.log(`⚠️ Answer validation failed: ${lastError}`);
                            }
                        }
                    }
                    catch (error) {
                        lastError = error.message;
                        console.error(`❌ Error in attempt ${attempts}:`, error);
                    }
                }
                if (!validAnswer) {
                    response = "I apologize, but I was unable to generate a satisfactory answer to your question after multiple attempts. " +
                        "The last error encountered was: " + lastError;
                }
                break;
            case 'OUT_OF_SCOPE':
                console.log('⚠️ Query marked as out of scope');
                response = "I apologize, but this question appears to be outside the scope of database-related queries I can help with.";
                break;
        }
        console.log('✅ Final response:', { response, timestamp: new Date().toISOString(), queryType });
        res.status(200).json({
            success: true,
            message: "Query processed successfully",
            response,
            insights,
            patterns,
            followUpQuestions,
            visualizations: validAnswer && combinedInsights ? combinedInsights.visualizations : [],
            timestamp: new Date().toISOString(),
            queryType
        });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});
exports.responseQuery = responseQuery;
