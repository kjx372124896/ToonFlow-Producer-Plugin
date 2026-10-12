// ZIP store (PKZIP 2.0) with UTF-8 names; script text remains byte-for-byte UTF-8.
const encoder=new TextEncoder();
const crcTable=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(data){let crc=0xffffffff;for(const b of data)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function write16(buf,i,n){buf[i]=n&255;buf[i+1]=(n>>>8)&255;}
function write32(buf,i,n){write16(buf,i,n&0xffff);write16(buf,i+2,Math.floor(n/65536));}
function fileName(script){
  const title=String(script.title||'剧本').replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,75);
  const ep=String(script.episode).padStart(3,'0');
  return `第${ep}集-${title}.txt`;
}
export function makeScriptsZip(scripts){
  if(!scripts?.length)throw new Error('请选择至少一集剧本');
  if(scripts.length>2000)throw new Error('单次最多导出2000集');
  const files=scripts.map((s,index)=>{
    if(!Number.isInteger(Number(s.episode))||!String(s.text||'').trim())throw new Error('剧本集数或正文无效：'+(s.title||index));
    const name=encoder.encode(fileName(s));const bytes=encoder.encode(s.text.replace(/^\uFEFF/,''));
    return {name,bytes,crc:crc32(bytes)};
  });
  const output=[],directory=[];let offset=0;
  for(const file of files){
    const local=new Uint8Array(30+file.name.length);
    write32(local,0,0x04034b50);write16(local,4,20);write16(local,6,0x0800);write16(local,8,0);
    write32(local,14,file.crc);write32(local,18,file.bytes.length);write32(local,22,file.bytes.length);write16(local,26,file.name.length);
    local.set(file.name,30);output.push(local,file.bytes);
    const cd=new Uint8Array(46+file.name.length);
    write32(cd,0,0x02014b50);write16(cd,4,20);write16(cd,6,20);write16(cd,8,0x0800);
    write32(cd,16,file.crc);write32(cd,20,file.bytes.length);write32(cd,24,file.bytes.length);
    write16(cd,28,file.name.length);write32(cd,42,offset);cd.set(file.name,46);
    directory.push(cd);offset+=local.length+file.bytes.length;
  }
  const cdSize=directory.reduce((n,x)=>n+x.length,0);
  const end=new Uint8Array(22);write32(end,0,0x06054b50);write16(end,8,files.length);write16(end,10,files.length);
  write32(end,12,cdSize);write32(end,16,offset);
  const result=new Uint8Array(offset+cdSize+end.length);let at=0;
  for(const part of [...output,...directory,end]){result.set(part,at);at+=part.length;}
  return result;
}
