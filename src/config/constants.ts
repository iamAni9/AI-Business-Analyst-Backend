// Database
export const POSTGRES_USER_TABLE = 'users';
export const POSTGRES_USER_DATA_TABLE = 'users_data';

// Session
export const SESSION_EXPIRY = 1000 * 60 * 60 * 24 // 1 day

// Password hasing cost
export const SALT_ROUNDS = 10;

// Rows limit for LLM analysis of uploaded csv file
export const SAMPLE_ROW_LIMIT = 10;

// Limits for chat controller
export const MAX_RETRY_ATTEMPTS = 3;
export const MAX_EVAL_ITERATION = 3;
export const INITIAL_RETRY_DELAY = 1000; // 1 second