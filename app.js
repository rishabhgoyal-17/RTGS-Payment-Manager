// PDF template loaded from file at runtime
var EMBEDDED_PDF = null;
async function loadPDFTemplate(){
  if(EMBEDDED_PDF) return EMBEDDED_PDF;
  var resp = await fetch('rtgs_template.pdf');
  var buffer = await resp.arrayBuffer();
  EMBEDDED_PDF = new Uint8Array(buffer);
  return EMBEDDED_PDF;
}
// ── DATA STORE ──
var DB = { vendors:[], accounts:[], banks:[], transactions:[], config:{
  ocrEnabled:false, anthropicApiKey:'', googleEnabled:false,
  googleEmail:'', googleClientId:'', googleSheetId:'',
  fieldMapping:null, defaultAccountId:null, defaultBankId:null
}};

function defaultMapping(){return[
  {rtgsField:'Beneficiary IFSC Code',vendorField:'ifsc',label:'IFSC Code'},
  {rtgsField:'Beneficiary Bank',vendorField:'bank',label:'Bank Name'},
  {rtgsField:'Beneficiary Branch',vendorField:'branch',label:'Branch'},
  {rtgsField:'Beneficiary Account Number',vendorField:'account',label:'Account Number'},
  {rtgsField:'Beneficiary Name',vendorField:'name',label:'Name'},
  {rtgsField:'Beneficiary Account Type',vendorField:'acctype',label:'Account Type'},
  {rtgsField:'Beneficiary Mobile',vendorField:'mobile',label:'Mobile No.'},
];}

function loadDB(){if(!DB.config.fieldMapping)DB.config.fieldMapping=defaultMapping();var cid=localStorage.getItem('rtgs_client_id');if(cid)DB.config.googleClientId=cid;}
function saveDB(){
  saveUserDB();
  updateDashboard();
  if(isTokenValid()){
    syncToSheets().catch(function(e){console.warn('Sheets sync:',e.message);});
  }
}
function genId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}

// ── NAV ──
function showPage(name){
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active');});
  var pg=document.getElementById('page-'+name);
  if(pg)pg.classList.add('active');
  var nav=document.getElementById('nav-'+name);
  if(nav)nav.classList.add('active');
  if(name==='vendors')renderVendors();
  if(name==='history')renderHistory();
  if(name==='payment')initPaymentPage();
  if(name==='config')initConfigPage();
  if(name==='dashboard')updateDashboard();
}

function showConfigTab(tab,el){
  document.querySelectorAll('.config-tab').forEach(function(t){t.classList.remove('active');});
  document.querySelectorAll('.config-panel').forEach(function(p){p.classList.remove('active');});
  document.getElementById('config-'+tab).classList.add('active');
  el.classList.add('active');
}

// ── TOAST ──
function toast(msg,type){
  type=type||'info';
  var wrap=document.getElementById('toastWrap');
  var el=document.createElement('div');
  el.className='toast '+type;
  var icons={success:'✅',error:'❌',info:'ℹ️'};
  el.innerHTML='<span>'+(icons[type]||'ℹ️')+'</span><span>'+msg+'</span>';
  el.style.animation='slideIn 0.2s ease';
  wrap.appendChild(el);
  setTimeout(function(){el.remove();},3500);
}

// ── MODAL ──
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}

// ── DASHBOARD ──
function updateDashboard(){
  document.getElementById('stat-vendors').textContent=DB.vendors.length;
  document.getElementById('stat-txns').textContent=DB.transactions.length;
  var total=DB.transactions.reduce(function(s,t){return s+(parseFloat(t.amount)||0);},0);
  document.getElementById('stat-amount').textContent='₹'+total.toLocaleString('en-IN');
  var recent=DB.transactions.slice().reverse().slice(0,5);
  var el=document.getElementById('dash-recent-txns');
  if(!recent.length){el.innerHTML='<div class="empty-state"><div class="empty-icon">💸</div><div class="empty-text">No transactions yet.</div></div>';return;}
  el.innerHTML='<div class="table-wrap"><table><thead><tr><th>Date</th><th>Vendor</th><th>Amount</th><th>Account</th></tr></thead><tbody>'+
    recent.map(function(t){return'<tr><td>'+t.date+'</td><td class="text-main">'+t.vendorName+'</td><td>₹'+parseFloat(t.amount).toLocaleString('en-IN')+'</td><td>'+(t.accountName||'-')+'</td></tr>';}).join('')+
    '</tbody></table></div>';
}

// ── VENDORS ──
function openVendorModal(id){
  ['v_name','v_account','v_ifsc','v_bank','v_branch','v_mobile','v_address','v_lei'].forEach(function(f){document.getElementById(f).value='';});
  document.getElementById('v_acctype').value='CD';
  document.getElementById('v_editId').value='';
  document.getElementById('vendorModalTitle').textContent='Add Vendor';
  var mw=document.getElementById('mobileWarning');if(mw)mw.textContent='';
  var aw=document.getElementById('accountLengthWarning');if(aw)aw.textContent='';
  if(id){
    var v=DB.vendors.find(function(x){return x.id===id;});
    if(v){
      document.getElementById('v_name').value=v.name||'';
      document.getElementById('v_account').value=v.account||'';

      document.getElementById('v_ifsc').value=v.ifsc||'';
      document.getElementById('v_bank').value=v.bank||'';
      document.getElementById('v_branch').value=v.branch||'';
      document.getElementById('v_acctype').value=v.acctype||'CD';
      document.getElementById('v_mobile').value=v.mobile||'';
      document.getElementById('v_address').value=v.address||'';
      document.getElementById('v_lei').value=v.lei||'';
      document.getElementById('v_editId').value=id;
      document.getElementById('vendorModalTitle').textContent='Edit Vendor';
    }
  }
  openModal('vendorModal');
}

// Bank account number length rules
var BANK_ACC_LENGTHS = {
  'STATE BANK OF INDIA': [11],
  'SBI': [11],
  'CANARA BANK': [11,13],
  'UNION BANK OF INDIA': [15],
  'CENTRAL BANK OF INDIA': [14],
  'HDFC BANK': [14],
  'ICICI BANK': [12],
  'AXIS BANK': [15],
  'PUNJAB NATIONAL BANK': [16],
  'BANK OF BARODA': [14],
  'KOTAK MAHINDRA BANK': [14],
  'INDUSIND BANK': [12],
  'YES BANK': [15],
  'IDBI BANK': [16],
  'BANK OF INDIA': [15],
  'INDIAN BANK': [15],
  'INDIAN OVERSEAS BANK': [15],
  'UCO BANK': [15],
  'BANK OF MAHARASHTRA': [15],
  'FEDERAL BANK': [14],
  'SOUTH INDIAN BANK': [16],
  'KARUR VYSYA BANK': [13],
  'CITY UNION BANK': [13],
  'DCIB BANK': [13],
  'RBL BANK': [12],
  'BANDHAN BANK': [15],
  'AU SMALL FINANCE BANK': [14],
};

function checkMobileNumber(){
  var mob = document.getElementById('v_mobile').value.trim();
  var warningEl = document.getElementById('mobileWarning');
  if(!warningEl) return;
  if(!mob){ warningEl.textContent=''; return; }
  if(mob.length < 10){
    warningEl.textContent = '⚠️ Mobile number should be 10 digits — ' + (10 - mob.length) + ' digit(s) remaining';
  } else if(mob.length === 10 && !/^[6-9]/.test(mob)){
    warningEl.textContent = '⚠️ Indian mobile numbers start with 6, 7, 8 or 9';
  } else {
    warningEl.textContent = '';
  }
}

function checkAccountLength(){
  var accNum = document.getElementById('v_account').value.trim();
  var bankName = (document.getElementById('v_bank').value||'').trim().toUpperCase();
  var warningEl = document.getElementById('accountLengthWarning');
  if(!warningEl) return;
  if(!accNum || !bankName){ warningEl.textContent=''; return; }

  // Find matching bank rule
  var lengths = null;
  for(var key in BANK_ACC_LENGTHS){
    if(bankName.includes(key) || key.includes(bankName)){
      lengths = BANK_ACC_LENGTHS[key];
      break;
    }
  }
  if(!lengths){ warningEl.textContent=''; return; } // Unknown bank — no validation

  var len = accNum.length;
  if(lengths.indexOf(len) === -1){
    var expected = lengths.length === 1
      ? lengths[0]+' digits'
      : lengths.join(' or ')+' digits';
    warningEl.textContent = '⚠️ '+bankName.charAt(0)+bankName.slice(1).toLowerCase()+' account numbers are usually '+expected+' — please double check';
  } else {
    warningEl.textContent = '';
  }
}

var ifscLookupTimer = null;
async function lookupIFSC(){
  var ifsc = document.getElementById('v_ifsc').value.trim().toUpperCase();
  var statusEl = document.getElementById('ifscLookupStatus');

  // Clear any pending auto-hide timer
  if(ifscLookupTimer){ clearTimeout(ifscLookupTimer); ifscLookupTimer=null; }

  // Clear previous state immediately on every call
  statusEl.textContent = '';
  statusEl.style.color = '';

  // Clear bank/branch/address so stale data from wrong IFSC doesn't remain
  document.getElementById('v_bank').value = '';
  document.getElementById('v_branch').value = '';
  document.getElementById('v_address').value = '';

  if(ifsc.length !== 11){ return; }

  statusEl.textContent = '⏳ Looking up...';
  statusEl.style.color = 'var(--warning)';
  try{
    var resp = await fetch('https://ifsc.razorpay.com/'+ifsc);
    if(!resp.ok) throw new Error('Not found');
    var data = await resp.json();
    if(data.BANK){
      document.getElementById('v_bank').value = data.BANK;
      document.getElementById('v_branch').value = data.BRANCH||'';
      // Auto-fill address from branch data — editable by user
      var addr = '';
      if(data.ADDRESS) addr = data.ADDRESS;
      else{
        var parts = [data.BRANCH, data.CITY, data.STATE, data.PINCODE].filter(Boolean);
        addr = parts.join(', ');
      }
      document.getElementById('v_address').value = addr;
      statusEl.textContent = '✅ Found';
      statusEl.style.color = 'var(--success)';
      checkAccountLength();
      ifscLookupTimer = setTimeout(function(){ statusEl.textContent=''; ifscLookupTimer=null; }, 3000);
    }
  }catch(e){
    statusEl.textContent = '❌ Invalid IFSC — please check and re-enter';
    statusEl.style.color = 'var(--danger)';
    // No auto-hide for error — stays until user corrects IFSC
  }
}

function saveVendor(){
  var name=document.getElementById('v_name').value.trim();
  var account=document.getElementById('v_account').value.trim();

  var ifsc=document.getElementById('v_ifsc').value.trim().toUpperCase();
  if(!name){toast('Vendor name is required','error');return;}
  if(!account){toast('Account number is required','error');return;}

  // Duplicate check — same account + IFSC already exists
  var editId = document.getElementById('v_editId').value;
  var duplicate = DB.vendors.find(function(v){
    return v.account === account && v.ifsc === ifsc && v.id !== editId;
  });
  if(duplicate){
    toast('❌ Vendor already exists: '+duplicate.name+' has the same account & IFSC','error');
    return;
  }
  var vendor={id:document.getElementById('v_editId').value||genId(),name:name,account:account,ifsc:ifsc,
    bank:document.getElementById('v_bank').value.trim(),branch:document.getElementById('v_branch').value.trim(),
    acctype:document.getElementById('v_acctype').value,mobile:document.getElementById('v_mobile').value.trim(),
    address:document.getElementById('v_address').value.trim(),lei:document.getElementById('v_lei').value.trim()};
  var editId=document.getElementById('v_editId').value;
  if(editId){var idx=DB.vendors.findIndex(function(v){return v.id===editId;});if(idx>=0)DB.vendors[idx]=vendor;}
  else DB.vendors.push(vendor);
  saveDB();closeModal('vendorModal');renderVendors();toast('Vendor saved!','success');
}

function deleteVendor(id){
  if(!confirm('Delete this vendor?'))return;
  DB.vendors=DB.vendors.filter(function(v){return v.id!==id;});
  saveDB();renderVendors();toast('Vendor deleted','info');
}

function renderVendors(){
  var search=(document.getElementById('vendorSearch')?document.getElementById('vendorSearch').value:'').toLowerCase();
  var filtered=DB.vendors.filter(function(v){return !search||v.name.toLowerCase().includes(search)||(v.bank||'').toLowerCase().includes(search);});
  var tbody=document.getElementById('vendorTableBody');
  if(!filtered.length){tbody.innerHTML='<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">👥</div><div class="empty-text">No vendors found.</div></div></td></tr>';return;}
  tbody.innerHTML=filtered.map(function(v){return(
    '<tr><td class="text-main">'+v.name+'</td><td>'+(v.bank||'-')+'</td>'+
    '<td><span style="font-family:\'DM Mono\',monospace;font-size:12px;">'+(v.account||'-')+'</span></td>'+
    '<td><span class="badge badge-blue">'+(v.ifsc||'-')+'</span></td>'+
    '<td>'+(v.mobile||'-')+'</td>'+
    '<td><div style="display:flex;gap:6px;">'+
    '<button class="btn btn-ghost btn-sm" onclick="openVendorModal(\''+v.id+'\')">✏️</button>'+
    '<button class="btn btn-danger btn-sm" onclick="deleteVendor(\''+v.id+'\')">🗑️</button>'+
    '</div></td></tr>'
  );}).join('');
}

// ── ACCOUNTS ──
function openAccountModal(id){
  ['a_name','a_account','a_custid','a_address','a_mobile','a_email','a_pan','a_lei'].forEach(function(f){document.getElementById(f).value='';});
  document.getElementById('a_acctype').value='CD';
  document.getElementById('a_default').checked=false;
  document.getElementById('a_editId').value='';
  document.getElementById('accountModalTitle').textContent='Add My Account';
  if(id){
    var a=DB.accounts.find(function(x){return x.id===id;});
    if(a){
      document.getElementById('a_name').value=a.name||'';
      document.getElementById('a_account').value=a.account||'';
      document.getElementById('a_acctype').value=a.acctype||'CD';
      document.getElementById('a_custid').value=a.custid||'';
      document.getElementById('a_address').value=a.address||'';
      document.getElementById('a_mobile').value=a.mobile||'';
      document.getElementById('a_email').value=a.email||'';
      document.getElementById('a_pan').value=a.pan||'';
      document.getElementById('a_lei').value=a.lei||'';
      document.getElementById('a_default').checked=(DB.config.defaultAccountId===id);
      document.getElementById('a_editId').value=id;
      document.getElementById('accountModalTitle').textContent='Edit Account';
    }
  }
  openModal('accountModal');
}

function saveAccount(){
  var name=document.getElementById('a_name').value.trim();
  var account=document.getElementById('a_account').value.trim();
  if(!name){toast('Trade/Business name required','error');return;}
  if(!account){toast('Account number required','error');return;}
  var acc={id:document.getElementById('a_editId').value||genId(),name:name,account:account,
    acctype:document.getElementById('a_acctype').value,custid:document.getElementById('a_custid').value.trim(),
    address:document.getElementById('a_address').value.trim(),mobile:document.getElementById('a_mobile').value.trim(),
    email:document.getElementById('a_email').value.trim(),pan:document.getElementById('a_pan').value.trim().toUpperCase(),
    lei:document.getElementById('a_lei').value.trim()};
  var editId=document.getElementById('a_editId').value;
  if(editId){var idx=DB.accounts.findIndex(function(a){return a.id===editId;});if(idx>=0)DB.accounts[idx]=acc;}
  else DB.accounts.push(acc);
  if(document.getElementById('a_default').checked||DB.accounts.length===1)DB.config.defaultAccountId=acc.id;
  saveDB();closeModal('accountModal');renderAccounts();toast('Account saved!','success');
}

function deleteAccount(id){
  if(!confirm('Delete this account?'))return;
  DB.accounts=DB.accounts.filter(function(a){return a.id!==id;});
  if(DB.config.defaultAccountId===id)DB.config.defaultAccountId=DB.accounts[0]?DB.accounts[0].id:null;
  saveDB();renderAccounts();
}

function setDefaultAccount(id){DB.config.defaultAccountId=id;saveDB();renderAccounts();toast('Default account set','success');}

function renderAccounts(){
  var el=document.getElementById('accountsList');
  if(!DB.accounts.length){el.innerHTML='<div class="empty-state"><div class="empty-icon">👤</div><div class="empty-text">No accounts added yet.</div></div>';return;}
  el.innerHTML=DB.accounts.map(function(a){
    var isDef=DB.config.defaultAccountId===a.id;
    return '<div class="account-card'+(isDef?' is-default':'')+'">'+
      '<div><div style="font-weight:600;font-size:14px;">'+a.name+(isDef?' <span class="default-badge">Default</span>':'')+'</div>'+
      '<div style="font-size:12px;color:var(--text3);margin-top:3px;">A/C: '+a.account+' · '+a.acctype+(a.mobile?' · '+a.mobile:'')+'</div></div>'+
      '<div style="display:flex;gap:6px;">'+
      (!isDef?'<button class="btn btn-ghost btn-sm" onclick="setDefaultAccount(\''+a.id+'\')">★ Default</button>':'')+
      '<button class="btn btn-ghost btn-sm" onclick="openAccountModal(\''+a.id+'\')">✏️</button>'+
      '<button class="btn btn-danger btn-sm" onclick="deleteAccount(\''+a.id+'\')">🗑️</button>'+
      '</div></div>';
  }).join('');
}

// ── BANKS ──
var tempBankPdfData=null;
function handleBankPDF(event){
  var file=event.target.files[0];if(!file)return;
  document.getElementById('b_pdfName').textContent=file.name;
  var reader=new FileReader();
  reader.onload=function(e){tempBankPdfData=e.target.result;};
  reader.readAsDataURL(file);
}

function openBankModal(id){
  ['b_bankname','b_branch','b_ifsc','b_address'].forEach(function(f){document.getElementById(f).value='';});
  document.getElementById('b_default').checked=false;
  document.getElementById('b_editId').value='';
  document.getElementById('b_pdfName').textContent='No file — will use embedded template';
  tempBankPdfData=null;
  if(id){
    var b=DB.banks.find(function(x){return x.id===id;});
    if(b){
      document.getElementById('b_bankname').value=b.bankname||'';
      document.getElementById('b_branch').value=b.branch||'';
      document.getElementById('b_ifsc').value=b.ifsc||'';
      document.getElementById('b_address').value=b.address||'';
      document.getElementById('b_default').checked=(DB.config.defaultBankId===id);
      document.getElementById('b_editId').value=id;
      if(b.pdfData){document.getElementById('b_pdfName').textContent='Existing PDF loaded';tempBankPdfData=b.pdfData;}
    }
  }
  openModal('bankModal');
}

function saveBank(){
  var bankname=document.getElementById('b_bankname').value.trim();
  var branch=document.getElementById('b_branch').value.trim();
  if(!bankname){toast('Bank name required','error');return;}
  if(!branch){toast('Branch name required','error');return;}
  var bank={id:document.getElementById('b_editId').value||genId(),bankname:bankname,branch:branch,
    ifsc:document.getElementById('b_ifsc').value.trim().toUpperCase(),
    address:document.getElementById('b_address').value.trim(),pdfData:tempBankPdfData||null};
  var editId=document.getElementById('b_editId').value;
  if(editId){var idx=DB.banks.findIndex(function(b){return b.id===editId;});if(idx>=0)DB.banks[idx]=bank;}
  else DB.banks.push(bank);
  if(document.getElementById('b_default').checked||DB.banks.length===1)DB.config.defaultBankId=bank.id;
  saveDB();closeModal('bankModal');renderBanks();toast('Bank/Branch saved!','success');
}

function deleteBank(id){
  if(!confirm('Delete this bank/branch?'))return;
  DB.banks=DB.banks.filter(function(b){return b.id!==id;});
  if(DB.config.defaultBankId===id)DB.config.defaultBankId=DB.banks[0]?DB.banks[0].id:null;
  saveDB();renderBanks();
}

function setDefaultBank(id){DB.config.defaultBankId=id;saveDB();renderBanks();toast('Default branch set','success');}

function renderBanks(){
  var el=document.getElementById('banksList');
  if(!DB.banks.length){el.innerHTML='<div class="empty-state"><div class="empty-icon">🏦</div><div class="empty-text">No banks added yet. Add your bank and branch.</div></div>';return;}
  el.innerHTML=DB.banks.map(function(b){
    var isDef=DB.config.defaultBankId===b.id;
    return '<div class="account-card'+(isDef?' is-default':'')+'">'+
      '<div><div style="font-weight:600;font-size:14px;">'+b.bankname+' — '+b.branch+(isDef?' <span class="default-badge">Default</span>':'')+'</div>'+
      '<div style="font-size:12px;color:var(--text3);margin-top:3px;">IFSC: '+(b.ifsc||'—')+' · PDF: '+(b.pdfData?'<span style="color:var(--success)">✓ Uploaded</span>':'<span style="color:var(--warning)">Using embedded</span>')+'</div></div>'+
      '<div style="display:flex;gap:6px;">'+
      (!isDef?'<button class="btn btn-ghost btn-sm" onclick="setDefaultBank(\''+b.id+'\')">★ Default</button>':'')+
      '<button class="btn btn-ghost btn-sm" onclick="openBankModal(\''+b.id+'\')">✏️</button>'+
      '<button class="btn btn-danger btn-sm" onclick="deleteBank(\''+b.id+'\')">🗑️</button>'+
      '</div></div>';
  }).join('');
}

// ── OCR / GOOGLE CONFIG ──
function saveOcrSettings(){
  DB.config.ocrEnabled=document.getElementById('ocrEnabled').checked;
  DB.config.anthropicApiKey=document.getElementById('anthropicApiKey').value;
  document.getElementById('ocrApiSection').style.display=DB.config.ocrEnabled?'block':'none';
  saveDB();
}

function saveGoogleSettings(){}

function updateGoogleBar(){
  var dot=document.getElementById('googleDot');var text=document.getElementById('googleStatusText');
  if(DB.config.googleEnabled && isTokenValid()){
    dot.classList.add('connected');
    text.textContent=(DB.config.googleEmail||'Google').split('@')[0]+' ✓';
  } else {
    dot.classList.remove('connected');
    text.textContent = DB.config.googleEnabled ? 'Session expired' : 'Local storage';
  }
}

// ── AUTH & GOOGLE SHEETS ──
var NETLIFY_URL = 'https://rtgs-payment-manager.netlify.app';
var currentUser = null; // { name, email, picture, accessToken, tokenExpiry }

function startGoogleLogin(){
  var clientId = DB.config.googleClientId;
  if(!clientId){
    // Show client ID input if not configured
    showClientIdPrompt();
    return;
  }
  launchOAuth(clientId);
}

function showClientIdPrompt(){
  var loginStatus = document.getElementById('loginStatus');
  loginStatus.innerHTML = 
    '<div style="text-align:left;margin-top:8px;">'
    +'<div style="font-size:12px;color:var(--text2);margin-bottom:6px;">Enter your Google OAuth Client ID:</div>'
    +'<input id="clientIdInput" type="text" placeholder="xxxxxx.apps.googleusercontent.com" '
    +'style="width:100%;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);'
    +'border-radius:6px;color:var(--text);font-size:12px;outline:none;box-sizing:border-box;">'
    +'<button onclick="saveClientIdAndLogin()" '
    +'style="margin-top:8px;width:100%;padding:9px;background:var(--accent);border:none;border-radius:6px;'
    +'color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:DM Sans,sans-serif;">Continue</button>'
    +'<div style="font-size:11px;color:var(--text3);margin-top:6px;">'
    +'Get this from <a href="https://console.cloud.google.com" target="_blank" style="color:var(--accent);">Google Cloud Console</a></div>'
    +'</div>';
}

function saveClientIdAndLogin(){
  var inp = document.getElementById('clientIdInput');
  if(!inp || !inp.value.trim()){return;}
  DB.config.googleClientId = inp.value.trim();
  localStorage.setItem('rtgs_db', JSON.stringify(DB));
  launchOAuth(DB.config.googleClientId);
}

function launchOAuth(clientId){
  var loginStatus = document.getElementById('loginStatus');
  loginStatus.innerHTML = '⏳ Opening Google login...';
  var scope = encodeURIComponent('https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email');
  var redirectUri = encodeURIComponent(NETLIFY_URL);
  var authUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
    +'?client_id='+encodeURIComponent(clientId)
    +'&redirect_uri='+redirectUri
    +'&response_type=token'
    +'&scope='+scope
    +'&prompt=consent';
  window.location.href = authUrl;
}

function handleOAuthRedirect(){
  var hash = window.location.hash;
  if(!hash || !hash.includes('access_token=')) return false;
  var params = {};
  hash.slice(1).split('&').forEach(function(p){
    var kv = p.split('=');
    params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]||'');
  });
  if(!params.access_token) return false;
  // Clean URL immediately
  history.replaceState(null,'',window.location.pathname);
  // Store token temporarily and fetch user info
  var token = params.access_token;
  var expiresIn = parseInt(params.expires_in||3600);
  fetchUserInfo(token, expiresIn);
  return true;
}

async function fetchUserInfo(token, expiresIn){
  showLoginScreen();
  document.getElementById('loginStatus').textContent = '⏳ Signing in...';
  try{
    var resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers:{'Authorization':'Bearer '+token}
    });
    var info = await resp.json();
    if(info.error) throw new Error(info.error.message);
    currentUser = {
      name: info.name||info.email,
      email: info.email,
      picture: info.picture||'',
      accessToken: token,
      tokenExpiry: Date.now() + (expiresIn*1000)
    };
    // Load user-specific DB from localStorage key
    loadUserDB();
    // Then load from sheets if available
    onLoginSuccess();
  }catch(e){
    document.getElementById('loginStatus').textContent = '❌ Sign in failed: '+e.message;
  }
}

function isTokenValid(){
  return !!(currentUser && currentUser.accessToken && Date.now() < currentUser.tokenExpiry);
}

function loadUserDB(){
  // Each user gets their own localStorage key based on email
  var key = 'rtgs_db_'+btoa(currentUser.email);
  try{
    var s = localStorage.getItem(key);
    if(s){ var p = JSON.parse(s); DB = Object.assign(DB,p); }
  }catch(e){}
  if(!DB.config.fieldMapping) DB.config.fieldMapping = defaultMapping();
  if(!DB.config.googleClientId && localStorage.getItem('rtgs_client_id')){
    DB.config.googleClientId = localStorage.getItem('rtgs_client_id');
  }
}

function saveUserDB(){
  if(!currentUser) return;
  var key = 'rtgs_db_'+btoa(currentUser.email);
  try{ localStorage.setItem(key, JSON.stringify(DB)); }catch(e){}
  // Save client ID globally so it persists across logins
  if(DB.config.googleClientId) localStorage.setItem('rtgs_client_id', DB.config.googleClientId);
}

async function onLoginSuccess(){
  // Update sidebar user info
  document.getElementById('userName').textContent = currentUser.name;
  document.getElementById('userEmail').textContent = currentUser.email;
  if(currentUser.picture){
    var av = document.getElementById('userAvatar');
    av.src = currentUser.picture;
    av.style.display = 'block';
  }
  // Show app, hide login
  hideLoginScreen();
  updateDashboard();
  // Init or load Google Sheet
  if(DB.config.googleSheetId){
    // Sheet exists — load data from it
    document.getElementById('loginStatus').textContent = '';
    toast('Loading your data from Google Sheets...','info');
    await loadFromSheets();
  } else {
    // First time — create sheet
    toast('Setting up your Google Sheet...','info');
    await initGoogleSheets();
    toast('Welcome! Your data is ready.','success');
  }
}

function signOut(){
  if(!confirm('Sign out?')) return;
  currentUser = null;
  DB = {vendors:[],accounts:[],banks:[],transactions:[],config:{
    ocrEnabled:false,anthropicApiKey:'',googleEnabled:false,
    googleEmail:'',googleClientId:DB.config.googleClientId||'',
    googleSheetId:'',fieldMapping:defaultMapping(),
    defaultAccountId:null,defaultBankId:null
  }};
  showLoginScreen();
  toast('Signed out','info');
}

function showLoginScreen(){
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appLayout').style.display = 'none';
}

function hideLoginScreen(){
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appLayout').style.display = 'flex';
}

async function gFetch(url, opts){
  if(!isTokenValid()) throw new Error('Session expired — please sign in again');
  opts = opts||{};
  opts.headers = Object.assign({
    'Authorization':'Bearer '+currentUser.accessToken,
    'Content-Type':'application/json'
  }, opts.headers||{});
  var resp = await fetch(url, opts);
  if(!resp.ok){ var err=await resp.text(); throw new Error(resp.status+' '+err.slice(0,120)); }
  return resp.json();
}

async function initGoogleSheets(){
  if(!isTokenValid()) return;
  var data = await gFetch('https://sheets.googleapis.com/v4/spreadsheets',{
    method:'POST',
    body:JSON.stringify({
      properties:{title:'RTGS - '+currentUser.email},
      sheets:[
        {properties:{title:'Vendors',sheetId:0}},
        {properties:{title:'MyAccounts',sheetId:1}},
        {properties:{title:'Transactions',sheetId:2}},
      ]
    })
  });
  DB.config.googleSheetId = data.spreadsheetId;
  saveUserDB();
  await syncToSheets();
}

async function syncToSheets(){
  if(!DB.config.googleSheetId||!isTokenValid()) return;
  var sid = DB.config.googleSheetId;
  var base = 'https://sheets.googleapis.com/v4/spreadsheets/'+sid+'/values';
  var vRows = [['ID','Name','Account','IFSC','Bank','Branch','AccType','Mobile','Address','LEI']].concat(
    DB.vendors.map(function(v){return[v.id,v.name||'',v.account||'',v.ifsc||'',v.bank||'',v.branch||'',v.acctype||'',v.mobile||'',v.address||'',v.lei||''];}));
  var aRows = [['ID','Name','Account','AccType','CustID','Address','Mobile','Email','PAN','LEI','Default']].concat(
    DB.accounts.map(function(a){return[a.id,a.name||'',a.account||'',a.acctype||'',a.custid||'',a.address||'',a.mobile||'',a.email||'',a.pan||'',a.lei||'',(DB.config.defaultAccountId===a.id)?'YES':''];}));
  var tRows = [['ID','Date','Vendor','VendorBank','VendorIFSC','VendorAccount','FromAccount','Amount']].concat(
    DB.transactions.map(function(t){return[t.id,t.date||'',t.vendorName||'',t.vendorBank||'',t.vendorIfsc||'',t.vendorAccount||'',t.accountName||'',t.amount||0];}));
  await gFetch(base+':batchClear',{method:'POST',body:JSON.stringify({ranges:['Vendors!A:Z','MyAccounts!A:Z','Transactions!A:Z']})});
  await gFetch(base+':batchUpdate',{method:'POST',body:JSON.stringify({valueInputOption:'RAW',data:[
    {range:'Vendors!A1',values:vRows},
    {range:'MyAccounts!A1',values:aRows},
    {range:'Transactions!A1',values:tRows},
  ]})});
}

async function loadFromSheets(){
  if(!DB.config.googleSheetId||!isTokenValid()) return;
  var sid = DB.config.googleSheetId;
  var base = 'https://sheets.googleapis.com/v4/spreadsheets/'+sid+'/values';
  try{
    var results = await Promise.all([
      gFetch(base+'/Vendors!A2:J1000'),
      gFetch(base+'/MyAccounts!A2:K1000'),
      gFetch(base+'/Transactions!A2:H1000'),
    ]);
    if(results[0].values&&results[0].values.length)
      DB.vendors=results[0].values.map(function(r){return{id:r[0]||'',name:r[1]||'',account:r[2]||'',ifsc:r[3]||'',bank:r[4]||'',branch:r[5]||'',acctype:r[6]||'CD',mobile:r[7]||'',address:r[8]||'',lei:r[9]||''};});
    if(results[1].values&&results[1].values.length){
      DB.accounts=results[1].values.map(function(r){return{id:r[0]||'',name:r[1]||'',account:r[2]||'',acctype:r[3]||'CD',custid:r[4]||'',address:r[5]||'',mobile:r[6]||'',email:r[7]||'',pan:r[8]||'',lei:r[9]||''};});
      var def=results[1].values.find(function(r){return r[10]==='YES';});
      if(def) DB.config.defaultAccountId=def[0];
    }
    if(results[2].values&&results[2].values.length)
      DB.transactions=results[2].values.map(function(r){return{id:r[0]||'',date:r[1]||'',vendorName:r[2]||'',vendorBank:r[3]||'',vendorIfsc:r[4]||'',vendorAccount:r[5]||'',accountName:r[6]||'',amount:parseFloat(r[7])||0,timestamp:Date.now()};});
    saveUserDB();
    updateDashboard();
    toast('Data loaded from Google Sheets','success');
  }catch(e){
    toast('Could not load from Sheets: '+e.message,'error');
  }
}

function connectGoogle(){ toast('You are already connected via Google login','info'); }
function disconnectGoogle(){ signOut(); }
function setGoogleStatus(type,html){}
function updateGoogleBar(){}


// ── FIELD MAPPING ──
var VENDOR_FIELDS=[
  {value:'name',label:'Name'},{value:'account',label:'Account Number'},
  {value:'ifsc',label:'IFSC Code'},{value:'bank',label:'Bank Name'},
  {value:'branch',label:'Branch'},{value:'acctype',label:'Account Type'},
  {value:'mobile',label:'Mobile No.'},{value:'address',label:'Address'},{value:'lei',label:'LEI No.'},
];

function renderFieldMapping(){
  var el=document.getElementById('fieldMappingList');
  el.innerHTML=DB.config.fieldMapping.map(function(m,i){
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px;align-items:center;">'+
      '<div style="background:var(--surface2);padding:8px 12px;border-radius:var(--radius-sm);font-size:12.5px;color:var(--text2);">📋 '+m.rtgsField+'</div>'+
      '<select class="form-select" id="fm_'+i+'">'+
      VENDOR_FIELDS.map(function(f){return'<option value="'+f.value+'"'+(m.vendorField===f.value?' selected':'')+'>'+f.label+'</option>';}).join('')+
      '</select></div>';
  }).join('');
}

function saveFieldMapping(){
  DB.config.fieldMapping=DB.config.fieldMapping.map(function(m,i){
    return Object.assign({},m,{vendorField:document.getElementById('fm_'+i).value});
  });
  saveDB();toast('Mapping saved!','success');
}

function resetFieldMapping(){DB.config.fieldMapping=defaultMapping();renderFieldMapping();toast('Reset to defaults','info');}

// ── CONFIG INIT ──
function initConfigPage(){
  document.getElementById('ocrEnabled').checked=DB.config.ocrEnabled;
  document.getElementById('anthropicApiKey').value=DB.config.anthropicApiKey||'';
  document.getElementById('ocrApiSection').style.display=DB.config.ocrEnabled?'block':'none';
  var cidEl = document.getElementById('googleClientId');
  if(cidEl) cidEl.value=DB.config.googleClientId||localStorage.getItem('rtgs_client_id')||'';
  // Show current user info in Google config panel
  var infoEl = document.getElementById('googleAccountInfo');
  if(infoEl && currentUser){
    infoEl.innerHTML = '<div style="display:flex;align-items:center;gap:10px;background:var(--surface2);padding:12px;border-radius:8px;">'
      +(currentUser.picture?'<img src="'+currentUser.picture+'" style="width:36px;height:36px;border-radius:50%;">':'')
      +'<div><div style="font-weight:600;font-size:13.5px;">'+currentUser.name+'</div>'
      +'<div style="font-size:12px;color:var(--text3);">'+currentUser.email+'</div>'
      +(DB.config.googleSheetId?'<a href="https://docs.google.com/spreadsheets/d/'+DB.config.googleSheetId+'" target="_blank" style="font-size:11px;color:var(--accent);">📊 View your Sheet</a>':'')
      +'</div>'
      +'<span style="margin-left:auto;font-size:11px;color:var(--success);">✅ Connected</span>'
      +'</div>';
  }
  renderAccounts();renderBanks();renderFieldMapping();
}

// ── PAYMENT PAGE ──
var currentBillBase64=null;

function initPaymentPage(){
  var vSel=document.getElementById('paymentVendor');
  vSel.innerHTML='<option value="">-- Select Vendor --</option>'+
    DB.vendors.map(function(v){return'<option value="'+v.id+'">'+v.name+'</option>';}).join('');
  var aSel=document.getElementById('paymentAccount');
  aSel.innerHTML='<option value="">-- Select Account --</option>'+
    DB.accounts.map(function(a){return'<option value="'+a.id+'"'+(DB.config.defaultAccountId===a.id?' selected':'')+'>'+a.name+' ('+a.account+')</option>';}).join('');
  document.getElementById('paymentAmount').value='';
  document.getElementById('amountWordsBox').textContent='—';
  document.getElementById('rtgsPreviewArea').style.display='none';
  document.getElementById('generatePdfBtn').style.display='none';
  document.getElementById('vendorDetailsPreview').style.display='none';
  clearBill();
}

function handleBillDrop(e){
  e.preventDefault();document.getElementById('billDrop').classList.remove('dragover');
  var file=e.dataTransfer.files[0];if(file)processBillFile(file);
}
function handleBillFile(e){var file=e.target.files[0];if(file)processBillFile(file);}

function processBillFile(file){
  var reader=new FileReader();
  reader.onload=function(e){
    currentBillBase64=e.target.result;
    document.getElementById('billPreviewImg').src=currentBillBase64;
    document.getElementById('bill-upload-area').style.display='none';
    document.getElementById('bill-preview-area').style.display='block';
    if(DB.config.ocrEnabled&&DB.config.anthropicApiKey){runOCR(currentBillBase64);}
    else{document.getElementById('ocrContent').innerHTML='<div style="padding:12px;background:var(--surface2);border-radius:var(--radius-sm);font-size:12.5px;color:var(--text2);"><div style="font-weight:600;margin-bottom:4px;">📎 Bill attached</div><div style="color:var(--text3);">OCR disabled. Select vendor and enter amount manually.</div></div>';}
  };
  reader.readAsDataURL(file);
}

function clearBill(){
  currentBillBase64=null;
  document.getElementById('billPreviewImg').src='';
  document.getElementById('bill-upload-area').style.display='block';
  document.getElementById('bill-preview-area').style.display='none';
  document.getElementById('billFileInput').value='';
}

async function runOCR(imgBase64){
  document.getElementById('ocrContent').innerHTML='<div style="text-align:center;padding:20px;"><div class="spinner" style="margin:0 auto 8px;"></div><div style="font-size:12px;color:var(--text3);">Analysing bill...</div></div>';
  try{
    var b64=imgBase64.split(',')[1];
    var mt=imgBase64.split(';')[0].split(':')[1];
    var resp=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':DB.config.anthropicApiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:300,messages:[{role:'user',content:[
        {type:'image',source:{type:'base64',media_type:mt,data:b64}},
        {type:'text',text:'Extract from this bill: 1) Vendor/seller company name 2) Total invoice amount (numbers only, no currency symbol). Reply ONLY in JSON: {"vendor_name":"...","amount":"..."}'}
      ]}]})
    });
    var data=await resp.json();
    var text=data.content&&data.content[0]?data.content[0].text:'{}';
    var extracted={};
    try{extracted=JSON.parse(text.replace(/```json|```/g,''));}catch(e){}
    var vendorName=extracted.vendor_name||'';
    var amount=extracted.amount||'';
    var matches=fuzzyMatch(vendorName,DB.vendors);
    var matchHtml='';
    if(matches.length){
      matchHtml=matches.slice(0,3).map(function(m){
        return '<div class="ocr-match" onclick="selectOCRVendor(\''+m.vendor.id+'\')">'+
          '<div style="flex:1;"><div style="font-size:13px;font-weight:600;">'+m.vendor.name+'</div><div style="font-size:11px;color:var(--text3);">Click to select</div></div>'+
          '<span class="match-score '+(m.score>70?'match-high':m.score>40?'match-med':'match-low')+'">'+m.score+'%</span></div>';
      }).join('');
    }else{matchHtml='<div style="font-size:12px;color:var(--text3);padding:8px 0;">No match — select vendor manually</div>';}
    document.getElementById('ocrContent').innerHTML=
      '<div style="margin-bottom:10px;"><div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;margin-bottom:6px;">Detected: "'+vendorName+'"</div>'+matchHtml+'</div>'+
      (amount?'<div style="font-size:12.5px;color:var(--text2);">💰 Amount: <strong style="color:var(--text);">₹'+amount+'</strong> <button class="btn btn-ghost btn-sm" style="margin-left:8px" onclick="applyOCRAmount(\''+amount+'\')">Apply</button></div>':'');
    if(matches.length&&matches[0].score>70)selectOCRVendor(matches[0].vendor.id);
    if(amount){document.getElementById('paymentAmount').value=amount;onAmountChange();}
  }catch(e){document.getElementById('ocrContent').innerHTML='<div style="color:var(--danger);font-size:12px;">OCR error: '+e.message+'</div>';}
}

function selectOCRVendor(id){document.getElementById('paymentVendor').value=id;onVendorSelect();toast('Vendor selected','success');}
function applyOCRAmount(amount){document.getElementById('paymentAmount').value=amount;onAmountChange();}

function fuzzyMatch(query,vendors){
  if(!query||!vendors.length)return[];
  var q=query.toLowerCase().trim();
  return vendors.map(function(v){
    var name=(v.name||'').toLowerCase();var score=0;
    if(name===q)score=100;
    else if(name.includes(q)||q.includes(name))score=80;
    else{
      var qw=q.split(/\s+/);var nw=name.split(/\s+/);
      var common=qw.filter(function(w){return nw.some(function(n){return n.includes(w)||w.includes(n);});});
      score=Math.round(common.length/Math.max(qw.length,nw.length)*70);
      var qc=new Set(q.replace(/\s/g,''));var nc=new Set(name.replace(/\s/g,''));
      var overlap=[...qc].filter(function(c){return nc.has(c);}).length;
      score=Math.max(score,Math.round(overlap/Math.max(qc.size,nc.size)*50));
    }
    return{vendor:v,score:score};
  }).filter(function(m){return m.score>20;}).sort(function(a,b){return b.score-a.score;});
}

function onVendorSelect(){
  var id=document.getElementById('paymentVendor').value;
  var vendor=DB.vendors.find(function(v){return v.id===id;});
  var prev=document.getElementById('vendorDetailsPreview');
  if(vendor){
    prev.style.display='block';
    document.getElementById('vendorDetailsContent').innerHTML=
      [['Bank',vendor.bank],['Branch',vendor.branch],['Account No.',vendor.account],['IFSC',vendor.ifsc],['Type',vendor.acctype],['Mobile',vendor.mobile]]
      .filter(function(r){return r[1];})
      .map(function(r){return'<div><span style="color:var(--text3);">'+r[0]+': </span><span style="color:var(--text);">'+r[1]+'</span></div>';}).join('');
  }else{prev.style.display='none';}
}

function onAmountChange(){
  var amt=parseFloat(document.getElementById('paymentAmount').value);
  document.getElementById('amountWordsBox').textContent=(!isNaN(amt)&&amt>0)?numToWords(amt)+' Only':'—';
}

function numToWords(n){
  if(n===0)return'Zero';
  var ones=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  var tens=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function c(num){
    if(num<20)return ones[num];
    if(num<100)return tens[Math.floor(num/10)]+(num%10?' '+ones[num%10]:'');
    if(num<1000)return ones[Math.floor(num/100)]+' Hundred'+(num%100?' '+c(num%100):'');
    if(num<100000)return c(Math.floor(num/1000))+' Thousand'+(num%1000?' '+c(num%1000):'');
    if(num<10000000)return c(Math.floor(num/100000))+' Lakh'+(num%100000?' '+c(num%100000):'');
    return c(Math.floor(num/10000000))+' Crore'+(num%10000000?' '+c(num%10000000):'');
  }
  var ip=Math.floor(n);var dp=Math.round((n-ip)*100);
  return'Rupees '+c(ip)+(dp>0?' and Paise '+c(dp):'');
}

// ── PREVIEW ──
function getFormData(){
  var vendorId=document.getElementById('paymentVendor').value;
  var accountId=document.getElementById('paymentAccount').value;
  return{
    vendor:DB.vendors.find(function(v){return v.id===vendorId;}),
    account:DB.accounts.find(function(a){return a.id===accountId;}),
    amount:parseFloat(document.getElementById('paymentAmount').value)||0,
    isCash:document.getElementById('paymentCash').checked,
    isCheque:document.getElementById('paymentCheque').checked,
    bank:DB.banks.find(function(b){return b.id===DB.config.defaultBankId;}),
    today:new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'})
  };
}

function validateForm(fd){
  if(!fd.vendor){toast('Please select a vendor','error');return false;}
  if(!fd.account){toast('Please select your account','error');return false;}
  if(!fd.amount||fd.amount<=0){toast('Please enter amount','error');return false;}
  return true;
}

function previewRTGS(){
  var fd=getFormData();if(!validateForm(fd))return;
  var preview=document.getElementById('rtgsPreviewArea');
  preview.style.display='block';
  document.getElementById('generatePdfBtn').style.display='inline-flex';
  var w=numToWords(fd.amount);
  preview.innerHTML='<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;">'+
    '<div style="font-size:13px;font-weight:600;margin-bottom:14px;color:var(--text2);">📋 RTGS Form Preview</div>'+
    '<div style="background:#fff;color:#000;border-radius:8px;padding:20px;font-size:11px;font-family:Arial,sans-serif;">'+
    '<div style="text-align:center;font-weight:bold;font-size:13px;margin-bottom:10px;">APPLICATION FOR FUNDS TRANSFER- RTGS/NEFT</div>'+
    '<div style="display:flex;justify-content:space-between;margin-bottom:6px;"><div>To, The Branch Manager, '+(fd.bank?fd.bank.branch:'_______')+' Branch</div><div>Date: '+fd.today+'</div></div>'+
    '<div style="margin:6px 0;">Please remit <strong>Rs. '+fd.amount.toLocaleString('en-IN')+'</strong> ('+w+') only</div>'+
    '<div style="margin-bottom:10px;">'+(fd.isCash?'☑ Cash':'☐ Cash')+'  '+(fd.isCheque?'☑ Cheque':'☐ Cheque')+'</div>'+
    '<table style="width:100%;border-collapse:collapse;font-size:10.5px;" border="1"><tr style="background:#f0f0f0;"><td style="padding:4px 6px;font-weight:bold;width:50%;">DETAILS OF APPLICANT</td><td style="padding:4px 6px;font-weight:bold;">DETAILS OF BENEFICIARY</td></tr>'+
    '<tr><td style="padding:4px 6px;">NAME: '+(fd.account.name||'')+'</td><td style="padding:4px 6px;">IFSC CODE: '+(fd.vendor.ifsc||'')+'</td></tr>'+
    '<tr><td style="padding:4px 6px;">ACCOUNT NO.: '+(fd.account.account||'')+'</td><td style="padding:4px 6px;">BANK: '+(fd.vendor.bank||'')+'</td></tr>'+
    '<tr><td style="padding:4px 6px;">TYPE OF A/C: '+(fd.account.acctype||'')+'</td><td style="padding:4px 6px;">BRANCH: '+(fd.vendor.branch||'')+'</td></tr>'+
    '<tr><td style="padding:4px 6px;">CUSTOMER ID: '+(fd.account.custid||'')+'</td><td style="padding:4px 6px;">ACCOUNT NUMBER: '+(fd.vendor.account||'')+'</td></tr>'+
    '<tr><td style="padding:4px 6px;">ADDRESS: '+(fd.account.address||'')+'</td><td style="padding:4px 6px;font-weight:bold;">REPEAT ACCOUNT: '+(fd.vendor.account||'')+'</td></tr>'+
    '<tr><td style="padding:4px 6px;">TEL/MOBILE: '+(fd.account.mobile||'')+'</td><td style="padding:4px 6px;">TYPE OF A/C: '+(fd.vendor.acctype||'')+'</td></tr>'+
    '<tr><td style="padding:4px 6px;">E-MAIL: '+(fd.account.email||'')+'</td><td style="padding:4px 6px;">NAME: '+(fd.vendor.name||'')+'</td></tr>'+
    '<tr><td style="padding:4px 6px;">PAN NO.: '+(fd.account.pan||'')+'</td><td style="padding:4px 6px;">TEL/MOBILE: '+(fd.vendor.mobile||'')+'</td></tr>'+
    '</table></div></div>';
  preview.scrollIntoView({behavior:'smooth'});
}

// ── PDF GENERATION ──
async function generateRTGSPDF(){
  var fd=getFormData();if(!validateForm(fd))return;
  var btn=document.getElementById('generatePdfBtn');
  btn.innerHTML='<span class="spinner"></span> Generating...';btn.disabled=true;
  try{
    var pdfBytes;
    var bank=DB.banks.find(function(b){return b.id===DB.config.defaultBankId;});
    if(bank&&bank.pdfData){
      var b64=bank.pdfData.split(',')[1];
      pdfBytes=Uint8Array.from(atob(b64),function(c){return c.charCodeAt(0);});
    }else{
      pdfBytes=await loadPDFTemplate();
    }
    var pdfDoc=await PDFLib.PDFDocument.load(pdfBytes);
    var pages=pdfDoc.getPages();var page=pages[0];
    // dt(text, x, y) - x,y are already in PDF points, y from bottom of page
    function dt(text,x,y,sz){
      if(!text)return;
      try{page.drawText(String(text),{x:x,y:y,size:sz||9,color:PDFLib.rgb(0,0,0)});}
      catch(e){console.warn('drawText failed for',text,e);}
    }
    var today=fd.today;var amt=fd.amount;
    var words=numToWords(amt).replace('Rupees ','');
    // Coordinates: drawText(text, x, y) where y is from BOTTOM of page (pdf-lib standard)
    // All coords derived precisely from PDF structure extraction
    dt(today,              480,  706.3);
    dt(fd.bank?fd.bank.branch:'', 58, 678.2);
    dt(amt.toLocaleString('en-IN'), 150, 641.7);
    // Amount words - split if too long
    if(words.length>50){
      dt(words.substring(0,50), 311, 645.0, 7.5);
      dt(words.substring(50),   311, 637.0, 7.5);
    } else {
      dt(words, 311, 641.7, 8.5);
    }
    if(fd.isCash)dt('X',   68, 615.5, 9);
    if(fd.isCheque)dt('X', 108, 615.5, 9);
    // APPLICANT details
    dt(fd.account.name,    87,  580.7, 9);
    dt(fd.account.account, 111, 569.2, 9);
    dt(fd.account.acctype, 189, 557.6, 9);
    dt(fd.account.custid,  126, 546.4, 9);
    dt(fd.account.address, 94,  534.9, 8);
    dt(fd.account.mobile,  119, 511.8, 9);
    dt(fd.account.email,   93,  500.3, 8);
    dt(fd.account.pan,     121, 488.7, 9);
    if(fd.account.lei)dt(fd.account.lei, 57, 477.2, 8);
    // BENEFICIARY details
    dt(fd.vendor.ifsc,     364, 580.7, 9);
    dt(fd.vendor.bank,     346, 569.2, 9);
    dt(fd.vendor.branch,   357, 557.6, 9);
    dt(fd.vendor.account,  398, 546.4, 9);
    dt(fd.vendor.account,  430, 534.9, 9);  // repeat account
    dt(fd.vendor.acctype,  426, 523.3, 9);
    dt(fd.vendor.name,     351, 511.8, 9);
    dt(fd.vendor.mobile,   405, 500.3, 9);
    if(fd.vendor.lei)dt(fd.vendor.lei, 322, 454.9, 8);
    var out=await pdfDoc.save();
    // Convert to base64 and use data URI to avoid blob URL CSP issues
    var binary='';
    var bytes=new Uint8Array(out);
    for(var i=0;i<bytes.byteLength;i++){binary+=String.fromCharCode(bytes[i]);}
    var b64=btoa(binary);
    var dataUri='data:application/pdf;base64,'+b64;
    var a=document.createElement('a');a.href=dataUri;
    a.download='RTGS_'+fd.vendor.name.replace(/\s+/g,'_')+'_'+today.replace(/\//g,'-')+'.pdf';
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    DB.transactions.push({id:genId(),date:today,vendorId:fd.vendor.id,vendorName:fd.vendor.name,
      vendorBank:fd.vendor.bank,vendorIfsc:fd.vendor.ifsc,vendorAccount:fd.vendor.account,
      accountId:fd.account.id,accountName:fd.account.name,amount:amt,timestamp:Date.now()});
    saveDB();toast('PDF downloaded & saved to history!','success');
  }catch(e){toast('PDF error: '+e.message,'error');console.error(e);}
  finally{btn.innerHTML='📥 Download PDF';btn.disabled=false;}
}

// ── HISTORY ──
function renderHistory(){
  var tbody=document.getElementById('historyTableBody');
  if(!DB.transactions.length){tbody.innerHTML='<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🕐</div><div class="empty-text">No transactions yet.</div></div></td></tr>';return;}
  tbody.innerHTML=DB.transactions.slice().reverse().map(function(t){
    return'<tr><td>'+t.date+'</td><td class="text-main">'+(t.vendorName||'-')+'</td>'+
      '<td>'+(t.vendorBank||'-')+' / <span style="font-family:\'DM Mono\',monospace;font-size:11px;">'+(t.vendorIfsc||'-')+'</span></td>'+
      '<td><span style="font-family:\'DM Mono\',monospace;font-size:11px;">'+(t.vendorAccount||'-')+'</span></td>'+
      '<td><strong>₹'+parseFloat(t.amount).toLocaleString('en-IN')+'</strong></td>'+
      '<td>'+(t.accountName||'-')+'</td>'+
      '<td><button class="btn btn-ghost btn-sm" onclick="reprintTxn(\''+t.id+'\')">🖨️</button></td></tr>';
  }).join('');
}

function reprintTxn(id){
  var t=DB.transactions.find(function(x){return x.id===id;});if(!t)return;
  showPage('payment');
  setTimeout(function(){
    document.getElementById('paymentVendor').value=t.vendorId||'';
    document.getElementById('paymentAccount').value=t.accountId||'';
    document.getElementById('paymentAmount').value=t.amount;
    onVendorSelect();onAmountChange();
    toast('Transaction loaded — click Preview','info');
  },200);
}

function exportHistory(){
  if(!DB.transactions.length){toast('No transactions','info');return;}
  var rows=[['Date','Vendor','Bank','IFSC','Account','Amount','From Account']];
  DB.transactions.forEach(function(t){rows.push([t.date,t.vendorName,t.vendorBank,t.vendorIfsc,t.vendorAccount,t.amount,t.accountName]);});
  var csv=rows.map(function(r){return r.map(function(c){return'"'+(c||'')+'"';}).join(',');}).join('\n');
  var b64=btoa(unescape(encodeURIComponent(csv)));
  var a=document.createElement('a');a.href='data:text/csv;base64,'+b64;
  a.download='RTGS_History.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);
  toast('CSV exported!','success');
}




// ── INIT ──
loadDB();
// Check if returning from Google OAuth redirect
if(!handleOAuthRedirect()){
  // Not an OAuth redirect — show login screen
  showLoginScreen();
}
// Banks are user configurable — no default pre-loaded