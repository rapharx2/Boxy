globalThis.browser ??= globalThis.chrome;
// Local Intelligence v1 — índice TF-IDF leve, 100% offline (sem modelo, sem deps).
// Ranqueia por relevância de termos, não por significado profundo (embeddings = fase futura).
(function(){
  // Stopwords PT + EN (conjunto pequeno, suficiente para o corpus name+note)
  const STOP = new Set(('a o e de da do das dos um uma para por com que no na em os as se ao à the of and to in is it for on with that this at be or an as your you').split(' '));
  // Stemmer-leve: normaliza plural simples (carros→carro, elétricos→elétrico, hooks→hook).
  // Conservador de propósito: só remove o "s" final quando sobram >3 chars, para não
  // quebrar tokens curtos legítimos (gas, bus, css) nem confundir singulares.
  function stem(t){ return (t.length > 3 && t.endsWith('s')) ? t.slice(0, -1) : t; }
  function tokenize(text){
    // Minúsculas + remoção de acentos via NFD (é → e) + split em não-alfanumérico + stem
    return (text||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
      .split(/[^a-z0-9]+/).filter(t=>t.length>=2 && !STOP.has(t)).map(stem);
  }
  function buildIndex(docs){
    const df=new Map(); const D=[];
    for(const d of docs){ const tf=new Map(); const toks=tokenize(d.text);
      for(const t of toks) tf.set(t,(tf.get(t)||0)+1);
      for(const t of tf.keys()) df.set(t,(df.get(t)||0)+1);
      D.push({id:d.id, tf, len:toks.length}); }
    return { N:D.length, df, docs:D };
  }
  function score(index, queryText){
    const q=tokenize(queryText); if(!q.length) return [];
    const out=[];
    for(const doc of index.docs){ let s=0;
      for(const t of q){ const tf=doc.tf.get(t); if(!tf) continue;
        const idf=Math.log(1 + index.N/(1+(index.df.get(t)||0))); s+=tf*idf; }
      if(s>0) out.push({id:doc.id, score:s}); }
    return out.sort((a,b)=>b.score-a.score);
  }
  globalThis.BoxySearch = { tokenize, buildIndex, score };
})();
