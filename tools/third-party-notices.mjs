import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
const sections=[],missing=[];
for(const path of Object.keys(lock.packages??{}).filter(path=>path.startsWith('node_modules/')).sort()){
 const directory=resolve(root,path);
 let pkg;
 try{pkg=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));}catch{continue;}
 const files=(await readdir(directory)).filter(name=>/^(LICENSE|LICENCE|COPYING|NOTICE|THIRD-PARTY-LICENSE)(?:[._-].*)?$/i.test(name));
 const source=lock.packages[path].resolved;
 const upstream=typeof pkg.repository==='string'?pkg.repository:pkg.repository?.url;
 const heading=`${pkg.name??path} ${pkg.version??''}\nPackage source: ${source??'See package-lock.json'}\nUpstream: ${upstream??'See package distribution'}\nDeclared license: ${typeof pkg.license==='string'?pkg.license:JSON.stringify(pkg.license??'unspecified')}`;
 const texts=[];
 for(const file of files){
  try{texts.push(file+'\n'+await readFile(join(directory,file),'utf8'));}catch{/* Some packages use license directories. Report below. */}
 }
 if(!texts.length&&pkg.name==='@better-auth/utils'&&['0.4.2','0.5.0'].includes(pkg.version))
  texts.push(await readFile(join(root,'third-party/better-auth-utils.LICENSE'),'utf8'));
 if(!texts.length&&pkg.name?.startsWith('@rolldown/binding-')){
  const parent=JSON.parse(await readFile(join(root,'node_modules/rolldown/package.json'),'utf8'));
  if(parent.version===pkg.version)for(const file of ['LICENSE','THIRD-PARTY-LICENSE'])texts.push(await readFile(join(root,'node_modules/rolldown',file),'utf8'));
 }
 if(!texts.length)missing.push({name:pkg.name,version:pkg.version,license:pkg.license??null,developmentOnly:lock.packages[path].dev===true});
 sections.push(heading+'\n\n'+(texts.join('\n\n')||`No standalone license text is shipped at the package root. The package metadata declares ${pkg.license??'no license'}. Author: ${typeof pkg.author==='string'?pkg.author:pkg.author?.name??'See package metadata'}. Consult the linked upstream distribution. This notice does not create an additional license grant.`));
}
await writeFile(join(root,'public/third-party-notices.txt'),'Third-party dependency notices\n\nDependencies retain their original licenses. This file includes build-tool notices as well as runtime dependencies.\n\n'+sections.join('\n\n'+'='.repeat(72)+'\n\n')+'\n');
console.log(JSON.stringify({packages:sections.length,missingLicenseText:missing}));
