export function migrateSharedContacts(db){
 const columns=db.prepare('PRAGMA table_info(expense_shares)').all();
 if(columns.some(c=>c.name==='person_key'))return;
 // Rebuild only the parent table with enforcement temporarily disabled. Child
 // rows keep their original IDs and references; check every FK before commit.
 const foreignKeys=db.prepare('PRAGMA foreign_keys').get().foreign_keys;
 db.exec('PRAGMA foreign_keys=OFF;BEGIN IMMEDIATE;');
 try{
  db.exec(`CREATE TABLE expense_shares_next(id TEXT PRIMARY KEY,expense_id TEXT NOT NULL REFERENCES shared_expenses(id) ON DELETE CASCADE,email TEXT,amount INTEGER NOT NULL,state TEXT NOT NULL,recipient_id TEXT REFERENCES users(id),budget_id TEXT REFERENCES budgets(id),name TEXT NOT NULL DEFAULT '',person_key TEXT,UNIQUE(expense_id,email),UNIQUE(expense_id,person_key)) STRICT;
   INSERT INTO expense_shares_next(id,expense_id,email,amount,state,recipient_id,budget_id) SELECT id,expense_id,email,amount,state,recipient_id,budget_id FROM expense_shares;
   DROP TABLE expense_shares;ALTER TABLE expense_shares_next RENAME TO expense_shares;
   CREATE INDEX expense_share_email ON expense_shares(email);`);
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Shared-contact migration could not verify existing references.');
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}finally{db.exec('PRAGMA foreign_keys='+foreignKeys);}
}
