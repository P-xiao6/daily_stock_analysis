import{a as i,r as m,M as c}from"./vendor-markdown-sAeW1ZNW.js";import{d as x,j as d}from"./vendor-react-BzB2o5Ol.js";function h(r){return r?i(r,{gfm:!0,useImgAltText:!0,stripListLeaders:!0}).replace(/\n\|?[\s|:-]+\|?\s*(?=\n|$)/g,`
`).trim():""}const b=r=>{const e=x.c(7),{content:n,className:l,testId:p}=r,a=`home-markdown-prose prose prose-invert prose-sm max-w-none
      prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
      prose-h1:text-xl
      prose-h2:text-lg
      prose-h3:text-base
      prose-p:leading-relaxed prose-p:mb-3 prose-p:last:mb-0
      prose-strong:text-foreground prose-strong:font-semibold
      prose-ul:my-2 prose-ol:my-2 prose-li:my-1
      prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
      prose-pre:border
      prose-table:border-collapse
      prose-hr:my-4
      prose-a:no-underline hover:prose-a:underline
      prose-blockquote:text-secondary-text
      whitespace-pre-line break-words
      ${l===void 0?"":l}
    `;let s;e[0]===Symbol.for("react.memo_cache_sentinel")?(s=[m],e[0]=s):s=e[0];let o;e[1]!==n?(o=d.jsx(c,{remarkPlugins:s,children:n}),e[1]=n,e[2]=o):o=e[2];let t;return e[3]!==a||e[4]!==o||e[5]!==p?(t=d.jsx("div",{"data-testid":p,className:a,children:o}),e[3]=a,e[4]=o,e[5]=p,e[6]=t):t=e[6],t};export{b as R,h as m};
