interface ColumnSchema {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
}

export interface TableSchema {
  columns: ColumnSchema[];
}