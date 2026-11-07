/* Camada de dados: Supabase atrás da mesma interface que o app já usava
   (doc(...).set / onSnapshot, collection(...).onSnapshot / add / orderBy / limit).
   Também cuida do login e guarda uma cópia local para abrir sem internet. */
(function(){
  const cfg=window.APP_CONFIG||{};
  const ready=cfg.SUPABASE_URL&&cfg.SUPABASE_ANON_KEY&&window.supabase;
  let sb=null, uid=null;

  function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

  /* ---------- tela de login ---------- */
  function loginScreen(msg){
    return new Promise(resolve=>{
      let el=document.getElementById('login');
      if(!el){
        el=document.createElement('div'); el.id='login';
        el.innerHTML='<form class="lcard" autocomplete="on"><h1>Diário de Treino</h1>'+
          '<p class="lmsg" id="lmsg" role="status"></p>'+
          '<label for="lem">E-mail</label><input id="lem" type="email" autocomplete="username" required>'+
          '<label for="lpw">Senha</label><input id="lpw" type="password" autocomplete="current-password" required>'+
          '<button type="submit" id="lbtn">Entrar</button></form>';
        document.body.appendChild(el);
      }
      el.hidden=false; document.getElementById('lmsg').textContent=msg||'Entre para ver seus treinos.';
      const form=el.querySelector('form');
      form.onsubmit=async ev=>{
        ev.preventDefault();
        const b=document.getElementById('lbtn'); b.disabled=true; b.textContent='Entrando…';
        const {data,error}=await sb.auth.signInWithPassword({email:document.getElementById('lem').value.trim(),password:document.getElementById('lpw').value});
        b.disabled=false; b.textContent='Entrar';
        if(error){document.getElementById('lmsg').textContent='Não consegui entrar: '+(error.message||'confira e-mail e senha.');return}
        el.hidden=true; resolve(data.session);
      };
    });
  }
  function setupScreen(){
    const el=document.createElement('div'); el.id='login';
    el.innerHTML='<div class="lcard"><h1>Diário de Treino</h1><p class="lmsg">Falta configurar o Supabase: preencha a URL e a chave pública no arquivo config.js.</p></div>';
    document.body.appendChild(el);
  }

  /* ---------- cópia local (leitura sem internet) ---------- */
  function cget(k){try{return JSON.parse(localStorage.getItem('sbc:'+uid+':'+k)||'null')}catch(e){return null}}
  function cset(k,v){try{localStorage.setItem('sbc:'+uid+':'+k,JSON.stringify(v))}catch(e){}}

  /* ---------- acesso ao banco ---------- */
  async function fetchColl(coll){
    const {data,error}=await sb.from('docs').select('id,data').eq('collection',coll).limit(5000);
    if(error)throw error; return data||[];
  }
  const subs={}; // uma assinatura em tempo real por coleção
  function watch(coll,onChange){
    if(!subs[coll]){
      subs[coll]={cbs:[],timer:null};
      sb.channel('docs-'+coll).on('postgres_changes',{event:'*',schema:'public',table:'docs',filter:'collection=eq.'+coll},()=>{
        clearTimeout(subs[coll].timer); subs[coll].timer=setTimeout(()=>subs[coll].cbs.forEach(f=>f()),250);
      }).subscribe();
    }
    subs[coll].cbs.push(onChange);
  }
  function snapFromRows(rows){return {docs:rows.map(r=>({id:r.id,data:()=>r.data}))}}

  function listen(coll,make,onSnap,onErr,filter){
    let first=true;
    const cached=cget(coll); if(cached)onSnap(make(filter?filter(cached):cached));
    const load=async()=>{
      try{const rows=await fetchColl(coll); cset(coll,rows); onSnap(make(filter?filter(rows):rows))}
      catch(e){ if(first&&!cached&&onErr)onErr(e); else if(!first&&onErr)onErr(e) }
      first=false;
    };
    load(); watch(coll,load);
    window.addEventListener('online',load);
  }

  function makeDb(){
    return {
      doc(path){
        const i=path.indexOf('/'), coll=path.slice(0,i), id=path.slice(i+1);
        return {
          async set(data){
            const {error}=await sb.from('docs').upsert({user_id:uid,collection:coll,id:id,data:data},{onConflict:'user_id,collection,id'});
            if(error)throw error;
          },
          onSnapshot(cb,err){
            listen(coll,rows=>{const r=rows.find(x=>x.id===id);return {exists:!!r,data:()=>r?r.data:undefined}},cb,err);
          }
        };
      },
      collection(coll){
        const q={order:null,dir:'asc',lim:null};
        const api={
          orderBy(f,d){q.order=f;q.dir=d||'asc';return api},
          limit(n){q.lim=n;return api},
          async add(data){
            const id=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2));
            const {error}=await sb.from('docs').insert({user_id:uid,collection:coll,id:id,data:data});
            if(error)throw error; return {id:id};
          },
          onSnapshot(cb,err){
            const shape=rows=>{
              let r=rows.slice();
              if(q.order){r.sort((a,b)=>{const x=(a.data||{})[q.order],y=(b.data||{})[q.order];return (x>y?1:x<y?-1:0)*(q.dir==='desc'?-1:1)})}
              if(q.lim)r=r.slice(0,q.lim);
              return snapFromRows(r);
            };
            listen(coll,shape,cb,err);
          }
        };
        return api;
      }
    };
  }

  window.__getDb=async function(){
    if(!ready){setupScreen();return null}
    sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
    let {data:{session}}=await sb.auth.getSession();
    if(!session)session=await loginScreen();
    uid=session.user.id;
    sb.auth.onAuthStateChange((ev,s)=>{if(ev==='SIGNED_OUT'){location.reload()}});
    window.__signOut=async()=>{await sb.auth.signOut()};
    return makeDb();
  };
})();
