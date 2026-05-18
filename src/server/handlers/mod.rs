use std::sync::Arc;

use axum::extract::{Query, State};
use axum::response::Html;
use serde::Deserialize;

use super::AppState;

static INDEX_HTML: &str = include_str!("../../../web/index.html");

pub async fn serve_index() -> Html<&'static str> {
    Html(INDEX_HTML)
}

pub async fn api_all(State(state): State<Arc<AppState>>) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;

    let (mmx_ts, mmx_models) = db.latest_minimax_with_ts().unwrap_or((0, vec![]));
    let mmx_status = provider_status(
        state.minimax_key.read().await.is_some(),
        if mmx_ts > 0 { Some(mmx_ts) } else { None },
    );

    let ds_balance = db.latest_deepseek().unwrap_or_default();
    let ds_status = provider_status(
        state.deepseek_key.read().await.is_some(),
        ds_balance.as_ref().map(|s| s.timestamp),
    );

    let zai_quota = db.latest_zai().unwrap_or_default();
    let zai_status = provider_status(
        state.zai_token.read().await.is_some(),
        zai_quota.as_ref().map(|s| s.timestamp),
    );

    drop(db);

    let mut mmx_models_json = Vec::new();
    for m in &mmx_models {
        mmx_models_json.push(serde_json::json!({
            "model_name": m.name,
            "current_interval_usage_count": m.interval_usage,
            "current_interval_total_count": m.interval_total,
            "current_weekly_usage_count": m.weekly_usage,
            "current_weekly_total_count": m.weekly_total,
        }));
    }

    axum::Json(serde_json::json!({
        "minimax": { "models": mmx_models_json, "status": mmx_status },
        "deepseek": { "balance": ds_balance, "status": ds_status },
        "zai": { "quota": zai_quota, "status": zai_status },
        "_nextPoll": state.next_poll.load(std::sync::atomic::Ordering::Relaxed),
    }))
}

pub async fn api_quota(
    State(state): State<Arc<AppState>>,
) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;
    let (_, models) = db.latest_minimax_with_ts().unwrap_or((0, vec![]));
    drop(db);

    let mut remains = Vec::new();
    for m in &models {
        remains.push(serde_json::json!({
            "model_name": m.name,
            "current_interval_usage_count": m.interval_usage,
            "current_interval_total_count": m.interval_total,
            "current_weekly_usage_count": m.weekly_usage,
            "current_weekly_total_count": m.weekly_total,
        }));
    }

    axum::Json(serde_json::json!({
        "model_remains": remains,
        "base_resp": { "status_code": 0 },
        "_nextPoll": state.next_poll.load(std::sync::atomic::Ordering::Relaxed),
    }))
}

#[derive(Deserialize)]
pub struct ModelQuery {
    pub model: Option<String>,
}

pub async fn api_history(
    State(state): State<Arc<AppState>>,
    Query(q): Query<ModelQuery>,
) -> axum::Json<serde_json::Value> {
    let model = q.model.as_deref().unwrap_or("MiniMax-M*");
    let db = state.db.lock().await;
    let history = db.minimax_history_24h(model).unwrap_or_default();
    drop(db);
    axum::Json(serde_json::json!(history))
}

pub async fn api_weekly_history(
    State(state): State<Arc<AppState>>,
    Query(q): Query<ModelQuery>,
) -> axum::Json<serde_json::Value> {
    let model = q.model.as_deref().unwrap_or("MiniMax-M*");
    let db = state.db.lock().await;
    let history = db.weekly_history(model);
    drop(db);
    axum::Json(serde_json::json!(history))
}

pub async fn api_consumption(
    State(state): State<Arc<AppState>>,
) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;
    let summary = db.consumption_summary();
    drop(db);
    axum::Json(summary)
}

pub async fn api_deepseek(
    State(state): State<Arc<AppState>>,
) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;
    let balance = db.latest_deepseek().unwrap_or_default();
    drop(db);

    let status = provider_status(
        state.deepseek_key.read().await.is_some(),
        balance.as_ref().map(|s| s.timestamp),
    );

    axum::Json(serde_json::json!({
        "balance": balance,
        "status": status,
    }))
}

#[derive(Deserialize)]
pub struct HoursQuery {
    pub hours: Option<u64>,
}

pub async fn api_deepseek_history(
    State(state): State<Arc<AppState>>,
    Query(q): Query<HoursQuery>,
) -> axum::Json<serde_json::Value> {
    let hours = q.hours.unwrap_or(24);
    let db = state.db.lock().await;
    let history = db.deepseek_history(hours).unwrap_or_default();
    drop(db);
    axum::Json(serde_json::json!(history))
}

pub async fn api_zai(
    State(state): State<Arc<AppState>>,
) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;
    let quota = db.latest_zai().unwrap_or_default();
    drop(db);

    let status = provider_status(
        state.zai_token.read().await.is_some(),
        quota.as_ref().map(|s| s.timestamp),
    );

    axum::Json(serde_json::json!({
        "quota": quota,
        "status": status,
    }))
}

pub async fn api_zai_history(
    State(state): State<Arc<AppState>>,
    Query(q): Query<HoursQuery>,
) -> axum::Json<serde_json::Value> {
    let hours = q.hours.unwrap_or(24);
    let db = state.db.lock().await;
    let history = db.zai_history(hours).unwrap_or_default();
    drop(db);
    axum::Json(serde_json::json!(history))
}

pub async fn api_config_get(
    State(state): State<Arc<AppState>>,
) -> axum::Json<serde_json::Value> {
    let mask = |key: &Option<String>| -> String {
        match key {
            Some(k) if k.len() > 4 => format!("\u{2022}\u{2022}\u{2022}\u{2022}{}", &k[k.len() - 4..]),
            Some(k) => k.clone(),
            None => String::new(),
        }
    };

    let mmx = state.minimax_key.read().await;
    let ds = state.deepseek_key.read().await;
    let zai = state.zai_token.read().await;

    axum::Json(serde_json::json!({
        "minimax_api_key": mask(&mmx),
        "deepseek_api_key": mask(&ds),
        "zai_auth_token": mask(&zai),
        "minimax_configured": mmx.is_some(),
        "deepseek_configured": ds.is_some(),
        "zai_configured": zai.is_some(),
    }))
}

#[derive(Deserialize)]
pub struct ConfigBody {
    pub minimax_api_key: Option<String>,
    pub deepseek_api_key: Option<String>,
    pub zai_auth_token: Option<String>,
}

pub async fn api_config_put(
    State(state): State<Arc<AppState>>,
    axum::Json(body): axum::Json<ConfigBody>,
) -> axum::Json<serde_json::Value> {
    let masked_prefix = "\u{2022}\u{2022}\u{2022}\u{2022}";

    if let Some(ref key) = body.minimax_api_key {
        if !key.starts_with(masked_prefix) && !key.is_empty() {
            *state.minimax_key.write().await = Some(key.clone());
        }
    }
    if let Some(ref key) = body.deepseek_api_key {
        if !key.starts_with(masked_prefix) && !key.is_empty() {
            *state.deepseek_key.write().await = Some(key.clone());
        }
    }
    if let Some(ref token) = body.zai_auth_token {
        if !token.starts_with(masked_prefix) && !token.is_empty() {
            *state.zai_token.write().await = Some(token.clone());
        }
    }

    let mmx = state.minimax_key.read().await;
    let ds = state.deepseek_key.read().await;
    let zai = state.zai_token.read().await;

    let config = crate::config::AppConfig {
        quota: crate::config::QuotaConfig {
            minimax: Some(crate::config::KeyConfig {
                api_key: mmx.clone(),
                api_key_env: None,
            }),
            deepseek: Some(crate::config::KeyConfig {
                api_key: ds.clone(),
                api_key_env: None,
            }),
            zai: Some(crate::config::ZaiKeyConfig {
                auth_token: zai.clone(),
                auth_token_env: None,
            }),
            ..Default::default()
        },
    };

    let toml_str = toml::to_string_pretty(&config).unwrap_or_default();
    let _ = std::fs::write(&state.config_path, toml_str);

    axum::Json(serde_json::json!({"ok": true}))
}

pub async fn api_refresh(
    State(state): State<Arc<AppState>>,
) -> axum::Json<serde_json::Value> {
    super::do_poll(state.clone()).await;
    axum::Json(serde_json::json!({
        "ok": true,
        "_nextPoll": state.next_poll.load(std::sync::atomic::Ordering::Relaxed),
    }))
}

fn provider_status(
    configured: bool,
    last_ts: Option<i64>,
) -> serde_json::Value {
    if !configured {
        return serde_json::json!({"status": "no_key"});
    }
    match last_ts {
        Some(ts) => serde_json::json!({"status": "ok", "lastTs": ts}),
        None => serde_json::json!({"status": "waiting"}),
    }
}
pub async fn mcp_handler(
    axum::Json(req): axum::Json<serde_json::Value>,
) -> axum::Json<serde_json::Value> {
    let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let id = req.get("id").cloned();
    let result = match method {
        "initialize" => serde_json::json!({
            "jsonrpc":"2.0","id":id,
            "result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},
            "serverInfo":{"name":"AgentSense","version":env!("CARGO_PKG_VERSION")}}
        }),
        "notifications/initialized" => serde_json::json!({"jsonrpc":"2.0","id":id,"result":{}}),
        "tools/list" => tools_list_json(&id),
        "tools/call" => tools_call_dispatch(&id, req.get("params")).await,
        _ => serde_json::json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":format!("Unknown: {method}")}}),
    };
    axum::Json(result)
}

// Dispatched via spawn_blocking to keep the handler future Send
async fn tools_call_dispatch(id: &Option<serde_json::Value>, params: Option<&serde_json::Value>) -> serde_json::Value {
    let id = id.clone();
    let params_val = params.cloned();
    tokio::task::spawn_blocking(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(tools_call_json(&id, params_val.as_ref()))
    }).await.unwrap_or_else(|e| err_resp(&None, &format!("Task panic: {e}")))
}

fn tools_list_json(id: &Option<serde_json::Value>) -> serde_json::Value {
    let tools: Vec<serde_json::Value> = vec![
        tool_def("doc_open","Open a PDF, return metadata and TOC",&[("path","string","PDF path")]),
        tool_def("doc_read","Read PDF text. Optional pages array; omit for full text",&[("path","string","PDF path"),("pages","array","Optional page numbers")]),
        tool_def("doc_read_page","Read single PDF page by number",&[("path","string","PDF path"),("page","integer","Page number (1-indexed)")]),
        tool_def("doc_toc","Get PDF table of contents tree",&[("path","string","PDF path")]),
        tool_def("doc_section","Read PDF section by TOC title",&[("path","string","PDF path"),("title","string","Section title")]),
        tool_def("doc_images","List PDF images with dimensions",&[("path","string","PDF path")]),
        tool_def("doc_extract_image","Extract PDF image as base64",&[("path","string","PDF path"),("page","integer","Page"),("index","integer","Image index (0-based)")]),
        tool_def("epub_open","Open EPUB, return metadata and TOC",&[("path","string","EPUB path")]),
        tool_def("epub_read_chapter","Read EPUB chapter by number",&[("path","string","EPUB path"),("chapter","integer","Chapter number")]),
        tool_def("epub_toc","Get EPUB table of contents",&[("path","string","EPUB path")]),
        tool_def("epub_read_section","Read EPUB section by TOC title",&[("path","string","EPUB path"),("title","string","Section title")]),
        tool_def("quota_status","Get AI quota for MiniMax/DeepSeek/Z.AI",&[]),
    ];
    serde_json::json!({"jsonrpc":"2.0","id":id,"result":{"tools":tools}})
}

fn tool_def(name:&str, desc:&str, props:&[(&str,&str,&str)]) -> serde_json::Value {
    let mut p = serde_json::Map::new();
    let mut r = Vec::new();
    for (k,t,d) in props {
        p.insert(k.to_string(), serde_json::json!({"type":t,"description":d}));
        r.push(serde_json::Value::String(k.to_string()));
    }
    serde_json::json!({"name":name,"description":desc,"inputSchema":{"type":"object","properties":p,"required":r}})
}

async fn tools_call_json(id: &Option<serde_json::Value>, params: Option<&serde_json::Value>) -> serde_json::Value {
    let params = match params { Some(p) => p, None => return err_resp(id,"Missing params") };
    let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let empty_args = serde_json::json!({});
    let args = params.get("arguments").unwrap_or(&empty_args);
    let text = match name {
        "doc_open" => tool_doc_open(args).await,
        "doc_read" => tool_doc_read(args).await,
        "doc_read_page" => tool_doc_read_page(args).await,
        "doc_toc" => tool_doc_toc(args).await,
        "doc_section" => tool_doc_section(args).await,
        "doc_images" => tool_doc_images(args).await,
        "doc_extract_image" => tool_doc_extract_image(args).await,
        "epub_open" => tool_epub_open(args).await,
        "epub_read_chapter" => tool_epub_read_chapter(args).await,
        "epub_toc" => tool_epub_toc(args).await,
        "epub_read_section" => tool_epub_read_section(args).await,
        "quota_status" => tool_quota_status().await,
        _ => return err_resp(id, &format!("Unknown tool: {name}")),
    };
    serde_json::json!({"jsonrpc":"2.0","id":id,"result":{"content":[{"type":"text","text":text}]}})
}

fn err_resp(id: &Option<serde_json::Value>, msg: &str) -> serde_json::Value {
    serde_json::json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":msg}})
}

// ── Tool implementations ────────────────────────────────────────────

fn get_str<'a>(args: &'a serde_json::Value, k: &str) -> Result<String, String> {
    args.get(k).and_then(|v| v.as_str()).map(|s| s.to_string()).ok_or_else(|| format!("Missing: {k}"))
}
fn get_u64(args: &serde_json::Value, k: &str) -> Result<u64, String> {
    args.get(k).and_then(|v| v.as_u64()).ok_or_else(|| format!("Missing: {k}"))
}
fn to_json(v: &serde_json::Value) -> String { serde_json::to_string_pretty(v).unwrap_or_default() }

async fn tool_doc_open(args: &serde_json::Value) -> String {
    let path = match get_str(args, "path") { Ok(p) => p, Err(e) => return e };
    let doc = match crate::PdfDocument::open(std::path::Path::new(&path)) {
        Ok(d) => d, Err(e) => return e.to_string(),
    };
    let info = doc.info();
    let outline = doc.outline().unwrap_or_default();
    to_json(&serde_json::json!({
        "path":path,"title":info.title(),"author":info.author(),
        "creator":info.creator(),"producer":info.producer(),
        "page_count":info.page_count(),"page_size_pt":[info.page_width_pt(),info.page_height_pt()],
        "toc": toc_to_json(&outline),
    }))
}

async fn tool_doc_read(args: &serde_json::Value) -> String {
    let path = match get_str(args, "path") { Ok(p) => p, Err(e) => return e };
    let doc = match crate::PdfDocument::open(std::path::Path::new(&path)) {
        Ok(d) => d, Err(e) => return e.to_string(),
    };
    if let Some(pages) = args.get("pages").and_then(|v| v.as_array()) {
        let mut out = String::new();
        for p in pages { if let Some(n) = p.as_u64() {
            match doc.read_page(n as usize) {
                Ok(t) => out.push_str(&format!("\n--- Page {n} ---\n{t}")),
                Err(e) => out.push_str(&format!("\n[P{n}: {e}]")),
            }
        }}
        out
    } else { doc.text().unwrap_or_else(|e| e.to_string()) }
}

async fn tool_doc_read_page(args: &serde_json::Value) -> String {
    let path = match get_str(args,"path"){Ok(p)=>p,Err(e)=>return e};
    let page = match get_u64(args,"page"){Ok(p)=>p as usize,Err(e)=>return e};
    let doc = match crate::PdfDocument::open(std::path::Path::new(&path)) {
        Ok(d)=>d,Err(e)=>return e.to_string()};
    doc.read_page(page).unwrap_or_else(|e|e.to_string())
}

async fn tool_doc_toc(args: &serde_json::Value) -> String {
    let path = match get_str(args,"path"){Ok(p)=>p,Err(e)=>return e};
    match crate::PdfDocument::open(std::path::Path::new(&path)) {
        Ok(d) => match d.outline() {
            Ok(o) => to_json(&serde_json::json!({"toc":toc_to_json(&o)})),
            Err(e) => e.to_string(),
        },
        Err(e) => e.to_string(),
    }
}

async fn tool_doc_section(args: &serde_json::Value) -> String {
    let path = match get_str(args,"path"){Ok(p)=>p,Err(e)=>return e};
    let title = match get_str(args,"title"){Ok(t)=>t,Err(e)=>return e};
    let doc = match crate::PdfDocument::open(std::path::Path::new(&path)) {
        Ok(d)=>d,Err(e)=>return e.to_string()};
    let outline = match doc.outline(){Ok(o)=>o,Err(e)=>return e.to_string()};
    if let Some(entry) = find_toc(&outline, &title) {
        if let crate::TocLocation::Pdf{page} = entry.location {
            return doc.read_page(page).unwrap_or_else(|e|e.to_string());
        }
    }
    format!("Section '{title}' not found. Available: {:?}",
        outline.iter().map(|e|&e.title).collect::<Vec<_>>())
}

async fn tool_doc_images(args: &serde_json::Value) -> String {
    let path = match get_str(args,"path"){Ok(p)=>p,Err(e)=>return e};
    match crate::PdfDocument::open(std::path::Path::new(&path)) {
        Ok(d) => match d.list_images() {
            Ok(imgs) => to_json(&serde_json::json!({
                "count":imgs.len(),
                "images":imgs.iter().map(|i|serde_json::json!({
                    "page":i.page,"index":i.index,"name":i.name,"width":i.width,"height":i.height
                })).collect::<Vec<_>>()
            })),
            Err(e)=>e.to_string()
        },
        Err(e)=>e.to_string()
    }
}

async fn tool_doc_extract_image(args: &serde_json::Value) -> String {
    let path = match get_str(args,"path"){Ok(p)=>p,Err(e)=>return e};
    let page = match get_u64(args,"page"){Ok(p)=>p as usize,Err(e)=>return e};
    let index = match get_u64(args,"index"){Ok(i)=>i as usize,Err(e)=>return e};
    match crate::PdfDocument::open(std::path::Path::new(&path)) {
        Ok(d) => match d.extract_image(page, index) {
            Ok(data) => {
                use base64::Engine;
                to_json(&serde_json::json!({
                    "page":page,"index":index,"size_bytes":data.len(),
                    "base64":base64::engine::general_purpose::STANDARD.encode(&data),
                    "format": if data.starts_with(&[0xff,0xd8]){"jpeg"}else{"unknown"},
                }))
            }
            Err(e)=>e.to_string()
        },
        Err(e)=>e.to_string()
    }
}

async fn tool_epub_open(args: &serde_json::Value) -> String {
    let path = match get_str(args,"path"){Ok(p)=>p,Err(e)=>return e};
    match crate::EpubDocument::open(std::path::Path::new(&path)) {
        Ok(d) => to_json(&serde_json::json!({
            "path":path,"title":d.title(),"author":d.author(),
            "chapter_count":d.chapter_count(),"toc":toc_to_json(d.toc()),
        })),
        Err(e)=>e.to_string()
    }
}

async fn tool_epub_read_chapter(args: &serde_json::Value) -> String {
    let path = match get_str(args,"path"){Ok(p)=>p,Err(e)=>return e};
    let ch = match get_u64(args,"chapter"){Ok(c)=>c as usize,Err(e)=>return e};
    match crate::EpubDocument::open(std::path::Path::new(&path)) {
        Ok(d)=>d.read_chapter(ch).unwrap_or_else(|e|e.to_string()),
        Err(e)=>e.to_string()
    }
}

async fn tool_epub_toc(args: &serde_json::Value) -> String {
    let path = match get_str(args,"path"){Ok(p)=>p,Err(e)=>return e};
    match crate::EpubDocument::open(std::path::Path::new(&path)) {
        Ok(d)=>to_json(&serde_json::json!({"toc":toc_to_json(d.toc())})),
        Err(e)=>e.to_string()
    }
}

async fn tool_epub_read_section(args: &serde_json::Value) -> String {
    let path = match get_str(args,"path"){Ok(p)=>p,Err(e)=>return e};
    let title = match get_str(args,"title"){Ok(t)=>t,Err(e)=>return e};
    match crate::EpubDocument::open(std::path::Path::new(&path)) {
        Ok(d) => {
            if let Some(entry) = find_toc(d.toc(), &title) {
                d.read_toc_entry(entry).unwrap_or_else(|e|e.to_string())
            } else { format!("Section '{title}' not found") }
        },
        Err(e)=>e.to_string()
    }
}

async fn tool_quota_status() -> String {
    let config = crate::AppConfig::load(&std::path::PathBuf::from("config.toml")).unwrap_or_default();
    let orch = match crate::quota::QuotaOrchestrator::new(&config.quota) {
        Ok(o)=>o, Err(e)=>return e.to_string(),
    };
    let r = orch.fetch_all().await;
    let mut json = serde_json::json!({});
    if let Some(Ok(s))=&r.minimax{json["minimax"]=serde_json::json!({
        "models":s.models.iter().map(|m|serde_json::json!({
            "name":m.name,"interval_remaining":m.interval_total-m.interval_usage,
            "interval_total":m.interval_total,"weekly_remaining":m.weekly_total-m.weekly_usage,"weekly_total":m.weekly_total
        })).collect::<Vec<_>>()});
    }
    if let Some(Ok(s))=&r.deepseek{json["deepseek"]=serde_json::json!({
        "balance_cny":s.total_balance_cny,"balance_usd":s.total_balance_usd
    });}
    if let Some(Ok(s))=&r.zai{json["zai"]=serde_json::json!({
        "token_5h_pct":s.token_5h_pct,"token_week_pct":s.token_week_pct,"mcp_month_pct":s.mcp_month_pct
    });}
    to_json(&json)
}

fn toc_to_json(toc: &[crate::TocEntry]) -> serde_json::Value {
    toc.iter().map(|e|{
        let loc = match &e.location {
            crate::TocLocation::Pdf{page}=>serde_json::json!({"type":"pdf","page":page}),
            crate::TocLocation::Epub{path,fragment}=>serde_json::json!({"type":"epub","path":path,"fragment":fragment}),
        };
        serde_json::json!({"title":e.title,"level":e.level,"location":loc,"children":toc_to_json(&e.children)})
    }).collect()
}

fn find_toc<'a>(toc:&'a [crate::TocEntry], title:&str) -> Option<&'a crate::TocEntry> {
    for e in toc { if e.title.contains(title)||title.contains(&e.title){return Some(e);}
        if let Some(f)=find_toc(&e.children,title){return Some(f);}
    } None
}
