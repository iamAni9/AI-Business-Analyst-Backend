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

// Date and Time format
export const DATA_TIME_FORMAT = [
    // Date only
  'YYYY-MM-DD',
  'MM-DD-YYYY',
  'DD-MM-YYYY',
  'YYYY/MM/DD',
  'MM/DD/YYYY',
  'DD/MM/YYYY',

  // Time only
  'HH:mm',
  'HH:mm:ss',
  'HH:mm:ss.SSS',     // milliseconds
  'HH:mm:ss.SSSSSS',  // microseconds 

  // Date + Time (no timezone)
  'YYYY-MM-DD HH:mm:ss',
  'YYYY-MM-DD HH:mm:ss.SSS',
  'YYYY-MM-DD HH:mm:ss.SSSSSS',

  'MM-DD-YYYY HH:mm:ss',
  'MM-DD-YYYY HH:mm:ss.SSS',

  'DD-MM-YYYY HH:mm:ss',
  'DD-MM-YYYY HH:mm:ss.SSS',

  'YYYY/MM/DD HH:mm:ss',
  'YYYY/MM/DD HH:mm:ss.SSS',

  'MM/DD/YYYY HH:mm:ss',
  'MM/DD/YYYY HH:mm:ss.SSS',

  'DD/MM/YYYY HH:mm:ss',
  'DD/MM/YYYY HH:mm:ss.SSS',

  // Date + Time + UTC or other TZ
  'YYYY-MM-DD HH:mm:ss [UTC]',
  'YYYY-MM-DD HH:mm:ss.SSS [UTC]',
  'YYYY-MM-DD HH:mm:ss.SSSSSS [UTC]',

  'YYYY-MM-DD HH:mm:ss Z',           // e.g., +00:00
  'YYYY-MM-DD HH:mm:ss.SSS Z',
  'YYYY-MM-DD HH:mm:ss.SSSSSS Z',

  'YYYY-MM-DDTHH:mm:ssZ',            // ISO 8601 basic
  'YYYY-MM-DDTHH:mm:ss.SSSZ',
  'YYYY-MM-DDTHH:mm:ss.SSSSSSZ'    
];