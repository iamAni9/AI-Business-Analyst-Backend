# Backend Documentation

## Overview
This is the backend service for the Insight AI application. It provides RESTful API endpoints for user management, data operations, and analysis functionality.

## Tech Stack
- Node.js
- Express.js
- TypeScript
- Google BigQuery
- Morgan (Logging)
- CORS
- dotenv

## Prerequisites
- Node.js (v14 or higher)
- Google Cloud Platform account
- BigQuery access
- Environment variables configured

## Environment Variables
Create a `.env` file in the root directory with the following variables:
```
PORT=3000
GOOGLE_CLOUD_PROJECT=your-project-id
# Add other required environment variables
```

## Installation
1. Clone the repository
2. Navigate to the backend directory:
```bash
cd backend
```
3. Install dependencies:
```bash
npm install
```
4. Start the development server:
```bash
npm run dev
```

## API Endpoints

### Base URL
`http://localhost:3000`

### Authentication
All API endpoints are prefixed with `/v1/api`

### User Routes (`/v1/api/users`)
- User management endpoints
- Authentication and authorization
- User profile operations

### Data Routes (`/v1/api/data`)
- Data management endpoints
- Data processing operations

### Schema Initialization
- `/init-user-data-schema` (GET)
  - Initializes the user data schema in BigQuery
  - Returns success/error message

- `/init-analysis-schema` (GET)
  - Initializes the analysis schema in BigQuery
  - Returns success/error message

### Data Querying
- `/query/:table` (GET)
  - Queries specific tables in the insight_ai dataset
  - Returns up to 10 rows from the specified table
  - Parameters:
    - `table`: Name of the table to query

## Error Handling
The application includes global error handling middleware that:
- Logs errors using the configured logger
- Returns appropriate HTTP status codes
- Provides error messages in JSON format

## Logging
- Uses Morgan for HTTP request logging
- Custom logger configuration for application logs
- Logs are streamed to both console and file

## BigQuery Integration
The application integrates with Google BigQuery for:
- Data storage and retrieval
- Schema management
- Query execution

## Project Structure
```
backend/
├── src/
│   ├── config/
│   │   ├── logger.ts
│   │   ├── bigquery.ts
│   │   ├── initSchema.ts
│   │   ├── initUserDataSchema.ts
│   │   └── initAnalysisSchema.ts
│   ├── routes/
│   │   ├── userRoutes.ts
│   │   └── dataRoutes.ts
│   ├── ai/
│   │   └── client.ts
│   └── index.ts
├── .env
└── package.json
```

## Development
- The server runs on port 3000 by default
- CORS is enabled for cross-origin requests
- JSON parsing middleware is configured
- Request logging is enabled

## Security
- CORS protection
- Environment variable management
- Error handling and logging
- Input validation (implemented in route handlers)

## Contributing
1. Follow the existing code style
2. Add appropriate error handling
3. Include logging for new features
4. Update documentation for new endpoints

## License
[Add your license information here] 