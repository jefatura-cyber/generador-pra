"use strict";

const MASTER_SHEET="1wUa9HEmeSHkxUtBF8wnpMHk9pWg7BYAB3lsvTmj9Yfk";
const GESTOR_TEMPLATE="1C44fN_f6DQssGx9ejTKIoOcx1Q9IVbz1y2TQTf_zods";
const FOLLOW_TEMPLATE="1RXzOJq_qqScAG2Qebw9NAbQstwwCFtV4rvmUky7r1tE";
const LEVELS=["Infantil","1º ESO","2º ESO","3º ESO","4º ESO","1º BACH","2º BACH"];
const GOOGLE_SCOPE=[
 "https://www.googleapis.com/auth/drive",
 "https://www.googleapis.com/auth/spreadsheets",
 "https://www.googleapis.com/auth/documents",
 "https://www.googleapis.com/auth/userinfo.email"
].join(" ");
const FOLLOW_OPTIONS={
 progress:["Adquiere los saberes previstos","Adquiere los saberes parcialmente","Dificultades en la adquisición de saberes","Muestra interés por las actividades","Participación activa","Participación escasa","Actitud positiva","Actitud pasiva o negativa","Comportamiento adecuado","Conductas disruptivas ocasionales","Conductas disruptivas frecuentes","Sin observar por absentismo"],
 difficulties:["Falta de hábitos de estudio","Dificultades de comprensión","Problemas de atención/concentración","Baja motivación","Falta de autonomía","Problemas de conducta","Dificultades emocionales","Falta de apoyo familiar","Absentismo escolar","Otras dificultades"],
 efficacy:["Muy eficaz - Mejoras significativas","Eficaz - Se observan mejoras","Poco eficaz - Pocas mejoras","No eficaz - Sin mejoras observadas","Sin valorar - Absentismo escolar"],
 changes:["No se requieren modificaciones","Ajuste de saberes","Cambio metodológico","Mayor tiempo de refuerzo","Refuerzo individualizado","Cambio de agrupamiento","Coordinación con otros profesionales","Mayor implicación familiar","Incrementar asistencia a clase (absentismo)","Otras modificaciones"],
 continuation:["Sí","No"]
};
const $=id=>document.getElementById(id);
const state={token:"",expires:0,email:"",sheetId:"",sheetMetadata:null,config:{},records:[],client:null,clientId:"",validated:false,busy:false};
const unique=a=>[...new Set(a.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"es"));
const delay=t=>new Promise(resolve=>setTimeout(resolve,t));
function message(id,text,isError=false){const e=$(id);if(!e)return;e.textContent=String(text||"");e.classList.toggle("error",!!isError)}
function errorText(e){return e&&e.message?e.message:String(e)}
function requireLogin(){if(!state.token||Date.now()>state.expires){throw Error("La autorización de Google no está activa. Pulsa «Conectar Google» para autorizar esta cuenta.");}}
function setBusy(value){state.busy=value;for(const id of ["crearHoja","checkG","copyTemplateG","checkData","runG","refreshFoldersG","checkS","copyTemplateS","makeLink","loadStudents","saveS","regenS"]){const e=$(id);if(e){e.disabled=value||e.dataset.disabled==="yes";}}}
function setReady(id,ready){const el=$(id);if(!el)return;el.dataset.disabled=ready?"no":"yes";el.disabled=state.busy||!ready;}
function safeFile(s){return String(s||"").replace(/[\\/:*?"<>|\r\n]/g," ").replace(/\s+/g," ").trim().slice(0,130);}
function normalize(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();}
function yearForData(){const input=$("curso").value.trim();return input.replace(/\//g,"-");}
function folderId(text){const m=String(text||"").match(/(?:\/folders\/|^)([A-Za-z0-9_-]{12,})(?:[/?#]|$)/);if(!m)throw Error("Introduce un enlace completo de carpeta Google Drive válido.");return m[1];}
function sheetLink(id){return "https://docs.google.com/spreadsheets/d/"+encodeURIComponent(id)+"/edit";}
function docLink(id){return "https://docs.google.com/document/d/"+encodeURIComponent(id)+"/edit";}
function allowedGoogleLink(id,type="folder"){return type==="folder"?"https://drive.google.com/drive/folders/"+encodeURIComponent(id):sheetLink(id);}
function tokenClient(){
 const cid=state.clientId;
 if(!cid||!/^[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com$/.test(cid))throw Error("Introduce el ID de cliente OAuth facilitado por el organizador.");
 if(!window.google?.accounts?.oauth2?.initTokenClient)throw Error("No se ha cargado Google Identity Services. Actualiza la página o revisa el bloqueo de scripts.");
 return google.accounts.oauth2.initTokenClient({
  client_id:cid,scope:GOOGLE_SCOPE,
  callback:async response=>{
   if(response.error){message("sessionMessage","Google no autorizó el acceso: "+response.error,true);return;}
   state.token=response.access_token;state.expires=Date.now()+(Number(response.expires_in||3500)-100)*1000;
   $("connState").textContent="Conectado";$("btnLogout").disabled=false;
   $("sessionInfo").textContent="Conectado a Google Workspace";
   message("sessionMessage","Autorización concedida. Solo se enviarán datos directamente a las API de Google.");
   try{
    const profile=await api("https://www.googleapis.com/oauth2/v3/userinfo");
    state.email=String(profile.email||"");
    if(!state.email)throw Error("Google no devolvió un correo identificado.");
    $("teacherEmail").value=state.email;
    $("sessionInfo").textContent="Cuenta: "+state.email;
    await loadMySheets();
    const params=new URLSearchParams(location.search);
    const sheet=params.get("sheet");
    if(sheet && /^[A-Za-z0-9_-]{20,}$/.test(sheet))await selectSheet(sheet);
    if(params.get("view")==="seguimiento")switchTab("seguimiento");
   }catch(e){message("sessionMessage",errorText(e),true);}
  }
 });
}
async function api(url,{method="GET",body,headers={},raw=false}={}){
 requireLogin();
 const h={Authorization:"Bearer "+state.token,...headers};
 let payload;
 if(body!==undefined){
  if(body instanceof Blob || body instanceof ArrayBuffer){payload=body;}
  else{payload=JSON.stringify(body);if(!h["Content-Type"])h["Content-Type"]="application/json";}
 }
 let response;
 try{response=await fetch(url,{method,headers:h,body:payload,cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer"});}
 catch(e){throw Error("No se ha podido conectar con Google: "+errorText(e));}
 if(!response.ok){
  let txt=await response.text();
  try{const obj=JSON.parse(txt);txt=obj.error?.message||txt;}catch(_){}
  if(response.status===401){state.token="";$("connState").textContent="Sesión caducada";}
  throw Error("Google API "+response.status+": "+String(txt).slice(0,500));
 }
 if(raw)return response.blob();
 if(response.status===204)return {};
 return response.json();
}
const DRIVE="https://www.googleapis.com/drive/v3";
const SHEETS="https://sheets.googleapis.com/v4/spreadsheets";
const DOCS="https://docs.googleapis.com/v1/documents";
async function getFile(id,fields="id,name,mimeType,parents,webViewLink,appProperties"){return api(DRIVE+"/files/"+encodeURIComponent(id)+"?fields="+encodeURIComponent(fields));}
async function listFiles(q,fields="nextPageToken,files(id,name,mimeType,parents,webViewLink,appProperties)",pageSize=1000){
 const found=[];let next="";
 do{const p=new URLSearchParams({q,fields,pageSize:String(pageSize),spaces:"drive"});if(next)p.set("pageToken",next);
 const r=await api(DRIVE+"/files?"+p.toString());found.push(...(r.files||[]));next=r.nextPageToken||"";}
 while(next&&found.length<4000);
 return found;
}
async function createFolder(name,parentId){
 const found=await listFiles("'"+parentId+"' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'");
 const existing=found.find(f=>f.name===name);if(existing)return existing.id;
 const r=await api(DRIVE+"/files?fields=id,name",{method:"POST",body:{name,mimeType:"application/vnd.google-apps.folder",parents:[parentId]}});return r.id;
}
async function copyFile(id,name,parentId){
 const metadata={name};if(parentId)metadata.parents=[parentId];
 return api(DRIVE+"/files/"+encodeURIComponent(id)+"/copy?fields=id,name,webViewLink",{method:"POST",body:metadata});
}
async function patchAppProps(id,changes){
 const original=await getFile(id,"id,appProperties");
 const appProperties={...(original.appProperties||{}),...changes};
 const r=await api(DRIVE+"/files/"+encodeURIComponent(id)+"?fields=id,appProperties",{method:"PATCH",body:{appProperties}});
 state.config=r.appProperties||appProperties;return state.config;
}
async function trashFile(id){return api(DRIVE+"/files/"+encodeURIComponent(id)+"?fields=id,trashed",{method:"PATCH",body:{trashed:true}});}
async function getSheetValues(sheetId,names){
 const query=new URLSearchParams({valueRenderOption:"FORMATTED_VALUE"});
 for(const name of names)query.append("ranges","'"+name.replace(/'/g,"''")+"'!A1:J1500");
 return api(SHEETS+"/"+encodeURIComponent(sheetId)+"/values:batchGet?"+query.toString());
}
async function getSheetMetadata(sheetId){return api(SHEETS+"/"+encodeURIComponent(sheetId)+"?fields=spreadsheetId,properties(title),sheets(properties(title,sheetId))");}
async function ensureInfantil(id){
 const meta=await getSheetMetadata(id);
 if(meta.sheets.some(x=>x.properties?.title==="Infantil"))return;
 const added=await api(SHEETS+"/"+encodeURIComponent(id)+":batchUpdate",{method:"POST",body:{requests:[{addSheet:{properties:{title:"Infantil",gridProperties:{rowCount:1000,columnCount:26,frozenRowCount:5}}}}]}});
 const headers=["Alumno/a","Año académico de creación","Curso de creación","Tipo de documento","Situación del alumno/a","Áreas/Materias/Ámbitos","Estado","Fecha inicio de vigencia","Fecha fin de vigencia","Completo"];
 await api(SHEETS+"/"+encodeURIComponent(id)+"/values/"+encodeURIComponent("'Infantil'!A5:J5")+"?valueInputOption=RAW",{method:"PUT",body:{values:[headers]}});
}
function decodeHtml(text){const doc=new DOMParser().parseFromString(String(text||""),"text/html");return doc;}
function parseStudent(cell){
 const doc=decodeHtml(cell);const b=doc.querySelector("b,strong");
 const name=(b?b.textContent:String(cell).split(/<br\s*\/?>/i)[0].replace(/<[^>]+>/g,"")).trim();
 const full=doc.body.textContent||"";
 const groupMatch=String(cell).match(/\(([^()]+)\)/);
 const idMatch=full.match(/NIE\s*:\s*(\d+)/i);
 return {name,group:groupMatch?groupMatch[1].trim():"",nie:idMatch?idMatch[1]:""};
}
function parseSubjects(text){
 const doc=decodeHtml(text);let parts=[...doc.querySelectorAll("li")].map(x=>x.textContent.trim());
 if(!parts.length)parts=String(text||"").replace(/<\/li>/gi,";").replace(/<li[^>]*>/gi,";").replace(/<[^>]+>/g,"").split(/;\s*|\n/);
 return unique(parts.map(x=>x.trim()).filter(Boolean));
}
function parseDataValueRanges(ranges){
 const all=[];for(const range of ranges){
  const level=String(range.range||"").split("!")[0].replace(/^'|'$/g,"").replace(/''/g,"'");
  const values=range.values||[];
  let headerIndex=values.findIndex(row=>row.some(v=>normalize(v).includes("alumno/a"))&&row.some(v=>normalize(v).includes("estado")));
  if(headerIndex<0)continue;
  const cols=values[headerIndex].map(normalize);
  const col=(needle,fallback)=>{const n=cols.findIndex(x=>x.includes(needle));return n<0?fallback:n;};
  const ci={student:col("alumno/a",0),year:col("ano academico de creacion",1),situation:col("situacion del alumno",4),subjects:col("areas/materias/ambitos",5),state:col("estado",6),type:col("tipo de documento",3)};
  for(let i=headerIndex+1;i<values.length;i++){
   const row=values[i];if(!row.length||normalize(row[ci.state])!=="abierto")continue;
   const year=String(row[ci.year]||"").replace(/\//g,"-");
   if(year!==yearForData())continue;
   const st=parseStudent(row[ci.student]);if(!st.name||!st.group)continue;
   const subjects=parseSubjects(row[ci.subjects]);if(!subjects.length)continue;
   all.push({level,group:st.group,name:st.name,nie:st.nie,uid:st.nie?level+"|"+st.nie:level+"|"+st.group+"|"+normalize(st.name),situation:String(row[ci.situation]||"").trim(),type:String(row[ci.type]||"Programa de Refuerzo del Aprendizaje").trim(),subjects});
  }
 }
 return all;
}
async function readData(){
 if(!state.sheetId)throw Error("Crea o selecciona primero una copia de la hoja maestra.");
 const selected=[...document.querySelectorAll("#levelChecks input:checked")].map(x=>x.value);
 if(!selected.length)throw Error("Selecciona al menos un nivel.");
 const meta=await getSheetMetadata(state.sheetId);
 const available=selected.filter(name=>meta.sheets.some(x=>x.properties?.title===name));
 if(!available.length)throw Error("Las pestañas seleccionadas no existen en tu hoja.");
 const data=await getSheetValues(state.sheetId,available);
 state.records=parseDataValueRanges(data.valueRanges||[]);
 state.validated=true;
 renderData();
 return state.records;
}
function renderData(){
 const group=new Map();
 for(const item of state.records){const key=item.level+"|"+item.group;group.set(key,(group.get(key)||0)+1);}
 const tbody=$("dataRows");tbody.replaceChildren();
 for(const [key,count] of group){const [level,grupo]=key.split("|");const tr=document.createElement("tr");
 for(const text of [level,grupo,String(count)]){const td=document.createElement("td");td.textContent=text;tr.append(td);}
 tbody.append(tr);}
 $("dataPreview").hidden=group.size===0;
 message("dataStatus",state.records.length+" PRAs abiertos encontrados en el curso "+yearForData()+". "+group.size+" grupos. Se han excluido cursos anteriores y programas cerrados.");
 setReady("runG",state.records.length>0&&!!state.config.folderG&&!!state.config.templateG);
 refreshStudents();
}
function fill(id,arr,placeholder="Seleccionar..."){
 const node=$(id);node.replaceChildren();node.add(new Option(placeholder,""));
 for(const item of arr){if(typeof item==="string")node.add(new Option(item,item));else node.add(new Option(item.label,item.value));}
 node.disabled=!arr.length;
}
function refreshStudents(){
 const records=state.records;
 fill("levelS",unique(records.map(x=>x.level)));
 fill("groupS",[]);fill("studentS",[]);fill("situationS",[]);fill("subjectS",[]);
}
function choiceSelection(name){return [...document.querySelectorAll('#questions input[name="'+name+'"]:checked')].map(x=>x.value);}
function installQuestions(){
 const root=$("questions");root.replaceChildren();
 const make=(title,name,list,type,extra)=>{
  const box=document.createElement("div");box.className="question";
  const heading=document.createElement("h3");heading.textContent=title;
  const inner=document.createElement("div");inner.className="inner";
  const choices=document.createElement("div");choices.className="choices";
  for(const o of list){
   const label=document.createElement("label"),input=document.createElement("input"),text=document.createElement("span");
   input.type=type;input.name=name;input.value=o;text.textContent=o;label.append(input,text);choices.append(label);
  }inner.append(choices);
  if(extra){const lab=document.createElement("label");lab.textContent=extra.label;lab.htmlFor=extra.id;const ta=document.createElement("textarea");ta.id=extra.id;ta.maxLength=3000;inner.append(lab,ta);}
  box.append(heading,inner);root.append(box);
 };
 make("1. PROGRESO DEL ALUMNO/A","progress",FOLLOW_OPTIONS.progress,"checkbox");
 make("2. DIFICULTADES DETECTADAS","difficulties",FOLLOW_OPTIONS.difficulties,"checkbox",{id:"otras",label:"Especifique otras dificultades u observaciones"});
 make("3. EFICACIA DE LA MEDIDA *","efficacy",FOLLOW_OPTIONS.efficacy,"radio");
 make("4. PROPUESTAS DE MEJORA","changes",FOLLOW_OPTIONS.changes,"checkbox",{id:"observaciones",label:"Observaciones finales y recomendaciones"});
 make("5. CONTINUACIÓN DE LA MEDIDA *","continuation",FOLLOW_OPTIONS.continuation,"radio");
}
async function googleDocReplace(docId,fields){
 const requests=Object.entries(fields).map(([k,v])=>({replaceAllText:{containsText:{text:"{{"+k+"}}",matchCase:true},replaceText:String(v??"")}}));
 const r=await api(DOCS+"/"+encodeURIComponent(docId)+":batchUpdate",{method:"POST",body:{requests}});
 const changed=(r.replies||[]).reduce((s,x)=>s+(x.replaceAllText?.occurrencesChanged||0),0);
 if(changed<5)throw Error("La plantilla no contiene suficientes campos automáticos. Revisa que utilizas la plantilla del curso.");
 return r;
}
async function exportPdf(docId){
 const url=DRIVE+"/files/"+encodeURIComponent(docId)+"/export?mimeType="+encodeURIComponent("application/pdf");
 return api(url,{raw:true});
}
async function uploadFileMultipart(name,parentId,blob,mimeType,props={}){
 const boundary="pra"+Math.random().toString(36).slice(2);
 const meta={name,parents:[parentId],mimeType,appProperties:props};
 const body=new Blob(["--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n",JSON.stringify(meta),
 "\r\n--"+boundary+"\r\nContent-Type: "+mimeType+"\r\n\r\n",blob,"\r\n--"+boundary+"--\r\n"],{type:"multipart/related; boundary="+boundary});
 return api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",{method:"POST",body,headers:{"Content-Type":"multipart/related; boundary="+boundary}});
}
async function replacePdfInFolder(name,folder,pdf){
 const files=await listFiles("'"+folder+"' in parents and trashed = false and mimeType = 'application/pdf'");
 const old=files.filter(f=>f.name===name);
 const created=await uploadFileMultipart(name,folder,pdf,"application/pdf",{kind:"pra-pdf"});
 for(const f of old){try{await trashFile(f.id);}catch(e){console.warn("No se pudo retirar el PDF anterior",errorText(e));}}
 return created;
}
async function renderFolders(parent,boxId,depth=2){
 const target=$(boxId);target.replaceChildren();if(!parent)return;
 const root=await getFile(parent,"id,name,webViewLink");
 const rootLink=document.createElement("a");rootLink.href=allowedGoogleLink(parent);rootLink.target="_blank";rootLink.rel="noopener";rootLink.textContent="📁 "+root.name;target.append(rootLink);
 async function visit(pid,d){
  if(d<=0)return;
  const arr=await listFiles("'"+pid+"' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'");
  for(const f of arr){
   const a=document.createElement("a");a.href=allowedGoogleLink(f.id);a.target="_blank";a.rel="noopener";a.textContent="📁 "+"　".repeat(depth-d+1)+f.name;target.append(a);
   if(d>1)await visit(f.id,d-1);
  }
 }await visit(parent,depth);
}
async function loadMySheets(){
 const r=await listFiles("mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false and (name contains 'PRA' or name contains 'Refuerzo')",undefined,100);
 const select=document.createElement("select");select.id="mineSelect";select.setAttribute("aria-label","Seleccionar una copia propia del Gestor PRA");
 select.add(new Option("Seleccionar copia existente...",""));
 for(const f of r)select.add(new Option(f.name,f.id));
 select.addEventListener("change",()=>{if(select.value)task("sheetStatus",()=>selectSheet(select.value));});
 const old=$("mineSelect");if(old)old.remove();
 $("crearHoja").parentNode.after(select);
 if(!state.sheetId && !new URLSearchParams(location.search).has("sheet") && r.length===1 && /PRA/i.test(r[0].name))await selectSheet(r[0].id);
}
async function selectSheet(id){
 const metadata=await getFile(id,"id,name,mimeType,appProperties,webViewLink,capabilities(canEdit)");
 if(metadata.mimeType!=="application/vnd.google-apps.spreadsheet")throw Error("El archivo seleccionado no es una hoja de cálculo de Google.");
 state.sheetId=id;state.config=metadata.appProperties||{};
 state.validated=false;state.records=[];
 const link=$("sheetLink");link.hidden=false;link.href=sheetLink(id);
 $("centro").value=state.config.centro||"Mi centro";
 $("curso").value=state.config.year||"2026-2027";
 $("folderG").value=state.config.folderG?allowedGoogleLink(state.config.folderG):"";
 $("folderS").value=state.config.folderS?allowedGoogleLink(state.config.folderS):"";
 message("sheetStatus","Hoja conectada: "+metadata.name+". Los PRAs no se han cargado aún.");
 message("folderGStatus",state.config.folderG?"Carpeta configurada previamente en Google Drive.":"");
 $("formLink").value="";
 setReady("makeLink",!!state.config.folderS);
 setReady("saveS",false);
 setReady("regenS",false);
 setReady("runG",false);
 if(state.config.templateG)message("templateGStatus","Plantilla de comunicación ya preparada en Google Docs.");
 if(state.config.templateS)message("followConfigStatus","Plantilla de seguimiento configurada.");
}
async function task(id,fn){
 if(state.busy)return;
 setBusy(true);message(id,"Procesando la operación en Google Workspace...");
 try{await fn();}catch(e){message(id,errorText(e),true);console.error(e);}
 finally{setBusy(false);}
}
async function createMySheet(){
 const r=await copyFile(MASTER_SHEET,"PRA · "+$("centro").value.trim()+" · "+yearForData());
 await ensureInfantil(r.id);
 await patchAppProps(r.id,{centro:$("centro").value.trim()||"Mi centro",year:yearForData(),sourceMaster:MASTER_SHEET});
 await selectSheet(r.id);
 message("sheetStatus","Copia creada correctamente en tu Google Drive. Ábrela e importa las exportaciones de Séneca en las pestañas correspondientes.");
 await loadMySheets();
}
async function saveFolder(kind){
 if(!state.sheetId)throw Error("Selecciona primero tu hoja del PRA.");
 const id=folderId($(kind==="G"?"folderG":"folderS").value);
 const folder=await getFile(id,"id,name,mimeType,capabilities(canAddChildren)");
 if(folder.mimeType!=="application/vnd.google-apps.folder")throw Error("El enlace no corresponde a una carpeta.");
 if(folder.capabilities?.canAddChildren===false)throw Error("No tienes permisos para crear archivos en esta carpeta.");
 const key=kind==="G"?"folderG":"folderS";
 const other=kind==="G"?state.config.folderS:state.config.folderG;
 if(other===id)throw Error("Las carpetas de comunicaciones y seguimiento deben ser distintas.");
 await patchAppProps(state.sheetId,{[key]:id});
 message(kind==="G"?"folderGStatus":"followConfigStatus","Carpeta verificada y guardada en Google: "+folder.name);
 if(kind==="G")await renderFolders(id,"foldersG");
 else{await renderFolders(id,"foldersS");setReady("makeLink",true);}
 renderData();
}
async function prepareTemplate(kind){
 if(!state.sheetId)throw Error("Selecciona una hoja.");
 const key=kind==="G"?"templateG":"templateS";
 if(state.config[key]){
  try{const file=await getFile(state.config[key],"id,name,mimeType");
   window.open(docLink(file.id),"_blank","noopener");
   message(kind==="G"?"templateGStatus":"followConfigStatus","Plantilla disponible en Drive: "+file.name);
   return;
  }catch(e){state.config[key]="";}
 }
 const parent=state.config[kind==="G"?"folderG":"folderS"];
 if(!parent)throw Error("Configura primero la carpeta de destino.");
 const templateId=kind==="G"?GESTOR_TEMPLATE:FOLLOW_TEMPLATE;
 const copy=await copyFile(templateId,"Plantilla PRA - "+(kind==="G"?"Comunicaciones":"Seguimiento")+" - "+($("centro").value.trim()||"Mi centro"),parent);
 await patchAppProps(state.sheetId,{[key]:copy.id});
 message(kind==="G"?"templateGStatus":"followConfigStatus","Plantilla creada en tu Drive. Puedes editar su formato desde el enlace.");
 window.open(docLink(copy.id),"_blank","noopener");
 renderData();
}
async function generateGestor(){
 if(!state.records.length||!state.config.folderG||!state.config.templateG)throw Error("Primero comprueba los PRAs y prepara la carpeta y la plantilla.");
 let count=0;const err=[];
 const folderCache=new Map();
 for(const p of state.records){
  try{
   const k=p.level+"|"+p.group;
   let folder=folderCache.get(k);
   if(!folder){const levelId=await createFolder(p.level,state.config.folderG);folder=await createFolder(p.group,levelId);folderCache.set(k,folder);}
   const fileName="PRA - "+safeFile(p.name)+" - "+safeFile(p.group)+".pdf";
   const tmp=await copyFile(state.config.templateG,"_TEMP_PRA_"+Date.now()+"_"+count,folder);
   try{
    await googleDocReplace(tmp.id,{ALUMNO:p.name,GRUPO:p.group,TIPO_PROGRAMA:p.type,MATERIAS:p.subjects.join("; "),CURSO_ACADEMICO:yearForData()});
    const pdf=await exportPdf(tmp.id);
    await replacePdfInFolder(fileName,folder,pdf);
   }finally{await trashFile(tmp.id).catch(()=>{});}
   count++;
  }catch(e){err.push(p.group+" / "+p.name+": "+errorText(e));}
  message("generateStatus","Generadas "+count+" de "+state.records.length+" comunicaciones."+ (err.length?" Incidencias: "+err.length:""));
 }
 message("generateStatus","Generados "+count+" PDF en Drive. "+(err.length?err.length+" incidencias:\n"+err.slice(0,8).join("\n"):"Sin incidencias."),err.length>0);
 await renderFolders(state.config.folderG,"foldersG");
}
function linkForTeachers(){
 const p=new URL(location.href);p.search="";p.hash="";
 p.searchParams.set("sheet",state.sheetId);p.searchParams.set("view","seguimiento");
 return p.href;
}
async function linkFollow(){
 if(!state.sheetId||!state.config.folderS)throw Error("Configura tu hoja y la carpeta de seguimiento.");
 const link=linkForTeachers();
 $("formLink").value=link;
 setReady("copyLink",true);
 message("followConfigStatus","Enlace generado. Recuerda que los docentes deben tener permiso de lectura sobre la hoja y edición en la carpeta de seguimiento; no basta con conocer el enlace.");
}
function currentStudent(){
 const selected=$("studentS").value;
 return state.records.find(x=>x.uid===selected&&x.group===$("groupS").value&&x.level===$("levelS").value);
}
function updateGroupS(){
 fill("groupS",unique(state.records.filter(x=>x.level===$("levelS").value).map(x=>x.group)));
 fill("studentS",[]);fill("situationS",[]);fill("subjectS",[]);
}
function updateStudentS(){
 const data=state.records.filter(x=>x.level===$("levelS").value&&x.group===$("groupS").value);
 const candidates=new Map(data.map(p=>[p.uid,{value:p.uid,label:p.name}]));
 fill("studentS",[...candidates.values()]);fill("situationS",[]);fill("subjectS",[]);
}
function updateSituationS(){
 const uid=$("studentS").value;
 fill("situationS",unique(state.records.filter(x=>x.uid===uid).map(x=>x.situation)));fill("subjectS",[]);
}
function updateSubjectS(){
 const recs=state.records.filter(x=>x.uid===$("studentS").value&&x.situation===$("situationS").value);
 fill("subjectS",unique(recs.flatMap(x=>x.subjects)));
}
async function shortHash(s){
 const bytes=new TextEncoder().encode(String(s));
 const hash=await crypto.subtle.digest("SHA-256",bytes);
 return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("").slice(0,30);
}
async function followFolder(p){
 const lev=await createFolder(p.level,state.config.folderS);
 return createFolder(p.group,lev);
}
async function readRecordFiles(folder,hash){
 const files=await listFiles("'"+folder+"' in parents and trashed = false and mimeType = 'application/json'");
 const entries=files.filter(x=>x.name.startsWith("PRA_REG_"+hash+"_"));
 const records=[];
 for(const f of entries){
  try{
   const data=await api(DRIVE+"/files/"+encodeURIComponent(f.id)+"?alt=media");
   if(data.studentKey===hash)records.push({...data,_fileId:f.id});
  }catch(e){console.warn("Omitido registro inválido",f.name);}
 }
 records.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 const latest=new Map();
 for(const r of records){latest.set(normalize(r.subject),r);}
 return [...latest.values()].sort((a,b)=>String(a.subject).localeCompare(String(b.subject),"es"));
}
function followFields(r){
 return {ALUMNO:r.student,GRUPO:r.group,CURSO_ESCOLAR:r.year,PROFESOR:r.teacher,MATERIA:r.subject,
 PROGRESO:(r.progress||[]).join("; "),DIFICULTADES:(r.difficulties||[]).join("; "),OTRAS_DIFICULTADES:r.other||"",
 EFICACIA:r.efficacy,MODIFICACIONES:(r.changes||[]).join("; "),OBSERVACIONES:r.observations||"",CONTINUIDAD:r.continuation,
 FECHA:new Date(r.date).toLocaleString("es-ES")};
}
function followParagraph(r){
 const f=followFields(r);
 return "\n\nSEGUIMIENTO DE LA MEDIDA ESPECÍFICA\n"+
 "Alumno/a: "+f.ALUMNO+"\nGrupo: "+f.GRUPO+"\nCurso escolar: "+f.CURSO_ESCOLAR+"\nProfesor/a: "+f.PROFESOR+
 "\nMateria: "+f.MATERIA+"\n\n1. Progreso: "+f.PROGRESO+"\n\n2. Dificultades detectadas: "+f.DIFICULTADES+
 "\nOtras dificultades: "+f.OTRAS_DIFICULTADES+"\n\n3. Eficacia: "+f.EFICACIA+
 "\n\n4. Modificaciones propuestas: "+f.MODIFICACIONES+"\nObservaciones: "+f.OBSERVACIONES+
 "\n\n5. Continuación: "+f.CONTINUIDAD+"\nFecha: "+f.FECHA+"\n";
}
async function createFollowPdf(p,folder,hash){
 const records=await readRecordFiles(folder,hash);
 if(!records.length)throw Error("No hay seguimientos guardados para este alumno.");
 const templateId=state.config.templateS;
 if(!templateId)throw Error("Configura la plantilla de seguimiento.");
 const tmp=await copyFile(templateId,"_TEMP_SEGUIMIENTO_"+hash+"_"+Date.now(),folder);
 try{
  await googleDocReplace(tmp.id,followFields(records[0]));
  for(const r of records.slice(1)){
   await api(DOCS+"/"+encodeURIComponent(tmp.id)+":batchUpdate",{method:"POST",body:{requests:[
    {insertPageBreak:{endOfSegmentLocation:{}}},
    {insertText:{endOfSegmentLocation:{},text:followParagraph(r)}}
   ]}});
  }
  const pdf=await exportPdf(tmp.id);
  const name="Seguimiento PRA - "+safeFile(p.name)+" - "+safeFile(p.group)+".pdf";
  const out=await replacePdfInFolder(name,folder,pdf);
  return {out,records};
 }finally{await trashFile(tmp.id).catch(()=>{});}
}
async function saveFollow(){
 if(!state.sheetId||!state.config.folderS)throw Error("Falta configurar la carpeta del seguimiento.");
 const p=currentStudent();if(!p)throw Error("Selecciona un alumno.");
 const situation=$("situationS").value,subject=$("subjectS").value;
 if(!subject||!situation||!p.subjects.includes(subject))throw Error("Materia y situación no válidas.");
 const teacher=$("teacher").value.trim();if(!/^[^,]+,\s*[^,]+$/.test(teacher))throw Error("Escribe el nombre como «Apellidos, nombre».");
 const efficacy=choiceSelection("efficacy")[0],continuation=choiceSelection("continuation")[0];
 if(!efficacy||!continuation)throw Error("Debes elegir las respuestas 3 y 5.");
 const hash=await shortHash(p.uid),folder=await followFolder(p);
 const name="PRA_REG_"+hash+"_"+(await shortHash(subject))+"_"+Date.now()+".json";
 const record={studentKey:hash,student:p.name,group:p.group,level:p.level,year:yearForData(),email:state.email,teacher,
 situation,subject,progress:choiceSelection("progress"),difficulties:choiceSelection("difficulties"),
 other:$("otras").value,efficacy,changes:choiceSelection("changes"),observations:$("observaciones").value,
 continuation,date:new Date().toISOString()};
 const blob=new Blob([JSON.stringify(record)],{type:"application/json"});
 const uploaded=await uploadFileMultipart(name,folder,blob,"application/json",{kind:"pra-followup-record"});
 message("saveStatus","Respuesta guardada en Google Drive. Preparando PDF acumulativo...");
 try{
  const result=await createFollowPdf(p,folder,hash);
  message("saveStatus","Seguimiento guardado. PDF acumulativo actualizado con "+result.records.length+" materias para "+p.name+".");
  await renderFolders(state.config.folderS,"foldersS");
 }catch(e){message("saveStatus","La respuesta se ha conservado en Drive, pero no se pudo actualizar el PDF: "+errorText(e),true);}
}
async function regenFollow(){
 const p=currentStudent();if(!p)throw Error("Selecciona un alumno.");const folder=await followFolder(p),hash=await shortHash(p.uid);
 const result=await createFollowPdf(p,folder,hash);
 message("saveStatus","PDF regenerado con "+result.records.length+" materias.");await renderFolders(state.config.folderS,"foldersS");
}
function switchTab(name){
 for(const tab of document.querySelectorAll(".tab"))tab.classList.toggle("active",tab.dataset.tab===name);
 for(const panel of document.querySelectorAll(".panel"))panel.classList.toggle("active",panel.id===name);
 window.scrollTo({top:0,behavior:"smooth"});
}
function init(){
 const cid=window.PRA_OAUTH_CLIENT_ID||"";
 if(cid){state.clientId=cid;$("clientId").value=cid;$("oauthSetup").hidden=true;}
 $("saveClient").addEventListener("click",()=>{state.clientId=$("clientId").value.trim();try{state.client=tokenClient();message("sessionMessage","ID de cliente aplicado. Pulsa Conectar Google.");}catch(e){message("sessionMessage",errorText(e),true);}});
 $("btnLogin").addEventListener("click",()=>{try{if(!state.client)state.client=tokenClient();state.client.requestAccessToken({prompt:"consent"});}catch(e){message("sessionMessage",errorText(e),true);}});
 $("btnLogout").addEventListener("click",()=>{
  if(state.token&&window.google?.accounts?.oauth2)google.accounts.oauth2.revoke(state.token,()=>{});
  state.token="";state.sheetId="";state.records=[];state.config={};state.email="";state.expires=0;
  $("connState").textContent="Sin conectar";$("sessionInfo").textContent="Sin conexión a Google";$("teacherEmail").value="";
  $("btnLogout").disabled=true;message("sessionMessage","Sesión desconectada.");
 });
 for(const t of document.querySelectorAll(".tab"))t.addEventListener("click",()=>switchTab(t.dataset.tab));
 const checks=$("levelChecks");
 for(const name of LEVELS){
  const label=document.createElement("label"),input=document.createElement("input"),text=document.createElement("span");
  input.type="checkbox";input.value=name;input.checked=name!=="Infantil";
  text.textContent=name;label.append(input,text);checks.append(label);
 }
 $("checkAll").addEventListener("click",()=>checks.querySelectorAll("input").forEach(x=>x.checked=true));
 $("checkNone").addEventListener("click",()=>checks.querySelectorAll("input").forEach(x=>x.checked=false));
 $("crearHoja").addEventListener("click",()=>task("sheetStatus",createMySheet));
 $("checkG").addEventListener("click",()=>task("folderGStatus",()=>saveFolder("G")));
 $("copyTemplateG").addEventListener("click",()=>task("templateGStatus",()=>prepareTemplate("G")));
 $("checkData").addEventListener("click",()=>task("dataStatus",readData));
 $("runG").addEventListener("click",()=>task("generateStatus",generateGestor));
 $("refreshFoldersG").addEventListener("click",()=>task("generateStatus",async()=>{if(!state.config.folderG)throw Error("Configura primero la carpeta.");await renderFolders(state.config.folderG,"foldersG");}));
 $("checkS").addEventListener("click",()=>task("followConfigStatus",()=>saveFolder("S")));
 $("copyTemplateS").addEventListener("click",()=>task("followConfigStatus",()=>prepareTemplate("S")));
 $("makeLink").addEventListener("click",()=>task("followConfigStatus",linkFollow));
 $("copyLink").addEventListener("click",async()=>{try{await navigator.clipboard.writeText($("formLink").value);message("followConfigStatus","Enlace copiado.");}catch(e){message("followConfigStatus",errorText(e),true);}});
 $("loadStudents").addEventListener("click",()=>task("studentStatus",async()=>{await readData();message("studentStatus",state.records.length+" PRAs abiertos disponibles para seleccionar.");}));
 $("levelS").addEventListener("change",updateGroupS);
 $("groupS").addEventListener("change",updateStudentS);
 $("studentS").addEventListener("change",updateSituationS);
 $("situationS").addEventListener("change",updateSubjectS);
 $("saveS").addEventListener("click",()=>task("saveStatus",saveFollow));
 $("regenS").addEventListener("click",()=>task("saveStatus",regenFollow));
 const updateReady=()=>{
  const ok=!!state.sheetId&&!!state.config.folderS&&!!state.config.templateS&&!!$("subjectS").value;
  setReady("saveS",ok);setReady("regenS",ok);
 };
 ["levelS","groupS","studentS","situationS","subjectS"].forEach(id=>$(id).addEventListener("change",updateReady));
 installQuestions();
 for(const id of ["runG","makeLink","copyLink","saveS","regenS"])setReady(id,false);
 const params=new URLSearchParams(location.search);
 if(params.get("view")==="seguimiento")switchTab("seguimiento");
 if(cid){try{state.client=tokenClient();}catch(e){message("sessionMessage",errorText(e),true);}}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
