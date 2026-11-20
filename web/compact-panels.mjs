const $=id=>document.getElementById(id);

export function resultPage(name='style'){
  for(const page of document.querySelectorAll('[data-result-page]'))page.hidden=page.dataset.resultPage!==name;
  for(const button of $('resultTabs').children)button.setAttribute('aria-pressed',String(button.dataset.resultTab===name));
}

export function initCompactPanels(){
  const sources=$('sourcePanel');
  for(const id of ['chooseSource','chooseSourceMini'])$(id).onclick=()=>sources.showModal();
  $('closeSource').onclick=()=>sources.close();
  for(const id of ['openCam','editLocal'])$(id).addEventListener('click',()=>sources.close(),true);
  $('backgroundFile').addEventListener('change',()=>sources.close(),true);
  for(const button of $('resultTabs').children)button.onclick=()=>resultPage(button.dataset.resultTab);
  for(const tabs of document.querySelectorAll('[data-parameters]')){
    for(const button of tabs.children)button.onclick=()=>{
      for(const row of $(tabs.dataset.parameters).children)row.hidden=row.dataset.parameterRow!==button.dataset.parameter;
      for(const other of tabs.children)other.setAttribute('aria-pressed',String(other===button));
    };
  }
  const panel=$('typePanel'),select=$('templateType');
  $('templateFilters').onclick=()=>{
    for(const button of panel.querySelectorAll('[data-type]'))button.setAttribute('aria-pressed',String(button.dataset.type===select.value));
    panel.showModal();
  };
  $('closeType').onclick=()=>panel.close();
  for(const button of panel.querySelectorAll('[data-type]'))button.onclick=()=>{
    select.value=button.dataset.type;$('templateFilters').textContent=button.textContent+' ▾';
    panel.close();select.dispatchEvent(new Event('change'));
  };
  panel.addEventListener('click',event=>{
    if(event.target!==panel)return;
    const r=panel.getBoundingClientRect();
    if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)panel.close();
  });
  const viewport=()=>{
    const v=window.visualViewport;
    document.documentElement.style.setProperty('--visible-height',(v?.height||innerHeight)+'px');
    document.body.toggleAttribute('data-short-view',(v?.height||innerHeight)<320);
  };
  viewport();window.visualViewport?.addEventListener('resize',viewport);window.addEventListener('resize',viewport);
}
