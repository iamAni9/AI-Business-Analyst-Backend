-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Analysis data table
CREATE TABLE IF NOT EXISTS analysis_data (
    id UUID PRIMARY KEY,
    table_id VARCHAR(255) NOT NULL,
    table_description TEXT NOT NULL,
    schema JSONB NOT NULL,
    analysis JSONB NOT NULL,
    data_summary JSONB NOT NULL,
    column_insights JSONB NOT NULL,
    business_context JSONB NOT NULL,
    data_relationships JSONB NOT NULL,
    data_trends JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_analysis_data_id ON analysis_data(id); 