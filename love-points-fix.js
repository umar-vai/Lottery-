(function(){
'use strict';
function replaceText(text){
  return String(text||'')
    .replace(/Land Points/gi,'Love Points')
    .replace(/Land Point/gi,'Love Point')
    .replace(/Support Points/gi,'Love Points')
    .replace(/Support Point/gi,'Love Point')
    .replace(/ল্যান্ড পয়েন্ট/g,'লাভ পয়েন্ট')
    .replace(/\bSP\b/g,'LP');
}
function apply(root){
  try{
    var host=root||document.body;if(!host)return;
    if(host.nodeType===Node.TEXT_NODE){var t=replaceText(host.nodeValue);if(t!==host.nodeValue)host.nodeValue=t;return}
    var walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT),node;
    while((node=walker.nextNode())){
      var parent=node.parentElement;if(parent&&/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/i.test(parent.tagName))continue;
      var next=replaceText(node.nodeValue);if(next!==node.nodeValue)node.nodeValue=next;
    }
  }catch(e){}
}
function install(){
  apply(document.body);
  [250,750,1800,3200,6500,12000].forEach(function(ms){setTimeout(function(){apply(document.body)},ms)});
  window.LovePointsBrand={apply:apply};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
