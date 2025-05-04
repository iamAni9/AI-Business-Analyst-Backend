-- Create TABLE_SCHEMA table to store table analysis results
CREATE TABLE IF NOT EXISTS TABLE_SCHEMA (
    table_name VARCHAR(255) PRIMARY KEY,
    analysis JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create user_data table to store user upload information
CREATE TABLE IF NOT EXISTS user_data (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    table_name VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (table_name) REFERENCES TABLE_SCHEMA(table_name) ON DELETE CASCADE
);

-- Create index on user_data for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_data_email ON user_data(email);
CREATE INDEX IF NOT EXISTS idx_user_data_user_id ON user_data(user_id); 