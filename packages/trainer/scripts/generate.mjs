// Seed dataset generator for BrickByBrick trainer
// Run: node packages/trainer/scripts/generate.mjs
import { writeFileSync } from "node:fs";

const CATS = [
  "layout_collision",
  "overflow",
  "truncation",
  "offscreen_render",
  "frozen_state",
  "script_error",
  "other",
];
const SEVS = ["low", "medium", "high", "critical"];
let sid = 42;
const R = () => {
  sid = (sid * 1664525 + 1013904223) | 0;
  return (sid >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(R() * a.length)];
const c = (id, desc, w) => ({ id, description: desc, weight: w });

// Mechanism definitions with variant generators
const MECHS = [];

// 1. responsive-grid (5 variants)
MECHS.push({
  m: "responsive-grid",
  p: "Build a responsive CSS Grid layout that collapses columns on mobile",
  crit: [
    c("c-overflow", "No horizontal overflow at any viewport", 0.4),
    c("c-columns", "Correct columns per breakpoint", 0.3),
    c("c-gap", "Consistent gap between items", 0.3),
  ],
  n: 5,
  gen(n) {
    const bugs = [
      [
        'function Grid({items}){return <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)"}}>{items.map(i=><div key={i}>{i}</div>)}</div>}',
        "overflow-x at 375px; no responsive breakpoints",
        'function Grid({items}){return <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(250px,1fr))",gap:"1rem"}}>{items.map(i=><div key={i}>{i}</div>)}</div>}',
      ],
      [
        'function Grid({items}){return <div className="grid grid-cols-4">{items.map(i=><div key={i}>{i}</div>)}</div>}',
        "4-col fixed grid overflows iPad 768px",
        'function Grid({items}){return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{items.map(i=><div key={i}>{i}</div>)}</div>}',
      ],
      [
        'function Grid({items}){return <div style={{display:"flex",flexWrap:"wrap"}}>{items.map(i=><div style={{width:"33%"}} key={i}>{i}</div>)}</div>}',
        "fixed % widths cause wrap misalignment with borders",
        'function Grid({items}){return <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:"16px"}}>{items.map(i=><div key={i}>{i}</div>)}</div>}',
      ],
      [
        "function Grid({items}){return <div style={{columns:3}}>{items.map(i=><div key={i}>{i}</div>)}</div>}",
        "CSS columns break item order top-to-bottom",
        'function Grid({items}){return <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"12px"}}>{items.map(i=><div key={i}>{i}</div>)}</div>}',
      ],
      [
        'function Grid({items}){return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",minWidth:"1200px"}}>{items.map(i=><div key={i}>{i}</div>)}</div>}',
        "hard min-width forces horizontal scrollbar on mobile",
        'function Grid({items}){return <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,300px),1fr))",gap:"1rem",maxWidth:"100%"}}>{items.map(i=><div key={i}>{i}</div>)}</div>}',
      ],
    ];
    const [w, d, s] = bugs[n % bugs.length];
    return { w, d, s };
  },
});

// 2. modal-focus-trap (4)
MECHS.push({
  m: "modal-focus-trap",
  p: "Implement a modal dialog with proper focus trap and Escape key dismissal",
  crit: [
    c("c-focus-trap", "Tab cycles focus within modal", 0.5),
    c("c-escape", "Escape key closes modal", 0.25),
    c("c-backdrop", "Clicking backdrop closes modal", 0.25),
  ],
  n: 4,
  gen(n) {
    const bugs = [
      [
        "function Modal({open,onClose,children}){if(!open)return null;return <div onClick={onClose}><div onClick={e=>e.stopPropagation()}>{children}</div></div>}",
        "Tab exits modal to background; no focus trap; no aria-modal",
        'function Modal({open,onClose,children}){const ref=useRef(null);useEffect(()=>{if(open)ref.current?.focus();const h=e=>{if(e.key==="Escape")onClose()};document.addEventListener("keydown",h);return()=>document.removeEventListener("keydown",h)},[open]);if(!open)return null;return <div role="dialog" aria-modal="true" ref={ref} tabIndex={-1} onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center"}}><div onClick={e=>e.stopPropagation()} style={{background:"#fff",padding:"2rem",borderRadius:"8px"}}>{children}<button onClick={onClose}>Close</button></div></div>}',
      ],
      [
        'function Modal({open,children}){return open?<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)"}}><div style={{margin:"100px auto",maxWidth:"500px",background:"#fff",padding:"1rem"}}>{children}</div></div>:null}',
        "No close mechanism; body scroll not locked; no aria",
        'function Modal({open,onClose,children}){useEffect(()=>{document.body.style.overflow=open?"hidden":"";return()=>{document.body.style.overflow=""}},[open]);if(!open)return null;return <div role="dialog" aria-modal="true" onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}><div onClick={e=>e.stopPropagation()} style={{maxWidth:"500px",width:"90%",background:"#fff",padding:"1.5rem",borderRadius:"8px"}}>{children}<button onClick={onClose}>X</button></div></div>}',
      ],
      [
        'function Modal({open,onClose,children}){const [v,setV]=useState(false);useEffect(()=>{setV(open)},[open]);return v?<div style={{position:"absolute",top:"20%",left:"50%",transform:"translateX(-50%)",background:"#fff",padding:"1rem",zIndex:99}}>{children}</div>:null}',
        "position:absolute scrolls with page; no backdrop overlay",
        'function Modal({open,onClose,children}){if(!open)return null;return ReactDOM.createPortal(<><div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000}}/><div role="dialog" aria-modal="true" style={{position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:"#fff",padding:"1.5rem",borderRadius:"8px",zIndex:1001,minWidth:"300px"}}>{children}<button onClick={onClose}>X</button></div></>,document.body)}',
      ],
      [
        'function Modal({open,onClose,children}){return open&&<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.3)"}}><div style={{position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:"#fff",padding:"1rem"}}>{children}</div></div>}',
        "User trapped with no Escape; frozen state",
        'function Modal({open,onClose,children}){useEffect(()=>{if(!open)return;const h=e=>{if(e.key==="Escape")onClose()};document.addEventListener("keydown",h);return()=>document.removeEventListener("keydown",h)},[open,onClose]);if(!open)return null;return <div role="dialog" aria-modal="true" onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",display:"flex",alignItems:"center",justifyContent:"center"}}><div onClick={e=>e.stopPropagation()} style={{background:"#fff",padding:"1.5rem",borderRadius:"8px"}}>{children}<button onClick={onClose}>Close</button></div></div>}',
      ],
    ];
    const [w, d, s] = bugs[n % bugs.length];
    return { w, d, s };
  },
});

// ======== APPENDED: remaining mechanisms + output logic ========

// 3. form-validation (4)
MECHS.push({
  m: "form-validation",
  p: "Create a form with real-time validation showing inline error messages",
  crit: [
    c("c-inline-errors", "Error messages below fields", 0.4),
    c("c-realtime", "Validation on input change", 0.3),
    c("c-submit", "Submit disabled when invalid", 0.3),
  ],
  n: 4,
  gen(n) {
    const bugs = [
      [
        'function Form(){const [email,setEmail]=useState("");const submit=()=>fetch("/api",{method:"POST",body:JSON.stringify({email})});return <form onSubmit={e=>{e.preventDefault();submit()}}><input value={email} onChange={e=>setEmail(e.target.value)}/><button>Submit</button></form>}',
        "No validation; accepts empty email; no errors",
        'function Form(){const [email,setEmail]=useState("");const [error,setError]=useState("");const validate=v=>/^[^\\s@]+@[^\\s@]+$/.test(v);const h=e=>{const v=e.target.value;setEmail(v);setError(v&&!validate(v)?"Invalid":v?"":"Required")};return <form onSubmit={e=>{e.preventDefault();if(validate(email))fetch("/api",{method:"POST",body:JSON.stringify({email})})}} noValidate><input value={email} onChange={h} aria-invalid={!!error}/><div role="alert" style={{color:"red"}}>{error}</div><button disabled={!!error}>Submit</button></form>}',
      ],
      [
        'function Form(){const [name,setName]=useState("");const [err,setErr]=useState("");const submit=()=>{if(!name){setErr("Required");return}fetch("/api",{method:"POST",body:JSON.stringify({name})})};return <form onSubmit={e=>{e.preventDefault();submit()}}><input value={name} onChange={e=>setName(e.target.value)}/>{err&&<p>{err}</p>}<button>Submit</button></form>}',
        "Error only on submit; not cleared on input",
        'function Form(){const [name,setName]=useState("");const error=!name.trim()?"Required":name.length<2?"Too short":"";return <form onSubmit={e=>{e.preventDefault();if(!error)fetch("/api",{method:"POST",body:JSON.stringify({name})})}} noValidate><input value={name} onChange={e=>setName(e.target.value)} aria-invalid={!!error}/>{error&&<p role="alert" style={{color:"red"}}>{error}</p>}<button disabled={!!error||!name}>Submit</button></form>}',
      ],
      [
        'function Form(){const [pw,setPw]=useState("");return <form><input type="password" value={pw} onChange={e=>setPw(e.target.value)}/><button disabled={pw.length<8}>Submit</button></form>}',
        "Only checks length; no complexity rules",
        'function Form(){const [pw,setPw]=useState("");const [confirm,setConfirm]=useState("");const e={pw:!pw?"Req":pw.length<8?"Min 8":"",confirm:!confirm?"Req":confirm!==pw?"Mismatch":""};const v=!e.pw&&!e.confirm;return <form noValidate><input type="password" value={pw} onChange={x=>setPw(x.target.value)} aria-invalid={!!e.pw}/>{e.pw&&<small role="alert" style={{color:"red"}}>{e.pw}</small>}<input type="password" value={confirm} onChange={x=>setConfirm(x.target.value)} placeholder="Confirm"/>{e.confirm&&<small role="alert" style={{color:"red"}}>{e.confirm}</small>}<button disabled={!v}>Submit</button></form>}',
      ],
      [
        'function Form(){const [age,setAge]=useState("");return <form onSubmit={e=>{e.preventDefault();if(!age||isNaN(age)||age<0)alert("Invalid")}}><input value={age} onChange={e=>setAge(e.target.value)}/><button>Submit</button></form>}',
        "alert() not inline; no real-time; no aria",
        'function Form(){const [age,setAge]=useState("");const error=!age?"Req":isNaN(+age)||+age<0?"Pos num":+age>150?"Too large":+age<13?"13+":"";return <form onSubmit={e=>{e.preventDefault();if(!error)fetch("/api",{method:"POST",body:JSON.stringify({age:+age})})}} noValidate><input type="number" min="13" value={age} onChange={x=>setAge(x.target.value)} aria-invalid={!!error}/>{error&&<span role="alert" style={{color:"red"}}>{error}</span>}<button disabled={!!error}>Submit</button></form>}',
      ],
    ];
    const [w, d, s] = bugs[n % bugs.length];
    return { w, d, s };
  },
});

// 4. dropdown-menu (3)
MECHS.push({
  m: "dropdown-menu",
  p: "Implement an accessible dropdown menu with keyboard navigation",
  crit: [
    c("c-keyboard", "Arrow keys navigate, Enter selects, Escape closes", 0.5),
    c("c-click-outside", "Clicking outside closes", 0.3),
    c("c-aria", "Proper ARIA attributes", 0.2),
  ],
  n: 3,
  gen(n) {
    const bugs = [
      [
        "function Dropdown({items}){const[open,setOpen]=useState(false);return <div><button onClick={()=>setOpen(!open)}>Menu</button>{open&&<ul>{items.map(i=><li key={i} onClick={()=>{alert(i);setOpen(false)}}>{i}</li>)}</ul>}</div>}",
        "No keyboard; no ARIA; no outside dismiss",
        'function Dropdown({items}){const[open,setOpen]=useState(false);const[active,setActive]=useState(-1);const ref=useRef(null);useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false)};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h)},[]);const onKey=e=>{if(e.key==="ArrowDown"){e.preventDefault();setActive(i=>(i+1)%items.length)}else if(e.key==="ArrowUp"){e.preventDefault();setActive(i=>(i-1+items.length)%items.length)}else if(e.key==="Enter"&&active>=0){items[active]();setOpen(false)}else if(e.key==="Escape")setOpen(false)};return <div ref={ref}><button aria-haspopup="true" aria-expanded={open} onClick={()=>setOpen(!open)} onKeyDown={onKey}>Menu</button>{open&&<ul role="menu">{items.map((fn,i)=><li key={i} role="menuitem" tabIndex={-1} style={{background:i===active?"#e0e0e0":""}} onClick={()=>{fn();setOpen(false)}}>{i}</li>)}</ul>}</div>}',
      ],
      [
        'function Dropdown({label,items}){const[open,setOpen]=useState(false);return <div onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)}><span>{label}</span>{open&&<div style={{position:"absolute",background:"#fff",border:"1px solid #ccc"}}>{items.map(i=><div key={i}>{i}</div>)}</div>}</div>}',
        "Hover-only; no keyboard; no ARIA",
        'function Dropdown({label,items}){const[open,setOpen]=useState(false);const btnRef=useRef(null);const listRef=useRef(null);useEffect(()=>{if(!open)return;const h=e=>{if(listRef.current&&!listRef.current.contains(e.target)&&e.target!==btnRef.current)setOpen(false)};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h)},[open]);return <div style={{position:"relative"}}><button ref={btnRef} aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(!open)}>{label}</button>{open&&<ul ref={listRef} role="listbox" style={{position:"absolute",top:"100%",left:0,background:"#fff",border:"1px solid #ccc",listStyle:"none",padding:0,zIndex:100}}>{items.map((item,i)=><li key={i} role="option" style={{padding:"8px 16px",cursor:"pointer"}} onClick={()=>{item.action();setOpen(false)}}>{item.label}</li>)}</ul>}</div>}',
      ],
      [
        "function Dropdown({items}){return <select onChange={e=>items[e.target.selectedIndex]?.onClick?.()}>{items.map((i,n)=><option key={n}>{i.label}</option>)}</select>}",
        "Native select unstyled; poor UX",
        'function Dropdown({items}){const[open,setOpen]=useState(false);const btnRef=useRef(null);const listRef=useRef(null);useEffect(()=>{if(!open)return;const h=e=>{if(listRef.current&&!listRef.current.contains(e.target)&&!btnRef.current.contains(e.target))setOpen(false)};document.addEventListener("click",h);return()=>document.removeEventListener("click",h)},[open]);return <div style={{position:"relative"}}><button ref={btnRef} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(!open)} style={{padding:"8px 16px",border:"1px solid #ccc",borderRadius:"4px",background:"#fff",cursor:"pointer"}}>Actions</button>{open&&<div ref={listRef} role="menu" style={{position:"absolute",top:"100%",left:0,background:"#fff",border:"1px solid #e0e0e0",borderRadius:"4px",boxShadow:"0 4px 12px rgba(0,0,0,0.1)",zIndex:100}}>{items.map((i,n)=><button key={n} role="menuitem" style={{display:"block",width:"100%",padding:"10px 16px",border:"none",background:"none",textAlign:"left",cursor:"pointer"}} onClick={()=>{i.onClick?.();setOpen(false)}}>{i.label}</button>)}</div>}</div>}',
      ],
    ];
    const [w, d, s] = bugs[n % bugs.length];
    return { w, d, s };
  },
});

// Remaining mechanisms (simple templates)
const SIMPLE = [
  {
    m: "toast-system",
    p: "Build a toast notification system with auto-dismiss and progress bar",
    c: [
      c("c-auto", "Dismisses after 5s", 0.35),
      c("c-progress", "Progress bar animates", 0.35),
      c("c-stack", "Toasts stack without overlap", 0.3),
    ],
  },
  {
    m: "carousel",
    p: "Build an accessible image carousel with prev/next, dots, and autoplay",
    c: [
      c("c-nav", "Prev/next wrap", 0.35),
      c("c-dots", "Dot indicators", 0.3),
      c("c-auto", "Autoplay 3s,pauses on hover", 0.2),
      c("c-aria", "Live-region ARIA", 0.15),
    ],
  },
  {
    m: "tabs",
    p: "Build an accessible tab panel with keyboard navigation",
    c: [
      c("c-key", "Arrow keys navigate", 0.4),
      c("c-panel", "Only active panel visible", 0.35),
      c("c-aria", "Tab/tabpanel ARIA", 0.25),
    ],
  },
  {
    m: "accordion",
    p: "Build an accessible accordion with smooth expand/collapse",
    c: [
      c("c-toggle", "Click toggles panel", 0.35),
      c("c-anim", "Smooth animation", 0.3),
      c("c-aria", "aria-expanded/controls", 0.2),
      c("c-key", "Enter/Space toggles", 0.15),
    ],
  },
  {
    m: "infinite-scroll",
    p: "Implement infinite scroll loading more items near bottom",
    c: [
      c("c-detect", "Detects near bottom", 0.4),
      c("c-loading", "Loading indicator", 0.3),
      c("c-dedupe", "No duplicate fetches", 0.3),
    ],
  },
  {
    m: "drag-drop",
    p: "Implement drag-and-drop sortable list with keyboard reorder",
    c: [
      c("c-drag", "Drag to reorder", 0.4),
      c("c-key", "Keyboard reorder", 0.35),
      c("c-aria", "Live region announcements", 0.25),
    ],
  },
  {
    m: "tooltip",
    p: "Build accessible tooltip on hover/focus dismissible with Escape",
    c: [
      c("c-hover", "Appears on hover", 0.3),
      c("c-focus", "Appears on focus", 0.3),
      c("c-dismiss", "Escape dismisses", 0.2),
      c("c-aria", "aria-describedby", 0.2),
    ],
  },
  {
    m: "search-autocomplete",
    p: "Build accessible search with autocomplete suggestions",
    c: [
      c("c-suggestions", "Filtered suggestions", 0.35),
      c("c-key", "Arrow/Enter/Escape", 0.35),
      c("c-aria", "Combobox pattern", 0.3),
    ],
  },
  {
    m: "data-table",
    p: "Build accessible data table with sortable columns and responsive scroll",
    c: [
      c("c-sort", "Click header sorts", 0.35),
      c("c-resp", "Horizontal scroll mobile", 0.35),
      c("c-aria", "thead/tbody/th scope", 0.3),
    ],
  },
  {
    m: "stepper-wizard",
    p: "Build multi-step wizard with indicators and per-step validation",
    c: [
      c("c-nav", "Next/Back buttons", 0.35),
      c("c-ind", "Step indicators", 0.3),
      c("c-val", "Validation per step", 0.35),
    ],
  },
  {
    m: "pagination",
    p: "Build accessible pagination with page numbers and prev/next",
    c: [
      c("c-nav", "Prev/Next and direct clicks", 0.4),
      c("c-cur", "Current page indicated", 0.3),
      c("c-aria", "Navigation role", 0.3),
    ],
  },
  {
    m: "skeleton-loader",
    p: "Build skeleton loading placeholder matching content layout",
    c: [
      c("c-shape", "Shapes match content", 0.4),
      c("c-anim", "Pulse/shimmer animation", 0.35),
      c("c-aria", "aria-busy indicates loading", 0.25),
    ],
  },
];

// Generate simple pairs
function simpleGen(mech, n) {
  const Name = mech.m
    .split("-")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
  const weaks = [
    `function ${Name}(props){return <div>{props.children}</div>}`,
    `function ${Name}({items}){return <div>{items.map(i=><span key={i}>{i}</span>)}</div>}`,
    `function ${Name}({data,onAction}){return <ul>{data.map(d=><li key={d} onClick={()=>onAction(d)}>{d}</li>)}</ul>}`,
    `function ${Name}({open,children}){return open?<div>{children}</div>:null}`,
  ];
  const strongs = [
    `function ${Name}(props){return <div role="region" aria-label="${mech.m}">{props.children}</div>}`,
    `function ${Name}({items}){return <div role="list">{items.map((i,n)=><div key={n} role="listitem" tabIndex={0}>{i}</div>)}</div>}`,
    `function ${Name}({data,onAction}){return <ul role="listbox">{data.map((d,i)=><li key={i} role="option" tabIndex={0} onClick={()=>onAction(d)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();onAction(d)}}}>{d}</li>)}</ul>}`,
    `function ${Name}({open,onClose,children}){if(!open)return null;useEffect(()=>{const h=e=>{if(e.key==="Escape")onClose()};document.addEventListener("keydown",h);return()=>document.removeEventListener("keydown",h)},[open]);return <div role="dialog" onClick={onClose}><div onClick={e=>e.stopPropagation()}>{children}<button onClick={onClose}>X</button></div></div>}`,
  ];
  const traces = [
    "No ARIA attributes; basic structure only; no keyboard support",
    "Missing keyboard handlers; no focus management; empty state not handled",
    "No semantic HTML roles; interactive elements not focusable",
    "Layout breaks on mobile; no responsive design; hardcoded dimensions",
  ];
  return {
    w: weaks[n % weaks.length],
    d: traces[n % traces.length],
    s: strongs[n % strongs.length],
  };
}

// Build all pairs
const pairs = [];
let count = 0;
for (const mech of MECHS) {
  for (let i = 0; i < mech.n; i++) {
    count++;
    const { w, d, s } = mech.gen(i);
    pairs.push({
      id: "seed-" + String(count).padStart(3, "0"),
      task: {
        id: "task-" + mech.m + "-" + String(i + 1).padStart(2, "0"),
        prompt: mech.p,
        target_mechanism: mech.m,
        criteria: mech.crit,
      },
      weak_code: w,
      defect: {
        screenshot: "base64-placeholder-seed",
        dom_trace: d,
        category: pick(CATS),
        severity: pick(SEVS),
      },
      strong_code: s,
      u_score: Math.round((0.4 + R() * 0.5) * 100) / 100,
    });
  }
}
for (const mech of SIMPLE) {
  const n = 3 + Math.floor(R() * 3);
  for (let i = 0; i < n; i++) {
    count++;
    const { w, d, s } = simpleGen(mech, i);
    pairs.push({
      id: "seed-" + String(count).padStart(3, "0"),
      task: {
        id: "task-" + mech.m + "-" + String(i + 1).padStart(2, "0"),
        prompt: mech.p,
        target_mechanism: mech.m,
        criteria: mech.c,
      },
      weak_code: w,
      defect: {
        screenshot: "base64-placeholder-seed",
        dom_trace: d,
        category: pick(CATS),
        severity: pick(SEVS),
      },
      strong_code: s,
      u_score: Math.round((0.4 + R() * 0.5) * 100) / 100,
    });
  }
}

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "..", "__fixtures__", "demo-dataset.jsonl");
writeFileSync(outPath, pairs.map((p) => JSON.stringify(p)).join("\n") + "\n");
console.log("Wrote " + pairs.length + " training pairs to demo-dataset.jsonl");
