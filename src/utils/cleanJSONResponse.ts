import logger from "../config/logger";

export const cleanAndParseJson = (dirtyString: string) => {
    let cleanStr = dirtyString;

    // 1. Extract content from markdown code block if present
    const match = cleanStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
        cleanStr = match[1];
    }

    // 2. If no code block, find the first '{' or '[' and last '}' or ']'
    else {
        const firstBracket = cleanStr.indexOf('{');
        const firstSquare = cleanStr.indexOf('[');
        let startIndex = -1;

        if (firstBracket === -1) startIndex = firstSquare;
        else if (firstSquare === -1) startIndex = firstBracket;
        else startIndex = Math.min(firstBracket, firstSquare);

        const lastBracket = cleanStr.lastIndexOf('}');
        const lastSquare = cleanStr.lastIndexOf(']');
        let endIndex = Math.max(lastBracket, lastSquare);
        
        if (startIndex !== -1 && endIndex !== -1) {
             cleanStr = cleanStr.substring(startIndex, endIndex + 1);
        }
    }

    // 3. Remove trailing commas from objects and arrays
    cleanStr = cleanStr.replace(/,\s*([}\]])/g, '$1');

    // 4. Correct the specific double-double-quote issue from your log
    // This is fragile but targets the specific problem you had.
    cleanStr = cleanStr.replace(/:\s*""/g, ': "').replace(/""/g, '"');

    // 5. Remove comments (// and /* */)
    cleanStr = cleanStr.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    
    // 6. Trim whitespace just in case
    cleanStr = cleanStr.trim();

    // Final attempt to parse
    try {
        return JSON.parse(cleanStr);
    } catch (e) {
        // If it still fails, log the version we tried to parse for debugging
        logger.error(`The cleaned string that failed to parse: ${cleanStr}`);
        throw e; // Re-throw the original error
    }
}