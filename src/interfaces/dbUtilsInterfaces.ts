// interface ColumnSchema {
//   column_name: string;
//   data_type: string;
//   is_nullable: 'YES' | 'NO';
// }

// export interface TableSchema {
//   columns: ColumnSchema[];
// }

interface ColumnSchema {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
  character_maximum_length?: number;
  numeric_precision?: number;
  numeric_scale?: number;
};

export interface TableSchema {
  columns: ColumnSchema[];
};