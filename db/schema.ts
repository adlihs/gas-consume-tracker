import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
// One atomic versioned aggregate per vehicle keeps history edits consistent.
export const vehicles=sqliteTable('vehicles',{id:text('id').primaryKey(),owner:text('owner').notNull(),payload:text('payload').notNull(),revision:integer('revision').notNull().default(1)},t=>[index('idx_vehicles_owner').on(t.owner)]);
