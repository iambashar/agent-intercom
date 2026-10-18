// Minimal JSON-RPC client for the codex app-server daemon (WebSocket over a Unix socket in /tmp/codex-daemon-<uid>).
const net=require('net'),crypto=require('crypto'),fs=require('fs'),path=require('path');
function connect(sock){
  return new Promise((res,rej)=>{
    const c=net.createConnection(sock);let buf=Buffer.alloc(0),open=false;const handlers=[];
    const api={send(o){const p=Buffer.from(JSON.stringify(o));let h;
        if(p.length<126)h=Buffer.from([0x81,0x80|p.length]);
        else if(p.length<65536){h=Buffer.alloc(4);h[0]=0x81;h[1]=0x80|126;h.writeUInt16BE(p.length,2);}
        else{h=Buffer.alloc(10);h[0]=0x81;h[1]=0x80|127;h.writeBigUInt64BE(BigInt(p.length),2);}
        const m=crypto.randomBytes(4);for(let i=0;i<p.length;i++)p[i]^=m[i&3];c.write(Buffer.concat([h,m,p]));},
      on(f){handlers.push(f)},close(){c.end()}};
    c.on('connect',()=>c.write(`GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    c.on('data',d=>{buf=Buffer.concat([buf,d]);
      if(!open){const i=buf.indexOf('\r\n\r\n');if(i<0)return;open=true;buf=buf.slice(i+4);res(api);}
      for(;;){if(buf.length<2)return;let len=buf[1]&127,off=2;
        if(len===126){if(buf.length<4)return;len=buf.readUInt16BE(2);off=4}
        else if(len===127){if(buf.length<10)return;len=Number(buf.readBigUInt64BE(2));off=10}
        if(buf.length<off+len)return;const op=buf[0]&15,pl=buf.slice(off,off+len);buf=buf.slice(off+len);
        if(op===1)for(const f of handlers)f(JSON.parse(pl.toString()));
        if(op===9){/* ping -> pong */const h=Buffer.from([0x8a,0x80|pl.length]);const m=crypto.randomBytes(4);const q=Buffer.from(pl);for(let i=0;i<q.length;i++)q[i]^=m[i&3];c.write(Buffer.concat([h,m,q]));}
      }});
    c.on('error',rej);
  });
}
module.exports={connect,daemonSock(){
  const d=process.env.CODEX_DAEMON_DIR||path.join('/tmp','codex-daemon-'+process.getuid());
  const f=fs.readdirSync(d).find(f=>!f.endsWith('.lock'));
  if(!f)throw new Error('no codex app-server daemon socket in '+d);
  return path.join(d,f);}};

async function session(){
  const ws=await connect(module.exports.daemonSock());let id=0;const pend={};
  ws.on(m=>{if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id]}});
  const call=(method,params)=>new Promise(r=>{const i=++id;pend[i]=r;ws.send({jsonrpc:'2.0',id:i,method,params})});
  await call('initialize',{clientInfo:{name:'agent-mail',version:'0'}});ws.send({jsonrpc:'2.0',method:'initialized'});
  return {call,close:()=>ws.close()};
}
module.exports.session=session;
