-- Add fuel_surcharge column to invoices table
ALTER TABLE invoices ADD COLUMN fuel_surcharge REAL DEFAULT 0;
