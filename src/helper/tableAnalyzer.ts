import { query } from '../config/db';
import { queryAI } from './query-ai';

export async function analyzeTable(
    tableName: string,
    sampleSize: number = 1000,
    maxDistinctValues: number = 100
): Promise<Record<string, any>> {
    try {
        // Get table info and sample data
        const sampleQuery = `
      SELECT * FROM "${tableName}" 
      ORDER BY RANDOM() 
      LIMIT ${sampleSize}
    `;
        const result = await query(sampleQuery);
        const columns = result.fields.map((field: any) => field.name);

        const dataDictionary: Record<string, any> = {};

        for (const column of columns) {
            const columnData = result.rows.map((row: any) => row[column]);
            const distinctValues = new Set(columnData);
            const nullCount = columnData.filter((value: any) => value === null).length;
            const columnType = result.fields.find((field: any) => field.name === column)?.dataTypeID;

            dataDictionary[column] = {
                type: getHumanReadableType(columnType),
                distinctCount: distinctValues.size,
                nullCount,
                nullPercentage: (nullCount / sampleSize) * 100,
            };

            if (distinctValues.size <= maxDistinctValues) {
                const valueCounts = columnData.reduce((acc: any, value: any) => {
                    acc[value] = (acc[value] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>);

                dataDictionary[column].topValues = Object.entries(valueCounts)
                    .sort((a: any, b: any) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([value, count]) => ({ value, count }));
            }

            // Handle numeric columns
            if (getHumanReadableType(columnType) === 'number') {
                const numericValues = columnData.filter((value: any) => value !== null).map(Number);
                if (numericValues.length > 0) {
                    dataDictionary[column].min = Math.min(...numericValues);
                    dataDictionary[column].max = Math.max(...numericValues);
                }
            }
            // Handle date/timestamp columns
            else if (getHumanReadableType(columnType) === 'date') {
                const dateValues = columnData.filter(value => value !== null).map(value => new Date(value));
                if (dateValues.length > 0) {
                    dataDictionary[column].min = new Date(Math.min(...dateValues.map(date => date.getTime())));
                    dataDictionary[column].max = new Date(Math.max(...dateValues.map(date => date.getTime())));
                }
            }
        }

        const llmSummary = await generateLLMSummary(dataDictionary);
        console.log(llmSummary);
        return llmSummary;

    } catch (error) {
        console.error('Error analyzing table:', error);
        throw new Error('Failed to analyze table');
    }
}

async function generateLLMSummary(dataDictionary: Record<string, any>): Promise<Record<string, string>> {
    const systemPrompt = `You are an expert data analyst with deep knowledge of database schemas and statistical analysis. Your task is to generate concise, accurate, and human-readable descriptions for each field in a data dictionary. Each description should include the field’s data type and notable characteristics (e.g., null percentage, top values, min/max for numeric or date fields) derived from a sample of the data. Avoid technical jargon unless necessary, and ensure descriptions are clear to non-experts. Format your response as a valid JSON object where each key is a field name and each value is a string description. Keep each description under 50 words. If the input lacks specific details, make reasonable assumptions but note them. Handle edge cases (e.g., high null percentages or unknown types) gracefully.`;
    const userPrompt = `Given the following data dictionary, provide a description for each field:

${JSON.stringify(dataDictionary, null, 2)}

Format your response as a JSON object where keys are field names and values are descriptions.`;

    const response = await queryAI(systemPrompt, userPrompt, true);
    return JSON.parse(response);
}

function getHumanReadableType(typeId: number | undefined): string {
    if (!typeId) return 'unknown';

    const typeMap: Record<string, string> = {
        '16': 'boolean',
        '20': 'number', // bigint
        '21': 'number', // smallint
        '23': 'number', // integer
        '700': 'number', // real/float4
        '701': 'number', // double precision/float8
        '1082': 'date', // date
        '1114': 'date', // timestamp without timezone
        '1184': 'date', // timestamp with timezone
        '25': 'text', // text
        '1043': 'text', // varchar
        '1700': 'number', // numeric/decimal
    };

    return typeMap[typeId.toString()] || 'unknown';
}