// Read-only Markdown preview; always HTML-escapes user content before formatting.
// Supports common headings, emphasis, tables, lists, quotes and fenced code from original manuals.
const escapeHtml=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function inline(value){
  return escapeHtml(value)
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g,'<em>$1</em>')
    .replace(/~~(.+?)~~/g,'<del>$1</del>');
}
export function renderManualMarkdown(markdown){
  const lines=String(markdown||'').replace(/\r\n?/g,'\n').split('\n');
  let out='',list='',code=false;
  const closeList=()=>{if(list){out+='</'+list+'>';list='';}};
  const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());
  for(let i=0;i<lines.length;i++){
    const line=lines[i],trim=line.trim();
    if(/^\x60{3}/.test(trim)){
      closeList();if(!code){out+='<pre><code>';code=true;}else{out+='</code></pre>';code=false;}continue;
    }
    if(code){out+=escapeHtml(line)+'\n';continue;}
    if(!trim){closeList();continue;}
    if(/^\|.+\|$/.test(trim)&&i+1<lines.length&&/^\|?[ :|\-]+\|?$/.test(lines[i+1].trim())){
      closeList();const headers=cells(trim);
      out+='<table><thead><tr>'+headers.map(x=>'<th>'+inline(x)+'</th>').join('')+'</tr></thead><tbody>';
      i++;
      while(i+1<lines.length&&/^\|.+\|$/.test(lines[i+1].trim())){
        out+='<tr>'+cells(lines[++i]).map(x=>'<td>'+inline(x)+'</td>').join('')+'</tr>';
      }
      out+='</tbody></table>';continue;
    }
    const heading=trim.match(/^(#{1,6})\s+(.+)$/);
    if(heading){closeList();const level=heading[1].length;out+='<h'+level+'>'+inline(heading[2])+'</h'+level+'>';continue;}
    if(/^([-*_]\s*){3,}$/.test(trim)){closeList();out+='<hr />';continue;}
    if(/^>\s*/.test(trim)){closeList();out+='<blockquote>'+inline(trim.replace(/^>\s*/,''))+'</blockquote>';continue;}
    const bullet=trim.match(/^[-*+]\s+(.+)$/);
    const ordered=trim.match(/^\d+[.)]\s+(.+)$/);
    if(bullet||ordered){
      const tag=bullet?'ul':'ol';if(list!==tag){closeList();list=tag;out+='<'+tag+'>';}
      out+='<li>'+inline((bullet||ordered)[1])+'</li>';continue;
    }
    closeList();out+='<p>'+inline(trim)+'</p>';
  }
  closeList();if(code)out+='</code></pre>';
  return out;
}
