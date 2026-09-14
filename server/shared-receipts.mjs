// Only flattened JPEG pages are shared. Originals and AI requests are separate.
export function validateSharedReceipt(value, fail) {
 if(value == null)return null;
 if(typeof value!=='object'||typeof value.text!=='string'||Buffer.byteLength(value.text)>1200||!Array.isArray(value.pages)||value.pages.length>12)fail(400,'INVALID_SHARED_BILL','Choose up to twelve bill pages and a short text excerpt.');
 let size=0;
 for(const page of value.pages){
  if(typeof page!=='string'||page.length>400000||!/^[A-Za-z0-9+/]+={0,2}$/.test(page))fail(400,'INVALID_SHARED_BILL','The bill image could not be verified. Scan it again.');
  const bytes=Buffer.from(page,'base64');size+=bytes.length;
  if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)fail(400,'INVALID_SHARED_BILL','Use a scanned image of the bill.');
 }
 if(size>2000000||(!value.pages.length&&!value.text.trim()))fail(400,'INVALID_SHARED_BILL','Choose bill pages under 2 MB, or share the bill text.');
 return {text:value.text,pages:value.pages};
}
