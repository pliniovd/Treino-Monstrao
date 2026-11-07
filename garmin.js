/* Leitura de arquivos do Garmin direto no navegador: ZIP, FIT e CSV.
   Do FIT só lemos o resumo da atividade (tempo, distância, calorias, frequência cardíaca).
   Dados pessoais do perfil que existem no arquivo (peso, altura etc.) são ignorados. */
(function(){
  const FIT_EPOCH=631065600; // 31/12/1989 em segundos Unix
  const SIZES={0:1,1:1,2:1,3:2,4:2,5:4,6:4,7:1,8:4,9:8,10:1,11:2,12:4,13:1,14:8,15:8,16:8};
  const SPORT={1:'running',2:'cycling',4:'fitness_equipment',5:'swimming',10:'training',11:'walking',17:'hiking',15:'rowing'};
  const SUB={1:'treadmill',20:'strength_training',0:'generic'};

  function u16(v,o,le){return v.getUint16(o,le)}
  function parseFit(buf){
    const v=new DataView(buf.buffer||buf,buf.byteOffset||0,buf.byteLength);
    const hs=v.getUint8(0); if(hs<12||String.fromCharCode(v.getUint8(8),v.getUint8(9),v.getUint8(10),v.getUint8(11))!=='.FIT')throw new Error('Não é um arquivo FIT');
    const end=hs+v.getUint32(4,true); let p=hs; const defs={}, out={session:null,activity:null};
    while(p<end&&p<v.byteLength-1){
      const h=v.getUint8(p++);
      if(h&0x80){ // timestamp comprimido
        const d=defs[(h>>5)&3]; if(!d)break; p+=d.size; continue;
      }
      const lt=h&0x0f;
      if(h&0x40){ // definição
        p++; const le=v.getUint8(p++)===0; const gm=u16(v,p,le); p+=2; const n=v.getUint8(p++);
        const f=[]; let size=0;
        for(let i=0;i<n;i++){f.push({num:v.getUint8(p),size:v.getUint8(p+1),type:v.getUint8(p+2)&0x1f});size+=v.getUint8(p+1);p+=3}
        if(h&0x20){const nd=v.getUint8(p++);for(let i=0;i<nd;i++){size+=v.getUint8(p+1);p+=3}}
        defs[lt]={gm,le,f,size};
      }else{
        const d=defs[lt]; if(!d)break; const start=p;
        if(d.gm===18||d.gm===34){
          const rec={}; let q=p;
          d.f.forEach(fd=>{
            const bs=SIZES[fd.type]||1; let val=null;
            if(fd.size===bs){
              if(fd.type===2||fd.type===0||fd.type===10||fd.type===13){val=v.getUint8(q);if(val===0xff)val=null}
              else if(fd.type===4||fd.type===11){val=v.getUint16(q,d.le);if(val===0xffff)val=null}
              else if(fd.type===6||fd.type===12){val=v.getUint32(q,d.le);if(val===0xffffffff)val=null}
              else if(fd.type===1){val=v.getInt8(q)}
              else if(fd.type===3){val=v.getInt16(q,d.le)}
              else if(fd.type===5){val=v.getInt32(q,d.le)}
            }
            rec[fd.num]=val; q+=fd.size;
          });
          if(d.gm===18&&!out.session)out.session=rec; else if(d.gm===34&&!out.activity)out.activity=rec;
        }
        p=start+d.size;
      }
    }
    return out;
  }

  function pad(n){return String(n).padStart(2,'0')}
  function fmtPace(sec,km){if(!km||km<=0)return null;const s=Math.round(sec/km);return Math.floor(s/60)+':'+pad(s%60)}

  // Converte o resumo FIT no mesmo formato dos itens do relógio que o app já usa.
  function itemFromFit(buf,name){
    const r=parseFit(buf), s=r.session; if(!s)return null;
    const timer=(s[8]!=null?s[8]:s[7]!=null?s[7]:0)/1000;
    const distKm=s[9]!=null?Math.round(s[9]/100/1000*100)/100:null;
    const sport=SPORT[s[5]]||'outro', sub=SUB[s[6]]||'';
    let kind='cardio', title='Atividade';
    if(sport==='running'&&sub==='treadmill')title='Esteira (corrida/caminhada)';
    else if(sport==='running')title='Corrida';
    else if(sport==='walking')title='Caminhada';
    else if(sport==='hiking')title='Trilha';
    else if(sport==='cycling')title='Bicicleta';
    else if(sport==='swimming')title='Natação';
    else if(sport==='training'||sport==='fitness_equipment'){title='Musculação';kind='manual'}
    const item={kind:kind,title:title,src:name||'',durSec:Math.round(timer)};
    if(kind==='cardio'&&distKm){item.distKm=distKm;item.pace=fmtPace(timer,s[9]/100/1000)}
    if(s[16]!=null)item.hrAvg=s[16];
    if(s[17]!=null)item.hrMax=s[17];
    if(s[11]!=null)item.kcal=s[11];
    // dia local da atividade: início (UTC) + diferença entre hora local e UTC
    let date=null;
    if(s[2]!=null){
      let off=0; const a=r.activity;
      if(a&&a[5]!=null&&a[253]!=null)off=a[5]-a[253];
      const d=new Date((s[2]+FIT_EPOCH+off)*1000);
      date=d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate());
    }
    return {item:item,date:date};
  }

  async function inflateRaw(bytes){
    const ds=new DecompressionStream('deflate-raw');
    const stream=new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function zipEntries(buf){
    const v=new DataView(buf.buffer,buf.byteOffset,buf.byteLength); let e=-1;
    for(let i=buf.byteLength-22;i>=Math.max(0,buf.byteLength-65600);i--){if(v.getUint32(i,true)===0x06054b50){e=i;break}}
    if(e<0)throw new Error('ZIP inválido');
    const n=v.getUint16(e+10,true); let p=v.getUint32(e+16,true); const out=[];
    for(let i=0;i<n;i++){
      if(v.getUint32(p,true)!==0x02014b50)break;
      const method=v.getUint16(p+10,true), csize=v.getUint32(p+20,true), nlen=v.getUint16(p+28,true), xlen=v.getUint16(p+30,true), clen=v.getUint16(p+32,true), off=v.getUint32(p+42,true);
      const name=new TextDecoder().decode(buf.subarray(p+46,p+46+nlen));
      const lh=off, lnl=v.getUint16(lh+26,true), lxl=v.getUint16(lh+28,true), ds=lh+30+lnl+lxl;
      const raw=buf.subarray(ds,ds+csize);
      out.push({name:name,data:method===0?raw:method===8?await inflateRaw(raw):null});
      p+=46+nlen+xlen+clen;
    }
    return out;
  }

  // Devolve uma lista de {item, date} para um arquivo escolhido pelo usuário.
  async function itemsFromFile(file,parseCsv){
    const name=file.name||'', low=name.toLowerCase(), res=[];
    if(low.endsWith('.zip')){
      const ents=await zipEntries(new Uint8Array(await file.arrayBuffer()));
      for(const en of ents){
        if(en.data&&/\.fit$/i.test(en.name)){const x=itemFromFit(en.data,en.name.split('/').pop());if(x)res.push(x)}
      }
    }else if(low.endsWith('.fit')){
      const x=itemFromFit(new Uint8Array(await file.arrayBuffer()),name); if(x)res.push(x);
    }else{
      const it=parseCsv(await file.text(),name); if(it)res.push({item:it,date:null});
    }
    return res;
  }
  window.GarminFit={parseFit:parseFit,itemFromFit:itemFromFit,zipEntries:zipEntries,itemsFromFile:itemsFromFile};
})();
