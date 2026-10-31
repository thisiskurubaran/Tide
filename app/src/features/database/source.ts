// What the database viewer needs from a database: a SQLite file in the project
// or a Postgres / MySQL server. Rows that can be edited carry their key under
// ROWID (SQLite's rowid, or a server table's primary key values).
import { allRows, Db, deleteRow, insertRow, listTables, QueryResult, Row, ROWID, runSql, TableInfo, tablePage, updateCell } from './database';

export interface Page {
  columns: string[];
  rows: Row[];
  editable: boolean;
}

export interface DbSource {
  listTables(): Promise<TableInfo[]>;
  page(table: string, offset: number): Promise<Page>;
  updateCell(table: string, row: Row, column: string, text: string): Promise<void>;
  deleteRow(table: string, row: Row): Promise<void>;
  insertRow(table: string, values: Record<string, string>): Promise<void>;
  allRows(table: string): Promise<{ columns: string[]; rows: Row[] }>;
  run(sql: string): Promise<QueryResult>;
  close(): Promise<void>;
  // Shown when a table can't be edited from the grid.
  readOnlyNote: string;
  // Shown under the SQL box before anything runs.
  sqlNote: string;
  sqlPlaceholder: string;
}

export function sqliteSource(db: Db): DbSource {
  return {
    listTables: () => listTables(db),
    page: (table, offset) => tablePage(db, table, offset),
    updateCell: (table, row, column, text) => updateCell(db, table, row[ROWID], column, text),
    deleteRow: (table, row) => deleteRow(db, table, row[ROWID]),
    insertRow: async (table, values) => {
      await insertRow(db, table, values);
    },
    allRows: (table) => allRows(db, table),
    run: (sql) => runSql(db, sql),
    close: () => db.closeAsync(),
    readOnlyNote: 'Views and WITHOUT ROWID tables can be changed with SQL.',
    sqlNote: 'Changes are saved to the file.',
    sqlPlaceholder: 'SELECT * FROM users WHERE age > 30',
  };
}
