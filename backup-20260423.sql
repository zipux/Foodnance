PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0001_initial_schema.sql','2026-04-07 05:51:23');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(2,'0002_invoice_lines.sql','2026-04-07 05:51:23');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(3,'0003_entry_invoice_file.sql','2026-04-07 05:51:23');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(4,'0004_entry_invoice_id.sql','2026-04-07 05:51:23');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(5,'0005_vendor_fee_templates.sql','2026-04-07 05:51:23');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(6,'0006_invoice_fuel_surcharge.sql','2026-04-07 05:51:23');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(7,'0007_product_mappings.sql','2026-04-07 05:51:24');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(8,'0008_invoice_deposit.sql','2026-04-07 06:04:49');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(9,'0009_avg_weight.sql','2026-04-12 06:56:18');
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT DEFAULT '',
  email TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "suppliers" ("id","name","contact","email","notes","created_at") VALUES('mnp7fkigfqxls2','YEN BROS. FOOD SERVICE (2011) LTD.','','','','2026-04-07 22:42:21');
INSERT INTO "suppliers" ("id","name","contact","email","notes","created_at") VALUES('mntm2n91dmdgrm','La Grotta Del Formaggio','','','','2026-04-11 00:43:17');
INSERT INTO "suppliers" ("id","name","contact","email","notes","created_at") VALUES('mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','','','','2026-04-12 07:29:29');
INSERT INTO "suppliers" ("id","name","contact","email","notes","created_at") VALUES('mnwe5bbu155t30','Alsco Canada Corporation','','','','2026-04-12 23:24:44');
INSERT INTO "suppliers" ("id","name","contact","email","notes","created_at") VALUES('mnwgh04s6s0xc2','Cioffi''s Meat Market & Deli','604 498 39839','simoneisonni@gmail.com','notes','2026-04-13 00:29:48');
INSERT INTO "suppliers" ("id","name","contact","email","notes","created_at") VALUES('mnxjgi2im5vz9x','Sid Wainer & Son','','','','2026-04-13 18:41:10');
INSERT INTO "suppliers" ("id","name","contact","email","notes","created_at") VALUES('mo7x4sfnpvlc9q','Oyster and King','','','','2026-04-21 01:01:40');
INSERT INTO "suppliers" ("id","name","contact","email","notes","created_at") VALUES('mo7x6os2771qob','SNOW CAP ENTERPRISES LTD.','','','','2026-04-21 01:03:08');
CREATE TABLE generic_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Ingredients',
  sub_unit_name TEXT DEFAULT '',
  sub_unit_qty REAL DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
, avg_weight_per_unit REAL DEFAULT NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mnwi5qdkpavuzc','Penne','Ingredients','',NULL,'2026-04-13 01:17:01',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mnwi5qgudec8x5','Prosciutto Cotto','Ingredients','',NULL,'2026-04-13 01:17:02',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mnwi5qjpv7tnsj','Prosciutto Deli Ready','Ingredients','',NULL,'2026-04-13 01:17:02',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mnwi5qmhxn5wdx','Olives Nicoise Pitted','Ingredients','',NULL,'2026-04-13 01:17:02',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mnwi5qp6ka9z1q','Olives Mixed','Ingredients','',NULL,'2026-04-13 01:17:02',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mnwi5qs8nfwn5p','Pork Bacon Slab','Ingredients','',NULL,'2026-04-13 01:17:02',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mnwi5qvbumpjlz','Pork Bacon Olymel','Ingredients','',NULL,'2026-04-13 01:17:02',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mnwi5qy6s1klpj','Anchovies Fill in Oil','Ingredients','',NULL,'2026-04-13 01:17:02',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mnwi5r1p61bm4w','Pecorino Romano','Ingredients','',NULL,'2026-04-13 01:17:02',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mnwi5r4kup4qel','Grana Padano','Ingredients','',NULL,'2026-04-13 01:17:02',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mnxjhni7igrxcm','Basil','Ingredients',NULL,NULL,'2026-04-13 18:42:03',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mnxjhnlwhdgigr','Anise (Fennel)','Ingredients','',NULL,'2026-04-13 18:42:04',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mnxjhnoafs0n90','Film Wrap','Packaging','',NULL,'2026-04-13 18:42:04',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mnxjhnqpubd8xg','Bio Cont #8- Medium','Disposables','',NULL,'2026-04-13 18:42:04',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mnxjhnt7zm070t','Bio Cont #1 Comp Small','Disposables','',NULL,'2026-04-13 18:42:04',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mnxjhnvkgaaboe','Paper Towel Multifold Nat','Disposables',NULL,NULL,'2026-04-13 18:42:04',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mo7wzkbdhcbqww','KALE GREEN','Ingredients','',NULL,'2026-04-21 00:57:36',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mo7wzkewc1bcb4','JUICE LEMON FRESH','Non-Alcoholic Beverages','',NULL,'2026-04-21 00:57:36',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mo7wzki891i1rg','CANOLA OIL','Ingredients','',NULL,'2026-04-21 00:57:36',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mo7wzklcb3yo7f','SQUASH ZUCCHINI GREEN','Ingredients','',NULL,'2026-04-21 00:57:36',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mo7wzkokjo2l6j','LIME','Ingredients','',NULL,'2026-04-21 00:57:36',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mo7wzkrv4i7v54','HERB-MINT BUNCH','Ingredients','',NULL,'2026-04-21 00:57:36',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mo7wzkv9py98gd','LEMON FANCY','Ingredients','',NULL,'2026-04-21 00:57:37',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mo7wzkyqqxuwpy','CUCUMBER L.E. MEDIUM #1','Ingredients','',NULL,'2026-04-21 00:57:37',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mo7wzl28k9ku1e','HERB ITALIAN PARSLEY','Ingredients','',NULL,'2026-04-21 00:57:37',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mo7wzl7kpi6fu5','SO POTATO FINGERLING','Ingredients','',NULL,'2026-04-21 00:57:37',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mo7x4sh4ctzs33','Nicli Mix','Ingredients','',NULL,'2026-04-21 01:01:40',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mo7x4sjt0sdmfd','White Button','Ingredients','',NULL,'2026-04-21 01:01:40',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mo7x6otfn4ant0','Primo Mulino 00 Style Flour','Ingredients','',NULL,'2026-04-21 01:03:08',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('mo7x6ow0320ziq','Semolina','Ingredients',NULL,NULL,'2026-04-21 01:03:08',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('moasbl872ml9er','Vegetable Mirepoix Mix','Ingredients','',NULL,'2026-04-23 01:10:17',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('moasblawgbdehc','Onion Red Sliced','Ingredients','',NULL,'2026-04-23 01:10:17',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('moasbldmqcfm3w','Pepper Jalapeno','Ingredients','',NULL,'2026-04-23 01:10:18',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('moasblgeegruva','Spinach Cello','Ingredients','',NULL,'2026-04-23 01:10:18',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('moasblj5i2tagq','Tomato, Cherry Bulk','Ingredients','',NULL,'2026-04-23 01:10:18',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('moasnqh5h239mz','Semolina- Durum','Ingredients',NULL,NULL,'2026-04-23 01:19:44',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('moasnqjrxy48fd','Sugar- Granulated Fine','Ingredients','',NULL,'2026-04-23 01:19:44',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('moasnqmcvkseap','Vinegar- Apple Cider','Ingredients','',NULL,'2026-04-23 01:19:44',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('moasnqp281riyx','Milk- Homogenized','Ingredients','',NULL,'2026-04-23 01:19:44',NULL);
INSERT INTO "generic_products" ("id","name","category","sub_unit_name","sub_unit_qty","created_at","avg_weight_per_unit") VALUES('moasnqrxmoqb3j','Milk Crate','Ingredients','',NULL,'2026-04-23 01:19:44',NULL);
CREATE TABLE product_entries (
  id TEXT PRIMARY KEY,
  generic_product_id TEXT NOT NULL,
  generic_product_name TEXT NOT NULL,
  supplier_id TEXT DEFAULT '',
  supplier_name TEXT DEFAULT '',
  vendor_item_name TEXT DEFAULT '',
  sku TEXT DEFAULT '',
  pack_qty REAL DEFAULT 1,
  pack_unit TEXT DEFAULT 'Each',
  cost REAL DEFAULT 0,
  cost_per_unit REAL DEFAULT 0,
  purchase_date TEXT DEFAULT '',
  expiry_date TEXT DEFAULT '',
  days_left INTEGER DEFAULT NULL,
  invoice_ref TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, invoice_file_key  TEXT DEFAULT '', invoice_file_name TEXT DEFAULT '', invoice_id TEXT DEFAULT '',
  FOREIGN KEY (generic_product_id) REFERENCES generic_products(id) ON DELETE CASCADE
);
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mnwi5qey82ig6z','mnwi5qdkpavuzc','Penne','mnwgh04s6s0xc2','Cioffi''s Meat Market & Deli','Penne','WS2049',500,'g',53.09,53.09,'2026-03-20','',NULL,'nv','2026-04-13 01:17:02','uploads/mnwi4lgo8btrzi.jpg','nv.jpg','mnwi5psn0k6ffk');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mnwi5qi5f6bt88','mnwi5qgudec8x5','Prosciutto Cotto','mnwgh04s6s0xc2','Cioffi''s Meat Market & Deli','Prosciutto Cotto','WS00146',1,'kg',38.45,14.19,'2026-03-20','',NULL,'nv','2026-04-13 01:17:02','uploads/mnwi4lgo8btrzi.jpg','nv.jpg','mnwi5psn0k6ffk');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mnwi5qkz7kwk0b','mnwi5qjpv7tnsj','Prosciutto Deli Ready','mnwgh04s6s0xc2','Cioffi''s Meat Market & Deli','Prosciutto Deli Ready','NIC03217',1,'kg',154.72,32.99,'2026-03-20','',NULL,'nv','2026-04-13 01:17:02','uploads/mnwi4lgo8btrzi.jpg','nv.jpg','mnwi5psn0k6ffk');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mnwi5qnmle43bo','mnwi5qmhxn5wdx','Olives Nicoise Pitted','mnwgh04s6s0xc2','Cioffi''s Meat Market & Deli','Olives Nicoise Pitted','WS2624',2,'kg',36.99,18.5,'2026-03-20','',NULL,'nv','2026-04-13 01:17:02','uploads/mnwi4lgo8btrzi.jpg','nv.jpg','mnwi5psn0k6ffk');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mnwi5qqd70t4rn','mnwi5qp6ka9z1q','Olives Mixed','mnwgh04s6s0xc2','Cioffi''s Meat Market & Deli','Olives Mixed','WS1411',1,'kg',99.96,24.99,'2026-03-20','',NULL,'nv','2026-04-13 01:17:02','uploads/mnwi4lgo8btrzi.jpg','nv.jpg','mnwi5psn0k6ffk');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mnwi5qtkqxuwcp','mnwi5qs8nfwn5p','Pork Bacon Slab','mnwgh04s6s0xc2','Cioffi''s Meat Market & Deli','Pork Bacon Slab','WS02055',1,'kg',150.78,18.5,'2026-03-20','',NULL,'nv','2026-04-13 01:17:02','uploads/mnwi4lgo8btrzi.jpg','nv.jpg','mnwi5psn0k6ffk');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mnwi5qwknkkeuv','mnwi5qvbumpjlz','Pork Bacon Olymel','mnwgh04s6s0xc2','Cioffi''s Meat Market & Deli','Pork Bacon Olymel','WS01060',5,'kg',75,15,'2026-03-20','',NULL,'nv','2026-04-13 01:17:02','uploads/mnwi4lgo8btrzi.jpg','nv.jpg','mnwi5psn0k6ffk');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mnwi5qzhljbjei','mnwi5qy6s1klpj','Anchovies Fill in Oil','mnwgh04s6s0xc2','Cioffi''s Meat Market & Deli','Anchovies Fill in Oil','WS07468',560,'g',22.59,22.59,'2026-03-20','',NULL,'nv','2026-04-13 01:17:02','uploads/mnwi4lgo8btrzi.jpg','nv.jpg','mnwi5psn0k6ffk');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mnwi5r2y1b34py','mnwi5r1p61bm4w','Pecorino Romano','mnwgh04s6s0xc2','Cioffi''s Meat Market & Deli','Pecorino Romano','NIC00923',1,'kg',59.98,29.99,'2026-03-20','',NULL,'nv','2026-04-13 01:17:02','uploads/mnwi4lgo8btrzi.jpg','nv.jpg','mnwi5psn0k6ffk');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mnwi5r5r7ohg84','mnwi5r4kup4qel','Grana Padano','mnwgh04s6s0xc2','Cioffi''s Meat Market & Deli','Grana Padano','NIC00107',1,'kg',119.96,29.99,'2026-03-20','',NULL,'nv','2026-04-13 01:17:03','uploads/mnwi4lgo8btrzi.jpg','nv.jpg','mnwi5psn0k6ffk');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mnxjhnjrx95fui','mnxjhni7igrxcm','Basil','mnp7fkigfqxls2','YEN BROS. FOOD SERVICE (2011) LTD.','Basil','161210',1,'lb',40.05,13.35,'2026-03-27','',NULL,'basil1','2026-04-13 18:42:04','uploads/mnxjgzqxv0tfvo.jpg','basil1.jpg','mnxjhmt1u92uup');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mnxjhnn0qd9iq3','mnxjhnlwhdgigr','Anise (Fennel)','mnp7fkigfqxls2','YEN BROS. FOOD SERVICE (2011) LTD.','Anise (Fennel)','170150x',1,'each',28.1,2.81,'2026-03-27','',NULL,'basil1','2026-04-13 18:42:04','uploads/mnxjgzqxv0tfvo.jpg','basil1.jpg','mnxjhmt1u92uup');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mnxjhnpbhkj3yf','mnxjhnoafs0n90','Film Wrap','mnp7fkigfqxls2','YEN BROS. FOOD SERVICE (2011) LTD.','Film Wrap','650568',2500,'case',41.32,41.32,'2026-03-27','',NULL,'basil1','2026-04-13 18:42:04','uploads/mnxjgzqxv0tfvo.jpg','basil1.jpg','mnxjhmt1u92uup');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mnxjhnrtr8x00k','mnxjhnqpubd8xg','Bio Cont #8- Medium','mnp7fkigfqxls2','YEN BROS. FOOD SERVICE (2011) LTD.','Bio Cont #8- Medium','659316',1,'each',47.84,47.84,'2026-03-27','',NULL,'basil1','2026-04-13 18:42:04','uploads/mnxjgzqxv0tfvo.jpg','basil1.jpg','mnxjhmt1u92uup');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mnxjhnua4d7175','mnxjhnt7zm070t','Bio Cont #1 Comp Small','mnp7fkigfqxls2','YEN BROS. FOOD SERVICE (2011) LTD.','Bio Cont #1 Comp Small','668698',6,'case',53.99,53.99,'2026-03-27','',NULL,'basil1','2026-04-13 18:42:04','uploads/mnxjgzqxv0tfvo.jpg','basil1.jpg','mnxjhmt1u92uup');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mnxjhnwnky6gcs','mnxjhnvkgaaboe','Paper Towel Multifold Nat','mnp7fkigfqxls2','YEN BROS. FOOD SERVICE (2011) LTD.','Paper Towel Multifold Nat','',16,'case',517.6,32.35,'2026-03-27','',NULL,'2784897','2026-04-13 18:42:04','','','');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mo7wzkcqh9so05','mo7wzkbdhcbqww','KALE GREEN','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','KALE GREEN','103501',1,'each',6,2,'2026-03-24','',NULL,'basil2','2026-04-21 00:57:36','uploads/mo7wyuqwby1yob.jpg','basil2.jpg','mo7wzjnc5602my');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mo7wzkg8fiy1c3','mo7wzkewc1bcb4','JUICE LEMON FRESH','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','JUICE LEMON FRESH','513045',1.89,'L',16.94,8.96,'2026-03-24','',NULL,'basil2','2026-04-21 00:57:36','uploads/mo7wyuqwby1yob.jpg','basil2.jpg','mo7wzjnc5602my');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mo7wzkjipsbtzg','mo7wzki891i1rg','CANOLA OIL','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','CANOLA OIL','517004',35,'lb',37.58,1.07,'2026-03-24','',NULL,'basil2','2026-04-21 00:57:36','uploads/mo7wyuqwby1yob.jpg','basil2.jpg','mo7wzjnc5602my');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mo7wzkmm7rp1tb','mo7wzklcb3yo7f','SQUASH ZUCCHINI GREEN','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','SQUASH ZUCCHINI GREEN','107901',1,'lb',12.28,3.07,'2026-03-24','',NULL,'basil2','2026-04-21 00:57:36','uploads/mo7wyuqwby1yob.jpg','basil2.jpg','mo7wzjnc5602my');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mo7wzkpyk046nm','mo7wzkokjo2l6j','LIME','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','LIME','123601',1,'each',6.24,1.04,'2026-03-24','',NULL,'basil2','2026-04-21 00:57:36','uploads/mo7wyuqwby1yob.jpg','basil2.jpg','mo7wzjnc5602my');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mo7wzkt9prgqx8','mo7wzkrv4i7v54','HERB-MINT BUNCH','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','HERB-MINT BUNCH','103351',1,'each',1.85,1.85,'2026-03-24','',NULL,'basil2','2026-04-21 00:57:36','uploads/mo7wyuqwby1yob.jpg','basil2.jpg','mo7wzjnc5602my');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mo7wzkwr7lghke','mo7wzkv9py98gd','LEMON FANCY','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','LEMON FANCY','123502',1,'lb',1.51,1.51,'2026-03-24','',NULL,'basil2','2026-04-21 00:57:37','uploads/mo7wyuqwby1yob.jpg','basil2.jpg','mo7wzjnc5602my');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mo7wzl0182j41g','mo7wzkyqqxuwpy','CUCUMBER L.E. MEDIUM #1','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','CUCUMBER L.E. MEDIUM #1','102001',1,'each',9.27,3.09,'2026-03-24','',NULL,'basil2','2026-04-21 00:57:37','uploads/mo7wyuqwby1yob.jpg','basil2.jpg','mo7wzjnc5602my');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mo7wzl3mju1i3c','mo7wzl28k9ku1e','HERB ITALIAN PARSLEY','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','HERB ITALIAN PARSLEY','103311',1,'lb',13.5,13.5,'2026-03-24','',NULL,'basil2','2026-04-21 00:57:37','uploads/mo7wyuqwby1yob.jpg','basil2.jpg','mo7wzjnc5602my');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mo7wzl5loj83q5','mnxjhni7igrxcm','Basil','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','Basil','103303',1,'lb',18.05,18.05,'2026-03-24','',NULL,'basil2','2026-04-21 00:57:37','uploads/mo7wyuqwby1yob.jpg','basil2.jpg','mo7wzjnc5602my');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mo7wzl8u8eg7qw','mo7wzl7kpi6fu5','SO POTATO FINGERLING','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','SO POTATO FINGERLING','106515',12,'lb',29.96,2.5,'2026-03-24','',NULL,'basil2','2026-04-21 00:57:37','uploads/mo7wyuqwby1yob.jpg','basil2.jpg','mo7wzjnc5602my');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mo7x4si7388jn4','mo7x4sh4ctzs33','Nicli Mix','mo7x4sfnpvlc9q','Oyster and King','Nicli Mix','1021',5,'lb',132,6.6,'2026-04-14','',NULL,'mus','2026-04-21 01:01:40','uploads/mo7x45u0hkekpl.jpg','mus.jpg','mo7x4s4kbsitt7');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mo7x4sl2aacbo6','mo7x4sjt0sdmfd','White Button','mo7x4sfnpvlc9q','Oyster and King','White Button','2005',5,'lb',90,4.5,'2026-04-14','',NULL,'mus','2026-04-21 01:01:40','uploads/mo7x45u0hkekpl.jpg','mus.jpg','mo7x4s4kbsitt7');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mo7x6ouked3ta4','mo7x6otfn4ant0','Primo Mulino 00 Style Flour','mo7x6os2771qob','SNOW CAP ENTERPRISES LTD.','Primo Mulino 00 Style Flour','RH0134',20,'kg',1117,1.12,'2026-02-26','',NULL,'sno27-2','2026-04-21 01:03:08','uploads/mo7x68bsnw4ifd.jpg','sno27-2.jpg','mo7x6oh6rthlro');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mo7x6ox13jhrjj','mo7x6ow0320ziq','Semolina','mo7x6os2771qob','SNOW CAP ENTERPRISES LTD.','Durum Semolina','RH1567',20,'kg',31.200000000000003,1.56,'2026-02-26','',NULL,'72592597','2026-04-21 01:03:08','','','');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('moas89iuqscak4','mnxjhni7igrxcm','Basil','mnp7fkigfqxls2','YEN BROS. FOOD SERVICE (2011) LTD.','Basil','161210',1,'lb',106.8,13.35,'2026-03-26','',NULL,'basil3','2026-04-23 01:07:42','uploads/moas7ujopesf0b.jpg','basil3.jpg','moas897eb85qyn');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('moasbl98068hbs','moasbl872ml9er','Vegetable Mirepoix Mix','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','Vegetable Mirepoix Mix','',5,'lbs',82.4,3.3,'2026-04-15','',NULL,'nept','2026-04-23 01:10:17','uploads/moasa5y1mpoeji.jpg','nept.jpg','moasbkr4g98jno');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('moasblbzub6pjn','moasblawgbdehc','Onion Red Sliced','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','Onion Red Sliced','',5,'lb',53.28,3.55,'2026-04-15','',NULL,'nept','2026-04-23 01:10:18','uploads/moasa5y1mpoeji.jpg','nept.jpg','moasbkr4g98jno');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('moasblepf67pz1','moasbldmqcfm3w','Pepper Jalapeno','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','Pepper Jalapeno','',35,'LB',201.6,0.19,'2026-04-15','',NULL,'nept','2026-04-23 01:10:18','uploads/moasa5y1mpoeji.jpg','nept.jpg','moasbkr4g98jno');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('moasblhl7fal1x','moasblgeegruva','Spinach Cello','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','Spinach Cello','',2.5,'LB',65.3,13.06,'2026-04-15','',NULL,'nept','2026-04-23 01:10:18','uploads/moasa5y1mpoeji.jpg','nept.jpg','moasbkr4g98jno');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('moasblk8tt6edy','moasblj5i2tagq','Tomato, Cherry Bulk','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','Tomato, Cherry Bulk','',12,'LBS',174.57,4.85,'2026-04-15','',NULL,'nept','2026-04-23 01:10:18','uploads/moasa5y1mpoeji.jpg','nept.jpg','moasbkr4g98jno');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('moased3zngxded','moasblawgbdehc','Onion Red Sliced','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','Onion Red Sliced','37230',5,'lb',35.52,3.55,'2026-04-03','',NULL,'invoice_1775254967826_page_1','2026-04-23 01:12:27','uploads/moasc6agov5cuw.jpg','invoice_1775254967826_page_1.jpg','moasecm9tp0axy');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('moased5vld429l','moasblgeegruva','Spinach Cello','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','Spinach Cello','107502',21.5,'LB',32.65,1.52,'2026-04-03','',NULL,'invoice_1775254967826_page_1','2026-04-23 01:12:27','uploads/moasc6agov5cuw.jpg','invoice_1775254967826_page_1.jpg','moasecm9tp0axy');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('moased7m82f0rm','mnxjhni7igrxcm','Basil','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','Basil','103303',1,'lb',126.35,18.05,'2026-04-03','',NULL,'invoice_1775254967826_page_1','2026-04-23 01:12:27','uploads/moasc6agov5cuw.jpg','invoice_1775254967826_page_1.jpg','moasecm9tp0axy');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('moased9u69ag0b','moasblj5i2tagq','Tomato, Cherry Bulk','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','Tomato, Cherry Bulk','10728',12,'LBS',139.38,3.87,'2026-04-03','',NULL,'invoice_1775254967826_page_1','2026-04-23 01:12:27','uploads/moasc6agov5cuw.jpg','invoice_1775254967826_page_1.jpg','moasecm9tp0axy');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('moasedc0mear82','moasbldmqcfm3w','Pepper Jalapeno','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','Pepper Jalapeno','106302',35,'LB',152.7,0.15,'2026-04-03','',NULL,'invoice_1775254967826_page_1','2026-04-23 01:12:27','uploads/moasc6agov5cuw.jpg','invoice_1775254967826_page_1.jpg','moasecm9tp0axy');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('moasnqfl508k7l','mnxjhni7igrxcm','Basil','mnp7fkigfqxls2','YEN BROS. FOOD SERVICE (2011) LTD.','Basil','161210',1,'lb',13.379914,13.379914,'2026-04-15','',NULL,'2790033','2026-04-23 01:19:44','','','');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('moasnqibariaun','moasnqh5h239mz','Semolina- Durum','mnp7fkigfqxls2','YEN BROS. FOOD SERVICE (2011) LTD.','Semolina- Durum','467748',20,'kg',30.8,1.54,'2026-04-15','',NULL,'2790033','2026-04-23 01:19:44','','','');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('moasnqkxx9zfu0','moasnqjrxy48fd','Sugar- Granulated Fine','mnp7fkigfqxls2','YEN BROS. FOOD SERVICE (2011) LTD.','Sugar- Granulated Fine','561578',20,'kg',46.91,2.35,'2026-04-15','',NULL,'y','2026-04-23 01:19:44','uploads/moaskqd87br6ok.jpg','y.jpg','moasnq0r3cuign');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('moasnqni5w3evs','moasnqmcvkseap','Vinegar- Apple Cider','mnp7fkigfqxls2','YEN BROS. FOOD SERVICE (2011) LTD.','Vinegar- Apple Cider','579638X',4,'LT',8.2,8.2,'2026-04-15','',NULL,'y','2026-04-23 01:19:44','uploads/moaskqd87br6ok.jpg','y.jpg','moasnq0r3cuign');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('moasnqqbnk4v9f','moasnqp281riyx','Milk- Homogenized','mnp7fkigfqxls2','YEN BROS. FOOD SERVICE (2011) LTD.','Milk- Homogenized','',4,'lt',55.15,11.03,'2026-04-15','',NULL,'y','2026-04-23 01:19:44','uploads/moaskqd87br6ok.jpg','y.jpg','moasnq0r3cuign');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('moasnqt58rhllq','moasnqrxmoqb3j','Milk Crate','mnp7fkigfqxls2','YEN BROS. FOOD SERVICE (2011) LTD.','Milk Crate','998800',1,'Each',3,3,'2026-04-15','',NULL,'y','2026-04-23 01:19:45','uploads/moaskqd87br6ok.jpg','y.jpg','moasnq0r3cuign');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mobx02kbj4bz5e','moasblj5i2tagq','Tomato, Cherry Bulk','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','Tomato, Cherry Bulk','10728',12,'LBS',111.84,2.33,'2026-01-13','',NULL,'oldc','2026-04-23 20:09:04','uploads/mobwzgvkdzrghz.jpg','oldc.jpg','mobx028f2vy82d');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mobx02lnzqdm4f','moasblgeegruva','Spinach Cello','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','Spinach Cello','107502',21.5,'LB',51.14,1.19,'2026-01-13','',NULL,'oldc','2026-04-23 20:09:04','uploads/mobwzgvkdzrghz.jpg','oldc.jpg','mobx028f2vy82d');
INSERT INTO "product_entries" ("id","generic_product_id","generic_product_name","supplier_id","supplier_name","vendor_item_name","sku","pack_qty","pack_unit","cost","cost_per_unit","purchase_date","expiry_date","days_left","invoice_ref","created_at","invoice_file_key","invoice_file_name","invoice_id") VALUES('mobx02n0g6x09s','moasbldmqcfm3w','Pepper Jalapeno','mnvg0uyd70zy7i','Neptune Fresh Produce Inc.','Pepper Jalapeno','106302',35,'LB',57.15,0.11,'2026-01-13','',NULL,'oldc','2026-04-23 20:09:04','uploads/mobwzgvkdzrghz.jpg','oldc.jpg','mobx028f2vy82d');
CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  servings REAL DEFAULT 1,
  yield_unit TEXT DEFAULT '',
  total_cost REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE recipe_items (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity REAL DEFAULT 1,
  unit TEXT DEFAULT '',
  line_cost REAL DEFAULT 0,
  FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
);
CREATE TABLE finished_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  selling_price REAL DEFAULT 0,
  total_cost REAL DEFAULT 0,
  profit REAL DEFAULT 0,
  margin_pct REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE finished_product_items (
  id TEXT PRIMARY KEY,
  finished_product_id TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'product',
  ref_id TEXT NOT NULL,
  ref_name TEXT NOT NULL,
  quantity REAL DEFAULT 1,
  unit TEXT DEFAULT '',
  line_cost REAL DEFAULT 0,
  FOREIGN KEY (finished_product_id) REFERENCES finished_products(id) ON DELETE CASCADE
);
CREATE TABLE inventory (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'raw_material',
  item_name TEXT NOT NULL,
  category TEXT DEFAULT '',
  quantity REAL DEFAULT 0,
  unit TEXT DEFAULT '',
  lot_number TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE stock_log (
  id TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_name TEXT NOT NULL,
  change REAL NOT NULL,
  reason TEXT DEFAULT '',
  note TEXT DEFAULT '',
  lot_number TEXT DEFAULT '',
  moved_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  vendor TEXT DEFAULT '',
  invoice_number TEXT DEFAULT '',
  invoice_date TEXT DEFAULT '',
  upload_date TEXT DEFAULT '',
  total REAL DEFAULT 0,
  status TEXT DEFAULT 'In Processing',
  payment_account TEXT DEFAULT 'A/P',
  file_name TEXT DEFAULT '',
  file_key TEXT DEFAULT '',
  file_url TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
, tax_pst       REAL DEFAULT 0, tax_gst       REAL DEFAULT 0, delivery      REAL DEFAULT 0, credit        REAL DEFAULT 0, other_cost    REAL DEFAULT 0, other_desc    TEXT DEFAULT '', fuel_surcharge REAL DEFAULT 0, deposit REAL DEFAULT 0);
INSERT INTO "invoices" ("id","vendor","invoice_number","invoice_date","upload_date","total","status","payment_account","file_name","file_key","file_url","notes","created_at","tax_pst","tax_gst","delivery","credit","other_cost","other_desc","fuel_surcharge","deposit") VALUES('mnwi5psn0k6ffk','Cioffi''s Meat Market & Deli','190040','2026-03-20','2026-04-13',814.66,'In Processing','A/P','nv.jpg','uploads/mnwi4lgo8btrzi.jpg','/api/files/uploads/mnwi4lgo8btrzi.jpg','','2026-04-13 01:17:01',0,0.15,0,0,0,'',2.99,0);
INSERT INTO "invoices" ("id","vendor","invoice_number","invoice_date","upload_date","total","status","payment_account","file_name","file_key","file_url","notes","created_at","tax_pst","tax_gst","delivery","credit","other_cost","other_desc","fuel_surcharge","deposit") VALUES('mnxjghud0niu0m','Sid Wainer & Son','71424056','2026-02-26','2026-04-13',3360.45,'In Processing','A/P','peppeorni.jpg','uploads/mnxjfcdyqq64m8.jpg','/api/files/uploads/mnxjfcdyqq64m8.jpg','','2026-04-13 18:41:09',0,9.95,0,0,0,'',0,0);
INSERT INTO "invoices" ("id","vendor","invoice_number","invoice_date","upload_date","total","status","payment_account","file_name","file_key","file_url","notes","created_at","tax_pst","tax_gst","delivery","credit","other_cost","other_desc","fuel_surcharge","deposit") VALUES('mnxjhmt1u92uup','YEN BROS. FOOD SERVICE (2011) LTD.','2784897','2026-03-27','2026-04-13',271.02,'In Processing','A/P','basil1.jpg','uploads/mnxjgzqxv0tfvo.jpg','/api/files/uploads/mnxjgzqxv0tfvo.jpg','','2026-04-13 18:42:03',12.29,9.08,6,0,0,'',0,0);
INSERT INTO "invoices" ("id","vendor","invoice_number","invoice_date","upload_date","total","status","payment_account","file_name","file_key","file_url","notes","created_at","tax_pst","tax_gst","delivery","credit","other_cost","other_desc","fuel_surcharge","deposit") VALUES('mo7wzjnc5602my','Neptune Fresh Produce Inc.','590440','2026-03-24','2026-04-21',158.43,'In Processing','A/P','basil2.jpg','uploads/mo7wyuqwby1yob.jpg','/api/files/uploads/mo7wyuqwby1yob.jpg','','2026-04-21 00:57:35',0,0.25,5,0,0,'',0,0);
INSERT INTO "invoices" ("id","vendor","invoice_number","invoice_date","upload_date","total","status","payment_account","file_name","file_key","file_url","notes","created_at","tax_pst","tax_gst","delivery","credit","other_cost","other_desc","fuel_surcharge","deposit") VALUES('mo7x4s4kbsitt7','Oyster and King','99875','2026-04-14','2026-04-21',222,'In Processing','A/P','mus.jpg','uploads/mo7x45u0hkekpl.jpg','/api/files/uploads/mo7x45u0hkekpl.jpg','','2026-04-21 01:01:39',0,0,0,0,0,'',0,0);
INSERT INTO "invoices" ("id","vendor","invoice_number","invoice_date","upload_date","total","status","payment_account","file_name","file_key","file_url","notes","created_at","tax_pst","tax_gst","delivery","credit","other_cost","other_desc","fuel_surcharge","deposit") VALUES('mo7x6oh6rthlro','SNOW CAP ENTERPRISES LTD.','72592597','2026-02-26','2026-04-21',1436.38,'In Processing','A/P','sno27-2.jpg','uploads/mo7x68bsnw4ifd.jpg','/api/files/uploads/mo7x68bsnw4ifd.jpg','','2026-04-21 01:03:08',0,0.38,7.5,0,0,'',0,0);
INSERT INTO "invoices" ("id","vendor","invoice_number","invoice_date","upload_date","total","status","payment_account","file_name","file_key","file_url","notes","created_at","tax_pst","tax_gst","delivery","credit","other_cost","other_desc","fuel_surcharge","deposit") VALUES('moas897eb85qyn','YEN BROS. FOOD SERVICE (2011) LTD.','2784540','2026-03-26','2026-04-23',106.8,'In Processing','A/P','basil3.jpg','uploads/moas7ujopesf0b.jpg','/api/files/uploads/moas7ujopesf0b.jpg','','2026-04-23 01:07:42',0,0,0,0,0,'',0,0);
INSERT INTO "invoices" ("id","vendor","invoice_number","invoice_date","upload_date","total","status","payment_account","file_name","file_key","file_url","notes","created_at","tax_pst","tax_gst","delivery","credit","other_cost","other_desc","fuel_surcharge","deposit") VALUES('moasbkr4g98jno','Neptune Fresh Produce Inc.','594687','2026-04-15','2026-04-23',583.98,'In Processing','A/P','nept.jpg','uploads/moasa5y1mpoeji.jpg','/api/files/uploads/moasa5y1mpoeji.jpg','','2026-04-23 01:10:17',0,0.33,6.5,0,0,'',0,0);
INSERT INTO "invoices" ("id","vendor","invoice_number","invoice_date","upload_date","total","status","payment_account","file_name","file_key","file_url","notes","created_at","tax_pst","tax_gst","delivery","credit","other_cost","other_desc","fuel_surcharge","deposit") VALUES('moasecm9tp0axy','Neptune Fresh Produce Inc.','592771','2026-04-03','2026-04-23',491.85,'In Processing','A/P','invoice_1775254967826_page_1.jpg','uploads/moasc6agov5cuw.jpg','/api/files/uploads/moasc6agov5cuw.jpg','','2026-04-23 01:12:26',0,0.25,5,0,0,'',0,0);
INSERT INTO "invoices" ("id","vendor","invoice_number","invoice_date","upload_date","total","status","payment_account","file_name","file_key","file_url","notes","created_at","tax_pst","tax_gst","delivery","credit","other_cost","other_desc","fuel_surcharge","deposit") VALUES('moasnq0r3cuign','Yen Bros. Food Service (2011) Ltd.','2790033','2026-04-15','2026-04-23',258.72,'In Processing','A/P','y.jpg','uploads/moaskqd87br6ok.jpg','/api/files/uploads/moaskqd87br6ok.jpg','','2026-04-23 01:19:44',0.21,0.47,6,0,0,'',0,0.17);
INSERT INTO "invoices" ("id","vendor","invoice_number","invoice_date","upload_date","total","status","payment_account","file_name","file_key","file_url","notes","created_at","tax_pst","tax_gst","delivery","credit","other_cost","other_desc","fuel_surcharge","deposit") VALUES('mobx028f2vy82d','Neptune Fresh Produce Inc.','578655','2026-01-13','2026-04-23',225.38,'In Processing','A/P','oldc.jpg','uploads/mobwzgvkdzrghz.jpg','/api/files/uploads/mobwzgvkdzrghz.jpg','','2026-04-23 20:09:04',0,0.25,5,0,0,'',0,0);
CREATE TABLE staff (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  role TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  department TEXT DEFAULT '',
  hire_date TEXT DEFAULT '',
  status TEXT DEFAULT 'Active',
  notes TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE certification_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  validity_months INTEGER DEFAULT 12,
  is_mandatory INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE staff_certifications (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  cert_type_id TEXT NOT NULL,
  cert_type_name TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  issuer TEXT DEFAULT '',
  cert_number TEXT DEFAULT '',
  file_key TEXT DEFAULT '',
  file_name TEXT DEFAULT '',
  file_url TEXT DEFAULT '',
  status TEXT DEFAULT 'Valid',
  notes TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  FOREIGN KEY (cert_type_id) REFERENCES certification_types(id)
);
CREATE TABLE invoice_lines (
  id           TEXT PRIMARY KEY,
  invoice_id   TEXT NOT NULL,
  product_name TEXT DEFAULT '',
  vendor_item  TEXT DEFAULT '',
  category     TEXT DEFAULT '',
  item_code    TEXT DEFAULT '',
  packaging    TEXT DEFAULT '',
  price        REAL DEFAULT 0,
  qty          REAL DEFAULT 0,
  line_total   REAL DEFAULT 0,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnwi5px26f64xe','mnwi5psn0k6ffk','Penne','Penne','LA ROSA','WS2049','500GR',53.09,1,53.09,'2026-04-13 01:17:01');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnwi5py8mr1dpe','mnwi5psn0k6ffk','Prosciutto Cotto','Prosciutto Cotto','MASTRO','WS00146','KG',14.19,2.71,38.45,'2026-04-13 01:17:01');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnwi5pzihbc3qq','mnwi5psn0k6ffk','Prosciutto Deli Ready','Prosciutto Deli Ready','','NIC03217','KG',32.99,4.69,154.72,'2026-04-13 01:17:01');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnwi5q0tf8coff','mnwi5psn0k6ffk','Olives Nicoise Pitted','Olives Nicoise Pitted','MASS DI PUG','WS2624','2KG',36.99,1,36.99,'2026-04-13 01:17:01');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnwi5q22xslxcp','mnwi5psn0k6ffk','Olives Mixed','Olives Mixed','','WS1411','KG',24.99,4,99.96,'2026-04-13 01:17:01');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnwi5q3a37lpw2','mnwi5psn0k6ffk','Pork Bacon Slab','Pork Bacon Slab','CANADA NAT','WS02055','KG',18.5,8.15,150.78,'2026-04-13 01:17:01');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnwi5q4ijfjron','mnwi5psn0k6ffk','Pork Bacon Olymel','Pork Bacon Olymel','OLYMEL','WS01060','5KG',75,1,75,'2026-04-13 01:17:01');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnwi5q5o0xiki7','mnwi5psn0k6ffk','Anchovies Fill in Oil','Anchovies Fill in Oil','ALLESSI','WS07468','560GR',22.59,1,22.59,'2026-04-13 01:17:01');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnwi5q761jm4t0','mnwi5psn0k6ffk','Pecorino Romano','Pecorino Romano','','NIC00923','KG',29.99,2,59.98,'2026-04-13 01:17:01');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnwi5q8s61a26m','mnwi5psn0k6ffk','Grana Padano','Grana Padano','','NIC00107','KG',29.99,4,119.96,'2026-04-13 01:17:01');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnxjghybfp6p3s','mnxjghud0niu0m','Pepperoni','Pepperoni','','10476758F','25 LB',239,10,2390,'2026-04-13 18:41:10');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnxjghze6kp5mw','mnxjghud0niu0m','Gluten Free Flour','Gluten Free Flour','Caputo','77844','5 KG',64,15,960,'2026-04-13 18:41:10');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnxjhmwyqu6qyo','mnxjhmt1u92uup','Basil','Basil','HAWAII','161210','1 lb',13.35,3,40.05,'2026-04-13 18:42:03');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnxjhmy10jx903','mnxjhmt1u92uup','Anise (Fennel)','Anise (Fennel)','','170150x','Each',2.81,10,28.1,'2026-04-13 18:42:03');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnxjhmz4yfphyd','mnxjhmt1u92uup','Film Wrap','Film Wrap','GET REDDI','650568','2500 ft',41.32,1,41.32,'2026-04-13 18:42:03');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnxjhn06z7tbs1','mnxjhmt1u92uup','Bio Cont #8- Medium','Bio Cont #8- Medium','GREENPAK','659316','Each',47.84,1,47.84,'2026-04-13 18:42:03');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnxjhn176q6drd','mnxjhmt1u92uup','Bio Cont #1 Comp Small','Bio Cont #1 Comp Small','GALLIGREEN','668698','6×50 ct',53.99,1,53.99,'2026-04-13 18:42:03');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mnxjhn2cw93yyq','mnxjhmt1u92uup','Paper Towel Multifold Nat','Paper Towel Multifold Nat','DURAPLUS','','16x250 ct',32.35,1,32.35,'2026-04-13 18:42:03');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mo7wzjspf9ixa1','mo7wzjnc5602my','KALE GREEN','KALE GREEN','','103501','Each',2,3,6,'2026-04-21 00:57:35');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mo7wzju7mo1ole','mo7wzjnc5602my','JUICE LEMON FRESH','JUICE LEMON FRESH','','513045','1.89L',16.94,1,16.94,'2026-04-21 00:57:35');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mo7wzjvlxabtsc','mo7wzjnc5602my','CANOLA OIL','CANOLA OIL','','517004','35 lb',37.58,1,37.58,'2026-04-21 00:57:35');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mo7wzjwx8owarf','mo7wzjnc5602my','SQUASH ZUCCHINI GREEN','SQUASH ZUCCHINI GREEN','','107901','LB',3.07,4,12.28,'2026-04-21 00:57:35');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mo7wzjy7lu4zys','mo7wzjnc5602my','LIME','LIME','','123601','Each',1.04,6,6.24,'2026-04-21 00:57:35');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mo7wzjzhwr2ns5','mo7wzjnc5602my','HERB-MINT BUNCH','HERB-MINT BUNCH','','103351','Each',1.85,1,1.85,'2026-04-21 00:57:35');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mo7wzk0qf2llyf','mo7wzjnc5602my','LEMON FANCY','LEMON FANCY','','123502','LB',1.51,1,1.51,'2026-04-21 00:57:36');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mo7wzk20luo3xr','mo7wzjnc5602my','CUCUMBER L.E. MEDIUM #1','CUCUMBER L.E. MEDIUM #1','','102001','Each',3.09,3,9.27,'2026-04-21 00:57:36');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mo7wzk3cypr0g7','mo7wzjnc5602my','HERB ITALIAN PARSLEY','HERB ITALIAN PARSLEY','','103311','1 lb',13.5,1,13.5,'2026-04-21 00:57:36');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mo7wzk4ui28jup','mo7wzjnc5602my','Basil','Basil','','103303','1 lb',18.05,1,18.05,'2026-04-21 00:57:36');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mo7wzk6ainou1s','mo7wzjnc5602my','SO POTATO FINGERLING','SO POTATO FINGERLING','','106515','12LB',29.96,1,29.96,'2026-04-21 00:57:36');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mo7x4s91dhskt0','mo7x4s4kbsitt7','Nicli Mix','Nicli Mix','','1021','5 lbs',33,4,132,'2026-04-21 01:01:39');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mo7x4sa7aldmq0','mo7x4s4kbsitt7','White Button','White Button','','2005','5 lbs',22.5,4,90,'2026-04-21 01:01:40');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mo7x6olpdqs63b','mo7x6oh6rthlro','Primo Mulino 00 Style Flour','Primo Mulino 00 Style Flour','RH','RH0134','20KG',22.34,50,1117,'2026-04-21 01:03:08');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mo7x6omqn0ckts','mo7x6oh6rthlro','Durum Semolina','Durum Semolina','RH','RH1567','20KG',31.15,10,311.5,'2026-04-21 01:03:08');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('moas89ccaeynzd','moas897eb85qyn','Basil','Basil','HAWAII','161210','1 lb',13.35,8,106.8,'2026-04-23 01:07:42');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('moasbkx14ybs04','moasbkr4g98jno','Vegetable Mirepoix Mix','Vegetable Mirepoix Mix','','','1/5 lbs.',16.48,5,82.4,'2026-04-23 01:10:17');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('moasbky4ll8kqf','moasbkr4g98jno','Onion Red Sliced','Onion Red Sliced','','','5 lb',17.76,3,53.28,'2026-04-23 01:10:17');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('moasbkzgcediyf','moasbkr4g98jno','Pepper Jalapeno','Pepper Jalapeno','','','35 LB',6.72,30,201.6,'2026-04-23 01:10:17');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('moasbl0qlao58d','moasbkr4g98jno','Spinach Cello','Spinach Cello','','','2.5LB',32.65,2,65.3,'2026-04-23 01:10:17');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('moasbl2xvput0c','moasbkr4g98jno','Tomato, Cherry Bulk','Tomato, Cherry Bulk','','','12 LBS',58.19,3,174.57,'2026-04-23 01:10:17');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('moasecr37fzsxq','moasecm9tp0axy','Onion Red Sliced','Onion Red Sliced','','37230','5 lb',17.76,2,35.52,'2026-04-23 01:12:26');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('moasecsiqlmepm','moasecm9tp0axy','Spinach Cello','Spinach Cello','','107502','21.5LB',32.65,1,32.65,'2026-04-23 01:12:26');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('moasectsgpykbb','moasecm9tp0axy','Basil','Basil','','103303','1 lb',18.05,7,126.35,'2026-04-23 01:12:26');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('moasecv87tf326','moasecm9tp0axy','Tomato, Cherry Bulk','Tomato, Cherry Bulk','','10728','12 LBS',46.46,3,139.38,'2026-04-23 01:12:27');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('moasecwr3iddu9','moasecm9tp0axy','Pepper Jalapeno','Pepper Jalapeno','','106302','35 LB',5.09,30,152.7,'2026-04-23 01:12:27');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('moasnq5ezcqvoa','moasnq0r3cuign','Basil','Basil','HAWAII','161210','1 lb',13.38,8,107.04,'2026-04-23 01:19:44');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('moasnq6mgj2dx1','moasnq0r3cuign','Semolina- Durum','Semolina- Durum','P & H','467748','20 kg',30.89,1,30.89,'2026-04-23 01:19:44');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('moasnq7sj2wb9v','moasnq0r3cuign','Sugar- Granulated Fine','Sugar- Granulated Fine','ROGER''S','561578','20 kg',46.91,1,46.91,'2026-04-23 01:19:44');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('moasnq94p6zhnh','moasnq0r3cuign','Vinegar- Apple Cider','Vinegar- Apple Cider','ALLEN''S','579638X','4 LT',8.2,1,8.2,'2026-04-23 01:19:44');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('moasnqad9uob9f','moasnq0r3cuign','Milk- Homogenized','Milk- Homogenized','ISLAND FRM','','4 lt',11.03,5,55.15,'2026-04-23 01:19:44');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('moasnqbko7g5bf','moasnq0r3cuign','Milk Crate','Milk Crate','','998800','Each',3,1,3,'2026-04-23 01:19:44');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mobx02cb3c3oou','mobx028f2vy82d','Tomato, Cherry Bulk','Tomato, Cherry Bulk','','10728','12 LBS',27.96,4,111.84,'2026-04-23 20:09:04');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mobx02dhyjbq8r','mobx028f2vy82d','Spinach Cello','Spinach Cello','','107502','21.5LB',25.57,2,51.14,'2026-04-23 20:09:04');
INSERT INTO "invoice_lines" ("id","invoice_id","product_name","vendor_item","category","item_code","packaging","price","qty","line_total","created_at") VALUES('mobx02ekh6t7nm','mobx028f2vy82d','Pepper Jalapeno','Pepper Jalapeno','','106302','35 LB',3.81,15,57.15,'2026-04-23 20:09:04');
CREATE TABLE vendor_fee_templates (
  id           TEXT PRIMARY KEY,
  vendor_name  TEXT NOT NULL UNIQUE,   
  delivery     REAL DEFAULT 0,
  fuel_surcharge REAL DEFAULT 0,
  tax_gst      REAL DEFAULT 0,
  tax_pst      REAL DEFAULT 0,
  other_cost   REAL DEFAULT 0,
  other_desc   TEXT DEFAULT '',
  use_percent  INTEGER DEFAULT 0,      
  notes        TEXT DEFAULT '',
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
, deposit REAL DEFAULT 0);
CREATE TABLE product_mappings (
  id TEXT PRIMARY KEY,
  vendor_name TEXT NOT NULL,
  raw_ocr_text TEXT NOT NULL,
  corrected_name TEXT NOT NULL,
  corrected_brand TEXT DEFAULT '',
  corrected_sku TEXT DEFAULT '',
  corrected_pack_size TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnp7fktd0fturj','YEN BROS. FOOD SERVICE (2011) LTD.','161210','Basil','HAWAII','161210','1 lb','2026-04-07T22:42:22.357Z','2026-04-23T01:19:45.236Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnr0gkprydzni7','YEN BROS. FOOD SERVICE (2011) LTD.','anise (fennel)','Anise (Fennel)','','','Each','2026-04-09T05:02:43.921Z','2026-04-12T07:27:20.365Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnr0gks73rvrrv','YEN BROS. FOOD SERVICE (2011) LTD.','650568','Film Wrap','GET REDDI','650568','2500 ft','2026-04-09T05:02:44.011Z','2026-04-13T18:42:04.935Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnr0gkv3e9kxro','YEN BROS. FOOD SERVICE (2011) LTD.','80308gp','Bio Cont #8- Medium','GREENPAK','80308GP','300 ct','2026-04-09T05:02:44.098Z','2026-04-12T07:27:20.505Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnr0gkxvjf6cr9','YEN BROS. FOOD SERVICE (2011) LTD.','668698','Bio Cont #1 Comp Small','GALLIGREEN','668698','6×50 ct','2026-04-09T05:02:44.212Z','2026-04-13T18:42:05.082Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnr0gl07izxn98','YEN BROS. FOOD SERVICE (2011) LTD.','paper towel multifold nat','Paper Towel Multifold Nat','DURAPLUS','','16x250 ct','2026-04-09T05:02:44.302Z','2026-04-13T18:42:05.152Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mntm2nhejtztma','La Grotta Del Formaggio','175','Tomatoes with Basil','La Regina','175','1000Z','2026-04-11T00:43:18.222Z','2026-04-13T00:50:23.153Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnvg0vt23c0i2d','Neptune Fresh Produce Inc.','103501','KALE GREEN','','103501','Each','2026-04-12T07:29:30.366Z','2026-04-21T00:57:37.864Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnvg0vv9dvjtkd','Neptune Fresh Produce Inc.','513045','JUICE LEMON FRESH','','513045','1.89L','2026-04-12T07:29:30.444Z','2026-04-21T00:57:37.960Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnvg0vx8xhj9sj','Neptune Fresh Produce Inc.','517004','CANOLA OIL','','517004','35 lb','2026-04-12T07:29:30.516Z','2026-04-21T00:57:38.051Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnvg0vz7j1gn5v','Neptune Fresh Produce Inc.','107901','SQUASH ZUCCHINI GREEN','','107901','LB','2026-04-12T07:29:30.589Z','2026-04-21T00:57:38.141Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnvg0w174p1qep','Neptune Fresh Produce Inc.','123601','LIME','','123601','Each','2026-04-12T07:29:30.660Z','2026-04-21T00:57:38.323Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnvg0w37femqtf','Neptune Fresh Produce Inc.','103351','HERB-MINT BUNCH','','103351','Each','2026-04-12T07:29:30.731Z','2026-04-21T00:57:38.428Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnvg0w59odln55','Neptune Fresh Produce Inc.','123502','LEMON FANCY','','123502','LB','2026-04-12T07:29:30.807Z','2026-04-21T00:57:38.517Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnvg0w77xctm7m','Neptune Fresh Produce Inc.','102001','CUCUMBER L.E. MEDIUM #1','','102001','Each','2026-04-12T07:29:30.876Z','2026-04-21T00:57:38.612Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnvg0w9glmps74','Neptune Fresh Produce Inc.','103311','HERB ITALIAN PARSLEY','','103311','1 lb','2026-04-12T07:29:30.958Z','2026-04-21T00:57:38.713Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnvg0wbd0cmkjc','Neptune Fresh Produce Inc.','103303','Basil','','103303','1 lb','2026-04-12T07:29:31.027Z','2026-04-23T01:12:28.239Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnvg0wdcm4kq4a','Neptune Fresh Produce Inc.','106515','SO POTATO FINGERLING','','106515','12LB','2026-04-12T07:29:31.098Z','2026-04-21T00:57:39.034Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwe5cb9xhexjs','Alsco Canada Corporation','5505-gn','Laundry Bag','','5505-GN','Each','2026-04-12T23:24:45.321Z','2026-04-12T23:24:45.321Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwe5cdwionaji','Alsco Canada Corporation','9650','Laundry Bag Stand','','9650','Each','2026-04-12T23:24:45.417Z','2026-04-12T23:24:45.417Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwe5cgb488l1c','Alsco Canada Corporation','4000-wh','Bar Mop','','4000-WH','Each','2026-04-12T23:24:45.499Z','2026-04-12T23:24:45.499Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwe5cima6quce','Alsco Canada Corporation','4999-wh','Micro Tech Pro Towel','','4999-WH','Each','2026-04-12T23:24:45.583Z','2026-04-12T23:24:45.583Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwe5cl8f82rsh','Alsco Canada Corporation','70006-wh','Napkin','','70006-WH','Each','2026-04-12T23:24:45.677Z','2026-04-12T23:24:45.677Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwe5cnm0zrmk6','Alsco Canada Corporation','3205-wh','Bib Apron','','3205-WH','Each','2026-04-12T23:24:45.767Z','2026-04-12T23:24:45.767Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwe5cq60y3prr','Alsco Canada Corporation','29100','Wet Mop','','29100','Each','2026-04-12T23:24:45.853Z','2026-04-12T23:24:45.853Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwe5csktgx0t8','Alsco Canada Corporation','9637','Wet Mop Handle','','9637','Each','2026-04-12T23:24:45.944Z','2026-04-12T23:24:45.944Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwe5cv2r2ienn','Alsco Canada Corporation','2020-bk','4X6 Mat','','2020-BK','Each','2026-04-12T23:24:46.033Z','2026-04-12T23:24:46.033Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwe5cybjwcgzg','Alsco Canada Corporation','2010-bk','3X5 Mat','','2010-BK','Each','2026-04-12T23:24:46.147Z','2026-04-12T23:24:46.147Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwgh0b3whul40','Cioffi''s Meat Market & Deli','ws3678','PEPPERONI EZZO SUPREME SLCD FRZ','EZZO','WS3678','25LB','2026-04-13T00:29:48.870Z','2026-04-13T00:29:48.870Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwhsfgdy0edx2','Cioffi''s Meat Market & Deli','ws2049','Penne','LA ROSA','WS2049','500GR','2026-04-13T01:06:41.324Z','2026-04-13T01:17:03.259Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwhsfiq7z535o','Cioffi''s Meat Market & Deli','ws00146','Prosciutto Cotto','MASTRO','WS00146','KG','2026-04-13T01:06:41.408Z','2026-04-13T01:17:03.342Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwhsfldt8oihj','Cioffi''s Meat Market & Deli','nic03217','Prosciutto Deli Ready','','NIC03217','KG','2026-04-13T01:06:41.503Z','2026-04-13T01:17:03.423Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwhsfntxw1qc0','Cioffi''s Meat Market & Deli','ws2624','Olives Nicoise Pitted','MASS DI PUG','WS2624','2KG','2026-04-13T01:06:41.591Z','2026-04-13T01:17:03.508Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwhsfq9gn2rsh','Cioffi''s Meat Market & Deli','ws1411','Olives Mixed','','WS1411','KG','2026-04-13T01:06:41.678Z','2026-04-13T01:17:03.596Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwhsfsr481yiy','Cioffi''s Meat Market & Deli','ws02055','Pork Bacon Slab','CANADA NAT','WS02055','KG','2026-04-13T01:06:41.768Z','2026-04-13T01:17:03.689Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwhsfv60wmort','Cioffi''s Meat Market & Deli','ws01060','Pork Bacon Olymel','OLYMEL','WS01060','5KG','2026-04-13T01:06:41.856Z','2026-04-13T01:17:03.782Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwhsfxnk5ifdu','Cioffi''s Meat Market & Deli','ws07468','Anchovies Fill in Oil','ALLESSI','WS07468','560GR','2026-04-13T01:06:41.947Z','2026-04-13T01:17:03.870Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwhsg0a24w748','Cioffi''s Meat Market & Deli','nic00923','Pecorino Romano','','NIC00923','KG','2026-04-13T01:06:42.030Z','2026-04-13T01:17:03.956Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnwhsg2y5okdig','Cioffi''s Meat Market & Deli','nic00107','Grana Padano','','NIC00107','KG','2026-04-13T01:06:42.132Z','2026-04-13T01:17:04.044Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnxjgicforb0hk','Sid Wainer & Son','10476758f','Pepperoni','','10476758F','25 LB','2026-04-13T18:41:10.614Z','2026-04-13T18:41:10.614Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnxjgiejgxuhvh','Sid Wainer & Son','77844','Gluten Free Flour','Caputo','77844','5 KG','2026-04-13T18:41:10.691Z','2026-04-13T18:41:10.691Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnxjho79t8l516','YEN BROS. FOOD SERVICE (2011) LTD.','170150x','Anise (Fennel)','','170150x','Each','2026-04-13T18:42:04.861Z','2026-04-13T18:42:04.861Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mnxjhobcu3a4e3','YEN BROS. FOOD SERVICE (2011) LTD.','659316','Bio Cont #8- Medium','GREENPAK','659316','Each','2026-04-13T18:42:05.008Z','2026-04-13T18:42:05.008Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mo7x4ssn98ou3e','Oyster and King','1021','Nicli Mix','','1021','5 lbs','2026-04-21T01:01:40.657Z','2026-04-21T01:01:40.657Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mo7x4sv3ko44de','Oyster and King','2005','White Button','','2005','5 lbs','2026-04-21T01:01:40.755Z','2026-04-21T01:01:40.755Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mo7x6p1wejkgp6','SNOW CAP ENTERPRISES LTD.','rh0134','Primo Mulino 00 Style Flour','RH','RH0134','20KG','2026-04-21T01:03:09.128Z','2026-04-21T01:03:09.128Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('mo7x6p3yropouf','SNOW CAP ENTERPRISES LTD.','rh1567','Durum Semolina','RH','RH1567','20KG','2026-04-21T01:03:09.203Z','2026-04-21T01:03:09.203Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('moasblqasev69s','Neptune Fresh Produce Inc.','vegetable mirepoix mix','Vegetable Mirepoix Mix','','','1/5 lbs.','2026-04-23T01:10:18.549Z','2026-04-23T01:10:18.549Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('moasblsm5hybld','Neptune Fresh Produce Inc.','onion red sliced','Onion Red Sliced','','','5 lb','2026-04-23T01:10:18.631Z','2026-04-23T01:10:18.631Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('moasbluse8dy03','Neptune Fresh Produce Inc.','pepper jalapeno','Pepper Jalapeno','','','35 LB','2026-04-23T01:10:18.714Z','2026-04-23T01:10:18.714Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('moasblwwaloo5m','Neptune Fresh Produce Inc.','spinach cello','Spinach Cello','','','2.5LB','2026-04-23T01:10:18.788Z','2026-04-23T01:10:18.788Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('moasblz22weq91','Neptune Fresh Produce Inc.','tomato, cherry bulk','Tomato, Cherry Bulk','','','12 LBS','2026-04-23T01:10:18.866Z','2026-04-23T01:10:18.866Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('moasedn6f0o0kb','Neptune Fresh Produce Inc.','37230','Onion Red Sliced','','37230','5 lb','2026-04-23T01:12:28.039Z','2026-04-23T01:12:28.039Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('moasedqbtew87b','Neptune Fresh Produce Inc.','107502','Spinach Cello','','107502','21.5LB','2026-04-23T01:12:28.148Z','2026-04-23T20:09:05.059Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('moasedvi9u38pi','Neptune Fresh Produce Inc.','10728','Tomato, Cherry Bulk','','10728','12 LBS','2026-04-23T01:12:28.340Z','2026-04-23T20:09:04.986Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('moasedxwjb0gxg','Neptune Fresh Produce Inc.','106302','Pepper Jalapeno','','106302','35 LB','2026-04-23T01:12:28.424Z','2026-04-23T20:09:05.125Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('moasnr27dkgsjw','Yen Bros. Food Service (2011) Ltd.','467748','Semolina- Durum','P & H','467748','20 kg','2026-04-23T01:19:45.332Z','2026-04-23T01:19:45.332Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('moasnr4w247z0v','Yen Bros. Food Service (2011) Ltd.','561578','Sugar- Granulated Fine','ROGER''S','561578','20 kg','2026-04-23T01:19:45.429Z','2026-04-23T01:19:45.429Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('moasnr7c911k1a','Yen Bros. Food Service (2011) Ltd.','579638x','Vinegar- Apple Cider','ALLEN''S','579638X','4 LT','2026-04-23T01:19:45.515Z','2026-04-23T01:19:45.515Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('moasnr9qrp0rnp','Yen Bros. Food Service (2011) Ltd.','milk- homogenized','Milk- Homogenized','ISLAND FRM','','4 lt','2026-04-23T01:19:45.603Z','2026-04-23T01:19:45.603Z');
INSERT INTO "product_mappings" ("id","vendor_name","raw_ocr_text","corrected_name","corrected_brand","corrected_sku","corrected_pack_size","created_at","updated_at") VALUES('moasnrc3h9sap2','Yen Bros. Food Service (2011) Ltd.','998800','Milk Crate','','998800','Each','2026-04-23T01:19:45.688Z','2026-04-23T01:19:45.688Z');
CREATE TABLE units (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "units" ("id","name","sort_order") VALUES(1,'kg',1);
INSERT INTO "units" ("id","name","sort_order") VALUES(2,'g',2);
INSERT INTO "units" ("id","name","sort_order") VALUES(3,'lb',3);
INSERT INTO "units" ("id","name","sort_order") VALUES(4,'ml',4);
INSERT INTO "units" ("id","name","sort_order") VALUES(5,'L',5);
INSERT INTO "units" ("id","name","sort_order") VALUES(6,'each',6);
INSERT INTO "units" ("id","name","sort_order") VALUES(7,'case',7);
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',9);
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('units',15);
CREATE INDEX idx_product_entries_generic_id ON product_entries(generic_product_id);
CREATE INDEX idx_recipe_items_recipe_id ON recipe_items(recipe_id);
CREATE INDEX idx_finished_product_items_fp_id ON finished_product_items(finished_product_id);
CREATE INDEX idx_inventory_item_type ON inventory(item_type);
CREATE INDEX idx_stock_log_inventory_id ON stock_log(inventory_id);
CREATE INDEX idx_invoices_vendor ON invoices(vendor);
CREATE INDEX idx_staff_certs_staff_id ON staff_certifications(staff_id);
CREATE INDEX idx_staff_certs_expiry ON staff_certifications(expiry_date);
CREATE INDEX idx_invoice_lines_invoice_id ON invoice_lines(invoice_id);
CREATE INDEX idx_vendor_fee_templates_vendor ON vendor_fee_templates(vendor_name);
CREATE INDEX idx_pm_vendor_raw ON product_mappings(vendor_name, raw_ocr_text);
