// Fictional WebAuthn credentials for tests only. Signatures are verified by the real server library.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
const hash = bytes => createHash('sha256').update(bytes).digest();
export function decodeBase32(input) {
  let bits=0,value=0;const bytes=[];
  for(const char of input){value=(value<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}
  return Buffer.from(bytes);
}
export function testAuthenticator({origin='https://review.example.test',rpID=new URL(origin).hostname,userId='owner'}={}) {
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const jwk=publicKey.export({format:'jwk'}),id=randomBytes(32);
  const cose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]));
  function client(type,options,overrides){return Buffer.from(JSON.stringify({type,challenge:options.challenge,origin,crossOrigin:false,...overrides}));}
  function authData(register,settings={}){
    const flags=(settings.present===false?0:1)|(settings.verified===false?0:4)|8|16|(register?64:0);
    const count=Buffer.alloc(4);count.writeUInt32BE(settings.counter??0);
    const prefix=Buffer.concat([hash(settings.rpID??rpID),Buffer.from([flags]),count]);
    if(!register)return prefix;
    const length=Buffer.alloc(2);length.writeUInt16BE(id.length);
    return Buffer.concat([prefix,Buffer.alloc(16),length,id,cose]);
  }
  return {
    registration(options,settings={}){
      const data=client('webauthn.create',options,settings.clientData);
      const attestation=isoCBOR.encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',new Uint8Array(authData(true,settings))]]));
      return {id:id.toString('base64url'),rawId:id.toString('base64url'),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:data.toString('base64url'),attestationObject:Buffer.from(attestation).toString('base64url'),transports:['hybrid','internal']}};
    },
    authentication(options,settings={}){
      const data=client('webauthn.get',options,settings.clientData),auth=authData(false,settings);
      const signature=sign('sha256',Buffer.concat([auth,hash(data)]),privateKey);
      if(settings.badSignature)signature[signature.length-1]^=1;
      return {id:id.toString('base64url'),rawId:id.toString('base64url'),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:data.toString('base64url'),authenticatorData:auth.toString('base64url'),signature:signature.toString('base64url'),userHandle:Buffer.from(settings.userId??userId).toString('base64url')}};
    },
  };
}
