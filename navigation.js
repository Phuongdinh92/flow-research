'use strict';
// Keep navigation links shareable and respect browser back/forward.
document.addEventListener('DOMContentLoaded',()=>{
 const buttons=[...document.querySelectorAll('nav button[data-tab]')];
 const activate=()=>{const id=location.hash.slice(1);const target=buttons.find(b=>b.dataset.tab===id);if(target)target.click();};
 for(const button of buttons)button.addEventListener('click',()=>{const next='#'+button.dataset.tab;if(location.hash!==next)history.pushState(null,'',next);});
 window.addEventListener('hashchange',activate);window.addEventListener('popstate',activate);activate();
});
