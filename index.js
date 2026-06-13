const CORS_HEADERS={'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}
function escapeHtml(str){
  if(!str) return '';
  return str.replace(/[&<>]/g, function(m){
    if(m==='&') return '&amp;';
    if(m==='<') return '&lt;';
    if(m==='>') return '&gt;';
    return m;
  }).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, function(c){ return c; }).replace(/[\/"'`]/g, function(m){
    if(m==='/') return '&#x2F;';
    if(m==='"') return '&quot;';
    if(m==="'") return '&#x27;';
    if(m==='`') return '&#x60;';
    return m;
  });
}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:CORS_HEADERS})}
function html(body, csp=true){
  let headers={'Content-Type':'text/html; charset=utf-8'};
  if(csp) headers['Content-Security-Policy']="default-src 'self'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'unsafe-inline' https://cdnjs.cloudflare.com; font-src https://cdnjs.cloudflare.com; img-src 'self' data: https:;";
  return new Response(body,{headers});
}
async function verifyAdmin(request,env){
  const auth=request.headers.get('Authorization')
  if(!auth)return false
  try{const[u,p]=atob(auth.replace('Basic ','')).split(':');return u===env.ADMIN_USERNAME&&p===env.ADMIN_PASSWORD}catch(e){return false}
}
function getClientIP(request){return request.headers.get('CF-Connecting-IP')||'127.0.0.1'}
async function getSiteConfig(env){
  const s=await env.KV.get('config:site','json')
  return {title:s?.title||'资源站',icon:s?.icon||'',downloadLimit:s?.downloadLimit||5,closed:s?.closed||false,...s}
}
async function checkDownloadLimit(ip,env,config){
  const limit=config.downloadLimit
  if(limit==='unlimited'||limit===0)return true
  const today=new Date().toISOString().slice(0,10)
  const key=`dl:${ip}:${today}`
  const count=parseInt(await env.KV.get(key))||0
  if(count>=limit)return false
  await env.KV.put(key,(count+1).toString(),{expirationTtl:86400})
  return true
}
async function tgApiCall(env,method,formData){
  const url=`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`
  try{const res=await fetch(url,{method:'POST',body:formData});return await res.json()}
  catch(e){return{ok:false,description:'网络请求失败'}}
}
async function checkLoginLimit(ip,env){
  const key=`login_fail:${ip}`;
  const record=await env.KV.get(key,'json');
  if(!record) return {allowed:true,remaining:5};
  if(record.blockedUntil && Date.now()<record.blockedUntil) return {allowed:false,reason:`请 ${Math.ceil((record.blockedUntil-Date.now())/60000)} 分钟后重试`};
  return {allowed:true,remaining:Math.max(0,5-(record.count||0))};
}
async function recordLoginFailure(ip,env){
  const key=`login_fail:${ip}`;
  const record=(await env.KV.get(key,'json'))||{count:0};
  record.count=(record.count||0)+1;
  if(record.count>=5){
    record.blockedUntil=Date.now()+15*60*1000;
    record.count=0;
  }
  await env.KV.put(key,JSON.stringify(record),{expirationTtl:1800});
}
async function resetLoginLimit(ip,env){
  await env.KV.delete(`login_fail:${ip}`);
}
const ALLOWED_PREVIEW_TYPES=['image/jpeg','image/png','image/webp'];
const ALLOWED_FILE_TYPES=[
  'application/zip','application/x-rar-compressed','application/x-7z-compressed',
  'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain','application/octet-stream'
];

const FRONTEND_HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>资源站</title><link rel="icon" id="siteIcon" href=""><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"><style>
:root{--bg:#f5f5f7;--card-bg:rgba(255,255,255,.7);--text:#1d1d1f;--text-secondary:#86868b;--border:rgba(0,0,0,.1);--accent:#0071e3;--shadow:0 8px 32px rgba(0,0,0,.08);--shadow-hover:0 16px 48px rgba(0,0,0,.12);--blur:20px;--radius:16px;--scrollbar-thumb:rgba(0,0,0,.2);--scrollbar-thumb-hover:rgba(0,0,0,.35)}
[data-theme="dark"]{--bg:#121212;--card-bg:rgba(30,30,30,.7);--text:#f5f5f7;--text-secondary:#86868b;--border:rgba(255,255,255,.1);--accent:#2997ff;--shadow:0 8px 32px rgba(0,0,0,.3);--shadow-hover:0 16px 48px rgba(0,0,0,.5);--scrollbar-thumb:rgba(255,255,255,.2);--scrollbar-thumb-hover:rgba(255,255,255,.35)}
*{margin:0;padding:0;box-sizing:border-box}
::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--scrollbar-thumb);border-radius:10px;transition:background .2s}::-webkit-scrollbar-thumb:hover{background:var(--scrollbar-thumb-hover)}
*{scrollbar-width:thin;scrollbar-color:var(--scrollbar-thumb) transparent}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;transition:background .3s,color .3s}
.container{max-width:1200px;margin:0 auto;padding:40px 20px}
.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:30px}
.search-box{display:flex;align-items:center;gap:10px;background:var(--card-bg);backdrop-filter:blur(var(--blur));-webkit-backdrop-filter:blur(var(--blur));border:1px solid var(--border);border-radius:var(--radius);padding:12px 20px;width:360px;transition:all .3s cubic-bezier(.4,0,.2,1)}
.search-box:focus-within{box-shadow:var(--shadow-hover);transform:translateY(-2px);border-color:var(--accent)}
.search-box input{flex:1;border:none;outline:none;background:transparent;color:var(--text);font-size:14px}
.search-box button{background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:16px;transition:color .2s}.search-box button:hover{color:var(--accent)}
.theme-toggle{background:var(--card-bg);backdrop-filter:blur(var(--blur));-webkit-backdrop-filter:blur(var(--blur));border:1px solid var(--border);border-radius:50%;width:44px;height:44px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text);transition:all .3s cubic-bezier(.4,0,.2,1)}
.theme-toggle:hover{transform:scale(1.1) rotate(15deg);box-shadow:var(--shadow-hover)}
.radio-group{display:flex;gap:6px;margin-bottom:18px;background:var(--card-bg);backdrop-filter:blur(var(--blur));-webkit-backdrop-filter:blur(var(--blur));border:1px solid var(--border);border-radius:12px;padding:6px;flex-wrap:wrap}
.radio-option{padding:8px 14px;text-align:center;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;transition:all .2s ease;color:var(--text-secondary);flex:1;min-width:60px}
.radio-option.active{background:var(--accent);color:#fff;box-shadow:0 4px 12px rgba(0,113,227,.25)}
.radio-option:hover:not(.active){background:rgba(0,113,227,.08);color:var(--text)}
.switch-row{display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-bottom:1px solid var(--border)}.switch-row:last-child{border-bottom:none}
.switch-label{font-size:14px}
.switch{position:relative;width:52px;height:28px;background:var(--border);border-radius:20px;cursor:pointer;transition:background .3s}.switch.active{background:var(--accent)}
.switch::after{content:'';position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:all .3s cubic-bezier(.4,0,.2,1);box-shadow:0 2px 6px rgba(0,0,0,.15)}.switch.active::after{left:27px}
.admin-tabs{display:flex;gap:4px;margin-bottom:24px;background:var(--card-bg);backdrop-filter:blur(var(--blur));-webkit-backdrop-filter:blur(var(--blur));border:1px solid var(--border);border-radius:14px;padding:6px}
.tab-item{padding:10px 22px;border-radius:10px;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-secondary);transition:all .2s ease;display:flex;align-items:center;gap:8px}
.tab-item.active{background:var(--accent);color:#fff;box-shadow:0 4px 12px rgba(0,113,227,.25)}
.tab-item:hover:not(.active){background:rgba(0,113,227,.06);color:var(--text)}
.tab-panel{display:none}.tab-panel.active{display:block;animation:fadeInUp .4s ease}
.settings-card{background:var(--card-bg);backdrop-filter:blur(var(--blur));-webkit-backdrop-filter:blur(var(--blur));border:1px solid var(--border);border-radius:var(--radius);padding:24px}
.settings-section{margin-bottom:28px}.settings-section h4{font-size:15px;margin-bottom:14px;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;animation:fadeInUp .5s ease}
@keyframes fadeInUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.card{background:var(--card-bg);backdrop-filter:blur(var(--blur));-webkit-backdrop-filter:blur(var(--blur));border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;cursor:pointer;transition:all .3s cubic-bezier(.4,0,.2,1);animation:fadeInUp .5s ease backwards}
.card:nth-child(1){animation-delay:.05s}.card:nth-child(2){animation-delay:.1s}.card:nth-child(3){animation-delay:.15s}.card:nth-child(4){animation-delay:.2s}.card:nth-child(5){animation-delay:.25s}.card:nth-child(6){animation-delay:.3s}.card:nth-child(7){animation-delay:.35s}.card:nth-child(8){animation-delay:.4s}.card:nth-child(9){animation-delay:.45s}.card:nth-child(10){animation-delay:.5s}.card:nth-child(11){animation-delay:.55s}.card:nth-child(12){animation-delay:.6s}
.card:hover{transform:translateY(-8px) scale(1.02);box-shadow:var(--shadow-hover);border-color:rgba(0,113,227,.3)}
.card-thumb{width:100%;height:0;padding-bottom:66.67%;background:linear-gradient(135deg,#e0e0e0,#f0f0f0);position:relative;overflow:hidden;transition:transform .3s ease}
[data-theme="dark"] .card-thumb{background:linear-gradient(135deg,#2a2a2a,#1a1a1a)}
.card:hover .card-thumb{transform:scale(1.05)}.card-thumb img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
.card-info{padding:16px}.card-name{font-size:15px;font-weight:500;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.card-id{font-size:12px;color:var(--text-secondary)}
.pagination{display:flex;justify-content:center;gap:8px;margin-top:40px}
.page-btn{width:40px;height:40px;border-radius:10px;background:var(--card-bg);backdrop-filter:blur(var(--blur));-webkit-backdrop-filter:blur(var(--blur));border:1px solid var(--border);color:var(--text);cursor:pointer;transition:all .2s cubic-bezier(.4,0,.2,1)}
.page-btn:hover:not(.active){background:var(--accent);color:#fff;transform:translateY(-2px);box-shadow:var(--shadow)}.page-btn.active{background:var(--accent);color:#fff}
.file-layout{display:grid;grid-template-columns:1fr 2fr;gap:24px;animation:fadeInUp .5s ease}
.file-card{background:var(--card-bg);backdrop-filter:blur(var(--blur));-webkit-backdrop-filter:blur(var(--blur));border:1px solid var(--border);border-radius:var(--radius);padding:24px;transition:all .3s ease}.file-card:hover{box-shadow:var(--shadow-hover)}
.file-thumb{width:100%;border-radius:12px;overflow:hidden;margin-bottom:20px;aspect-ratio:4/3;background:linear-gradient(135deg,#e0e0e0,#f0f0f0)}
[data-theme="dark"] .file-thumb{background:linear-gradient(135deg,#2a2a2a,#1a1a1a)}
.file-thumb img{width:100%;height:100%;object-fit:cover;transition:transform .3s ease}.file-card:hover .file-thumb img{transform:scale(1.03)}
.file-name{font-size:20px;font-weight:600;margin-bottom:8px}.file-id{font-size:13px;color:var(--text-secondary);margin-bottom:16px}
.file-tags{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px}
.tag{padding:4px 12px;border-radius:20px;font-size:12px;background:rgba(0,113,227,.1);color:var(--accent);transition:all .2s ease}.tag:hover{transform:translateY(-1px);background:rgba(0,113,227,.2)}
.download-btn{width:100%;padding:14px;border:none;border-radius:12px;background:var(--accent);color:#fff;font-size:15px;font-weight:500;cursor:pointer;transition:all .3s cubic-bezier(.4,0,.2,1);display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none}
.download-btn:hover{transform:translateY(-3px);box-shadow:0 12px 28px rgba(0,113,227,.35)}.download-btn:active{transform:translateY(-1px)}
.desc-content{line-height:1.7}.desc-content h1,.desc-content h2,.desc-content h3{margin:16px 0 8px}.desc-content p{margin:8px 0}.desc-content code{background:rgba(0,0,0,.05);padding:2px 6px;border-radius:4px}
.question-page{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.question-card{background:var(--card-bg);backdrop-filter:blur(var(--blur));-webkit-backdrop-filter:blur(var(--blur));border:1px solid var(--border);border-radius:var(--radius);padding:36px 40px;width:100%;max-width:480px;animation:fadeInUp .5s ease;transition:all .3s ease}.question-card:hover{box-shadow:var(--shadow-hover)}
.question-card h3{margin-bottom:18px;font-size:16px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.question-card .answer-row{display:flex;gap:10px;align-items:center}
.question-card input{flex:1;padding:12px 16px;border:1px solid var(--border);border-radius:10px;background:transparent;color:var(--text);font-size:14px;outline:none;transition:all .2s}
.question-card input:focus{border-color:var(--accent);box-shadow:0 0 0 4px rgba(0,113,227,.1)}
.question-card button{padding:12px 24px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-size:14px;cursor:pointer;transition:all .3s cubic-bezier(.4,0,.2,1);white-space:nowrap}
.question-card button:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,113,227,.3)}
.maintenance-page{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.maintenance-card{background:var(--card-bg);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);border:1px solid var(--border);border-radius:24px;padding:60px 50px;text-align:center;max-width:460px;animation:fadeInUp .6s ease}
.maintenance-icon{width:80px;height:80px;border-radius:50%;background:rgba(0,113,227,.1);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:36px;margin:0 auto 24px}
.maintenance-card h2{font-size:24px;margin-bottom:12px;font-weight:600}.maintenance-card p{color:var(--text-secondary);line-height:1.6;font-size:14px}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:1000;opacity:0;visibility:hidden;transition:all .3s ease}.modal-overlay.show{opacity:1;visibility:visible}
.modal{background:var(--card-bg);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);border:1px solid var(--border);border-radius:20px;padding:32px;width:100%;max-width:560px;max-height:85vh;overflow-y:auto;transform:translateY(30px) scale(.95);transition:all .4s cubic-bezier(.4,0,.2,1)}.modal-overlay.show .modal{transform:translateY(0) scale(1)}
.modal h3{margin-bottom:20px;font-size:18px}
.form-group{margin-bottom:18px}.form-group label{display:block;margin-bottom:8px;font-size:13px;color:var(--text-secondary);font-weight:500}
.form-group input,.form-group textarea{width:100%;padding:12px 16px;border:1px solid var(--border);border-radius:12px;background:transparent;color:var(--text);font-size:14px;outline:none;transition:all .2s cubic-bezier(.4,0,.2,1);font-family:inherit}
.form-group input:focus,.form-group textarea:focus{border-color:var(--accent);box-shadow:0 0 0 4px rgba(0,113,227,.1);transform:translateY(-1px)}
.form-group textarea{min-height:100px;resize:vertical}
.checkbox-row{display:flex;align-items:center;gap:10px;margin-bottom:18px;cursor:pointer}.checkbox-row input[type="checkbox"]{width:18px;height:18px;cursor:pointer;accent-color:var(--accent)}
.btn-primary{width:100%;padding:14px;border:none;border-radius:12px;background:var(--accent);color:#fff;font-size:14px;font-weight:500;cursor:pointer;transition:all .3s cubic-bezier(.4,0,.2,1)}
.btn-primary:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(0,113,227,.3)}.btn-primary:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn-danger{padding:8px 16px;border:none;border-radius:10px;background:#ff3b30;color:#fff;font-size:13px;cursor:pointer;transition:all .2s ease}.btn-danger:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(255,59,48,.3)}
.btn-secondary{padding:8px 16px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-size:13px;cursor:pointer;transition:all .2s ease}.btn-secondary:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(0,113,227,.3)}
.drag-area{border:2px dashed var(--border);border-radius:12px;padding:28px 20px;text-align:center;cursor:pointer;transition:all .3s cubic-bezier(.4,0,.2,1);background:rgba(0,113,227,.02)}
.drag-area:hover{border-color:var(--accent);background:rgba(0,113,227,.05);transform:translateY(-2px)}
.drag-area.drag-over{border-color:var(--accent);background:rgba(0,113,227,.1);transform:scale(1.02)}
.drag-area i{font-size:28px;color:var(--text-secondary);margin-bottom:8px;transition:color .3s}.drag-area:hover i{color:var(--accent)}
.drag-area .drag-text{font-size:14px;color:var(--text-secondary);margin-bottom:4px}
.drag-area .drag-hint{font-size:12px;color:var(--text-secondary);opacity:.7}
.drag-area .file-name{margin-top:10px;font-size:13px;color:var(--accent);font-weight:500;word-break:break-all}
.drag-area input[type="file"]{display:none}
.admin-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}.admin-header h2{font-size:22px}
.add-btn{padding:12px 24px;border:none;border-radius:12px;background:var(--accent);color:#fff;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:8px;transition:all .3s cubic-bezier(.4,0,.2,1)}.add-btn:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(0,113,227,.3)}
.resource-list{background:var(--card-bg);backdrop-filter:blur(var(--blur));-webkit-backdrop-filter:blur(var(--blur));border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.resource-item{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);transition:all .2s ease}.resource-item:last-child{border-bottom:none}
.resource-item:hover{background:rgba(0,113,227,.03);padding-left:24px}.resource-actions{display:flex;gap:10px}
@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}.file-layout{grid-template-columns:1fr}.search-box{width:100%}}
@media(max-width:600px){.grid{grid-template-columns:1fr}.container{padding:20px 16px}.topbar{flex-direction:column;gap:16px;align-items:stretch}.modal{padding:24px;margin:16px}.admin-tabs{flex-direction:column}.tab-item{justify-content:center}.question-card .answer-row{flex-direction:column}.question-card button{width:100%}}
.page{display:none}.page.active{display:block}
</style></head><body>
<div id="page-maintenance" class="page"><div class="maintenance-page"><div class="maintenance-card"><div class="maintenance-icon"><i class="fas fa-wrench"></i></div><h2>网站维护中</h2><p>站点正在进行升级维护，请稍后再访问。<br>感谢您的理解与耐心等待。</p></div></div></div>
<div id="page-index" class="page active"><div class="container"><div class="topbar"><div class="search-box"><input type="text" id="searchInput" placeholder="搜索资源名称或标签..."><button onclick="doSearch()"><i class="fas fa-search"></i></button></div><button class="theme-toggle" onclick="toggleTheme()"><i class="fas fa-moon" id="themeIcon"></i></button></div><div class="grid" id="resourceGrid"></div><div class="pagination" id="pagination"></div></div></div>
<div id="page-file" class="page"><div class="container"><div style="margin-bottom:20px"><button class="theme-toggle" onclick="goHome()" style="display:inline-flex;margin-right:12px"><i class="fas fa-arrow-left"></i></button><button class="theme-toggle" onclick="toggleTheme()" style="display:inline-flex"><i class="fas fa-moon" id="themeIcon2"></i></button></div><div class="file-layout" id="fileContent"></div></div></div>
<div id="page-question" class="page"><div class="question-page"><div class="question-card"><h3 id="questionText">请回答问题以访问资源</h3><div class="answer-row"><input type="text" id="answerInput" placeholder="输入答案..."><button onclick="submitAnswer()">确认</button></div></div></div></div>
<div id="page-admin" class="page"><div class="container"><div class="admin-header"><h2>管理后台</h2><button class="add-btn" id="addResourceBtn" onclick="showAddModal()"><i class="fas fa-plus"></i> 添加资源</button></div>
<div class="admin-tabs"><div class="tab-item active" onclick="switchTab('settings')"><i class="fas fa-cog"></i> 基本设置</div><div class="tab-item" onclick="switchTab('resources')"><i class="fas fa-folder"></i> 资源管理</div></div>
<div id="tab-settings" class="tab-panel active"><div class="settings-card">
<div class="settings-section"><h4>站点信息</h4>
<div class="form-group"><label>网站标题</label><input type="text" id="settingTitle" placeholder="输入网站标题"></div>
<div class="form-group"><label>网站Icon（URL外链）</label><input type="text" id="settingIcon" placeholder="https://example.com/favicon.ico"></div>
</div>
<div class="settings-section"><h4>下载限制</h4><label style="font-size:13px;color:var(--text-secondary);margin-bottom:10px;display:block">单IP每日下载次数</label><div class="radio-group" id="limitGroup"><div class="radio-option" data-value="1">1次</div><div class="radio-option active" data-value="5">5次</div><div class="radio-option" data-value="10">10次</div><div class="radio-option" data-value="50">50次</div><div class="radio-option" data-value="100">100次</div><div class="radio-option" data-value="unlimited">无限</div></div></div>
<div class="settings-section"><h4>站点状态</h4><div class="switch-row"><div class="switch-label">网站关停（开启后所有前台页面显示维护）</div><div class="switch" id="closeSwitch" onclick="toggleClose()"></div></div></div>
<button class="btn-primary" onclick="saveSettings()">保存设置</button>
</div></div>
<div id="tab-resources" class="tab-panel"><div class="resource-list" id="adminList"></div></div>
</div></div>
<div class="modal-overlay" id="loginModal"><div class="modal"><h3>管理员登录</h3><div class="form-group"><label>用户名</label><input type="text" id="loginUser"></div><div class="form-group"><label>密码</label><input type="password" id="loginPass"></div><button class="btn-primary" onclick="doLogin()">登录</button></div></div>
<div class="modal-overlay" id="resourceModal"><div class="modal"><h3 id="modalTitle">添加资源</h3>
<div class="form-group"><label>资源名称</label><input type="text" id="resName"></div>
<div class="form-group"><label>资源ID</label><input type="text" id="resId"></div>
<div class="form-group"><label>资源标签（空格分隔）</label><input type="text" id="resTags"></div>
<div class="form-group"><label>资源描述（支持Markdown）</label><textarea id="resDesc"></textarea></div>

<div id="storageModeGroup" class="form-group"><label>资源存放方式</label><div class="radio-group"><div class="radio-option active" data-mode="upload" onclick="setStorageMode('upload')"><i class="fas fa-upload"></i> 本地上传</div><div class="radio-option" data-mode="url" onclick="setStorageMode('url')"><i class="fas fa-link"></i> URL外链</div></div></div>

<div id="storageTypeGroup" class="form-group"><label>本体存储位置</label><div class="radio-group"><div class="radio-option active" data-storage="telegram" onclick="setStorageType('telegram')"><i class="fab fa-telegram"></i> Telegram</div><div class="radio-option" data-storage="r2" onclick="setStorageType('r2')"><i class="fas fa-cloud"></i> R2存储</div></div></div>

<div id="uploadFields">
<div class="form-group" id="previewUploadGroup"><label>预览图</label><div class="drag-area" id="previewDrag"><i class="fas fa-cloud-upload-alt"></i><div class="drag-text">点击或拖拽图片到此处上传</div><div class="drag-hint">支持 JPG / PNG / WEBP</div><div class="file-name" id="previewFileName"></div><input type="file" id="resPreview" accept="image/jpeg,image/png,image/webp"></div></div>
<div class="form-group" id="previewUrlGroup" style="display:none"><label>预览图URL</label><input type="text" id="previewUrl" placeholder="https://..."></div>
<div class="form-group"><label>资源文件</label><div class="drag-area" id="fileDrag"><i class="fas fa-file-upload"></i><div class="drag-text">点击或拖拽文件到此处上传</div><div class="drag-hint">单文件建议不超过 50MB</div><div class="file-name" id="resFileName"></div><input type="file" id="resFile"></div></div>
</div>

<div id="urlFields" style="display:none"><div class="form-group"><label>预览图URL</label><input type="text" id="previewUrlOnly" placeholder="https://..."></div><div class="form-group"><label>资源下载URL</label><input type="text" id="fileUrl" placeholder="https://..."></div></div>

<div class="checkbox-row"><input type="checkbox" id="enableQ" onchange="toggleQuestion()"><label for="enableQ">启用访问问题</label></div>
<div id="qFields" style="display:none"><div class="form-group"><label>问题</label><input type="text" id="resQuestion"></div><div class="form-group"><label>答案</label><input type="text" id="resAnswer"></div></div>
<button class="btn-primary" id="saveBtn" onclick="saveResource()">保存</button>
</div></div>
<script>
let currentPage=1,totalPages=1,allResources=[],currentFileId=null,editMode=false,editId=null,siteConfig={title:'资源站',icon:'',downloadLimit:5,closed:false},currentStorageMode='upload',currentStorageType='telegram',hasR2Enabled=true
function toggleTheme(){const h=document.documentElement,d=h.getAttribute('data-theme')==='dark';h.setAttribute('data-theme',d?'light':'dark');localStorage.setItem('theme',d?'light':'dark');updateThemeIcons()}
function updateThemeIcons(){const d=document.documentElement.getAttribute('data-theme')==='dark',i=d?'fa-sun':'fa-moon';document.querySelectorAll('#themeIcon,#themeIcon2').forEach(e=>e.className='fas '+i)}
(function(){const s=localStorage.getItem('theme')||'light';document.documentElement.setAttribute('data-theme',s);updateThemeIcons()})()
function initDragUpload(did,iid,nid){const d=document.getElementById(did),i=document.getElementById(iid),n=document.getElementById(nid);d.addEventListener('click',()=>i.click());d.addEventListener('dragover',e=>{e.preventDefault();d.classList.add('drag-over')});d.addEventListener('dragleave',()=>d.classList.remove('drag-over'));d.addEventListener('drop',e=>{e.preventDefault();d.classList.remove('drag-over');if(e.dataTransfer.files.length){i.files=e.dataTransfer.files;n.textContent=e.dataTransfer.files[0].name}});i.addEventListener('change',()=>{if(i.files.length)n.textContent=i.files[0].name})}
function switchTab(name){
  document.querySelectorAll('.tab-item').forEach(t=>t.classList.remove('active'))
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'))
  document.querySelector(\`.tab-item[onclick="switchTab('\${name}')"]\`).classList.add('active')
  document.getElementById('tab-'+name).classList.add('active')
  document.getElementById('addResourceBtn').style.display=name==='resources'?'flex':'none'
}
function setStorageMode(mode){
  currentStorageMode=mode
  document.querySelectorAll('[data-mode]').forEach(e=>e.classList.remove('active'))
  document.querySelector(\`[data-mode="\${mode}"]\`).classList.add('active')
  document.getElementById('uploadFields').style.display=mode==='upload'?'block':'none'
  document.getElementById('urlFields').style.display=mode==='url'?'block':'none'
}
function setStorageType(type){
  currentStorageType=type
  document.querySelectorAll('[data-storage]').forEach(e=>e.classList.remove('active'))
  document.querySelector(\`[data-storage="\${type}"]\`).classList.add('active')
  if(!hasR2Enabled){
    if(type==='url'){
      document.getElementById('uploadFields').style.display='none'
      document.getElementById('urlFields').style.display='block'
    }else{
      document.getElementById('uploadFields').style.display='block'
      document.getElementById('urlFields').style.display='none'
      document.getElementById('previewUploadGroup').style.display='none'
      document.getElementById('previewUrlGroup').style.display='block'
    }
  }
}
function applyR2Layout(){
  if(hasR2Enabled)return
  document.getElementById('storageModeGroup').style.display='none'
  document.querySelector('#storageTypeGroup label').textContent='储存位置'
  document.querySelector('[data-storage="r2"]').style.display='none'
  document.getElementById('previewUploadGroup').style.display='none'
  document.getElementById('previewUrlGroup').style.display='block'
}
function parseHash(){const h=location.hash.slice(1);if(h==='admin')return{page:'admin'};if(h.startsWith('file/'))return{page:'file',id:h.slice(5)};return{page:'index'}}
async function router(){const r=parseHash();document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));await loadSiteConfig();applySiteIcon();if(siteConfig.closed&&r.page!=='admin'){document.getElementById('page-maintenance').classList.add('active');document.title='维护中 - '+siteConfig.title;return}if(r.page==='index'){document.getElementById('page-index').classList.add('active');document.title=siteConfig.title;loadResources()}else if(r.page==='file'){currentFileId=r.id;loadFilePage(r.id)}else if(r.page==='admin'){document.getElementById('page-admin').classList.add('active');document.title='管理后台 - '+siteConfig.title;checkAdminAuth()}}
window.addEventListener('hashchange',router)
function applySiteIcon(){const i=document.getElementById('siteIcon');if(siteConfig.icon)i.href=siteConfig.icon;else i.href='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📦</text></svg>'}
async function loadSiteConfig(){try{const r=await fetch('/api/config');siteConfig=await r.json();hasR2Enabled=siteConfig.hasR2;applyR2Layout()}catch(e){console.error(e)}}
async function loadSettingsForm(){await loadSiteConfig();document.getElementById('settingTitle').value=siteConfig.title;document.getElementById('settingIcon').value=siteConfig.icon||'';document.querySelectorAll('#limitGroup .radio-option').forEach(e=>{e.classList.remove('active');if(e.dataset.value==siteConfig.downloadLimit)e.classList.add('active')});const s=document.getElementById('closeSwitch');siteConfig.closed?s.classList.add('active'):s.classList.remove('active')}
function toggleClose(){document.getElementById('closeSwitch').classList.toggle('active')}
function getSelectedLimit(){const a=document.querySelector('#limitGroup .radio-option.active');return a?a.dataset.value:5}
async function saveSettings(){const t=localStorage.getItem('adminToken'),d={title:document.getElementById('settingTitle').value.trim()||'资源站',icon:document.getElementById('settingIcon').value.trim(),downloadLimit:getSelectedLimit(),closed:document.getElementById('closeSwitch').classList.contains('active')};try{const r=await fetch('/api/admin/config',{method:'POST',headers:{Authorization:'Basic '+t,'Content-Type':'application/json'},body:JSON.stringify(d)});if(r.ok){alert('设置保存成功');siteConfig=d;applySiteIcon();document.title=siteConfig.title}else alert('保存失败')}catch(e){alert('保存失败，请重试')}}
async function loadResources(){try{const r=await fetch('/api/resources');allResources=await r.json();renderGrid()}catch(e){console.error(e)}}
function renderGrid(s=null){
  const l=s||allResources,g=document.getElementById('resourceGrid'),p=12
  totalPages=Math.ceil(l.length/p)||1
  if(currentPage>totalPages)currentPage=totalPages
  const start=(currentPage-1)*p,items=l.slice(start,start+p)
  g.innerHTML=items.map(r=>\`<div class="card" onclick="goFile('\${r.id}')"><div class="card-thumb"><img src="/api/preview/\${r.id}" alt="\${escapeHtmlStatic(r.name)}" loading="lazy" onerror="this.style.display='none'"></div><div class="card-info"><div class="card-name">\${escapeHtmlStatic(r.name)}</div><div class="card-id">ID: \${escapeHtmlStatic(r.id)}</div></div></div>\`).join('')
  renderPagination()
}
function renderPagination(){
  const p=document.getElementById('pagination');let h=''
  for(let i=1;i<=totalPages;i++)h+=\`<button class="page-btn \${i===currentPage?'active':''}" onclick="goPage(\${i})">\${i}</button>\`
  p.innerHTML=h
}
function goPage(n){currentPage=n;renderGrid();window.scrollTo({top:0,behavior:'smooth'})}
function doSearch(){const q=document.getElementById('searchInput').value.trim().toLowerCase();if(!q){renderGrid();return}const r=allResources.filter(x=>x.name.toLowerCase().includes(q)||x.tags.some(t=>t.toLowerCase().includes(q)));currentPage=1;renderGrid(r)}
document.getElementById('searchInput').addEventListener('keypress',e=>{if(e.key==='Enter')doSearch()})
function goFile(id){location.hash='file/'+id}function goHome(){location.hash=''}
async function loadFilePage(id){try{const r=await fetch('/api/resource/'+id);const d=await r.json();if(d.needQuestion){document.getElementById('page-question').classList.add('active');document.getElementById('page-file').classList.remove('active');document.getElementById('questionText').textContent=d.question;document.title='访问验证 - '+siteConfig.title;return}document.title=d.name+' - '+siteConfig.title;renderFilePage(d)}catch(e){alert('资源不存在');goHome()}}
function renderFilePage(d){
  document.getElementById('page-file').classList.add('active')
  document.getElementById('page-question').classList.remove('active')
  const t=d.tags.map(x=>\`<span class="tag">\${escapeHtmlStatic(x)}</span>\`).join('')
  document.getElementById('fileContent').innerHTML=\`<div class="file-card"><div class="file-thumb"><img src="/api/preview/\${d.id}" alt="\${escapeHtmlStatic(d.name)}" onerror="this.style.display='none'"></div><div class="file-name">\${escapeHtmlStatic(d.name)}</div><div class="file-id">ID: \${escapeHtmlStatic(d.id)}</div><div class="file-tags">\${t}</div><a class="download-btn" href="/api/download/\${d.id}"><i class="fas fa-download"></i> 下载资源</a></div><div class="file-card"><div class="desc-content" id="descHtml"></div></div>\`
  document.getElementById('descHtml').innerHTML=simpleMarkdown(escapeHtmlStatic(d.description||''))
}
function escapeHtmlStatic(str){if(!str) return '';return str.replace(/[&<>]/g, function(m){if(m==='&') return '&amp;';if(m==='<') return '&lt;';if(m==='>') return '&gt;';return m;}).replace(/[\\/"'\`]/g, function(m){if(m==='/') return '&#x2F;';if(m==='"') return '&quot;';if(m==="'") return '&#x27;';if(m==='\`') return '&#x60;';return m;});}
function simpleMarkdown(t){return t.replace(/^### (.*$)/gm,'<h3>$1</h3>').replace(/^## (.*$)/gm,'<h2>$1</h2>').replace(/^# (.*$)/gm,'<h1>$1</h1>').replace(/\\*\\*(.*?)\\*\\*/g,'<strong>$1</strong>').replace(/\\*(.*?)\\*/g,'<em>$1</em>').replace(/\\n/g,'<br>')}
async function submitAnswer(){const a=document.getElementById('answerInput').value;try{const r=await fetch('/api/verify/'+currentFileId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answer:a})}),d=await r.json();if(d.ok){document.title=d.resource.name+' - '+siteConfig.title;renderFilePage(d.resource)}else alert('答案错误')}catch(e){alert('验证失败，请重试')}}
function checkAdminAuth(){const t=localStorage.getItem('adminToken');if(!t)document.getElementById('loginModal').classList.add('show');else{loadSettingsForm();loadAdminList()}}
async function doLogin(){const u=document.getElementById('loginUser').value,p=document.getElementById('loginPass').value;if(!u||!p){alert('请输入用户名和密码');return}const t=btoa(u+':'+p);try{const r=await fetch('/api/admin/check',{headers:{Authorization:'Basic '+t}});if(r.ok){localStorage.setItem('adminToken',t);document.getElementById('loginModal').classList.remove('show');loadSettingsForm();loadAdminList()}else{let msg='用户名或密码错误';const data=await r.json().catch(()=>({}));if(data.reason) msg=data.reason;alert(msg)}}catch(e){alert('登录请求失败，请检查网络')}}
async function loadAdminList(){
  const t=localStorage.getItem('adminToken')
  try{
    const r=await fetch('/api/admin/resources',{headers:{Authorization:'Basic '+t}})
    if(r.status===401){localStorage.removeItem('adminToken');document.getElementById('loginModal').classList.add('show');return}
    const l=await r.json()
    document.getElementById('adminList').innerHTML=l.map(x=>\`<div class="resource-item"><span>\${escapeHtmlStatic(x.name)}</span><div class="resource-actions"><button class="btn-secondary" onclick="editResource('\${x.id}')">编辑</button><button class="btn-danger" onclick="deleteResource('\${x.id}')">删除</button></div></div>\`).join('')
  }catch(e){alert('加载资源列表失败')}
}
function showAddModal(){
  editMode=false;editId=null;currentStorageMode='upload';currentStorageType='telegram'
  document.getElementById('modalTitle').textContent='添加资源'
  document.getElementById('resName').value='';document.getElementById('resId').value='';document.getElementById('resTags').value='';document.getElementById('resDesc').value=''
  document.getElementById('enableQ').checked=false;document.getElementById('qFields').style.display='none'
  document.getElementById('resQuestion').value='';document.getElementById('resAnswer').value=''
  document.getElementById('previewFileName').textContent='';document.getElementById('resFileName').textContent=''
  document.getElementById('resPreview').value='';document.getElementById('resFile').value=''
  document.getElementById('previewUrl').value='';document.getElementById('fileUrl').value=''
  document.getElementById('previewUrlOnly').value=''
  if(hasR2Enabled){
    setStorageMode('upload');setStorageType('telegram')
  }else{
    setStorageType('telegram')
  }
  document.getElementById('resourceModal').classList.add('show')
  setTimeout(()=>{initDragUpload('previewDrag','resPreview','previewFileName');initDragUpload('fileDrag','resFile','resFileName')},50)
}
function toggleQuestion(){document.getElementById('qFields').style.display=document.getElementById('enableQ').checked?'block':'none'}
async function editResource(id){
  const t=localStorage.getItem('adminToken')
  try{
    const r=await fetch('/api/admin/resource/'+id,{headers:{Authorization:'Basic '+t}})
    if(r.status===401){localStorage.removeItem('adminToken');document.getElementById('loginModal').classList.add('show');return}
    const d=await r.json()
    editMode=true;editId=id;currentStorageMode=d.storageMode||'upload';currentStorageType=d.storageType||'telegram'
    document.getElementById('modalTitle').textContent='编辑资源'
    document.getElementById('resName').value=d.name;document.getElementById('resId').value=d.id
    document.getElementById('resTags').value=d.tags.join(' ');document.getElementById('resDesc').value=d.description||''
    document.getElementById('enableQ').checked=!!d.hasQuestion
    document.getElementById('qFields').style.display=d.hasQuestion?'block':'none'
    document.getElementById('resQuestion').value=d.question||'';document.getElementById('resAnswer').value=d.answer||''
    if(hasR2Enabled){
      setStorageMode(d.storageMode||'upload');setStorageType(d.storageType||'telegram')
      if(d.storageMode==='url'){document.getElementById('previewUrl').value=d.previewUrl||'';document.getElementById('fileUrl').value=d.fileUrl||''}
      else{document.getElementById('previewFileName').textContent=d.tgFileId||d.r2Key?'已上传（重新上传将覆盖）':'';document.getElementById('resFileName').textContent=d.fileName||'已上传（重新上传将覆盖）'}
    }else{
      setStorageType(d.storageType||'telegram')
      if(d.storageType==='url'){document.getElementById('previewUrlOnly').value=d.previewUrl||'';document.getElementById('fileUrl').value=d.fileUrl||''}
      else{document.getElementById('previewUrl').value=d.previewUrl||'';document.getElementById('resFileName').textContent=d.fileName||'已上传（重新上传将覆盖）'}
    }
    document.getElementById('resourceModal').classList.add('show')
    setTimeout(()=>{initDragUpload('previewDrag','resPreview','previewFileName');initDragUpload('fileDrag','resFile','resFileName')},50)
  }catch(e){alert('加载资源信息失败')}
}
async function saveResource(){
  const btn=document.getElementById('saveBtn'),t=localStorage.getItem('adminToken'),name=document.getElementById('resName').value.trim(),id=document.getElementById('resId').value.trim()
  if(!name||!id){alert('请填写资源名称和资源ID');return}
  btn.disabled=true;btn.textContent='保存中...'
  try{
    const f=new FormData()
    f.append('name',name);f.append('id',id);f.append('tags',document.getElementById('resTags').value)
    f.append('description',document.getElementById('resDesc').value)
    f.append('hasQuestion',document.getElementById('enableQ').checked)
    f.append('question',document.getElementById('resQuestion').value)
    f.append('answer',document.getElementById('resAnswer').value)
    f.append('storageMode',currentStorageMode);f.append('storageType',currentStorageType)
    if(hasR2Enabled&&currentStorageMode==='url'){
      f.append('previewUrl',document.getElementById('previewUrl').value)
      f.append('fileUrl',document.getElementById('fileUrl').value)
    }else if(!hasR2Enabled&&currentStorageType==='url'){
      f.append('previewUrl',document.getElementById('previewUrlOnly').value)
      f.append('fileUrl',document.getElementById('fileUrl').value)
    }else{
      if(!hasR2Enabled)f.append('previewUrl',document.getElementById('previewUrl').value)
      const p=document.getElementById('resPreview').files[0]
      if(p&&hasR2Enabled)f.append('preview',p)
      const fi=document.getElementById('resFile').files[0]
      if(fi)f.append('file',fi)
    }
    const url=editMode?'/api/admin/resource/'+editId:'/api/admin/resource',method=editMode?'PUT':'POST'
    const r=await fetch(url,{method,headers:{Authorization:'Basic '+t},body:f})
    if(r.status===401){alert('登录已过期，请重新登录');localStorage.removeItem('adminToken');document.getElementById('resourceModal').classList.remove('show');document.getElementById('loginModal').classList.add('show');return}
    const d=await r.json().catch(()=>({error:'服务器无响应'}))
    if(r.ok){document.getElementById('resourceModal').classList.remove('show');loadAdminList();alert('保存成功')}
    else alert('保存失败：'+(d.error||'未知错误'))
  }catch(e){console.error(e);alert('保存失败：网络异常或文件过大')}
  finally{btn.disabled=false;btn.textContent='保存'}
}
async function deleteResource(id){if(!confirm('确定删除此资源？删除后无法恢复'))return;const t=localStorage.getItem('adminToken');try{const r=await fetch('/api/admin/resource/'+id,{method:'DELETE',headers:{Authorization:'Basic '+t}});if(r.ok)loadAdminList();else alert('删除失败')}catch(e){alert('删除失败，请重试')}}
router()
</script></body></html>`

async function handleAPI(pathname,request,env){
  const hasR2 = !!env.R2_PREVIEWS

  if(pathname==='/api/config'&&request.method==='GET'){
    const c=await getSiteConfig(env)
    return json({title:c.title,icon:c.icon,downloadLimit:c.downloadLimit,closed:c.closed,hasR2})
  }

  if(pathname==='/api/admin/config'&&request.method==='POST'){
    if(!await verifyAdmin(request,env)) return json({error:'未授权'},401)
    const body=await request.json().catch(()=>({}))
    const cur=await getSiteConfig(env)
    await env.KV.put('config:site',JSON.stringify({...cur,...body}))
    return json({ok:true})
  }

  if(pathname==='/api/resources'&&request.method==='GET'){
    const keys=await env.KV.list({prefix:'res:'})
    const res=[]
    for(const k of keys.keys){
      const d=await env.KV.get(k.name,'json')
      if(d) res.push({id:d.id,name:d.name,tags:d.tags||[]})
    }
    return json(res)
  }

  if(pathname.startsWith('/api/resource/')&&request.method==='GET'){
    const id=pathname.slice('/api/resource/'.length)
    const d=await env.KV.get('res:'+id,'json')
    if(!d) return json({error:'资源不存在'},404)
    if(d.hasQuestion) return json({needQuestion:true,question:d.question})
    return json({id:d.id,name:d.name,tags:d.tags||[],description:d.description||''})
  }

  if(pathname.startsWith('/api/verify/')&&request.method==='POST'){
    const id=pathname.slice('/api/verify/'.length)
    const body=await request.json().catch(()=>({}))
    const d=await env.KV.get('res:'+id,'json')
    if(!d) return json({error:'资源不存在'},404)
    if(body.answer===d.answer) return json({ok:true,resource:{id:d.id,name:d.name,tags:d.tags||[],description:d.description||''}})
    return json({ok:false,error:'答案错误'},403)
  }

  if(pathname.startsWith('/api/preview/')){
    const id=pathname.slice('/api/preview/'.length)
    const d=await env.KV.get('res:'+id,'json')
    if(!d) return new Response(null,{status:404})
    if(d.previewUrl) return Response.redirect(d.previewUrl,302)
    if(!hasR2) return new Response(null,{status:404})
    const obj=await env.R2_PREVIEWS.get('preview_'+id)
    if(!obj) return new Response(null,{status:404})
    return new Response(obj.body,{headers:{'Content-Type':obj.httpMetadata?.contentType||'image/jpeg','Cache-Control':'public, max-age=86400'}})
  }

  if(pathname.startsWith('/api/download/')){
    const id=pathname.slice('/api/download/'.length)
    const ip=getClientIP(request)
    const config=await getSiteConfig(env)
    if(!await checkDownloadLimit(ip,env,config)) return json({error:'今日下载次数已达上限'},429)
    const d=await env.KV.get('res:'+id,'json')
    if(!d) return json({error:'资源不存在'},404)
    if(d.fileUrl && (d.storageMode==='url'||d.storageType==='url')) return Response.redirect(d.fileUrl,302)
    const downloadName=d.fileName||d.name
    if(d.storageType==='r2'){
      if(!hasR2) return json({error:'R2未启用'},500)
      const obj=await env.R2_PREVIEWS.get('file_'+id)
      if(!obj) return json({error:'文件不存在'},404)
      return new Response(obj.body,{headers:{
        'Content-Type':obj.httpMetadata?.contentType||'application/octet-stream',
        'Content-Disposition':`attachment; filename="${encodeURIComponent(downloadName)}"`,
        'Content-Length':obj.size,
        'X-Filename':encodeURIComponent(downloadName)
      }})
    }
    try{
      const fi=await tgApiCall(env,'getFile',new URLSearchParams({file_id:d.tgFileId}))
      if(!fi.ok) return json({error:'获取文件失败'},500)
      const fp=fi.result.file_path
      const fu=`https://api.telegram.org/file/bot${env.TG_BOT_TOKEN}/${fp}`
      const fr=await fetch(fu)
      if(!fr.ok) return json({error:'文件下载失败'},500)
      return new Response(fr.body,{headers:{
        'Content-Type':fr.headers.get('Content-Type')||'application/octet-stream',
        'Content-Disposition':`attachment; filename="${encodeURIComponent(downloadName)}"`,
        'X-Filename':encodeURIComponent(downloadName)
      }})
    }catch(e){ return json({error:'下载失败'},500) }
  }

  if(pathname==='/api/admin/check'&&request.method==='GET'){
    const ip=getClientIP(request);
    const limit=await checkLoginLimit(ip,env);
    if(!limit.allowed) return json({error:'登录尝试过多，'+limit.reason},429);
    if(!await verifyAdmin(request,env)){
      await recordLoginFailure(ip,env);
      return json({error:'用户名或密码错误'},401);
    }
    await resetLoginLimit(ip,env);
    return json({ok:true});
  }

  if(pathname==='/api/admin/resources'&&request.method==='GET'){
    if(!await verifyAdmin(request,env)) return json({error:'未授权'},401)
    const keys=await env.KV.list({prefix:'res:'})
    const res=[]
    for(const k of keys.keys){
      const d=await env.KV.get(k.name,'json')
      if(d) res.push({id:d.id,name:d.name})
    }
    return json(res)
  }

  if(pathname.startsWith('/api/admin/resource/')&&request.method==='GET'){
    if(!await verifyAdmin(request,env)) return json({error:'未授权'},401)
    const id=pathname.slice('/api/admin/resource/'.length)
    const d=await env.KV.get('res:'+id,'json')
    if(!d) return json({error:'资源不存在'},404)
    return json(d)
  }

  if(pathname==='/api/admin/resource'&&request.method==='POST'){
    if(!await verifyAdmin(request,env)) return json({error:'未授权'},401)
    let fd
    try{ fd=await request.formData() }catch(e){ return json({error:'表单解析失败'},400) }
    const id=fd.get('id')
    if(!id) return json({error:'资源ID不能为空'},400)
    const exist=await env.KV.get('res:'+id,'json')
    if(exist) return json({error:'资源ID已存在'},400)
    const tagsStr=fd.get('tags')||''
    const tags=tagsStr.split(' ').filter(t=>t.trim())
    const sm=fd.get('storageMode')||'upload'
    const st=fd.get('storageType')||'telegram'
    let tgFileId=null,r2Key=null,fileName=null

    if(!hasR2 && st==='r2') return json({error:'R2未启用，无法使用R2存储'},400)
    if(!hasR2 && fd.get('preview') && fd.get('preview').size>0) return json({error:'R2未启用，无法上传预览图，请使用URL外链'},400)

    if((hasR2 && sm==='upload') || (!hasR2 && st==='telegram')){
      const file=fd.get('file')
      if(file && file.size>0){
        if(!ALLOWED_FILE_TYPES.includes(file.type) && file.type!=='application/octet-stream') return json({error:'不支持的文件类型'},400)
        fileName=file.name
        if(st==='telegram'){
          const tgf=new FormData()
          tgf.append('chat_id',env.TG_CHANNEL_ID)
          tgf.append('document',file,file.name)
          const tgd=await tgApiCall(env,'sendDocument',tgf)
          if(!tgd.ok) return json({error:'上传失败'},500)
          tgFileId=tgd.result.document.file_id
        }else if(st==='r2' && hasR2){
          await env.R2_PREVIEWS.put('file_'+id,file.stream(),{httpMetadata:{contentType:file.type}})
          r2Key='file_'+id
        }
      }
      const prev=fd.get('preview')
      if(prev && prev.size>0 && hasR2){
        if(!ALLOWED_PREVIEW_TYPES.includes(prev.type)) return json({error:'预览图格式不支持，仅支持 JPG/PNG/WEBP'},400)
        await env.R2_PREVIEWS.put('preview_'+id,prev.stream(),{httpMetadata:{contentType:prev.type}})
      }
    }

    const hq=fd.get('hasQuestion')==='true'
    const previewUrl = (!hasR2 || sm==='url' || st==='url') ? fd.get('previewUrl') : null
    const fileUrl = (sm==='url' || st==='url') ? fd.get('fileUrl') : null
    const data={id,name:fd.get('name')||id,tags,description:fd.get('description')||'',hasQuestion:hq,question:hq?fd.get('question'):null,answer:hq?fd.get('answer'):null,storageMode:sm,storageType:st,tgFileId,r2Key,fileName,previewUrl,fileUrl,createdAt:Date.now()}
    await env.KV.put('res:'+id,JSON.stringify(data))
    return json({ok:true})
  }

  if(pathname.startsWith('/api/admin/resource/')&&request.method==='PUT'){
    if(!await verifyAdmin(request,env)) return json({error:'未授权'},401)
    const id=pathname.slice('/api/admin/resource/'.length)
    const exist=await env.KV.get('res:'+id,'json')
    if(!exist) return json({error:'资源不存在'},404)
    const fd=await request.formData()
    const tagsStr=fd.get('tags')||''
    const tags=tagsStr.split(' ').filter(t=>t.trim())
    const sm=fd.get('storageMode')||exist.storageMode||'upload'
    const st=fd.get('storageType')||exist.storageType||'telegram'
    let tgFileId=exist.tgFileId,r2Key=exist.r2Key,fileName=exist.fileName

    if(!hasR2 && st==='r2') return json({error:'R2未启用，无法使用R2存储'},400)

    if((hasR2 && sm==='upload') || (!hasR2 && st==='telegram')){
      const file=fd.get('file')
      if(file && file.size>0){
        if(!ALLOWED_FILE_TYPES.includes(file.type) && file.type!=='application/octet-stream') return json({error:'不支持的文件类型'},400)
        fileName=file.name
        if(st==='telegram'){
          const tgf=new FormData()
          tgf.append('chat_id',env.TG_CHANNEL_ID)
          tgf.append('document',file,file.name)
          const tgd=await tgApiCall(env,'sendDocument',tgf)
          if(!tgd.ok) return json({error:'上传失败'},500)
          tgFileId=tgd.result.document.file_id
        }else if(st==='r2' && hasR2){
          await env.R2_PREVIEWS.put('file_'+id,file.stream(),{httpMetadata:{contentType:file.type}})
          r2Key='file_'+id
        }
      }
      const prev=fd.get('preview')
      if(prev && prev.size>0 && hasR2){
        if(!ALLOWED_PREVIEW_TYPES.includes(prev.type)) return json({error:'预览图格式不支持，仅支持 JPG/PNG/WEBP'},400)
        await env.R2_PREVIEWS.put('preview_'+id,prev.stream(),{httpMetadata:{contentType:prev.type}})
      }
    }

    const hq=fd.get('hasQuestion')==='true'
    const previewUrl = (!hasR2 || sm==='url' || st==='url') ? (fd.get('previewUrl')||exist.previewUrl) : exist.previewUrl
    const fileUrl = (sm==='url' || st==='url') ? (fd.get('fileUrl')||exist.fileUrl) : exist.fileUrl
    const updated={...exist,name:fd.get('name')||exist.name,tags,description:fd.get('description')||'',hasQuestion:hq,question:hq?fd.get('question'):null,answer:hq?fd.get('answer'):null,storageMode:sm,storageType:st,tgFileId,r2Key,fileName,previewUrl,fileUrl,updatedAt:Date.now()}
    await env.KV.put('res:'+id,JSON.stringify(updated))
    return json({ok:true})
  }

  if(pathname.startsWith('/api/admin/resource/')&&request.method==='DELETE'){
    if(!await verifyAdmin(request,env)) return json({error:'未授权'},401)
    const id=pathname.slice('/api/admin/resource/'.length)
    await env.KV.delete('res:'+id)
    if(hasR2){
      await env.R2_PREVIEWS.delete('preview_'+id)
      await env.R2_PREVIEWS.delete('file_'+id)
    }
    return json({ok:true})
  }

  return json({error:'接口不存在'},404)
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url)
    if(url.pathname.startsWith('/api/')) return handleAPI(url.pathname,request,env)
    return html(FRONTEND_HTML, true)
  }
}
