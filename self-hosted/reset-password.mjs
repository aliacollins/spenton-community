import {DatabaseSync} from 'node:sqlite';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {resetLocalPassword} from '../server/local-accounts.mjs';

if(!process.stdin.isTTY)throw new Error('Run interactively: docker compose -f self-hosted/compose.yaml exec app node self-hosted/reset-password.mjs');
let hidden=false;
const output=new Writable({write(chunk,_encoding,callback){if(!hidden)process.stdout.write(chunk);callback();}});
const prompt=createInterface({input:process.stdin,output,terminal:true});
let db;
try{
 const username=await prompt.question('Username: ');
 process.stdout.write('New password (hidden): ');hidden=true;const password=await prompt.question('');hidden=false;process.stdout.write('\n');
 process.stdout.write('Repeat password (hidden): ');hidden=true;const repeat=await prompt.question('');hidden=false;process.stdout.write('\n');
 if(password!==repeat)throw new Error('Passwords do not match.');
 db=new DatabaseSync(process.env.SPENTON_DB_PATH||'/data/spenton.sqlite',{timeout:5000});db.exec('PRAGMA foreign_keys=ON');
 await resetLocalPassword(db,username,password);
 console.log('Password changed. Previous sessions have been signed out.');
}finally{hidden=false;prompt.close();db?.close();}
